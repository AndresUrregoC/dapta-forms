import { getFormById, type Db } from '@quill/db';
import {
  summarizeAnswers,
  type Answers,
  type FormConfig as EngineConfig,
  type SubmissionFacets,
  type SubmissionsSummary,
} from '@quill/engine';
import {
  BackendError,
  type AnswerSearchPage,
  type AnswerSearchQuery,
  type BrandKitView,
  type CsvExport,
  type CsvQuery,
  type DeliveriesQuery,
  type DeliveryItem,
  type DestinationsResult,
  type FolderItem,
  type FormDetail,
  type FormsBackend,
  type McpCaller,
  type MemberProfile,
  type NotificationKey,
  type NotificationPatch,
  type NotificationView,
  type ResponseDetail,
  type ResponseFile,
  type ResponseFilter,
  type VanityStatus,
  type WebhookPing,
} from '@quill/mcp';
import type { AdminCrudController } from './admin-crud.controller';
import type { AnalyticsController } from './analytics.controller';
import type { BrandingController } from './branding.controller';
import type { FormDestinationsController, IntegrationsController } from './integrations.controller';
import { ApiFormsBackend, detailOf, reqOf, run, type McpHandlers } from './mcp.backend';
import type { FilterQuery } from './submission-filter';

/**
 * forms-api's side of the rest of the MCP port (`ApiParityBackend` in
 * `@quill/mcp`): one method per route of the public API reference that the
 * first tools did not cover.
 *
 * Same rule as `ApiFormsBackend`: every method runs the handler the REST
 * route runs, in process, on the caller's in-process request, so the route's
 * principal resolution, account scope, role check (`assertAdmin` where the
 * route has it), validation, secret masking and product events all apply,
 * with nothing restated here. Where a route answers 204 for an id it cannot
 * see (deleting a form, a folder or a response), the method first reads it
 * through the matching read route, so the agent hears NOT_FOUND instead of a
 * success that did nothing.
 */

/** Every handler the parity tools call, by controller. Each is checked against the API-key allowlist at boot. */
export const MCP_PARITY_HANDLERS = {
  forms: [
    'getForm',
    'updateFormSlug',
    'duplicateForm',
    'setFormFolder',
    'deleteForm',
    'listFolders',
    'createFolder',
    'renameFolder',
    'deleteFolder',
    'submissionFile',
    'formDeliveries',
    'notifications',
    'updateNotification',
    'resetNotification',
    'formNotifications',
    'updateFormNotification',
    'resetFormNotification',
    'myProfile',
    'vanity',
  ],
  analytics: ['submission', 'exportCsv', 'deleteSubmission', 'deleteSubmissions', 'formSummary', 'submissionFacets', 'summaryAnswers'],
  destinations: ['putDestinations', 'pingWebhook'],
  branding: ['get', 'put', 'apply', 'revert'],
  integrations: ['list', 'webhooks', 'hubspotProperties', 'calendlyEventTypes'],
} as const;

type Names<K extends keyof typeof MCP_PARITY_HANDLERS> = (typeof MCP_PARITY_HANDLERS)[K][number];

/** The handlers the parity methods call. The controllers themselves in the app; fakes in a spec. */
export interface McpParityHandlers {
  forms: Pick<AdminCrudController, Names<'forms'>>;
  analytics: Pick<AnalyticsController, Names<'analytics'>>;
  destinations: Pick<FormDestinationsController, Names<'destinations'>>;
  branding: Pick<BrandingController, Names<'branding'>>;
  integrations: Pick<IntegrationsController, Names<'integrations'>>;
}

/** The response filter as the REST routes read their query string. */
function filterQuery(f: ResponseFilter): FilterQuery {
  return {
    ...(f.status && f.status !== 'all' ? { status: f.status } : {}),
    ...(f.from !== undefined ? { from: f.from } : {}),
    ...(f.to !== undefined ? { to: f.to } : {}),
    ...(f.scoreMin !== undefined ? { scoreMin: String(f.scoreMin) } : {}),
    ...(f.scoreMax !== undefined ? { scoreMax: String(f.scoreMax) } : {}),
    ...(f.answers !== undefined ? { answers: JSON.stringify(f.answers) } : {}),
    ...(f.search !== undefined ? { search: f.search } : {}),
  };
}

