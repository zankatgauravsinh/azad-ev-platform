#!/usr/bin/env bash
# Restore a backup set made by scripts/backup.sh (or backup-docker.sh) through DATABASE_URL.
#
# Default — into a NEW database; nothing that exists is changed:
#   DATABASE_URL=postgresql://user:pass@localhost:5432/azad_ev ./scripts/restore.sh /abs/path/azad_ev-<UTC stamp>.dump
#   Creates <db>_restore_<UTC time> (or RESTORE_DB=<name>, which must not exist yet) on the same server.
#   DATABASE_URL's own database is only used to connect. The user needs the CREATEDB privilege. If the
#   restore fails, the new database — and only it, verified by its OID — is dropped again.
#
# Replace — DESTRUCTIVE, only on explicit request:
#   DATABASE_URL=… ./scripts/restore.sh --replace /abs/path/azad_ev-<UTC stamp>.dump
#   Replaces DATABASE_URL's own database in place (pg_restore --clean, one transaction). It runs only when
#   CONFIRM_REPLACE equals the identity printed for that database, "<db>@<system id>/<database oid>" —
#   from the environment or typed at the prompt — and nothing else is connected to it. Only for an archive
#   of the SAME schema version: across migrations restore into a new database and swap names
#   (deploy/DEPLOY.md → Rollback). FORCE=1 is no longer accepted.
#
# Both modes refuse a server that is not on this machine (a Unix socket, localhost, 127.0.0.1 or ::1)
# unless ALLOW_REMOTE_HOST names that exact host, and check the archive before connecting. Results, in order:
#   ARCHIVE_READABLE   the .sha256 checksum (required) matches; the table of contents and every data block read.
#                      A checksum proves the file is the one the backup wrote — not that it holds all the data.
#   RESTORE_COMPLETED  pg_restore --exit-on-error --single-transaction succeeded — nothing compared yet
#   then exactly one of:
#   RESTORE_VERIFIED              (exit 0) FULL: every table's exact row count equals the set's .counts and the
#                                 Prisma migration history equals the one recorded in its .meta
#   RESTORE_VERIFIED_TABLES_ONLY  (exit 3) only the table list was verified: the source's counts changed while
#                                 the dump ran (they are taken outside the dump's snapshot), there is no .counts
#                                 (checked against the archive's table of contents instead), or the set's .meta
#                                 (or a field of it) is absent. Row counts were NOT verified.
#   Failures (exit 1): ARCHIVE_REJECTED (checksum, archive or set metadata unusable — nothing restored),
#   RESTORE_FAILED (pg_restore failed; a database this run created is dropped again), RESTORE_NOT_VERIFIED
#   (restored but not matching the set; the database is kept for inspection). A FULL result also needs the
#   set's .counts and .meta complete and consistent with the archive (verify_set_metadata).
# The password comes from DATABASE_URL via a temporary mode-600 file; it never appears in an argument or output.
set -euo pipefail
umask 077

