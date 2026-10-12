import type { Locale } from '@quill/shared';

/**
 * Copy for the "How to use the API" section of the Developers page, in its own
 * catalog next to the component (like the builder's), so this section can ship
 * without touching the shared one the rest of the page is built on.
 *
 * Text between backticks renders as inline code; keep paths, headers and field
 * names inside them so both locales show them the same way.
 */
export interface DeveloperDocsMessages {
  title: string;
  intro: string;
  apiUrlLabel: string;
  apiUrlMissing: string;
  authTitle: string;
  authBody: string;
  flowTitle: string;
  flowBody: string;
  flow: {
    create: string;
    edit: string;
    publish: string;
    revert: string;
  };
  flowLabels: {
    create: string;
    edit: string;
    publish: string;
    revert: string;
  };
  gotchasTitle: string;
  gotchas: {
    put: string;
    stale: string;
    destinations: string;
    rateLimit: string;
  };
  skillTitle: string;
  skillBody: string;
  skillContents: string;
  skillButton: string;
  skillUnavailable: string;
}

const en: DeveloperDocsMessages = {
  title: 'How to use the API',
  intro:
    'Connect an AI agent (Claude Code, Codex, Cursor) or your own code to this workspace with an API key from this page. The API is the same one the dashboard uses.',
  apiUrlLabel: 'API URL',
  apiUrlMissing:
    'This deployment has no public API address configured yet. Ask whoever runs it to set `PUBLIC_API_URL`.',
  authTitle: 'Authenticate',
  authBody:
    'Send your key in the `Authorization` header of every request. The key already belongs to this workspace, so there is nothing else to choose.',
  flowTitle: 'Create, edit, publish and revert',
  flowBody: 'Every form goes through the same four calls.',
  flow: {
    create:
      'Creates the form with its config, live right away. The answer carries `publicUrl` and `editorUrl`: share those links as they come.',
    edit: 'Saves the whole config as a draft. The public form does not change until you publish.',
    publish: 'Makes the draft live.',
    revert: 'Puts the previously published version back live. Calling it again undoes the revert.',
  },
  flowLabels: {
    create: 'Create',
    edit: 'Edit',
    publish: 'Publish',
    revert: 'Revert',
  },
  gotchasTitle: 'Watch out for',
  gotchas: {
    put: '`PUT` replaces the whole config. Read the form, change what you need and send every step back: a config without `steps` is refused, and the steps you leave out are deleted.',
    stale:
      'Send `expectedUpdatedAt` with the `updatedAt` you read. If someone saved the form in the editor since then, you get a `409` with the current version instead of overwriting their work.',
    destinations:
      'Webhooks and HubSpot have their own route, `PUT /v1/forms/{id}/destinations`. They never go inside the config.',
    rateLimit:
      'Each key can make 120 requests per minute. Past that you get a `429` with a `Retry-After` header: wait that many seconds and continue.',
  },
  skillTitle: 'Skill for your agent',
  skillBody:
    'Give your agent everything it needs in one file. The skill already carries this environment’s addresses, so your agent can use the API without you explaining anything.',
  skillContents:
    'Inside: the rules your agent should follow, every endpoint, the error codes, the JSON Schema of a form config, recipes (a quiz with scoring, editing a step, publishing and reverting, responses with filters, analytics and CSV) and how to install it in Claude Code, Codex and Cursor.',
  skillButton: 'Download the skill',
  skillUnavailable: 'The download is available once the API address is configured.',
};

const es: DeveloperDocsMessages = {
  title: 'Cómo usar la API',
  intro:
    'Conecta un agente de IA (Claude Code, Codex, Cursor) o tu propio código a este workspace con una llave de esta página. La API es la misma que usa el dashboard.',
  apiUrlLabel: 'URL de la API',
  apiUrlMissing:
    'Este entorno todavía no tiene configurada una dirección pública para la API. Pídele a quien lo administra que defina `PUBLIC_API_URL`.',
  authTitle: 'Autenticación',
  authBody:
    'Manda tu llave en el header `Authorization` de cada request. La llave ya pertenece a este workspace, así que no tienes que elegir nada más.',
  flowTitle: 'Crear, editar, publicar y revertir',
  flowBody: 'Todo form pasa por las mismas cuatro llamadas.',
  flow: {
    create:
      'Crea el form con su config, publicado de inmediato. La respuesta trae `publicUrl` y `editorUrl`: comparte esos links tal cual.',
    edit: 'Guarda la config completa como borrador. El form público no cambia hasta que publiques.',
    publish: 'Publica el borrador.',
    revert: 'Vuelve a publicar la versión anterior. Si la llamas otra vez, deshaces el cambio.',
  },
  flowLabels: {
    create: 'Crear',
    edit: 'Editar',
    publish: 'Publicar',
    revert: 'Revertir',
  },
  gotchasTitle: 'Ten en cuenta',
  gotchas: {
    put: '`PUT` reemplaza la config entera. Lee el form, cambia lo que necesites y manda todos los pasos de vuelta: una config sin `steps` se rechaza, y los pasos que no mandes se borran.',
    stale:
      'Manda `expectedUpdatedAt` con el `updatedAt` que leíste. Si alguien guardó el form en el editor desde entonces, recibes un `409` con la versión actual en vez de pisar su trabajo.',
    destinations:
      'Los webhooks y HubSpot van por su propia ruta, `PUT /v1/forms/{id}/destinations`. Nunca dentro de la config.',
    rateLimit:
      'Cada llave puede hacer 120 requests por minuto. Si te pasas, recibes un `429` con el header `Retry-After`: espera esos segundos y sigue.',
  },
  skillTitle: 'Skill para tu agente',
  skillBody:
    'Dale a tu agente todo lo que necesita en un solo archivo. El skill ya trae las direcciones de este entorno, así que tu agente puede usar la API sin que le expliques nada.',
  skillContents:
    'Incluye las reglas que tu agente debe seguir, todos los endpoints, los códigos de error, el JSON Schema de la config de un form, recetas (un quiz con puntaje, editar un paso, publicar y revertir, respuestas con filtros, analítica y CSV) y cómo instalarlo en Claude Code, Codex y Cursor.',
  skillButton: 'Descargar el skill',
  skillUnavailable: 'La descarga estará disponible cuando se configure la dirección de la API.',
};

const CATALOG: Record<Locale, DeveloperDocsMessages> = { en, es };

/** The section's copy for a locale (English for anything unknown). */
export function getDeveloperDocsMessages(locale: string): DeveloperDocsMessages {
  return CATALOG[locale === 'es' ? 'es' : 'en'];
}
