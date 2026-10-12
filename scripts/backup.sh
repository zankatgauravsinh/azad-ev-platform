#!/usr/bin/env bash
# Database backup for AZAD EV POINT using the HOST's PostgreSQL client tools (pg_dump / pg_restore, version
# >= the server's). For a database inside Docker with no client tools on the host, use backup-docker.sh.
#
#   DATABASE_URL=postgresql://user:pass@host:5432/db BACKUP_DIR=/opt/azad-ev/backups ./scripts/backup.sh
#
# DATABASE_URL is read from the environment only (the systemd unit loads it from .env); the password never
# appears in a process argument. Produces, without ever overwriting an existing file:
#   <db>-<UTC stamp>.dump         custom-format archive (mode 600, folder mode 700)
#   <db>-<UTC stamp>.dump.sha256  checksum
#   <db>-<UTC stamp>.toc          pg_restore --list output
#   <db>-<UTC stamp>.counts       exact row count per table, taken just before the dump
#   <db>-<UTC stamp>.meta         server version, sizes, whether the data changed during the dump
# The archive is validated (table of contents readable, every data block decodes) BEFORE it gets its final
# name. That proves the file is readable — NOT that a restore succeeds: run scripts/restore-test.sh for that.
# Old backups (> RETENTION_DAYS) are pruned only after the new one has been validated.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
. scripts/lib/pg-env.sh

BACKUP_DIR="${1:-${BACKUP_DIR:?Set BACKUP_DIR (absolute path) or pass it as the first argument}}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
case "$BACKUP_DIR" in /*) ;; *) echo "BACKUP_DIR must be an absolute path" >&2; exit 1 ;; esac
case "$RETENTION_DAYS" in ''|*[!0-9]*) echo "RETENTION_DAYS must be a whole number" >&2; exit 1 ;; esac
command -v pg_dump >/dev/null && command -v pg_restore >/dev/null && command -v psql >/dev/null || { echo "pg_dump, pg_restore and psql are required on this host" >&2; exit 1; }
sha() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }

pg_env_from_database_url
OUT=""
trap 'pg_env_cleanup; if [ -n "$OUT" ]; then rm -f "$OUT.partial" "$BASE.counts.after"; fi' EXIT
sql() { psql -X -At -v ON_ERROR_STOP=1 --no-password -c "$1"; }

mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BASE="$BACKUP_DIR/$PGDATABASE-$STAMP"; OUT="$BASE.dump"
for f in "$OUT" "$OUT.partial" "$OUT.sha256" "$BASE.toc" "$BASE.counts" "$BASE.meta"; do
  [ ! -e "$f" ] || { echo "Refusing to overwrite existing $f" >&2; OUT=""; exit 1; }
done

echo "→ Backing up database '$PGDATABASE' on $PGHOST:$PGPORT as $PGUSER to $OUT"
sql "$(cat scripts/lib/table-counts.sql)" > "$BASE.counts"
pg_dump --format=custom --no-password --file="$OUT.partial"
sql "$(cat scripts/lib/table-counts.sql)" > "$BASE.counts.after"
if cmp -s "$BASE.counts" "$BASE.counts.after"; then STABLE=yes; else STABLE=no; fi

echo "→ Validating the archive (table of contents + decoding every data block; this is not a restore)"
pg_restore --list "$OUT.partial" > "$BASE.toc"
[ "$(grep -c ' TABLE DATA ' "$BASE.toc" || true)" -gt 0 ] || { echo "The archive contains no table data" >&2; exit 1; }
pg_restore --file=/dev/null "$OUT.partial"

ln "$OUT.partial" "$OUT"            # fails instead of overwriting
rm -f "$OUT.partial"
(cd "$BACKUP_DIR" && sha "$(basename "$OUT")" > "$(basename "$OUT").sha256")
{
  echo "server=$PGHOST:$PGPORT"
  echo "server_version=$(sql 'show server_version;')"
  echo "database=$PGDATABASE"
  echo "created_utc=$STAMP"
  echo "archive_bytes=$(wc -c < "$OUT" | tr -d ' ')"
  echo "tables=$(wc -l < "$BASE.counts" | tr -d ' ')"
  echo "table_data_entries=$(grep -c ' TABLE DATA ' "$BASE.toc")"
  echo "counts_stable_during_dump=$STABLE"
} > "$BASE.meta"

echo "→ Pruning backups older than ${RETENTION_DAYS} days"
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name "$PGDATABASE-*.dump" -o -name "$PGDATABASE-*.dump.sha256" -o -name "$PGDATABASE-*.toc" -o -name "$PGDATABASE-*.counts" -o -name "$PGDATABASE-*.meta" \) -mtime "+$RETENTION_DAYS" -delete

echo "✓ BACKUP_ARCHIVE_VALID $OUT"
sed 's/^/  /' "$BASE.meta"
[ "$STABLE" = yes ] || echo "  NOTE: rows changed while dumping; $BASE.counts is only approximate. Back up in a quiet window for an exact comparison."
echo "  Readable archive only. To prove it restores: scripts/restore-test.sh $OUT <postgres-image>"
