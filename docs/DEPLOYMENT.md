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

## 6. Backups & restore (verified)
Nightly via the systemd timer, or manually:
```bash
DATABASE_URL=… ./scripts/backup.sh /opt/azad-ev/backups      # compressed pg_dump, prunes >14 days
DATABASE_URL=… ./scripts/restore.sh /opt/azad-ev/backups/azad_ev-YYYYmmdd-HHMMSS.dump
```
The scripts strip Prisma's `?schema=` param that libpq rejects. **Test a restore into a
scratch database quarterly** — an untested backup is not a backup. Also back up the
`uploads/` directory (KYC docs, photos) with the DB.

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
