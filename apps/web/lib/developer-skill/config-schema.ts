import { formConfigSchema } from '@quill/types';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Config fields the editor has no control for, as dot paths (`[]` = every item
 * of an array). With an API key the API refuses them (`UNSUPPORTED_FIELD`),
 * because a form an agent saves with one of them is a form a person can no
 * longer edit in full. The JSON Schema in the skill leaves them out, so an
 * agent that validates against it never sends one in the first place.
 *
 * The list is the API spec's, from the research on fields without a control.
 * Webhook `signatureHeader` and `timeoutMs` live under the webhook variant of
 * `destinations[]`; the last three are the legacy single-reveal fields that
 * `reveal` steps replaced.
 */
export const UNSUPPORTED_CONFIG_FIELDS = [
  'outcomes.[].booking',
  'steps.[].buttonText',
  'steps.[].sliderUnitLabel',
  'steps.[].reveal.subtitleTemplate',
  'steps.[].reveal.enabled',
  'steps.[].scheduler.prefill',
  'steps.[].flowGroup',
  'branding.clientLogos',
  'destinations.[].settings.signatureHeader',
  'destinations.[].settings.timeoutMs',
  'reveal',
  'revealAfterStep',
  'steps.[].triggersReveal',
] as const;

type JsonSchema = Record<string, unknown>;

/** The schema itself and every object variant of a nullable or union node. */
function variants(node: unknown): JsonSchema[] {
  if (!node || typeof node !== 'object') return [];
  const n = node as JsonSchema;
  const out: JsonSchema[] = [n];
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const list = n[key];
    if (Array.isArray(list)) for (const member of list) out.push(...variants(member));
  }
  return out;
}

/** The nodes a path segment leads to from `nodes`. */
function step(nodes: JsonSchema[], segment: string): JsonSchema[] {
  const next: JsonSchema[] = [];
  for (const node of nodes) {
    for (const v of variants(node)) {
      if (segment === '[]') {
        if (v.items && typeof v.items === 'object') next.push(v.items as JsonSchema);
      } else {
        const props = v.properties as Record<string, JsonSchema> | undefined;
        if (props && props[segment]) next.push(props[segment]);
      }
    }
  }
  return next;
}

/**
 * Remove the field at `path` from every object it can appear in. Returns how
 * many properties were removed, so a path that no longer matches the schema
 * (a field renamed in `@quill/types`) is noticed instead of silently ignored.
 */
function removeField(root: JsonSchema, path: string): number {
  const segments = path.split('.');
  const field = segments.pop()!;
  let nodes: JsonSchema[] = [root];
  for (const segment of segments) nodes = step(nodes, segment);
  let removed = 0;
  for (const node of nodes) {
    for (const v of variants(node)) {
      const props = v.properties as Record<string, unknown> | undefined;
      if (props && field in props) {
        delete props[field];
        if (Array.isArray(v.required)) v.required = v.required.filter((r) => r !== field);
        removed++;
      }
    }
  }
  return removed;
}

/**
 * The form config as a JSON Schema (draft-07), generated from
 * `formConfigSchema` so it can never drift from what the API parses, minus the
 * fields in `UNSUPPORTED_CONFIG_FIELDS`.
 *
 * Every sub-schema is inlined (`$refStrategy: 'none'`): the reveal shape is
 * used both at the top level and inside steps, and a `$ref` from one to the
 * other would dangle once the top-level copy is removed.
 *
 * `steps` is marked required. The zod schema defaults it to `[]`, but a `PUT`
 * with an API key that leaves it out is refused (`STEPS_REQUIRED`), and the
 * skill tells the agent to always send the whole list.
 */
export function formConfigJsonSchema(): JsonSchema {
  const schema = zodToJsonSchema(formConfigSchema, {
    $refStrategy: 'none',
    target: 'jsonSchema7',
  }) as JsonSchema;
  for (const path of UNSUPPORTED_CONFIG_FIELDS) {
    if (removeField(schema, path) === 0) {
      throw new Error(`Unsupported config field ${path} is not in formConfigSchema any more.`);
    }
  }
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  required.add('steps');
  return {
    $schema: schema.$schema,
    $id: 'form-config.schema.json',
    title: 'dForms form config (version 1)',
    description:
      'The `config` object of a dForms form, as POST /v1/forms and PUT /v1/forms/{id} accept it. Fields the editor cannot show are left out; the API refuses them with UNSUPPORTED_FIELD.',
    ...Object.fromEntries(Object.entries(schema).filter(([k]) => k !== '$schema')),
    required: [...required],
  };
}
