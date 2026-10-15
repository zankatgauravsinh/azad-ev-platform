#!/usr/bin/env bash
# Proves a backup archive RESTORES — not just that it is readable — without touching any real database.
#
#   ./scripts/restore-test.sh <archive.dump> <postgres-image>
#   e.g. ./scripts/restore-test.sh /home/u/azad-backups/azad_ev-20261012T101500Z.dump postgres:16-alpine
#
# Use an image of the SAME (or a newer) PostgreSQL major version as the source; the backup's .meta names
# it. The scratch server is a throwaway container: no network at all (--network none), data on tmpfs
# (nothing written to disk), local-socket trust (no password exists) and a unique name and label. Cleanup
# removes exactly the container ID this run created — never a container it did not start — and its own
# temporary folder; the container is removed with its anonymous volumes (docker rm -v), which belong to it
# alone. Nothing else is created, changed or deleted.
#
# Distinct results, in order:
#   ARCHIVE_READABLE     the .sha256 checksum (required) matches and pg_restore can list the archive. A checksum
#                        proves the file is the one the backup wrote — not that it holds all the data.
#   RESTORE_COMPLETED    pg_restore --exit-on-error --single-transaction into an empty database succeeded —
#                        nothing compared yet
#   then exactly one of:
#   RESTORE_TEST_PASSED              (exit 0) FULL verification: every table's exact row count equals
#                                    <archive>.counts and the Prisma migration history is clean and equal to
#                                    the one recorded in <archive>.meta. Only this proves the backup usable.
#   RESTORE_TEST_PASSED_TABLES_ONLY  (exit 3) only the table list was verified (and the migration history is
#                                    clean): the source's row counts changed while the dump ran (they are
#                                    taken outside the dump's snapshot), or there is no .counts (the list is
#                                    then checked against the archive's own table of contents), or the set's
#                                    .meta (or a field of it) is absent. Row counts were NOT verified.
#   Failures (exit 1): ARCHIVE_REJECTED (checksum, archive or set metadata unusable — nothing restored),
#   RESTORE_FAILED (pg_restore or the scratch server failed), RESTORE_NOT_VERIFIED (restored, but not
#   matching the set). A FULL result also needs the set's .counts and .meta complete and consistent with the
#   archive (verify_set_metadata). The same labels and exit codes as scripts/restore.sh.
set -euo pipefail
umask 077
ARCHIVE="${1:?Usage: restore-test.sh <archive.dump> <postgres-image>}"
IMAGE="${2:?Usage: restore-test.sh <archive.dump> <postgres-image>}"
. "$(dirname "$0")/lib/backup-lib.sh"
BASE="${ARCHIVE%.dump}"
require_tools $CORE_TOOLS docker od seq sleep tail
verify_archive_set "$ARCHIVE"
verify_set_metadata "$ARCHIVE" || die "ARCHIVE_REJECTED: the set's metadata cannot be trusted; nothing was restored"

TAG="azad-restore-test-$(date -u +%Y%m%dT%H%M%SZ)-$$-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/azad-restore-test.XXXXXX")
CID=""
cleanup() { if [ -n "$CID" ]; then docker rm -f -v "$CID" > /dev/null 2>&1 || true; fi; rm -rf "$WORK"; }
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

echo "→ Starting an isolated scratch server ($IMAGE, no network, tmpfs) as $TAG"
CID=$(docker run -d --name "$TAG" --label azad.restore-test=1 --label "azad.restore-test.run=$TAG" --network none \
  --tmpfs /var/lib/postgresql/data -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=restore_check "$IMAGE") \
  || { CID=$(docker ps -aq --no-trunc --filter "label=azad.restore-test.run=$TAG"); die "RESTORE_FAILED: could not start the scratch server"; }
ready=0
for _ in $(seq 1 120); do
  # Only the final server listens on TCP (the image's init-time server does not), so this waits for the real one.
  if docker exec "$CID" pg_isready -q -h 127.0.0.1 -U postgres -d restore_check 2>/dev/null; then ready=1; break; fi
  sleep 0.5
done
[ "$ready" = 1 ] || { echo "RESTORE_FAILED: the scratch server did not become ready" >&2; docker logs "$CID" 2>&1 | tail -20 >&2; exit 1; }
sql() { printf '%s\n' "$1" | docker exec -i "$CID" psql -X -At -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d restore_check; }

docker exec -i "$CID" pg_restore --list < "$ARCHIVE" > "$WORK/toc" 2> "$WORK/list.log" \
  || { echo "ARCHIVE_REJECTED: the archive is not a readable pg_dump archive:" >&2; tail -5 "$WORK/list.log" >&2; exit 1; }
echo "✓ ARCHIVE_READABLE $ARCHIVE"

echo "→ Restoring (single transaction, stop at the first error)"
docker exec -i "$CID" pg_restore --exit-on-error --single-transaction --no-owner --no-privileges -h 127.0.0.1 -U postgres -d restore_check < "$ARCHIVE" 2> "$WORK/restore.log" \
  || { echo "RESTORE_FAILED:" >&2; tail -20 "$WORK/restore.log" >&2; exit 1; }
echo "✓ RESTORE_COMPLETED into the scratch server — not yet verified"

sql "$(cat "$(dirname "$0")/lib/table-counts.sql")" > "$WORK/counts"
TABLES=$(wc -l < "$WORK/counts" | tr -d ' ')
verify_restored_counts "$BASE" "$WORK/counts" "$WORK/toc" || { echo "RESTORE_NOT_VERIFIED: the restored database does not match the backup set" >&2; exit 1; }
if [ "$(sql "$MIGRATIONS_PRESENT_SQL")" = t ]; then MIGRATIONS=$(sql "$MIGRATIONS_STATE_SQL"); else MIGRATIONS=absent; fi
verify_restored_migrations "$BASE" "$MIGRATIONS" || { echo "RESTORE_NOT_VERIFIED: the restored database does not match the backup set" >&2; exit 1; }

if [ "$(restore_verification_level)" = full ]; then
  echo "✓ RESTORE_TEST_PASSED $ARCHIVE → $IMAGE ($TABLES tables, exact row counts and migration history verified). The scratch server is removed on exit."
else
  echo "~ RESTORE_TEST_PASSED_TABLES_ONLY $ARCHIVE → $IMAGE ($TABLES tables) — only the table list was verified. $TABLES_ONLY_GUIDANCE The scratch server is removed on exit."
  exit 3
fi
