#!/usr/bin/env bash
# Database backup for AZAD EV POINT when PostgreSQL runs in a Docker container (the production topology in
# deploy/DEPLOY.md). Uses the CONTAINER's own pg_dump / pg_restore, so their version always matches the
# server and the host needs no PostgreSQL tools.
#
#   BACKUP_DIR=/home/<user>/azad-backups ./scripts/backup-docker.sh <container> <database>
#
# Both the container (its exact name — not an ID prefix) and the database are named explicitly; nothing is
# assumed. The dump connects over the container's local socket as $POSTGRES_USER (the official image trusts
# local connections), so no password is read, passed or printed. No pseudo-terminal is allocated (never
# `docker exec -t` for a dump: a TTY can rewrite line endings and corrupt the stream). BACKUP_DIR must be an
# absolute, private folder (see backup_dir_prepare in scripts/lib/backup-lib.sh). Produces one backup set,
# never overwriting an existing file:
#   <db>-<UTC stamp>.dump             custom-format archive (files mode 600, folder mode 700)
#   <db>-<UTC stamp>.dump.sha256      checksum (verified after the set is in place)
#   <db>-<UTC stamp>.toc              pg_restore --list output
#   <db>-<UTC stamp>.counts           exact row count per table, taken just before the dump
#   <db>-<UTC stamp>.meta             container, image, source identity, server version, migration state,
#                                     and — written last — backup_status=ARCHIVE_VALID
# Everything is built in a private ".incomplete-…" folder first; a failure removes only that folder. The
# archive is validated (table of contents readable, every data block decodes) — that proves it is readable,
# NOT that a restore succeeds: run scripts/restore-test.sh for that. This script never deletes a backup.
set -euo pipefail
umask 077
CONTAINER="${1:?Usage: backup-docker.sh <postgres-container> <database>}"
DB="${2:?Usage: backup-docker.sh <postgres-container> <database>}"
. "$(dirname "$0")/lib/backup-lib.sh"
BACKUP_DIR="${BACKUP_DIR:-}"
[ -n "$BACKUP_DIR" ] || die "Set BACKUP_DIR to the absolute path of the backup folder"
require_tools $CORE_TOOLS docker
case "$DB" in ''|*[!A-Za-z0-9_]*) die "Unexpected database name: $DB" ;; esac

# The exact container, by name: resolve it once to its full ID and use only that from here on.
INFO=$(docker inspect -f '{{.Id}} {{.Name}} {{.State.Running}}' "$CONTAINER" 2>/dev/null) || die "No container named '$CONTAINER' (list them with: docker ps)"
read -r CID CNAME RUNNING <<EOF
$INFO
EOF
[ "$CNAME" = "/$CONTAINER" ] || die "'$CONTAINER' is not the exact name of a container (it matched $CNAME); give the full name"
[ "$RUNNING" = true ] || die "Container '$CONTAINER' is not running"
IMAGE=$(docker inspect -f '{{.Config.Image}}' "$CID")
# SQL goes in on stdin, the database name as a positional argument — no shell quoting of either.
sql() { printf '%s\n' "$1" | docker exec -i "$CID" sh -c 'exec psql -X -At -v ON_ERROR_STOP=1 --no-password -U "$POSTGRES_USER" -d "$1"' sh "$DB"; }

IDENT=$(sql "select current_database()||'|'||(select oid from pg_database where datname = current_database())||'|'||current_setting('server_version');") \
  || die "Cannot connect to database '$DB' in '$CONTAINER'"
IFS='|' read -r CUR_DB DB_OID SERVER_VERSION <<EOF
$IDENT
EOF
[ "$CUR_DB" = "$DB" ] || die "Connected to '$CUR_DB', not '$DB'"
SYSID=$(sql "select system_identifier from pg_control_system();" 2>/dev/null) || SYSID=unavailable
SOURCE_ID="$SYSID/container:$CONTAINER/$DB_OID"
COUNTS_SQL=$(cat "$(dirname "$0")/lib/table-counts.sql")

