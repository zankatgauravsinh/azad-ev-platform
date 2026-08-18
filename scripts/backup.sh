#!/usr/bin/env bash
# Database backup for AZAD EV POINT.
# Produces a compressed, timestamped pg_dump and prunes backups older than
# RETENTION_DAYS. Intended to run from cron/systemd-timer (see docs/DEPLOYMENT.md).
#
#   DATABASE_URL=postgres://user:pass@host:5432/db ./scripts/backup.sh [backup_dir]
#
set -euo pipefail

BACKUP_DIR="${1:-${BACKUP_DIR:-./backups}}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
: "${DATABASE_URL:?DATABASE_URL must be set}"

# Prisma appends a `schema=` query param that libpq (pg_dump) rejects — strip it.
PG_URL="$(printf '%s' "$DATABASE_URL" | sed -E 's/([?&])schema=[^&]*//; s/\?&/?/; s/[?&]$//')"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/azad_ev-$STAMP.dump"

echo "→ Backing up database to $OUT"
# Custom format (-Fc) → compressed and restorable with pg_restore.
pg_dump "$PG_URL" -Fc -f "$OUT"

echo "→ Pruning backups older than ${RETENTION_DAYS} days"
find "$BACKUP_DIR" -name 'azad_ev-*.dump' -type f -mtime "+${RETENTION_DAYS}" -delete

echo "✓ Backup complete: $(du -h "$OUT" | cut -f1) — $(ls "$BACKUP_DIR"/azad_ev-*.dump | wc -l | tr -d ' ') backup(s) retained"
