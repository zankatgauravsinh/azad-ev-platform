#!/usr/bin/env bash
# Restore an AZAD EV POINT database backup produced by scripts/backup.sh.
# DESTRUCTIVE: recreates the public schema before restoring.
#
#   DATABASE_URL=postgres://user:pass@host:5432/db ./scripts/restore.sh backups/azad_ev-YYYYmmdd-HHMMSS.dump
#
set -euo pipefail

DUMP="${1:?Usage: restore.sh <dump-file>}"
: "${DATABASE_URL:?DATABASE_URL must be set}"
[ -f "$DUMP" ] || { echo "Backup file not found: $DUMP" >&2; exit 1; }

# Prisma appends a `schema=` query param that libpq (pg_restore) rejects — strip it.
PG_URL="$(printf '%s' "$DATABASE_URL" | sed -E 's/([?&])schema=[^&]*//; s/\?&/?/; s/[?&]$//')"

echo "!! This will REPLACE the current database with $DUMP"
if [ "${FORCE:-0}" != "1" ]; then
  read -r -p "Type 'yes' to continue: " confirm
  [ "$confirm" = "yes" ] || { echo "Aborted."; exit 1; }
fi

echo "→ Restoring…"
# --clean --if-exists drops existing objects first; single transaction rolls back on error.
pg_restore --clean --if-exists --no-owner --single-transaction -d "$PG_URL" "$DUMP"
echo "✓ Restore complete"
