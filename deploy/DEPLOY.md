# Production deployment runbook

How to ship a new release of **AZAD EV POINT** to production. Keep this current when the
server topology changes.

## Production topology

| Piece | How it runs | Where |
| --- | --- | --- |
| App code (monorepo) | git checkout | `/var/www/html/azad-ev-platform` |
| API (NestJS) | **pm2** process, listens on `127.0.0.1:3000` | built to `api/dist/main.js` |
| Web (React/Vite) | **nginx** serves the static build | `web/dist` copied into the nginx web root |
| Database (PostgreSQL) | **Docker** container `azad_ev_postgres` | reached via `DATABASE_URL` in `api/.env` |
| Deploy branch | `release/2.0` | GitHub `origin` |

> Discover the exact values on the box if unsure:
> - pm2 API app name → `pm2 list`
> - nginx web root → `grep -R "root " /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null`
> - DB container → `docker ps` (expect `azad_ev_postgres`)

## 0. Before you deploy (on the dev machine)

1. All work is committed and pushed to `origin/release/2.0`.
2. Decide what the release contains — this changes the steps:
   - **Prisma schema / migration change?** → a migration runs on deploy (see §3a). Take a DB backup first (§2).
   - **New or changed env var?** → update `api/.env` (and/or `web/.env`) on the server *before* building/restarting.
   - **New dependency?** → `npm install` on the server is required (it is otherwise optional).
3. Green locally: `npm run build`, `npm run lint`, `npm run test`, and the e2e suite.

## 1. Pull the new code (server)

```
cd /var/www/html/azad-ev-platform
git fetch origin
git checkout release/2.0          # if not already on it
git pull origin release/2.0
git log -1 --oneline             # confirm the expected commit is checked out
```

## 2. Back up the database (only when the release has migrations, or any time you want safety)

The API talks to the `azad_ev_postgres` Docker container, so run `pg_dump` **inside** the
container (the host has no `pg_dump`):

```
docker exec -t azad_ev_postgres pg_dump -U <db-user> <db-name> > ~/azad-backup-$(date +%F-%H%M).sql
```

(`<db-user>` / `<db-name>` are the `POSTGRES_USER` / `POSTGRES_DB` from the compose file / `DATABASE_URL`.)

## 3. Build

```
npm install            # required only if dependencies changed; otherwise optional/no-op
# web bakes VITE_API_BASE_URL in at build time — confirm it points at the prod API first:
cat web/.env
npm run build          # builds packages/shared → api → web (in that order)
```

### 3a. Apply migrations (only if the release changed the Prisma schema)

```
cd api
set -a; source .env; set +a      # load DATABASE_URL
npm run prisma:deploy            # = prisma migrate deploy (no-op if nothing pending)
cd ..
```

Skip this entirely when there are no schema changes.

### 3b. Initialize RBAC (run on every deploy)

Seeds the permission catalog + the five locked system roles for every company and backfills each
user's dynamic role (`User.roleId`) from their legacy `role`. **Authorization is permission-based,
so this must run or every non-OWNER user is denied across the app.**

```
cd api
set -a; source .env; set +a      # load DATABASE_URL (skip if already loaded in §3a)
npm run rbac:init                # = node dist/rbac-init.js  (needs `npm run build` from §3 first)
cd ..
```

- Run it on **every** deploy, not just migration releases — it is idempotent (a second run creates
  nothing and backfills zero users) and safe to repeat.
- It runs as compiled JS under `node` (no `ts-node`, no dev dependencies) and creates **no** demo
  data — it is not the dev seed (`npm run prisma:seed`), which must never run in production.
- On the very first deploy of this release, run §3a (the migration that creates the RBAC tables)
  **before** this step.

## 4. Restart the API (pm2)

```
pm2 restart <api-app-name>       # from `pm2 list`
pm2 save
pm2 logs <api-app-name> --lines 50   # watch for a clean boot
```

## 5. Publish the web build (nginx)

```
# Back up the current dist so you can roll the UI back instantly:
sudo cp -r <web-root> <web-root>.bak-$(date +%F)
# Publish the fresh build:
sudo rsync -a --delete web/dist/ <web-root>/
```

No nginx restart is needed for a static-file swap. (Only reload nginx if you changed
`nginx.conf`: `sudo nginx -t && sudo systemctl reload nginx`.)

