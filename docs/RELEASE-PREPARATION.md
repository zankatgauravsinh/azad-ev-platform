# Release preparation — release 3.2

The order below is deliberate: each step depends on the one before it, and **nothing is pushed, merged or
deployed until step 8 is signed off.** Production is only ever read in step 2 (configuration) and step 3
(the backup); every data check runs against a restored *copy* (step 4). The deployment itself then follows
`deploy/DEPLOY.md`.

> Status: this document is the procedure. As of its writing, none of these steps has been carried out
> against production.

What release 3.2 changes, relative to `release/2.0` (production): GST configuration and documents (GST stays
**disabled**), catalogue management, vehicle-identity protection, the CSV import (preview, all-or-nothing
import, rate limits, time limits), and three database migrations (step 5).

## 1. Establish the intended deployment branch — decision required

`deploy/DEPLOY.md` deploys `release/2.0`. `release/3.2` contains all of `release/2.0` (it is a fast-forward)
and is not yet pushed. Choose one, and record who approved it:

- **A. Fast-forward `release/2.0` to `release/3.2`.** The runbook and the server's checkout stay as they are.
- **B. Make `release/3.2` the deploy branch.** Push it; update `deploy/DEPLOY.md` §0/§1 and the server checkout.

Either way, note the exact commit to deploy and the commit currently in production (`git log -1` on the
server) — the latter is the code-only rollback target (step 6). Do not push until step 8.

## 2. Confirm the production topology (read-only, on the server)

Record the answers; several later steps depend on them.

```bash
cd /var/www/html/azad-ev-platform
git log -1 --oneline                                 # commit in production now
pm2 list                                             # API app name
docker ps --format '{{.Names}}  {{.Image}}'          # Postgres container and image (major version)
grep -E '^VITE_API_BASE_URL' web/.env                # where browsers and the app send API calls
sudo ss -ltnp | grep -E ':(80|443|3000|3001|5432)\b' # what listens on which port
sudo grep -RnE 'proxy_pass|proxy_read_timeout|proxy_send_timeout|X-Forwarded-For' /etc/nginx/sites-enabled/
node --version
```

Then decide, per `deploy/DEPLOY.md`:
- **Proxy trust** ("Client IP and proxy trust"). The API trusts only loopback proxy hops. If nginx proxies
  the API it must connect over loopback and append `$proxy_add_x_forwarded_for`. If something else sits in
  front, the per-IP limit needs the trusted hops adjusted; the CSV limits are per user and unaffected.
- **Timeouts** ("Request timeouts"). If nginx proxies the API, set `proxy_read_timeout` and
  `proxy_send_timeout` to 120 s on that location.
- Whether port 5432 is reachable from outside the host (it must not be).

## 3. Back up production and prove the backup restores

Follow `deploy/DEPLOY.md` §2 exactly: `scripts/backup-docker.sh` (`BACKUP_ARCHIVE_VALID`), then
`scripts/restore-test.sh` (`RESTORE_TEST_PASSED`) with the image from the `.meta` file. Record the archive
name, its SHA-256 and both result lines, copy the archive and its `.sha256`, `.counts` and `.meta` off the
server, verify the checksum there, and back up `uploads/`. `BACKUP_ARCHIVE_VALID` alone is not enough.

## 4. Run the compatibility checks against a snapshot — never against production

Restore the verified archive into a throwaway container with no network and run the read-only checks in
`scripts/release/compatibility-checks.sql` there. The file sets its session read-only; any write fails.

```bash
ARCHIVE="${ARCHIVE:?the archive that passed restore-test.sh}"
IMAGE="${IMAGE:?the image= line of its .meta file}"
SNAP="azad-snapshot-$(date -u +%Y%m%dT%H%M%SZ)"
docker run -d --name "$SNAP" --network none --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=snapshot "$IMAGE"
until docker exec "$SNAP" pg_isready -q -h 127.0.0.1 -U postgres -d snapshot; do sleep 1; done
docker exec -i "$SNAP" pg_restore --exit-on-error --single-transaction --no-owner --no-privileges -h 127.0.0.1 -U postgres -d snapshot < "$ARCHIVE"
docker exec -i "$SNAP" psql -X -h 127.0.0.1 -U postgres -d snapshot < scripts/release/compatibility-checks.sql | tee "compat-$SNAP.txt"
docker rm -f "$SNAP"
```

