# Deployment & Operations Runbook

Target: a single on-prem/VPS host for one showroom (AZAD EV POINT). Two supported
paths — **systemd + nginx** (recommended for a single box; verified scripts) and
**Docker** (artifacts provided). Postgres 14+.

## 1. Prerequisites
- Node 20 LTS, PostgreSQL 14+, nginx, `postgresql-client` (for backups).
- A dedicated unix user `azad`; app at `/opt/azad-ev/app`, uploads at `/opt/azad-ev/app/uploads`, backups at `/opt/azad-ev/backups`.

## 2. Environment
Copy `.env.example` → `.env` and set **real** values. In `NODE_ENV=production` the API
**refuses to boot** unless (enforced in `api/src/config/env.ts`):
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` are not the example values, differ from each other, and are ≥ 32 chars.
- `SEED_OWNER_PASSWORD` is not the example value.

Generate secrets: `openssl rand -hex 32`. Set `WEB_ORIGIN` to the real HTTPS origin (CORS), and `VITE_API_BASE_URL` to `https://<host>/api/v1` before building the web app.

## 3. Build
```bash
npm ci
npm run build --workspace @azad/shared
npm run build --workspace api
npm run build --workspace web        # → web/dist
npx prisma migrate deploy --schema api/prisma/schema.prisma
node api/dist/prisma/seed.js          # first install only — seeds company + owner
```

## 4a. Run with systemd (recommended)
```bash
sudo cp deploy/azad-api.service /etc/systemd/system/
sudo cp deploy/azad-backup.service deploy/azad-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now azad-api
sudo systemctl enable --now azad-backup.timer
```
Serve the SPA + proxy the API with nginx: copy `web/dist` to `/var/www/azad-ev/web`,
install `deploy/nginx.conf`, then `certbot --nginx` and enable the HTTPS block.

## 4b. Run with Docker (alternative)
`api/Dockerfile` is a multi-stage build (context = repo root). Reviewed against the
workspace layout; **build it in your CI/host first** — the dev box here has no Docker
daemon, so the image is not runtime-verified in this repo. Pair with the existing
`docker-compose.yml` (Postgres) or extend it with the API image and an nginx service.

## 5. Health & monitoring
- Liveness + DB check: `GET /api/v1/health` → `{ status, db, timestamp }` (public, unauthenticated). Wire to your uptime monitor and the load balancer.
- App logs go to stdout (systemd journal: `journalctl -u azad-api -f`). 5xx responses log with stack traces; 4xx log as warnings (`AllExceptionsFilter`).

## 6. Backups & restore
Nightly via the systemd timer (host PostgreSQL client tools, version ≥ the server's), or manually:
```bash
DATABASE_URL="…" BACKUP_DIR=/opt/azad-ev/backups ./scripts/backup.sh     # validated custom-format dump; deletes nothing
./scripts/restore-test.sh /opt/azad-ev/backups/azad_ev-<UTC time>.dump postgres:16-alpine   # proves it restores (needs Docker)
DATABASE_URL="…" ./scripts/restore.sh /opt/azad-ev/backups/azad_ev-<UTC time>.dump   # restores into a NEW database azad_ev_restore_<time>
```
`DATABASE_URL` is read from the environment only; the password goes to a temporary mode-600 password file,
never a command-line argument or any output. A URL that is ambiguous (several hosts, or `hostaddr`/`port`/
`dbname`… repeated as query parameters) is refused, and the scripts print — and `.meta` records — the
server's system identifier and the database OID, so the source is identified positively, not by host name.
`BACKUP_DIR` must be an absolute path to a private folder (created mode 700 if missing; an existing one must
belong to you and already be mode 700). Each backup is a set — `.dump`, `.dump.sha256`, `.toc`, `.counts`,
`.meta` — built in a private `.incomplete-…` folder and put in place without ever overwriting a file; it is
complete exactly when its `.meta` says `backup_status=ARCHIVE_VALID`. A failed run removes only its own
temporary folder.

**Retention is off unless `RETENTION_DAYS` is set** (the systemd unit sets 14). It then removes only
complete sets of the same database on the same server (system identifier, address and database OID) older
than that many days — never a set with a `<base>.keep` file (`touch <base>.keep` for release backups),
an older-format set, or any other file.

`backup.sh` prints `BACKUP_ARCHIVE_VALID` when the archive is readable (a checksum proves the file is the one
written, not that its data is complete); only `restore-test.sh` (`RESTORE_TEST_PASSED`) shows that it
restores — run it for every release and at least quarterly. Its results, in order: `ARCHIVE_READABLE`,
`RESTORE_COMPLETED` (restored, nothing compared yet), then `RESTORE_TEST_PASSED` (exit 0: exact row counts and
migration history match) or `RESTORE_TEST_PASSED_TABLES_ONLY` (exit 3: only the table list could be checked —
the rows changed during the dump, so `.counts`, taken outside the dump's snapshot, need not match it; or there
is no `.counts`; or the `.meta`, or a field of it, is absent). The weaker result is not a full verification:
back up again in a quiet window. A full result also requires the set's `.counts` and `.meta` to be consistent
with the archive; metadata that is present but malformed or contradictory is refused (`ARCHIVE_REJECTED`,
exit 1), as are checksum failures. Other failures: `RESTORE_FAILED`, `RESTORE_NOT_VERIFIED` (exit 1).
`restore.sh` reports `RESTORE_VERIFIED` / `RESTORE_VERIFIED_TABLES_ONLY` with the same labels and exit codes.
When
PostgreSQL runs in Docker with no client tools on the host, use `scripts/backup-docker.sh` instead (see
`deploy/DEPLOY.md` §2). `scripts/restore.sh` checks the checksum first, refuses a server that is not on this
machine (unless `ALLOW_REMOTE_HOST` names it), restores into a **new** database by default and prints
`ARCHIVE_READABLE` → `RESTORE_COMPLETED` → `RESTORE_VERIFIED`. It replaces an existing database only with
`--replace` and `CONFIRM_REPLACE='<db>@<system id>/<database oid>'` (the value it prints), with nothing else
connected, and only for an archive of the same schema version; rollbacks across migrations are in
`deploy/DEPLOY.md` → Rollback. `scripts/tests/backup-restore-safety.sh` tests all of this against a
throwaway cluster and containers. Also back up the `uploads/` directory (KYC docs, photos) with the database.

## 7. Security checklist before go-live
- [ ] Real, unique JWT secrets and owner password (enforced by the boot guard).
- [ ] HTTPS enforced; HSTS on; HTTP→HTTPS redirect enabled in nginx.
- [ ] Postgres not exposed to the public internet (bind localhost / private subnet).
- [ ] `NODE_ENV=production` (disables Swagger at `/api/docs`).
- [ ] Firewall: only 80/443 public; 3000 and 5432 internal only.
- [ ] Owner changed the seeded password after first login (this also revokes the seed session).
- [ ] Rate limits active (login 10/min, refresh 20/min, global 120/min per IP).

## 8. Known limitations (see PRODUCTION-READINESS.md)
- Stored files are served by unguessable UUID key but without per-request auth (fine on a private LAN; move to S3 signed URLs before any public/multi-tenant hosting).
- No offline/sync engine (architecture is prepared for it; see the Offline-Future audit in the readiness report).
