import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';

/**
 * Time allowed for an e2e `beforeAll`/`afterAll` hook that boots the app, logs in, seeds or cleans up.
 * Individual tests keep Jest's default timeout.
 */
export const E2E_HOOK_TIMEOUT = 30_000;

/**
 * Boots the full application for one e2e suite and starts ONE real HTTP listener on an ephemeral
 * loopback port, so every Supertest request in the suite reuses the same server.
 *
 * Why: given a server that is not listening, Supertest calls `listen(0)` for every request and
 * `close()` when that request ends. `close()` drops idle connections, so any two requests that
 * overlap (a slow hook still running when the next test starts, or a deliberate `Promise.all`)
 * reset each other ("socket hang up" / ECONNRESET). A listening server is used as-is and never
 * closed by Supertest. Close it with `app.close()` in `afterAll`, which also stops the listener.
 */
export async function createE2eApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.listen(0, '127.0.0.1');
  return app;
}
