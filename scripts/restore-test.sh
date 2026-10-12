#!/usr/bin/env bash
# Proves a backup archive RESTORES — not just that it is readable — without touching any real database.
#
#   ./scripts/restore-test.sh <archive.dump> <postgres-image>
#   e.g. ./scripts/restore-test.sh /home/u/azad-backups/azad_ev-20261012T101500Z.dump postgres:16-alpine
#
# Use an image of the SAME (or a newer) PostgreSQL major version as the source; backup-docker.sh prints it.
# The scratch server is a throwaway container: no network at all (--network none), data on tmpfs (nothing
# written to disk), local-socket trust (no password exists), a unique label, and it is removed on exit
# whatever happens. Nothing else is created, changed or deleted.
#
# Checks, in order: the .sha256 file (when present) matches; pg_restore --exit-on-error --single-transaction
# into an empty database succeeds; the restored tables and exact row counts equal <archive>.counts (written
# by backup-docker.sh; when the data changed during the dump only the table list must match); and, when the
# database uses Prisma, its migration history is intact. Prints RESTORE_TEST_PASSED only if all of that holds.
set -euo pipefail
umask 077
ARCHIVE="${1:?Usage: restore-test.sh <archive.dump> <postgres-image>}"
IMAGE="${2:?Usage: restore-test.sh <archive.dump> <postgres-image>}"
[ -f "$ARCHIVE" ] || { echo "Archive not found: $ARCHIVE" >&2; exit 1; }
sha() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
BASE="${ARCHIVE%.dump}"

if [ -f "$ARCHIVE.sha256" ]; then
  (cd "$(dirname "$ARCHIVE")" && sha -c "$(basename "$ARCHIVE").sha256" > /dev/null) || { echo "Checksum mismatch: $ARCHIVE" >&2; exit 1; }
  echo "→ Checksum OK"
else
  echo "→ No $ARCHIVE.sha256 — checksum not verified"
fi

TAG="azad-restore-test-$(date -u +%Y%m%dT%H%M%SZ)-$$"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/azad-restore-test.XXXXXX")
cleanup() { docker rm -f "$TAG" > /dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

echo "→ Starting an isolated scratch server ($IMAGE, no network, tmpfs) as $TAG"
docker run -d --name "$TAG" --label azad.restore-test=1 --network none --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=restore_check "$IMAGE" > /dev/null
ready=0
for _ in $(seq 1 120); do
  # Only the final server listens on TCP (the image's init-time server does not), so this waits for the real one.
  if docker exec "$TAG" pg_isready -q -h 127.0.0.1 -U postgres -d restore_check 2>/dev/null; then ready=1; break; fi
  sleep 0.5
done
[ "$ready" = 1 ] || { echo "The scratch server did not become ready" >&2; docker logs "$TAG" 2>&1 | tail -20 >&2; exit 1; }
sql() { printf '%s\n' "$1" | docker exec -i "$TAG" psql -X -At -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d restore_check; }

echo "→ Restoring (single transaction, stop at the first error)"
docker exec -i "$TAG" pg_restore --exit-on-error --single-transaction --no-owner --no-privileges -h 127.0.0.1 -U postgres -d restore_check < "$ARCHIVE" 2> "$WORK/restore.log" \
  || { echo "RESTORE FAILED:" >&2; tail -20 "$WORK/restore.log" >&2; exit 1; }

sql "$(cat "$(dirname "$0")/lib/table-counts.sql")" > "$WORK/counts"
TABLES=$(wc -l < "$WORK/counts" | tr -d ' ')
[ "$TABLES" -gt 0 ] || { echo "The restored database has no tables" >&2; exit 1; }

if [ -f "$BASE.counts" ]; then
  if cmp -s "$BASE.counts" "$WORK/counts"; then
    echo "→ All $TABLES tables and their exact row counts match $BASE.counts"
  elif grep -qx 'counts_stable_during_dump=no' "$BASE.meta" 2>/dev/null && [ "$(cut -d' ' -f1 "$BASE.counts")" = "$(cut -d' ' -f1 "$WORK/counts")" ]; then
    echo "→ All $TABLES tables present; row counts differ, but the data was changing during the dump (see $BASE.meta)"
  else
    echo "Restored tables or row counts differ from $BASE.counts:" >&2; diff "$BASE.counts" "$WORK/counts" >&2 || true; exit 1
  fi
else
  echo "→ $TABLES tables restored (no $BASE.counts to compare row counts against)"
fi

if [ "$(sql "select to_regclass('public._prisma_migrations') is not null;")" = t ]; then
  m=$(sql "select count(*) filter (where finished_at is not null and rolled_back_at is null)||' applied, '||count(*) filter (where finished_at is null or rolled_back_at is not null)||' unfinished or rolled back, latest '||coalesce(max(migration_name) filter (where finished_at is not null and rolled_back_at is null), 'none') from public._prisma_migrations;")
  case "$m" in *" 0 unfinished or rolled back"*) echo "→ Prisma migrations: $m" ;; *) echo "Prisma migration history is not clean: $m" >&2; exit 1 ;; esac
fi

echo "✓ RESTORE_TEST_PASSED $ARCHIVE → $IMAGE ($TABLES tables). The scratch server is removed on exit."
