import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadServerEnv } from '@quill/config/env';
import { loadDotenv } from '@quill/config/dotenv';
import { AppModule } from './app.module';
import { databaseLogLabel } from './database-log-label';
import { configureCors } from './cors';

async function bootstrap() {
  // Load .env (root + app-local) before reading env — a self-hoster's .env must
  // actually take effect. Real deployment env is never overridden (H3).
  loadDotenv();
  const env = loadServerEnv();
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  // CORS (P1-4): an explicit allowlist, never a reflected origin; `/mcp` has
  // its own (MCP_ALLOWED_ORIGINS, no credentials). See cors.ts.
  const origins = configureCors(app, env);
  console.log(`[api] CORS allowlist: ${origins.join(', ')}`);
  await app.listen(env.API_PORT);
  console.log(`[api] listening on http://localhost:${env.API_PORT} (db=${databaseLogLabel(env.DATABASE_URL)})`);
}

bootstrap().catch((err) => {
  console.error('[api] failed to start:', err);
  process.exit(1);
});
