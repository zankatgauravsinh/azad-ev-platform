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
The live server currently uses **pm2** as described above; the systemd unit is kept for
reference / future migration. Don't mix the two.