## 6. Verify

```
curl -s https://<your-host>/api/v1/health      # API healthy
pm2 logs <api-app-name> --lines 50             # no errors
```

Then in a browser, smoke-test what the release touched. For any auth/role-gated feature,
check it as the intended role **and** as a role that should not see it.

## Client IP and proxy trust

The API trusts **only loopback proxy hops** (`api/src/common/http/configure-http-app.ts`): a reverse proxy
on the same host connecting over 127.0.0.1 / ::1 may set `X-Forwarded-For`; Express then uses the right-most
non-loopback address. Anyone connecting directly (the API listens on 0.0.0.0) is keyed by their own socket
address and their `X-Forwarded-For` is ignored. The per-IP app-wide rate limit depends on this; the CSV import
limits are per signed-in user and do not.

Check on the server when this changes, or when deploying release 3.2:
- Which address the browser/app calls (`cat web/.env`), and what listens on that port (`sudo ss -ltnp` / `lsof -iTCP -sTCP:LISTEN`).
- If nginx proxies the API, it must connect over loopback and append the client address:
  `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` (never `$http_x_forwarded_for` alone).
- If another proxy or load balancer sits in front, or nginx runs in a container / on another host, loopback
  trust is not enough: every client would share that proxy's address for the per-IP limit. Change
  `TRUSTED_PROXY_HOPS` to exactly those hops; never `true`.

## Request timeouts

Each layer waits longer than the one behind it, so the innermost answer normally reaches the user:

| Layer | Setting | Value |
| --- | --- | --- |
| Database, CSV import | transaction wait-to-start / timeout | 5 s / 30 s → 503 "could not finish in time" |
| Database, CSV re-check after a failed import, and CSV preview | transaction wait-to-start / timeout | 5 s / 10 s |
| API, CSV import worst case | parse + import transaction + re-check | ≈ 51 s (preview ≈ 16 s) |
| nginx `location /api/` (if nginx proxies the API) | `proxy_read_timeout`, `proxy_send_timeout` | **120 s** (nginx default is 60 s) |
| Node HTTP server | `requestTimeout` / `headersTimeout` | Node defaults, 300 s / 60 s (unchanged) |
| Browser | CSV preview / CSV import request | 60 s / 150 s (other requests: none) |

A 2,000-row import measured 0.7 s, so these are ceilings, not expectations. On the server, check the live
nginx site config (`grep -R proxy_read_timeout /etc/nginx/`) and set 120 s on the location that proxies the
API — but only if nginx proxies the API at all (see "Client IP and proxy trust"). Reload with
`sudo nginx -t && sudo systemctl reload nginx`.

## Rollback

1. Note the previous commit (`git log --oneline` shows it just under the current one).
2. `git checkout <previous-commit>` → `npm run build` → `pm2 restart <api-app-name>`.
3. Restore the UI from the backup: `sudo rsync -a --delete <web-root>.bak-<date>/ <web-root>/`.
4. If a migration ran and must be undone, restore the DB dump from §2 (migrations are not
   auto-reversed) — this is why the backup is mandatory for migration releases.

## Troubleshooting

- **`pg_dump: command not found`** — the host doesn't have Postgres tools; run `pg_dump`
  *inside* the container: `docker exec -t azad_ev_postgres pg_dump ...` (see §2).
- **`No such container` / `service 'db' is not running`** — check the real name with
  `docker ps`; it is `azad_ev_postgres` (not `azad-postgres`, and not a compose `db` service
  unless you're in the directory with that `docker-compose.yml`).
- **API won't boot after restart** — `pm2 logs <api-app-name>`; common causes are a missing
  env var in `api/.env` or a pending migration that failed. Fix forward or roll back (above).
- **UI shows old version** — the dist wasn't copied into the nginx root, or the browser
  cached it; confirm the files in `<web-root>` changed and hard-refresh.

## Reference: alternative systemd setup

`deploy/azad-api.service` + `deploy/nginx.conf` describe an alternative **systemd**-based
deployment (API at `/opt/azad-ev/app`, `prisma migrate deploy` run automatically on start).
That path must also run `npm run rbac:init` after the migration (§3b) for the same reason.
The live server currently uses **pm2** as described above; the systemd unit is kept for
reference / future migration. Don't mix the two.
