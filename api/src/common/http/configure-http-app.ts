import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Which proxy hops may set the client address (Express `trust proxy`). Only loopback peers are trusted:
 * a reverse proxy on the same host (nginx → 127.0.0.1 / ::1) has its X-Forwarded-For honoured, and
 * Express then takes the right-most address that is NOT loopback — the one nginx appends
 * ($proxy_add_x_forwarded_for), never a value the client sent. A client that connects directly (the API
 * also listens on 0.0.0.0) is not loopback, so any X-Forwarded-For it sends is ignored and `req.ip` is
 * its own socket address. Change this only together with the deployment topology (see deploy/DEPLOY.md).
 */
export const TRUSTED_PROXY_HOPS = 'loopback';

/** HTTP-adapter settings shared by main.ts and the e2e app, so tests exercise the production values. */
export function configureHttpApp(app: NestExpressApplication): void {
  app.set('trust proxy', TRUSTED_PROXY_HOPS);
}
