#!/usr/bin/env bash
# Database backup for AZAD EV POINT when PostgreSQL runs in a Docker container (the production topology in
# deploy/DEPLOY.md). Uses the CONTAINER's own pg_dump / pg_restore, so their version always matches the
# server and the host needs no PostgreSQL tools.
#
#   BACKUP_DIR=/home/<user>/azad-backups ./scripts/backup-docker.sh <container> <database>
#
# Both the container and the database are named explicitly — nothing is assumed. The dump connects over the
# container's local socket as $POSTGRES_USER (the official image trusts local connections), so no password
# is read, passed or printed. No pseudo-terminal is allocated (never `docker exec -t` for a dump: a TTY can
# rewrite line endings and corrupt the stream). Produces, without ever overwriting an existing file:
#   <db>-<UTC stamp>.dump             custom-format archive (mode 600, folder mode 700)
#   <db>-<UTC stamp>.dump.sha256      checksum
#   <db>-<UTC stamp>.toc              pg_restore --list output
#   <db>-<UTC stamp>.counts           exact row count per table, taken just before the dump
#   <db>-<UTC stamp>.meta             container, image, server version, sizes, whether the data changed
# The archive is validated (table of contents readable, every data block decodes) BEFORE it gets its final
# name. That proves the file is readable — NOT that a restore succeeds: run scripts/restore-test.sh for that.
set -euo pipefail
umask 077
CONTAINER="${1:?Usage: backup-docker.sh <postgres-container> <database>}"
DB="${2:?Usage: backup-docker.sh <postgres-container> <database>}"
BACKUP_DIR="${BACKUP_DIR:?Set BACKUP_DIR to the absolute path of the backup folder}"
case "$BACKUP_DIR" in /*) ;; *) echo "BACKUP_DIR must be an absolute path" >&2; exit 1 ;; esac
case "$DB" in ''|*[!A-Za-z0-9_]*) echo "Unexpected database name: $DB" >&2; exit 1 ;; esac
sha() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }

[ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" = true ] || { echo "Container '$CONTAINER' is not running (list them with: docker ps)" >&2; exit 1; }
# SQL goes in on stdin, the database name as a positional argument — no shell quoting of either.
sql() { printf '%s\n' "$1" | docker exec -i "$CONTAINER" sh -c 'exec psql -X -At -v ON_ERROR_STOP=1 --no-password -U "$POSTGRES_USER" -d "$1"' sh "$DB"; }
[ "$(sql "select current_database();")" = "$DB" ] || { echo "Cannot connect to database '$DB' in '$CONTAINER'" >&2; exit 1; }

COUNTS_SQL=$(cat "$(dirname "$0")/lib/table-counts.sql")

mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BASE="$BACKUP_DIR/$DB-$STAMP"; OUT="$BASE.dump"
for f in "$OUT" "$OUT.partial" "$OUT.sha256" "$BASE.toc" "$BASE.counts" "$BASE.meta"; do
  [ ! -e "$f" ] || { echo "Refusing to overwrite existing $f" >&2; exit 1; }
done
trap 'rm -f "$OUT.partial" "$BASE.counts.after"' EXIT

echo "→ Recording row counts of '$DB' in '$CONTAINER'"
sql "$COUNTS_SQL" > "$BASE.counts"
echo "→ Dumping to $OUT"
docker exec "$CONTAINER" sh -c 'exec pg_dump --format=custom --no-password -U "$POSTGRES_USER" -d "$1"' sh "$DB" > "$OUT.partial"
sql "$COUNTS_SQL" > "$BASE.counts.after"
if cmp -s "$BASE.counts" "$BASE.counts.after"; then STABLE=yes; else STABLE=no; fi

echo "→ Validating the archive with the container's pg_restore (table of contents + every data block; not a restore)"
docker exec -i "$CONTAINER" pg_restore --list < "$OUT.partial" > "$BASE.toc"
[ "$(grep -c ' TABLE DATA ' "$BASE.toc" || true)" -gt 0 ] || { echo "The archive contains no table data" >&2; exit 1; }
docker exec -i "$CONTAINER" pg_restore --file=/dev/null < "$OUT.partial"

ln "$OUT.partial" "$OUT"            # fails instead of overwriting
rm -f "$OUT.partial"
(cd "$BACKUP_DIR" && sha "$(basename "$OUT")" > "$(basename "$OUT").sha256")
{
  echo "container=$CONTAINER"
  echo "image=$(docker inspect -f '{{.Config.Image}}' "$CONTAINER")"
  echo "server_version=$(sql 'show server_version;')"
  echo "database=$DB"
  echo "created_utc=$STAMP"
  echo "archive_bytes=$(wc -c < "$OUT" | tr -d ' ')"
  echo "tables=$(wc -l < "$BASE.counts" | tr -d ' ')"
  echo "table_data_entries=$(grep -c ' TABLE DATA ' "$BASE.toc")"
  echo "counts_stable_during_dump=$STABLE"
} > "$BASE.meta"

echo "✓ BACKUP_ARCHIVE_VALID $OUT"
sed 's/^/  /' "$BASE.meta"
[ "$STABLE" = yes ] || echo "  NOTE: rows changed while dumping; the archive is a consistent snapshot, but $BASE.counts is only approximate. Back up in a quiet window for an exact comparison."
echo "  Readable archive only. To prove it restores: scripts/restore-test.sh $OUT $(docker inspect -f '{{.Config.Image}}' "$CONTAINER")"
