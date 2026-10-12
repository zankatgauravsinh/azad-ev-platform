#!/usr/bin/env bash
# Restore an AZAD EV POINT database backup produced by scripts/backup.sh.
# DESTRUCTIVE: recreates the public schema before restoring.
#
#   DATABASE_URL=postgres://user:pass@host:5432/db ./scripts/restore.sh /abs/path/azad_ev-<UTC stamp>.dump
# Only for an archive of the SAME schema version as the target: restoring an older archive over a migrated
# database fails (newer tables reference the old ones) — see deploy/DEPLOY.md → Rollback, which restores into
# a new database instead. For a database inside Docker, see the same section. Never run this as a test —
# use restore-test.sh.
#
set -euo pipefail

DUMP="${1:?Usage: restore.sh <dump-file>}"
[ -f "$DUMP" ] || { echo "Backup file not found: $DUMP" >&2; exit 1; }
DUMP="$(cd "$(dirname "$DUMP")" && pwd)/$(basename "$DUMP")"   # absolute, before changing directory
cd "$(dirname "$0")/.."
. scripts/lib/pg-env.sh
pg_env_from_database_url           # DATABASE_URL from the environment; no password in any argument
trap pg_env_cleanup EXIT

# Refuse an archive that is not readable before touching the database.
pg_restore --list "$DUMP" > /dev/null || { echo "Not a readable pg_dump archive: $DUMP" >&2; exit 1; }

echo "!! This will REPLACE database '$PGDATABASE' on $PGHOST:$PGPORT with $DUMP"
echo "   Prove the archive restores first: scripts/restore-test.sh $DUMP <postgres-image>"
if [ "${FORCE:-0}" != "1" ]; then
  read -r -p "Type 'yes' to continue: " confirm
  [ "$confirm" = "yes" ] || { echo "Aborted."; exit 1; }
fi

echo "→ Restoring…"
# --clean --if-exists drops existing objects first; single transaction rolls back on error.
pg_restore --clean --if-exists --no-owner --single-transaction --no-password --dbname="$PGDATABASE" "$DUMP"
echo "✓ Restore complete"