backup_dir_prepare "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
NAME="$DB-$STAMP"; BASE="$BACKUP_DIR/$NAME"
backup_set_absent "$BASE" || exit 1
WORK=$(mktemp -d "$BACKUP_DIR/.incomplete-$NAME.XXXXXX")
trap 'if [ -n "$WORK" ]; then rm -rf "$WORK"; fi' EXIT
trap 'exit 130' INT TERM HUP

echo "→ Backing up '$DB' (oid $DB_OID) in container '$CONTAINER' ($IMAGE) — PostgreSQL $SERVER_VERSION, system id $SYSID"
sql "$COUNTS_SQL" > "$WORK/set.counts"
docker exec "$CID" sh -c 'exec pg_dump --format=custom --no-password -U "$POSTGRES_USER" -d "$1"' sh "$DB" > "$WORK/set.dump"
sql "$COUNTS_SQL" > "$WORK/counts.after"
if files_equal "$WORK/set.counts" "$WORK/counts.after"; then STABLE=yes; else STABLE=no; fi
if [ "$(sql "$MIGRATIONS_PRESENT_SQL")" = t ]; then MIGRATIONS=$(sql "$MIGRATIONS_STATE_SQL"); else MIGRATIONS=absent; fi

echo "→ Validating the archive with the container's pg_restore (table of contents + every data block; not a restore)"
docker exec -i "$CID" pg_restore --list < "$WORK/set.dump" > "$WORK/set.toc"
ENTRIES=$(grep -c ' TABLE DATA ' "$WORK/set.toc" || true)
[ "$ENTRIES" -gt 0 ] || die "The archive contains no table data"
docker exec -i "$CID" pg_restore --file=/dev/null < "$WORK/set.dump"

HASH=$(sha256_of "$WORK/set.dump")
printf '%s  %s\n' "$HASH" "$NAME.dump" > "$WORK/set.dump.sha256"
{
  echo "tool=backup-docker.sh"
  echo "container=$CONTAINER"
  echo "container_id=$CID"
  echo "image=$IMAGE"
  echo "database=$DB"
  echo "database_oid=$DB_OID"
  echo "server_system_identifier=$SYSID"
  echo "source_identity=$SOURCE_ID"
  echo "server_version=$SERVER_VERSION"
  echo "created_utc=$STAMP"
  echo "archive=$NAME.dump"
  echo "archive_sha256=$HASH"
  echo "archive_bytes=$(wc -c < "$WORK/set.dump" | tr -d ' ')"
  echo "tables=$(wc -l < "$WORK/set.counts" | tr -d ' ')"
  echo "table_data_entries=$ENTRIES"
  echo "counts_stable_during_dump=$STABLE"
  echo "migrations=$MIGRATIONS"
  echo "backup_status=ARCHIVE_VALID"
} > "$WORK/set.meta"

publish_backup_set "$WORK" "$BASE" || exit 1
if ! sha256_check "$BASE.dump"; then   # the set was linked into place by this run a moment ago: withdraw it
  rm -f "$BASE.dump" "$BASE.dump.sha256" "$BASE.toc" "$BASE.counts" "$BASE.meta"
  die "Checksum verification failed after writing $BASE.dump; the set was withdrawn"
fi
rm -rf "$WORK"; WORK=""

echo "✓ BACKUP_ARCHIVE_VALID $BASE.dump"
sed 's/^/  /' "$BASE.meta"
[ "$STABLE" = yes ] || echo "  NOTE: rows changed while dumping. The archive is a consistent snapshot, but $BASE.counts (counted outside that snapshot) need not match it, so a restore test of this set can only reach RESTORE_TEST_PASSED_TABLES_ONLY. Back up in a quiet window for a fully verifiable set."
echo "  Readable archive only. To prove it restores: scripts/restore-test.sh $BASE.dump $IMAGE"
