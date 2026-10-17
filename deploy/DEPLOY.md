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

> **Release 3.2 and later:** follow `docs/RELEASE-PREPARATION.md` first. It orders the deployment-branch
> decision, the verified backup, the production compatibility checks, the topology review and the release
> approval. This runbook still names `release/2.0` as the deploy branch; that changes only with that approval.

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

## 2. Back up the database and prove the backup restores (mandatory for migration releases)

The database runs in a Docker container and the host has no PostgreSQL tools, so the script uses the
container's own `pg_dump` / `pg_restore` (their version always matches the server). Name the container and
the database explicitly — check them first, do not assume them:

```bash
cd /var/www/html/azad-ev-platform
docker ps --format '{{.Names}}  {{.Image}}'      # the Postgres container and its image
CONTAINER="${CONTAINER:?set CONTAINER to the Postgres container name shown by docker ps}"
DB="${DB:?set DB to the application database name (POSTGRES_DB of that container)}"
BACKUP_DIR="$HOME/azad-backups" ./scripts/backup-docker.sh "$CONTAINER" "$DB"
```

It writes `<db>-<UTC time>.dump` (custom format) plus `.dump.sha256`, `.toc`, `.counts` (exact row count per
table) and `.meta` (container, image, server version, system identifier and database OID, migration state)
into `$BACKUP_DIR`: files mode 600, and it **refuses to overwrite** an existing file. `$BACKUP_DIR` must be
an absolute path to a private folder — created with mode 700 if missing; an existing one must belong to you
and already be mode 700 (a shared folder such as `/tmp` is refused, never `chmod`-ed). The container must
be given by its exact name. No password is read or passed — the dump connects over the container's local
socket as its `POSTGRES_USER` (which must be set in the container's environment). The set is built in a
private `.incomplete-…` folder and only then put in place, `.meta` last: a set is complete exactly when its
`.meta` ends with `backup_status=ARCHIVE_VALID`. On any error only that temporary folder is removed — an
existing backup is never touched, and the script never deletes backups.

Distinct results — only `RESTORE_TEST_PASSED` proves the backup is usable:

- **`BACKUP_ARCHIVE_VALID`** (from `backup-docker.sh`): the archive's table of contents is readable and
  every data block decodes (`pg_restore --list` and `pg_restore -f /dev/null`), and the checksum verifies.
  It does **not** prove a restore succeeds. A checksum only proves the file is the one the backup wrote —
  not that the data in it is complete.
- **`ARCHIVE_READABLE`**, then **`RESTORE_COMPLETED`** (from `restore-test.sh`): the checksum (required)
  matched and the archive lists; then `pg_restore` into the throwaway database succeeded — not yet compared
  with anything.
- **`RESTORE_TEST_PASSED`** (exit 0) — full verification: the set's `.counts` and `.meta` are complete and
  consistent with the archive, every table's exact row count equals `.counts`, and the Prisma migration
  history equals the one recorded in `.meta`.
- **`RESTORE_TEST_PASSED_TABLES_ONLY`** (exit 3) — only the table list could be verified; row counts were
  **not**. Emitted when the rows changed while the dump ran (`.meta`: `counts_stable_during_dump=no`), when
  there is no `.counts` (e.g. a hand-made backup — the list is then checked against the archive's own table
  of contents), or when the `.meta` (or a field of it) is absent, e.g. an older set. **Not sufficient for a
  release**: take the backup again in a quiet window (API stopped) and re-test until `RESTORE_TEST_PASSED`.
- Failures, all exit 1: **`ARCHIVE_REJECTED`** — checksum mismatch, unreadable archive, or set metadata that is
  present but malformed, duplicated or contradicts the archive (nothing is restored); **`RESTORE_FAILED`** —
  `pg_restore` or the scratch server failed; **`RESTORE_NOT_VERIFIED`** — restored, but it does not match the
  set. `scripts/restore.sh` uses the same labels and exit codes (`RESTORE_VERIFIED` /
  `RESTORE_VERIFIED_TABLES_ONLY` for its two successes). The scripts stop with one clear error if a required
  command is missing; they do not need `cmp` or `diff`.

Why the counts can be unstable: `.counts` is taken just before (and checked just after) `pg_dump`, in
separate sessions — outside the dump's own snapshot. The archive itself is always a consistent snapshot, but
if rows change during the dump, `.counts` need not describe it, so no exact comparison is possible.

```bash
ARCHIVE="${ARCHIVE:?absolute path of the .dump printed by backup-docker.sh}"
IMAGE="${IMAGE:?the image= line of the matching .meta file, e.g. postgres:16-alpine}"
./scripts/restore-test.sh "$ARCHIVE" "$IMAGE"
```

`restore-test.sh` touches nothing real: the scratch server is a new container with **no network**
(`--network none`), its data on tmpfs (RAM — roughly the database's size must be free), no password, and
it is removed on exit. If the server lacks the memory, copy the archive with its `.sha256`, `.counts` and
`.meta` to another machine with Docker and run it there. Then copy those files **off the server**, check
the checksum at the destination (`sha256sum -c <file>.dump.sha256`), and back up `uploads/` with them.

Never use `docker exec -t` for a dump: a pseudo-terminal can rewrite line endings and corrupt the output.
If the script cannot be used, the equivalent by hand (no TTY, refuses to overwrite):

```bash
set -o noclobber
OUT="$HOME/azad-backups/$DB-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker exec "$CONTAINER" sh -c 'exec pg_dump --format=custom --no-password -U "$POSTGRES_USER" -d "$1"' sh "$DB" > "$OUT"
docker exec -i "$CONTAINER" pg_restore --list < "$OUT" > "$OUT.toc"     # readable — still not a restore test
sha256sum "$OUT" > "$OUT.sha256"
```

## 3. Build

```
npm install            # required only if dependencies changed; otherwise optional/no-op
# web bakes VITE_API_BASE_URL in at build time — confirm it points at the prod API first:
cat web/.env
npm run build          # builds packages/shared → api → web (in that order)
```

### 3a. Apply migrations (only if the release changed the Prisma schema)

```
npm run prisma:deploy --workspace api   # = prisma migrate deploy, with DATABASE_URL from api/.env or the root .env (no-op if nothing pending)
```

Skip this entirely when there are no schema changes.

### 3b. Initialize RBAC (run on every deploy)

Seeds the permission catalog + the five locked system roles for every company and backfills each
user's dynamic role (`User.roleId`) from their legacy `role`. **Authorization is permission-based,
so this must run or every non-OWNER user is denied across the app.**

```
npm run rbac:init --workspace api   # = node dist/rbac-init.js  (needs `npm run build` from §3 first)
```

`rbac:init` and `npm run prisma:deploy --workspace api` find `DATABASE_URL` on their own: they read
`api/.env`, or the repository-root `.env` when there is none (the server keeps it in the root). A value
already exported in the shell wins. The bare Prisma CLI (`npx prisma …` from `api/`) only reads `api/.env`, so
run it as `(set -a; . ../.env; set +a; npx prisma migrate status)` when the file is in the root.

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

**Prefer a code-only rollback.** Roll the code back and keep the database: data written since the deploy
is kept. For release 3.2 this is possible because its three migrations only add tables, nullable columns
and a narrower unique index, and the `release/2.0` code does not depend on what they removed (see
`docs/RELEASE-PREPARATION.md`, step 6):

1. Note the previous commit (`git log --oneline` shows it just under the current one).
2. `git checkout <previous-commit>` → `npm run build` → `pm2 restart <api-app-name>`.
3. Restore the UI from the backup: `sudo rsync -a --delete <web-root>.bak-<date>/ <web-root>/`.

**Restore the database only if a migration failed part-way or the data itself must go back.** Everything
written after the backup is lost. Restore into a **new, empty database** and swap names — restoring an
older archive over the migrated database with `--clean` fails, because newer tables reference the old
ones. The previous database is kept, renamed, for inspection. Prove the archive first (§2,
`restore-test.sh`), then:

```bash
pm2 stop "${API_APP:?set API_APP to the pm2 app name}"     # nothing may stay connected
CONTAINER="${CONTAINER:?Postgres container}"; DB="${DB:?database name}"; ARCHIVE="${ARCHIVE:?verified .dump}"
NEWDB="${DB}_restore_$(date -u +%Y%m%d%H%M%S)"
docker exec "$CONTAINER" sh -c 'exec createdb --no-password -U "$POSTGRES_USER" "$1"' sh "$NEWDB"
docker exec -i "$CONTAINER" sh -c 'exec pg_restore --exit-on-error --single-transaction --no-owner --no-password -U "$POSTGRES_USER" -d "$1"' sh "$NEWDB" < "$ARCHIVE"
docker exec -i "$CONTAINER" sh -c 'exec psql -X -v ON_ERROR_STOP=1 --no-password -U "$POSTGRES_USER" -d postgres -v db="$1" -v newdb="$2" -v failed="$1_failed_$3"' sh "$DB" "$NEWDB" "$(date -u +%Y%m%d%H%M%S)" <<'SQL'
SELECT count(*) > 0 AS busy FROM pg_stat_activity WHERE datname IN (:'db', :'newdb') AND pid <> pg_backend_pid() \gset
\if :busy
  DO $$ BEGIN RAISE EXCEPTION 'STOP: something is still connected to the database; stop the API first'; END $$;
\endif
ALTER DATABASE :"db" RENAME TO :"failed";
ALTER DATABASE :"newdb" RENAME TO :"db";
SQL
```

Then check out and build the matching older code, `pm2 start` it, and verify (§6). Drop the
`<db>_failed_<time>` database only once you no longer need it. (`scripts/restore.sh` uses the host's
PostgreSQL tools and restores into a **new** database by default; it replaces an existing database only
with `--replace` and a `CONFIRM_REPLACE` naming that exact database and server — and only for an archive
of the **same** schema version. See its header.)

## Troubleshooting

- **`pg_dump: command not found`** — the host doesn't have Postgres tools; use
  `scripts/backup-docker.sh`, which runs the container's own tools (§2). Never `docker exec -t` for a dump.
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
