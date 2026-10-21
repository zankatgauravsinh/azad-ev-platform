#!/usr/bin/env bash
# Database backup for AZAD EV POINT using the HOST's PostgreSQL client tools (pg_dump / pg_restore, version
# >= the server's). For a database inside Docker with no client tools on the host, use backup-docker.sh.
#
#   DATABASE_URL=postgresql://user:pass@host:5432/db BACKUP_DIR=/opt/azad-ev/backups ./scripts/backup.sh
#
# DATABASE_URL is read from the environment only (the systemd unit loads it from .env); the password never
# appears in a process argument or in any output. BACKUP_DIR (or the first argument) must be an absolute,
# private folder — see backup_dir_prepare in scripts/lib/backup-lib.sh. Produces one backup set, never
# overwriting an existing file:
#   <db>-<UTC stamp>.dump         custom-format archive (files mode 600, folder mode 700)
#   <db>-<UTC stamp>.dump.sha256  checksum (verified after the set is in place)
#   <db>-<UTC stamp>.toc          pg_restore --list output
#   <db>-<UTC stamp>.counts       exact row count per table, taken just before the dump
#   <db>-<UTC stamp>.meta         source identity, server version, migration state, sizes, and — written
#                                 last — backup_status=ARCHIVE_VALID, the mark of a complete set
# Everything is built in a private ".incomplete-…" folder first; a failure removes only that folder, so a
# failed run never leaves a partial set, and never touches an existing backup. The archive is validated
# (table of contents readable, every data block decodes) — that proves it is readable, NOT that a restore
# succeeds: run scripts/restore-test.sh for that.
#
# Retention is OFF unless RETENTION_DAYS is set. When it is, only COMPLETE sets of the same database on the
# same server (same system identifier, address and database OID) whose .meta is older than that many days
# are removed, after the new set is in place — never a set with a <base>.keep file, an older-format set, or
# anything else in the folder.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
. scripts/lib/pg-env.sh
. scripts/lib/backup-lib.sh

BACKUP_DIR="${1:-${BACKUP_DIR:-}}"
[ -n "$BACKUP_DIR" ] || die "Set BACKUP_DIR (absolute path) or pass it as the first argument"
RETENTION_DAYS="${RETENTION_DAYS:-}"
retention_days_valid "$RETENTION_DAYS"
require_tools $CORE_TOOLS node psql pg_dump pg_restore

pg_env_from_database_url
WORK=""
trap 'pg_env_cleanup; if [ -n "$WORK" ]; then rm -rf "$WORK"; fi' EXIT
trap 'exit 130' INT TERM HUP
case "$PGDATABASE" in ''|*[!A-Za-z0-9_]*) die "Unexpected database name (letters, digits and _ only): $PGDATABASE" ;; esac
sql() { psql -X -At -v ON_ERROR_STOP=1 --no-password -c "$1"; }

# Positive identification of what is being backed up: the server that answered, not just the URL.
IDENT=$(sql "select current_database()||'|'||(select oid from pg_database where datname = current_database())||'|'||coalesce(host(inet_server_addr())||':'||inet_server_port(), 'local socket')||'|'||current_setting('server_version');") \
  || die "Cannot connect to database '$PGDATABASE' on $PGHOST:$PGPORT"
IFS='|' read -r CUR_DB DB_OID SERVER_ADDR SERVER_VERSION <<EOF
$IDENT
EOF
[ "$CUR_DB" = "$PGDATABASE" ] || die "Connected to '$CUR_DB', not '$PGDATABASE'"
SYSID=$(sql "select system_identifier from pg_control_system();" 2>/dev/null) || SYSID=unavailable
SOURCE_ID="$SYSID/$SERVER_ADDR/$DB_OID"

backup_dir_prepare "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
NAME="$PGDATABASE-$STAMP"; BASE="$BACKUP_DIR/$NAME"
backup_set_absent "$BASE" || exit 1
WORK=$(mktemp -d "$BACKUP_DIR/.incomplete-$NAME.XXXXXX")

echo "→ Backing up database '$PGDATABASE' (oid $DB_OID) on $PGHOST:$PGPORT — server $SERVER_ADDR, PostgreSQL $SERVER_VERSION, system id $SYSID"
sql "$(cat scripts/lib/table-counts.sql)" > "$WORK/set.counts"
pg_dump --format=custom --no-password --file="$WORK/set.dump"
sql "$(cat scripts/lib/table-counts.sql)" > "$WORK/counts.after"
if files_equal "$WORK/set.counts" "$WORK/counts.after"; then STABLE=yes; else STABLE=no; fi
if [ "$(sql "$MIGRATIONS_PRESENT_SQL")" = t ]; then MIGRATIONS=$(sql "$MIGRATIONS_STATE_SQL"); else MIGRATIONS=absent; fi

echo "→ Validating the archive (table of contents + decoding every data block; this is not a restore)"
pg_restore --list "$WORK/set.dump" > "$WORK/set.toc"
ENTRIES=$(grep -c ' TABLE DATA ' "$WORK/set.toc" || true)
[ "$ENTRIES" -gt 0 ] || die "The archive contains no table data"
pg_restore --file=/dev/null "$WORK/set.dump"

HASH=$(sha256_of "$WORK/set.dump")
printf '%s  %s\n' "$HASH" "$NAME.dump" > "$WORK/set.dump.sha256"
{
  echo "tool=backup.sh"
  echo "database=$PGDATABASE"
  echo "database_oid=$DB_OID"
  echo "server=$PGHOST:$PGPORT"
  echo "server_address=$SERVER_ADDR"
  echo "server_system_identifier=$SYSID"
  echo "source_identity=$SOURCE_ID"
  echo "server_version=$SERVER_VERSION"
  echo "pg_dump_version=$(pg_dump --version)"
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
echo "  Readable archive only. To prove it restores: scripts/restore-test.sh $BASE.dump <postgres-image>"

[ -z "$RETENTION_DAYS" ] || prune_backup_sets "$BACKUP_DIR" "$PGDATABASE" "$SOURCE_ID" "$RETENTION_DAYS" "$BASE"