Gates (each check prints its expectation):

| Check | Must be | If not |
| --- | --- | --- |
| **P5** GST enabled anywhere | no rows | **Stop.** In 3.2 the flag turns on GST calculation for sales; decide with the owner before anything else |
| **P3a / P3b** identifiers not trimmed and upper-case; near-duplicates | 0 0 0; no rows | A reviewed data fix before the CSV import is used |
| **M1** migrations | the 21 of `release/2.0`, none failed or rolled back, none of the three new ones | Stop; investigate the migration history |
| **M2** `ScooterModel_brand_name_key` | present | Stop; the 3.2 migration drops it |
| **M3** (companyId, brand, name) duplicates | no rows | Stop; the new unique index would fail |
| **M4** new tax tables | all NULL | Stop |
| **P1, P2, P4** | reviewed | Tell staff which vehicles and catalogue entries will refuse edits (P1, P2) and which names need a Brand column in CSV files (P4) |

## 5. Inspect the migration prerequisites

`prisma migrate deploy` (`deploy/DEPLOY.md` §3a) applies, in order:

| Migration | Effect | Note |
| --- | --- | --- |
| `20261004173939_tax_foundation` | new enums and tables; nullable `CompanySetting.gstStateCode` | additive |
| `20261005170323_sale_tax_snapshots` | new tables; nullable columns on Accessory, CompanySetting, Customer, ScooterModel; foreign keys (TaxSnapshot → Sale) | additive |
| `20261007124942_catalog_model_tenant_unique` | drops `ScooterModel_brand_name_key`, creates a unique index on (companyId, brand, name) | needs M2 / M3 clean; briefly locks `ScooterModel` |

Then `npm run rbac:init` (§3b; the permission catalogue is unchanged in 3.2, but it runs on every deploy).
No new environment variables are required. The backup from step 3 must exist before the migration runs.

## 6. Review the rollback procedures

- **Code-only rollback (preferred):** check out the commit recorded in step 1, rebuild, restart; the
  migrated database stays and no data is lost. Possible for 3.2 because the `release/2.0` code never
  references the dropped `brand_name` index key, never hard-deletes sales (the new TaxSnapshot → Sale
  foreign key cannot block it), and ignores the new tables and nullable columns; with GST disabled (P5)
  no tax snapshots are written. The UI is rolled back from the `<web-root>.bak-<date>` copy.
- **Database restore:** only if a migration fails part-way or data must go back. It loses every write
  since the backup, and it must restore into a new database and swap names — `deploy/DEPLOY.md` → Rollback.
  Rehearse it on a snapshot container (step 4) if there is any doubt.

## 7. Outstanding server-side items

- nginx: 120 s timeouts and the `X-Forwarded-For` form — only if nginx proxies the API (step 2).
- Release notes: `CHANGELOG.md` does not yet describe 3.x; operators should get a summary of user-visible
  changes (identity locks, catalogue management, CSV import, GST screens with GST off).

## 8. Release approval — record before pushing anything

- [ ] Deployment branch decided (A or B), deploy commit and rollback commit recorded — approved by: ____
- [ ] Topology recorded (step 2); nginx changes, if any, planned
- [ ] Backup: archive ____, SHA-256 ____, `RESTORE_TEST_PASSED` seen, copy off the server verified
- [ ] Compatibility checks on the snapshot: every gate in step 4 met (P5 no rows)
- [ ] Migration prerequisites (step 5) and rollback plan (step 6) reviewed
- [ ] Release approved by: ____ on ____

Only then push or merge as decided in step 1 and deploy with `deploy/DEPLOY.md` §1–§6.