MODE=new
if [ "${1:-}" = "--replace" ]; then MODE=replace; shift; fi
DUMP="${1:?Usage: restore.sh [--replace] <archive.dump>}"
[ $# -eq 1 ] || { echo "Usage: restore.sh [--replace] <archive.dump>" >&2; exit 1; }
[ -z "${FORCE:-}" ] || { echo "FORCE is no longer accepted; see the header of scripts/restore.sh" >&2; exit 1; }
[ -f "$DUMP" ] || { echo "ERROR: ARCHIVE_REJECTED: Backup file not found: $DUMP" >&2; exit 1; }
DUMP="$(cd "$(dirname "$DUMP")" && pwd)/$(basename "$DUMP")"   # absolute, before changing directory
BASE="${DUMP%.dump}"
cd "$(dirname "$0")/.."
. scripts/lib/pg-env.sh
. scripts/lib/backup-lib.sh
require_tools $CORE_TOOLS node psql pg_restore

# 1. The archive, before any connection.
TMPW=$(mktemp -d "${TMPDIR:-/tmp}/azad-restore.XXXXXX")
trap 'rm -rf "$TMPW"' EXIT
verify_archive_set "$DUMP"
verify_set_metadata "$DUMP" || die "ARCHIVE_REJECTED: the set's metadata cannot be trusted; nothing was restored"
pg_restore --list "$DUMP" > "$TMPW/toc" || die "ARCHIVE_REJECTED: Not a readable pg_dump archive: $DUMP"
pg_restore --file=/dev/null "$DUMP" || die "ARCHIVE_REJECTED: The archive's data blocks do not all decode: $DUMP"
echo "✓ ARCHIVE_READABLE $DUMP"

# 2. The server, positively identified.
pg_env_from_database_url
CREATED=""; CREATED_OID=""
cleanup() {
  if [ -n "$CREATED" ]; then   # this run created the database and the restore did not complete: drop it again
    if [ "$(psql -X -At --no-password -c "select oid from pg_database where datname = '$CREATED';" 2>/dev/null)" = "$CREATED_OID" ]; then
      psql -X -q --no-password -c "DROP DATABASE \"$CREATED\";" && echo "  removed the new database '$CREATED' that this run created" >&2
    fi
  fi
  pg_env_cleanup
  rm -rf "$TMPW"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP
pg_env_host_is_local || [ "${ALLOW_REMOTE_HOST:-}" = "$PGHOST" ] \
  || die "Refusing a server that is not on this machine ($PGHOST). If that is really intended, set ALLOW_REMOTE_HOST=$PGHOST"
sql() { psql -X -At -v ON_ERROR_STOP=1 --no-password -c "$1"; }
IDENT=$(sql "select current_database()||'|'||(select oid from pg_database where datname = current_database())||'|'||coalesce(host(inet_server_addr())||':'||inet_server_port(), 'local socket')||'|'||current_setting('server_version');") \
  || die "Cannot connect to database '$PGDATABASE' on $PGHOST:$PGPORT"
IFS='|' read -r CUR_DB DB_OID SERVER_ADDR SERVER_VERSION <<EOF
$IDENT
EOF
[ "$CUR_DB" = "$PGDATABASE" ] || die "Connected to '$CUR_DB', not '$PGDATABASE'"
SYSID=$(sql "select system_identifier from pg_control_system();" 2>/dev/null) || SYSID=unavailable
echo "→ Server $PGHOST:$PGPORT ($SERVER_ADDR), PostgreSQL $SERVER_VERSION, system id $SYSID"

# 3. Restore.
if [ "$MODE" = new ]; then
  TARGET="${RESTORE_DB:-${PGDATABASE}_restore_$(date -u +%Y%m%d%H%M%S)}"
  case "$TARGET" in ''|[!a-z_]*|*[!a-z0-9_]*) die "RESTORE_DB must be a new database name (lower-case letters, digits, _): $TARGET" ;; esac
  [ "${#TARGET}" -le 63 ] || die "RESTORE_DB is longer than 63 characters"
  [ -z "$(sql "select 1 from pg_database where datname = '$TARGET';")" ] || die "Database '$TARGET' already exists; restore.sh never restores into an existing database without --replace"
  echo "→ Creating the new database '$TARGET' (nothing existing is changed)"
  sql "CREATE DATABASE \"$TARGET\";" > /dev/null || die "Could not create database '$TARGET' (does the user have CREATEDB?)"
  CREATED_OID=$(sql "select oid from pg_database where datname = '$TARGET';"); CREATED="$TARGET"
  echo "→ Restoring into '$TARGET' (single transaction, stop at the first error)"
  pg_restore --exit-on-error --single-transaction --no-owner --no-privileges --no-password --dbname="$TARGET" "$DUMP" \
    || die "RESTORE_FAILED into '$TARGET'"
  CREATED=""   # restored: keep it
else
  TARGET="$PGDATABASE"
  TOKEN="$PGDATABASE@$SYSID/$DB_OID"
  echo "!! --replace: this REPLACES the contents of database '$TARGET' — identity $TOKEN — with $DUMP"
  if [ -n "${CONFIRM_REPLACE:-}" ]; then
    [ "$CONFIRM_REPLACE" = "$TOKEN" ] || die "CONFIRM_REPLACE does not match this database's identity ($TOKEN); nothing was changed"
  elif [ -t 0 ]; then
    read -r -p "Type the identity above to continue: " typed
    [ "$typed" = "$TOKEN" ] || die "Not confirmed; nothing was changed"
  else
    die "Not confirmed. After checking that this is the database to replace, re-run with CONFIRM_REPLACE='$TOKEN'"
  fi
  OTHERS=$(sql "select count(*) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid();")
  [ "$OTHERS" = 0 ] || die "$OTHERS other session(s) are connected to '$TARGET'; stop the API (and anything else) first"
  echo "→ Replacing '$TARGET' (pg_restore --clean, single transaction, stop at the first error)"
  pg_restore --clean --if-exists --exit-on-error --single-transaction --no-owner --no-privileges --no-password --dbname="$TARGET" "$DUMP" \
    || die "RESTORE_FAILED; the transaction was rolled back and '$TARGET' is unchanged"
fi
echo "✓ RESTORE_COMPLETED into '$TARGET' — not yet verified"

# 4. Verify what was restored.
vsql() { psql -X -At -v ON_ERROR_STOP=1 --no-password --dbname="$TARGET" -c "$1"; }
COUNTS="$TMPW/counts"
vsql "$(cat scripts/lib/table-counts.sql)" > "$COUNTS"
if [ "$(vsql "$MIGRATIONS_PRESENT_SQL")" = t ]; then MIGRATIONS=$(vsql "$MIGRATIONS_STATE_SQL"); else MIGRATIONS=absent; fi
if ! verify_restored_counts "$BASE" "$COUNTS" "$TMPW/toc" || ! verify_restored_migrations "$BASE" "$MIGRATIONS"; then
  die "RESTORE_NOT_VERIFIED: '$TARGET' was restored but does not match the backup set; inspect it before any use"
fi
if [ "$(restore_verification_level)" = full ]; then
  echo "✓ RESTORE_VERIFIED '$TARGET' on $PGHOST:$PGPORT matches $(basename "$DUMP") (exact row counts and migration history)"
else
  echo "~ RESTORE_VERIFIED_TABLES_ONLY '$TARGET' on $PGHOST:$PGPORT — only the table list matches $(basename "$DUMP"). $TABLES_ONLY_GUIDANCE"
  exit 3
fi