/**
 * A stream that keeps what the CSV route writes, cut to the caps. The route
 * writes the header (after the byte-order mark) first, then one row per
 * write, so every write after the first is one data row.
 */
export class CsvCollector {
  private header: string | null = null;
  private readonly kept: string[] = [];
  private chars = 0;
  /** Set at the first row that does not fit: the rows kept are always the first ones, never a set with a gap. */
  private full = false;
  total = 0;

  constructor(
    private readonly maxRows: number,
    private readonly maxChars: number,
  ) {}

  setHeader(): void {}

  write(chunk: string): void {
    if (this.header === null) {
      this.header = chunk.replace(/^\uFEFF/, '');
      return;
    }
    this.total += 1;
    if (this.full) return;
    if (this.kept.length >= this.maxRows || this.chars + chunk.length > this.maxChars) {
      this.full = true;
      return;
    }
    this.kept.push(chunk);
    this.chars += chunk.length;
  }

  end(): void {}

  result(): CsvExport {
    const csv = `${this.header ?? ''}${this.kept.join('')}`.replace(/\r?\n$/, '');
    return { csv, rows: this.kept.length, totalRows: this.total, truncated: this.kept.length < this.total };
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export class ApiMcpBackend extends ApiFormsBackend implements FormsBackend {
  constructor(
    private readonly database: Db,
    handlers: () => McpHandlers,
    private readonly parity: () => McpParityHandlers,
  ) {
    super(database, handlers);
  }

  // --- Forms ------------------------------------------------------------------

  setFormSlug(caller: McpCaller, formId: string, slug: string): Promise<FormDetail> {
    return run(async () => detailOf(await this.parity().forms.updateFormSlug(reqOf(caller), formId, { slug })));
  }

  duplicateForm(caller: McpCaller, formId: string): Promise<FormDetail> {
    return run(async () => detailOf(await this.parity().forms.duplicateForm(reqOf(caller), formId)));
  }

  moveForm(caller: McpCaller, formId: string, folderId: string | null) {
    return run(async () => {
      const out = await this.parity().forms.setFormFolder(reqOf(caller), formId, { folderId });
      return { id: out.id, folderId: out.folderId ?? null };
    });
  }

  deleteForm(caller: McpCaller, formId: string) {
    return run(async () => {
      const req = reqOf(caller);
      const form = await this.parity().forms.getForm(req, formId);
      await this.parity().forms.deleteForm(req, formId);
      return { id: form.id, name: form.name };
    });
  }

  // --- Folders ----------------------------------------------------------------

  listFolders(caller: McpCaller): Promise<FolderItem[]> {
    return run(() => this.parity().forms.listFolders(reqOf(caller)));
  }

  createFolder(caller: McpCaller, name: string): Promise<FolderItem> {
    return run(() => this.parity().forms.createFolder(reqOf(caller), { name }));
  }

  renameFolder(caller: McpCaller, folderId: string, name: string): Promise<FolderItem> {
    return run(() => this.parity().forms.renameFolder(reqOf(caller), folderId, { name }));
  }

  deleteFolder(caller: McpCaller, folderId: string): Promise<FolderItem> {
    return run(async () => {
      const req = reqOf(caller);
      const folder = (await this.parity().forms.listFolders(req)).find((f) => f.id === folderId);
      if (!folder) throw new BackendError(404, 'NOT_FOUND', 'Not found.');
      await this.parity().forms.deleteFolder(req, folderId);
      return folder;
    });
  }

  // --- Destinations -----------------------------------------------------------

  setDestinations(caller: McpCaller, formId: string, destinations: unknown[]): Promise<DestinationsResult> {
    return run(async () => {
      const out = await this.parity().destinations.putDestinations(reqOf(caller), formId, { destinations });
      const config = isRecord(out.config) ? out.config : {};
      return {
        formId: out.id,
        updatedAt: out.updatedAt,
        destinations: Array.isArray(config.destinations) ? config.destinations : [],
        formActivityError: typeof out.formActivityError === 'string' ? out.formActivityError : null,
      };
    });
  }

  pingWebhook(caller: McpCaller, formId: string): Promise<WebhookPing> {
    return run(async () => {
      // The adapter's raw `message` is for the log, not for a model.
      const { ok, reason, status, detail } = await this.parity().destinations.pingWebhook(reqOf(caller), formId);
      return { ok, ...(reason ? { reason } : {}), ...(status !== undefined ? { status } : {}), ...(detail ? { detail } : {}) };
    });
  }

  // --- Responses --------------------------------------------------------------

  /**
   * One submission through its route (account join, and it must belong to
   * the form), with its answers rendered as the owner reads them, like
   * `listResponses`, and the file questions it answered.
   */
  getResponse(caller: McpCaller, formId: string, responseId: string): Promise<ResponseDetail> {
    return run(async () => {
      const s = await this.parity().analytics.submission(reqOf(caller), formId, responseId);
      // The route above already proved the form is this caller's.
      const form = await getFormById(this.database, caller.accountId, formId);
      const config = (form?.config ?? { version: 1, steps: [] }) as EngineConfig;
      const data = (s.data ?? {}) as Answers;
      return {
        id: s.id,
        formId: s.formId,
        completedAt: s.completedAt ?? null,
        startedAt: s.startedAt ?? null,
        partialAt: s.partialAt ?? null,
        score: s.score ?? null,
        answers: summarizeAnswers(config, data).map((row) => ({ question: row.label, answer: row.value })),
        files: (config.steps ?? [])
          .filter((step) => step.type === 'file' && data[step.key] != null && data[step.key] !== '')
          .map((step) => ({ stepKey: step.key, question: step.question || step.key })),
      };
    });
  }

  getResponseFile(caller: McpCaller, formId: string, responseId: string, stepKey: string): Promise<ResponseFile> {
    return run(async () => {
      const req = reqOf(caller);
      // The file route reads the response by account alone; the form must match too.
      await this.parity().analytics.submission(req, formId, responseId);
      const f = await this.parity().forms.submissionFile(req, responseId, stepKey);
      return { name: f.name, size: Number(f.size), kind: f.kind, url: f.url, previewUrl: f.previewUrl ?? null };
    });
  }

  exportResponsesCsv(caller: McpCaller, formId: string, query: CsvQuery): Promise<CsvExport> {
    return run(async () => {
      const res = new CsvCollector(query.maxRows, query.maxChars);
      await this.parity().analytics.exportCsv(
        reqOf(caller),
        res,
        formId,
        { ...filterQuery(query), ...(query.sort ? { sort: query.sort } : {}) },
        query.ids ? query.ids.join(',') : undefined,
      );
      return res.result();
    });
  }

  deleteResponses(caller: McpCaller, formId: string, responseIds: string[]) {
    return run(() => this.parity().analytics.deleteSubmissions(reqOf(caller), formId, { ids: responseIds }));
  }

  deleteResponse(caller: McpCaller, formId: string, responseId: string): Promise<void> {
    return run(async () => {
      const req = reqOf(caller);
      await this.parity().analytics.submission(req, formId, responseId);
      await this.parity().analytics.deleteSubmission(req, responseId);
    });
  }

  listDeliveries(caller: McpCaller, formId: string, query: DeliveriesQuery): Promise<DeliveryItem[]> {
    return run(async () => {
      const out = await this.parity().forms.formDeliveries(
        reqOf(caller),
        formId,
        query.limit !== undefined ? String(query.limit) : undefined,
        query.kind?.join(','),
        query.status?.join(','),
      );
      return out.items;
    });
  }

  // --- Analytics --------------------------------------------------------------

  formSummary(caller: McpCaller, formId: string, filter: ResponseFilter): Promise<SubmissionsSummary> {
    return run(() => this.parity().analytics.formSummary(reqOf(caller), formId, filterQuery(filter)));
  }

  responseFacets(caller: McpCaller, formId: string): Promise<SubmissionFacets> {
    return run(() => this.parity().analytics.submissionFacets(reqOf(caller), formId));
  }

  searchAnswers(caller: McpCaller, formId: string, stepKey: string, query: AnswerSearchQuery): Promise<AnswerSearchPage> {
    return run(() =>
      this.parity().analytics.summaryAnswers(
        reqOf(caller),
        formId,
        stepKey,
        filterQuery(query),
        query.q,
        query.limit !== undefined ? String(query.limit) : undefined,
        query.offset !== undefined ? String(query.offset) : undefined,
      ),
    );
  }

  // --- Brand kit --------------------------------------------------------------

  getBrandKit(caller: McpCaller): Promise<BrandKitView> {
    return run(async () => this.kit(await this.parity().branding.get(reqOf(caller))));
  }

  updateBrandKit(caller: McpCaller, kit: Record<string, unknown>): Promise<BrandKitView> {
    return run(async () => this.kit(await this.parity().branding.put(reqOf(caller), kit)));
  }

  applyBrandKit(caller: McpCaller, formIds: string[]) {
    return run(() => this.parity().branding.apply(reqOf(caller), { formIds }));
  }

  revertBrandKit(caller: McpCaller, formIds: string[]) {
    return run(() => this.parity().branding.revert(reqOf(caller), { formIds }));
  }

  // --- Notifications ----------------------------------------------------------

  listNotifications(caller: McpCaller): Promise<NotificationView[]> {
    return run(async () => (await this.parity().forms.notifications(reqOf(caller))).settings);
  }

  updateNotification(caller: McpCaller, key: NotificationKey, patch: NotificationPatch): Promise<NotificationView> {
    return run(() => this.parity().forms.updateNotification(reqOf(caller), key, patch));
  }

  resetNotification(caller: McpCaller, key: NotificationKey): Promise<NotificationView> {
    return run(() => this.parity().forms.resetNotification(reqOf(caller), key));
  }

  listFormNotifications(caller: McpCaller, formId: string): Promise<NotificationView[]> {
    return run(async () => (await this.parity().forms.formNotifications(reqOf(caller), formId)).settings);
  }

  updateFormNotification(caller: McpCaller, formId: string, key: NotificationKey, patch: NotificationPatch): Promise<NotificationView> {
    return run(() => this.parity().forms.updateFormNotification(reqOf(caller), formId, key, patch));
  }

  resetFormNotification(caller: McpCaller, formId: string, key: NotificationKey): Promise<NotificationView> {
    return run(() => this.parity().forms.resetFormNotification(reqOf(caller), formId, key));
  }

  // --- Integrations, read only ------------------------------------------------

  listIntegrations(caller: McpCaller): Promise<Record<string, unknown>> {
    return run(async () => ({ ...(await this.parity().integrations.list(reqOf(caller))) }));
  }

  listWebhooks(caller: McpCaller): Promise<Array<Record<string, unknown>>> {
    return run(async () => (await this.parity().integrations.webhooks(reqOf(caller))).items.map((w) => ({ ...w })));
  }

  hubspotProperties(caller: McpCaller): Promise<Record<string, unknown>> {
    return run(async () => ({ ...(await this.parity().integrations.hubspotProperties(reqOf(caller))) }));
  }

  calendlyEventTypes(caller: McpCaller): Promise<Record<string, unknown>> {
    return run(async () => ({ ...(await this.parity().integrations.calendlyEventTypes(reqOf(caller))) }));
  }

  // --- Identity ---------------------------------------------------------------

  myProfile(caller: McpCaller): Promise<MemberProfile> {
    return run(async () => {
      const p = await this.parity().forms.myProfile(reqOf(caller));
      return { handle: p.handle ?? null, profile: p.profile ?? null };
    });
  }

  vanity(caller: McpCaller): Promise<VanityStatus> {
    return run(() => this.parity().forms.vanity(reqOf(caller)));
  }

  // --- Shapes -----------------------------------------------------------------

  private kit(v: { config: unknown; updatedAt: number | null }): BrandKitView {
    return { config: isRecord(v.config) ? v.config : null, updatedAt: v.updatedAt ?? null };
  }
}
