#!/usr/bin/env bash
# Safety tests for scripts/backup.sh, backup-docker.sh, backup-nightly.sh, restore.sh and restore-test.sh.
#
#   ./scripts/tests/backup-restore-safety.sh
#
# Touches nothing real. Everything it uses is created by this run and removed by it:
#   - a throwaway PostgreSQL cluster (initdb in a new temporary folder, listening only on 127.0.0.1 at a
#     free high port, scram password auth with a random password) holding synthetic data only;
#   - throwaway Docker containers (--network none, tmpfs) from an image that must ALREADY be present
#     (TEST_PG_IMAGE, default postgres:17-alpine; never pulled) — skipped when Docker or the image is missing.
# DATABASE_URL from the environment is ignored and api/.env is never read. Needs initdb, pg_ctl, psql,
# pg_dump and pg_restore on PATH.
set -uo pipefail
umask 077
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
S="$REPO/scripts"
TMPDIR="${TMPDIR:-/tmp}"; TMPDIR="${TMPDIR%/}"; export TMPDIR
unset DATABASE_URL PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD PGPASSFILE PGSERVICE PGHOSTADDR PGOPTIONS FORCE CONFIRM_REPLACE RESTORE_DB RETENTION_DAYS ALLOW_REMOTE_HOST BACKUP_DIR CONTAINER DB UPLOADS_DIR BACKUP_S3_URI
for t in initdb pg_ctl psql pg_dump pg_restore node; do command -v "$t" >/dev/null || { echo "missing $t" >&2; exit 2; }; done
REAL_PG_RESTORE=$(command -v pg_restore); REAL_PG_DUMP=$(command -v pg_dump)
IMAGE="${TEST_PG_IMAGE:-postgres:17-alpine}"
NONPG_IMAGE="${TEST_NONPG_IMAGE:-redis:7-alpine}"   # an already-present image that is NOT PostgreSQL (partial-setup test)

T=$(mktemp -d "${TMPDIR%/}/azbk.XXXXXX")   # short: the Unix socket path must stay under ~100 bytes
PASS=0; FAIL=0; CONTAINERS=""
RUN_LABEL="azad.safety-test.run=${T##*/}"   # unique to this run: every container it creates carries it
CLUSTER_UP=0
# The containers of THIS run: the IDs it recorded plus any carrying its unique label (one whose creation
# half-failed). Each is removed with its anonymous volumes (-v), which belong to that container alone —
# never a named volume, never another container.
own_containers() { { for c in $CONTAINERS; do echo "$c"; done; docker ps -aq --no-trunc --filter "label=$RUN_LABEL" 2> /dev/null; } | sort -u; }
remove_own_containers() {
  command -v docker > /dev/null || return 0
  for c in $(own_containers); do docker rm -f -v "$c" > /dev/null 2>&1 || true; done
  CONTAINERS=""
}
cleanup() {
  remove_own_containers
  [ "$CLUSTER_UP" = 1 ] && pg_ctl -D "$T/pg" -m fast -w stop > /dev/null 2>&1
  rm -rf "$T"
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

ok()   { PASS=$((PASS + 1)); echo "  PASS  $*"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL  $*"; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }   # <name> <shell condition>
run() { local log="$T/log/$1"; shift; "$@" > "$log" 2>&1; echo $? > "$log.rc"; }   # <log name> <command…>
rc() { cat "$T/log/$1.rc"; }
require() { [ "$(rc "$1")" = 0 ] || { echo "PREREQUISITE FAILED: $1 — stopping (later tests depend on it):" >&2; cat "$T/log/$1" >&2; exit 1; }; }
has() { grep -q -- "$2" "$T/log/$1"; }
# SHA-256 helpers for the harness itself: shasum when present (macOS), else sha256sum (GNU or BusyBox).
sha_stdin() { if command -v shasum > /dev/null; then shasum -a 256; else sha256sum; fi | cut -d' ' -f1; }
sha_line() { if command -v shasum > /dev/null; then shasum -a 256 "$1"; else sha256sum "$1"; fi; }   # "<hash>  <name>"
sha_verify() { if command -v shasum > /dev/null; then shasum -a 256 -c "$1"; else sha256sum -c "$1"; fi > /dev/null 2>&1; }
tree_sum() { (cd "$1" && find . -type f -print | LC_ALL=C sort | while IFS= read -r f; do printf '%s %s\n' "$f" "$(sha_stdin < "$f")"; done); }
mkdir -p "$T/log"

# ---- throwaway cluster -------------------------------------------------------------------------------
PORT=""
for _ in $(seq 1 50); do
  p=$((55000 + RANDOM % 4000))
  [ "$p" != 5432 ] || continue
  if ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then PORT=$p; break; fi
done
[ -n "$PORT" ] || { echo "no free port" >&2; exit 2; }
PW="Sx9:@/%-secret-$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
printf '%s\n' "$PW" > "$T/pwfile"
initdb -D "$T/pg" -U owner --auth=scram-sha-256 --pwfile="$T/pwfile" > "$T/log/initdb" 2>&1 || { cat "$T/log/initdb"; exit 2; }
rm -f "$T/pwfile"
pg_ctl -D "$T/pg" -l "$T/log/server" -w -o "-p $PORT -k $T -c listen_addresses=127.0.0.1" start > /dev/null || { cat "$T/log/server"; exit 2; }
CLUSTER_UP=1
ENC=$(PW="$PW" node -e 'process.stdout.write(encodeURIComponent(process.env.PW))')
URL="postgresql://owner:$ENC@127.0.0.1:$PORT/synth"
admin() { PGPASSWORD="$PW" psql -X -At -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U owner -d "${2:-postgres}" -c "$1"; }
# Positive identity: the server that answers is the one this run created.
[ "$(cd "$(admin 'show data_directory;')" && pwd -P)" = "$(cd "$T/pg" && pwd -P)" ] || { echo "the test server is not the throwaway cluster" >&2; exit 2; }
echo "Throwaway cluster on 127.0.0.1:$PORT, data in $T/pg (system id $(admin 'select system_identifier from pg_control_system();'))"

admin "CREATE DATABASE synth;" > /dev/null
admin "CREATE TABLE \"Customer\"(id serial primary key, name text not null);
INSERT INTO \"Customer\"(name) SELECT 'synthetic ' || g FROM generate_series(1, 25) g;
CREATE TABLE \"InventoryUnit\"(id serial primary key, vin text unique, \"customerId\" int references \"Customer\"(id));
INSERT INTO \"InventoryUnit\"(vin, \"customerId\") SELECT 'VIN' || g, g FROM generate_series(1, 10) g;
CREATE TABLE _prisma_migrations(id varchar(36) primary key, checksum varchar(64) not null, finished_at timestamptz, migration_name varchar(255) not null, logs text, rolled_back_at timestamptz, started_at timestamptz not null default now(), applied_steps_count int not null default 0);
INSERT INTO _prisma_migrations(id, checksum, finished_at, migration_name, applied_steps_count) VALUES ('m1', 'x', now(), '20260101000000_init', 1), ('m2', 'y', now(), '20260102000000_more', 1);" synth > /dev/null
admin "CREATE DATABASE unrelated_db;" > /dev/null
admin "CREATE TABLE keep_me(v text); INSERT INTO keep_me VALUES ('do not touch');" unrelated_db > /dev/null
dbs() { admin "select string_agg(datname, ',' order by datname) from pg_database;"; }
fp() { admin "select md5(string_agg(t::text, '|' order by t::text)) from (select * from \"Customer\") t;" "$1"; }
SYNTH_FP=$(fp synth)
UNRELATED_FP=$(admin "select md5(string_agg(v, '|')) from keep_me;" unrelated_db)

B="$T/backups"   # created by backup.sh itself
# ---- backup: target and destination validation --------------------------------------------------------
echo "backup.sh — refusals"
run nourl env BACKUP_DIR="$B" "$S/backup.sh";                                         check "missing DATABASE_URL refused" '[ "$(rc nourl)" != 0 ] && has nourl "DATABASE_URL must be set"'
run badurl env DATABASE_URL="not a url" BACKUP_DIR="$B" "$S/backup.sh";               check "invalid DATABASE_URL refused" '[ "$(rc badurl)" != 0 ] && has badurl "must start with postgres"'
run mysql env DATABASE_URL="mysql://u:p@127.0.0.1/x" BACKUP_DIR="$B" "$S/backup.sh";  check "non-postgres URL refused" '[ "$(rc mysql)" != 0 ]'
run multi env DATABASE_URL="postgresql://owner:$ENC@127.0.0.1:$PORT,127.0.0.2:$PORT/synth" BACKUP_DIR="$B" "$S/backup.sh"
check "multi-host URL refused as ambiguous" '[ "$(rc multi)" != 0 ] && has multi "more than one host"'
run hostq env DATABASE_URL="postgresql://owner:$ENC@db.example.invalid:$PORT/synth?host=$T" BACKUP_DIR="$B" "$S/backup.sh"
check "hostname + ?host= refused as ambiguous" '[ "$(rc hostq)" != 0 ] && has hostq "ambiguous"'
run haddr env DATABASE_URL="$URL?hostaddr=192.0.2.1" BACKUP_DIR="$B" "$S/backup.sh";  check "?hostaddr= refused as ambiguous" '[ "$(rc haddr)" != 0 ] && has haddr "hostaddr"'
run qport env DATABASE_URL="$URL?port=1" BACKUP_DIR="$B" "$S/backup.sh";              check "?port= refused as ambiguous" '[ "$(rc qport)" != 0 ] && has qport "\"port\""'
run nodb env DATABASE_URL="postgresql://owner:$ENC@127.0.0.1:$PORT/" BACKUP_DIR="$B" "$S/backup.sh"; check "URL without a database refused" '[ "$(rc nodb)" != 0 ]'
run trav env DATABASE_URL="postgresql://owner:$ENC@127.0.0.1:$PORT/..%2Fescape" BACKUP_DIR="$B" "$S/backup.sh"
check "database name with path characters refused" '[ "$(rc trav)" != 0 ] && has trav "Unexpected database name" && [ ! -e "$T/escape-"* ]'
mkdir -m 755 "$T/open755"; mkdir -m 700 "$T/real"; ln -s "$T/real" "$T/link"; : > "$T/afile"
run e_empty env DATABASE_URL="$URL" BACKUP_DIR="" "$S/backup.sh";               check "empty BACKUP_DIR refused" '[ "$(rc e_empty)" != 0 ]'
run e_rel env DATABASE_URL="$URL" BACKUP_DIR="backups" "$S/backup.sh";          check "relative BACKUP_DIR refused" '[ "$(rc e_rel)" != 0 ] && has e_rel "absolute"'
run e_root env DATABASE_URL="$URL" BACKUP_DIR="/" "$S/backup.sh";               check "BACKUP_DIR=/ refused" '[ "$(rc e_root)" != 0 ]'
TMPREAL=$(cd /tmp && pwd -P)
run e_tmp env DATABASE_URL="$URL" BACKUP_DIR="$TMPREAL" "$S/backup.sh";         check "shared /tmp refused (and not chmod-ed)" '[ "$(rc e_tmp)" != 0 ] && [ -n "$(find "$TMPREAL" -maxdepth 0 -perm -1777)" ]'
run e_open env DATABASE_URL="$URL" BACKUP_DIR="$T/open755" "$S/backup.sh";      check "group/world-readable folder refused, mode left 755" '[ "$(rc e_open)" != 0 ] && has e_open "open to other users" && [ -n "$(find "$T/open755" -maxdepth 0 -perm 755)" ]'
run e_link env DATABASE_URL="$URL" BACKUP_DIR="$T/link" "$S/backup.sh";         check "symlinked folder refused" '[ "$(rc e_link)" != 0 ] && has e_link "symbolic link"'
run e_dots env DATABASE_URL="$URL" BACKUP_DIR="$T/real/../real" "$S/backup.sh"; check "path with .. refused" '[ "$(rc e_dots)" != 0 ] && has e_dots "normalised"'
run e_file env DATABASE_URL="$URL" BACKUP_DIR="$T/afile" "$S/backup.sh";        check "a file as BACKUP_DIR refused" '[ "$(rc e_file)" != 0 ]'
run badpw env DATABASE_URL="postgresql://owner:wrong@127.0.0.1:$PORT/synth" BACKUP_DIR="$B" "$S/backup.sh"
check "wrong password: refused before any file is written" '[ "$(rc badpw)" != 0 ] && [ ! -e "$B" ]'

# ---- backup: success ----------------------------------------------------------------------------------
echo "backup.sh — success"
run ok1 env DATABASE_URL="$URL" BACKUP_DIR="$B" PGHOSTADDR=192.0.2.1 PGPASSWORD=bogus "$S/backup.sh"
require ok1
SET1=$(sed -n 's/^✓ BACKUP_ARCHIVE_VALID //p' "$T/log/ok1"); BASE1="${SET1%.dump}"
[ -f "$SET1" ] && [ -f "$BASE1.meta" ] || { echo "PREREQUISITE FAILED: no archive path in the ok1 output" >&2; exit 1; }
check "backup succeeds (stray PGHOSTADDR/PGPASSWORD ignored)" '[ "$(rc ok1)" = 0 ] && [ -f "$SET1" ]'
check "set has all five files, each mode 600; folder mode 700" '[ "$(find "$B" -maxdepth 1 -type f -name "synth-*" -perm 600 | wc -l | tr -d " ")" = 5 ] && [ -n "$(find "$B" -maxdepth 0 -perm 700)" ]'
check "no .incomplete folder left behind" '[ -z "$(find "$B" -maxdepth 1 -name ".incomplete-*")" ]'
check ".meta records status, identity, version, migrations" 'grep -qx "backup_status=ARCHIVE_VALID" "$BASE1.meta" && grep -q "^server_system_identifier=[0-9]" "$BASE1.meta" && grep -q "^source_identity=" "$BASE1.meta" && grep -qx "migrations=applied=2 unfinished=0 latest=20260102000000_more" "$BASE1.meta"'
check "checksum file verifies" '(cd "$B" && sha_verify "$(basename "$SET1").sha256")'
check "source database unchanged by the backup" '[ "$(fp synth)" = "$SYNTH_FP" ]'

# ---- backup: collisions and failures never touch existing sets ---------------------------------------
echo "backup.sh — collisions and failures"
BEFORE=$(tree_sum "$B")
STAMP1=$(sed -n 's/^created_utc=//p' "$BASE1.meta")
mkdir -p "$T/shim-date"; printf '#!/bin/sh\nif [ "$1" = "-u" ] && [ "$2" = "+%%Y%%m%%dT%%H%%M%%SZ" ]; then echo %s; else exec /bin/date "$@"; fi\n' "$STAMP1" > "$T/shim-date/date"; chmod +x "$T/shim-date/date"
run coll env PATH="$T/shim-date:$PATH" DATABASE_URL="$URL" BACKUP_DIR="$B" "$S/backup.sh"
check "same-second collision refused" '[ "$(rc coll)" != 0 ] && has coll "Refusing to overwrite"'
check "existing set byte-identical after the collision" '[ "$(tree_sum "$B")" = "$BEFORE" ]'
mkdir -p "$T/shim-dump"; cat > "$T/shim-dump/pg_dump" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$SHIM_LOG"; [ -z "${PGPASSWORD:-}" ] || echo PGPASSWORD-SET >> "$SHIM_LOG"
for a in "$@"; do case "$a" in --file=*) echo garbage > "${a#--file=}" ;; esac; done
echo "pg_dump: error: simulated failure" >&2; exit 1
EOF
chmod +x "$T/shim-dump/pg_dump"
mkdir -p "$B/.incomplete-decoy"; echo keep > "$B/.incomplete-decoy/other-run"; echo keep > "$B/notes.txt"
BEFORE=$(tree_sum "$B")
run dumpfail env PATH="$T/shim-dump:$PATH" SHIM_LOG="$T/log/shim-args" DATABASE_URL="$URL" BACKUP_DIR="$B" "$S/backup.sh"
check "failed pg_dump fails the backup" '[ "$(rc dumpfail)" != 0 ] && ! has dumpfail "BACKUP_ARCHIVE_VALID"'
check "failed run leaves no partial set and removes only its own temp folder" '[ "$(tree_sum "$B")" = "$BEFORE" ] && [ -z "$(find "$B" -maxdepth 1 -name ".incomplete-synth-*")" ]'
check "pg_dump got no password in its arguments or PGPASSWORD" '! grep -q -- "$PW" "$T/log/shim-args" && ! grep -q -- "$ENC" "$T/log/shim-args" && ! grep -q PGPASSWORD-SET "$T/log/shim-args"'
rm -rf "$B/.incomplete-decoy" "$B/notes.txt"

# publish guard (the race the early check cannot see): pre-existing .toc → nothing of ours stays, theirs untouched
( . "$S/lib/backup-lib.sh"; mkdir "$T/pw"; for e in dump dump.sha256 toc counts meta; do echo "new $e" > "$T/pw/set.$e"; done
  mkdir -m 700 "$T/pub"; echo theirs > "$T/pub/x.toc"; publish_backup_set "$T/pw" "$T/pub/x" 2> /dev/null; echo "rc=$?" ) > "$T/log/publish"
( . "$S/lib/backup-lib.sh"; mkdir -m 700 "$T/ck"; echo payload > "$T/ck/a.dump"; sha_line "$T/ck/a.dump" > /dev/null
  (cd "$T/ck" && sha_line a.dump > a.dump.sha256); sha256_check "$T/ck/a.dump" && echo "good=ok"
  cp "$T/ck/a.dump" "$T/ck/b.dump"; printf '%s  a.dump\n' "$(sha_stdin < "$T/ck/a.dump")" > "$T/ck/b.dump.sha256"; sha256_check "$T/ck/b.dump" 2>/dev/null || echo "othername=refused"
  printf 'x' >> "$T/ck/a.dump"; sha256_check "$T/ck/a.dump" 2>/dev/null || echo "mismatch=refused" ) > "$T/log/ck" 2>&1
check "sha256_check: correct checksum accepted (portable -c, output discarded)" 'has ck "good=ok"'
check "sha256_check: mismatch refused" 'has ck "mismatch=refused"'
check "sha256_check: a .sha256 naming another file refused" 'has ck "othername=refused"'
check "publish refuses a file that appeared meanwhile and withdraws its own links" 'has publish "rc=1" && [ "$(ls "$T/pub")" = "x.toc" ] && [ "$(cat "$T/pub/x.toc")" = theirs ]'

# ---- restore.sh ---------------------------------------------------------------------------------------
echo "restore.sh"
mkdir -m 700 "$T/bad"
cp "$BASE1".* "$T/bad/"; BADSET="$T/bad/$(basename "$SET1")"
printf 'x' >> "$BADSET"
DBS_BEFORE=$(dbs)
run r_sum env DATABASE_URL="$URL" "$S/restore.sh" "$BADSET";       check "checksum mismatch refused before connecting" '[ "$(rc r_sum)" != 0 ] && has r_sum "Checksum" && ! has r_sum "ARCHIVE_READABLE" && [ "$(dbs)" = "$DBS_BEFORE" ]'
head -c 2000 "$SET1" > "$BADSET"; (cd "$T/bad" && sha_line "$(basename "$BADSET")" > "$(basename "$BADSET").sha256")
rm -f "$T/bad/$(basename "$BASE1").meta"   # so the archive itself (not its metadata) is what gets refused
run r_corrupt env DATABASE_URL="$URL" "$S/restore.sh" "$BADSET";   check "corrupt archive (valid checksum) refused before connecting" '[ "$(rc r_corrupt)" = 1 ] && has r_corrupt "ARCHIVE_REJECTED" && ! has r_corrupt "ARCHIVE_READABLE" && [ "$(dbs)" = "$DBS_BEFORE" ]'
rm "$BADSET.sha256"
run r_nosum env DATABASE_URL="$URL" "$S/restore.sh" "$BADSET";     check "missing .sha256 refused" '[ "$(rc r_nosum)" != 0 ] && has r_nosum "Checksum missing"'
cp "$BASE1".* "$T/bad/"; sed -i.orig 's/^backup_status=.*/backup_status=PARTIAL/' "$T/bad/$(basename "$BASE1").meta"
run r_partial env DATABASE_URL="$URL" "$S/restore.sh" "$BADSET";   check "set not marked complete refused" '[ "$(rc r_partial)" != 0 ] && has r_partial "does not mark this backup as complete"'
run r_remote env DATABASE_URL="postgresql://owner:x@db.example.invalid:5432/synth" "$S/restore.sh" "$SET1"
check "non-local server refused" '[ "$(rc r_remote)" != 0 ] && has r_remote "not on this machine"'
run r_remote2 env ALLOW_REMOTE_HOST=other.example.invalid DATABASE_URL="postgresql://owner:x@db.example.invalid:5432/synth" "$S/restore.sh" "$SET1"
check "ALLOW_REMOTE_HOST for a different host still refused" '[ "$(rc r_remote2)" != 0 ] && has r_remote2 "not on this machine"'
run r_force env FORCE=1 DATABASE_URL="$URL" "$S/restore.sh" "$SET1"; check "FORCE=1 refused" '[ "$(rc r_force)" != 0 ] && has r_force "FORCE is no longer accepted"'
run r_exists env RESTORE_DB=unrelated_db DATABASE_URL="$URL" "$S/restore.sh" "$SET1"
check "existing database as RESTORE_DB refused, left intact" '[ "$(rc r_exists)" != 0 ] && has r_exists "already exists" && [ "$(admin "select md5(string_agg(v, '"'|'"')) from keep_me;" unrelated_db)" = "$UNRELATED_FP" ]'
mkdir -p "$T/shim-restore"; printf '#!/bin/sh\nfor a in "$@"; do case "$a" in --dbname=*) echo "pg_restore: error: simulated failure" >&2; exit 1 ;; esac; done\nexec %s "$@"\n' "$REAL_PG_RESTORE" > "$T/shim-restore/pg_restore"; chmod +x "$T/shim-restore/pg_restore"
run r_fail env PATH="$T/shim-restore:$PATH" RESTORE_DB=synth_failed_restore DATABASE_URL="$URL" "$S/restore.sh" "$SET1"
check "failed restore: reported, and only the database it created is dropped" '[ "$(rc r_fail)" != 0 ] && has r_fail "RESTORE_FAILED" && ! has r_fail "RESTORE_COMPLETED" && [ "$(dbs)" = "$DBS_BEFORE" ]'
run r_ok env DATABASE_URL="$URL" "$S/restore.sh" "$SET1"
require r_ok
NEWDB=$(sed -n "s/^✓ RESTORE_VERIFIED '\([a-z0-9_]*\)'.*/\1/p" "$T/log/r_ok")
check "default restore: new database, three stages, FULL verification (exit 0)" '[ "$(rc r_ok)" = 0 ] && has r_ok "ARCHIVE_READABLE" && has r_ok "RESTORE_COMPLETED" && has r_ok "^✓ RESTORE_VERIFIED " && ! has r_ok "TABLES_ONLY" && [ -n "$NEWDB" ] && [ "$NEWDB" != synth ]'
check "restored copy equals the source; source and unrelated database untouched" '[ "$(fp "$NEWDB")" = "$SYNTH_FP" ] && [ "$(fp synth)" = "$SYNTH_FP" ] && [ "$(admin "select md5(string_agg(v, '"'|'"')) from keep_me;" unrelated_db)" = "$UNRELATED_FP" ]'
admin "CREATE DATABASE replace_target;" > /dev/null; admin "CREATE TABLE \"Customer\"(id int); INSERT INTO \"Customer\" VALUES (999); CREATE TABLE extra(x int);" replace_target > /dev/null
RURL="postgresql://owner:$ENC@127.0.0.1:$PORT/replace_target"
RT_FP=$(fp replace_target)
run rp_none env DATABASE_URL="$RURL" "$S/restore.sh" --replace "$SET1" < /dev/null
TOKEN=$(sed -n "s/.*CONFIRM_REPLACE='\([^']*\)'.*/\1/p" "$T/log/rp_none")
[ -n "$TOKEN" ] || { echo "PREREQUISITE FAILED: no identity token in the rp_none output" >&2; cat "$T/log/rp_none" >&2; exit 1; }
check "--replace without confirmation refused, database unchanged" '[ "$(rc rp_none)" != 0 ] && [ -n "$TOKEN" ] && [ "$(fp replace_target)" = "$RT_FP" ]'
run rp_wrong env CONFIRM_REPLACE="replace_target@0/0" DATABASE_URL="$RURL" "$S/restore.sh" --replace "$SET1"
check "--replace with a wrong identity refused, database unchanged" '[ "$(rc rp_wrong)" != 0 ] && has rp_wrong "does not match" && [ "$(fp replace_target)" = "$RT_FP" ]'
run rp_other env CONFIRM_REPLACE="$TOKEN" DATABASE_URL="postgresql://owner:$ENC@127.0.0.1:$PORT/unrelated_db" "$S/restore.sh" --replace "$SET1"
check "a token for one database does not unlock another" '[ "$(rc rp_other)" != 0 ] && [ "$(admin "select md5(string_agg(v, '"'|'"')) from keep_me;" unrelated_db)" = "$UNRELATED_FP" ]'
PGPASSWORD="$PW" psql -X -q -h 127.0.0.1 -p "$PORT" -U owner -d replace_target -c "select pg_sleep(30);" > /dev/null 2>&1 &
SLEEPER=$!; sleep 1
run rp_busy env CONFIRM_REPLACE="$TOKEN" DATABASE_URL="$RURL" "$S/restore.sh" --replace "$SET1"
check "--replace refused while another session is connected" '[ "$(rc rp_busy)" != 0 ] && has rp_busy "other session" && [ "$(fp replace_target)" = "$RT_FP" ]'
admin "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'replace_target' and pid <> pg_backend_pid();" > /dev/null; wait "$SLEEPER" 2>/dev/null
run rp_ok env CONFIRM_REPLACE="$TOKEN" DATABASE_URL="$RURL" "$S/restore.sh" --replace "$SET1"
check "--replace with the exact identity: completed, then NOT verified (extra pre-existing data reported)" '[ "$(rc rp_ok)" != 0 ] && has rp_ok "RESTORE_COMPLETED" && has rp_ok "RESTORE_NOT_VERIFIED"'
admin "DROP DATABASE replace_target;" > /dev/null; admin "CREATE DATABASE replace_target;" > /dev/null
TOKEN2="replace_target@$(admin 'select system_identifier from pg_control_system();')/$(admin "select oid from pg_database where datname = 'replace_target';")"
run rp_clean env CONFIRM_REPLACE="$TOKEN2" DATABASE_URL="$RURL" "$S/restore.sh" --replace "$SET1"
check "--replace into an empty database of the same schema: verified" '[ "$(rc rp_clean)" = 0 ] && has rp_clean "RESTORE_VERIFIED" && [ "$(fp replace_target)" = "$SYNTH_FP" ]'
check "old token is useless after the database was recreated (OID changed)" '[ "$TOKEN" != "$TOKEN2" ]'

echo "restore verification levels"
mkdir -m 700 "$T/nocounts" "$T/handmade" "$T/tampered"
cp "$SET1" "$SET1.sha256" "$BASE1.toc" "$BASE1.meta" "$T/nocounts/"                      # a set without .counts
cp "$SET1" "$SET1.sha256" "$T/handmade/"                                                 # hand-made: .dump + .sha256 only
cp "$BASE1".* "$T/tampered/"; TAMP="$T/tampered/$(basename "$BASE1").counts"
awk '$1 == "public.Customer" { $2 = $2 + 1 } { print }' "$BASE1.counts" > "$TAMP"         # counts that do not match (stable)
run r_nocounts env RESTORE_DB=lvl_nocounts DATABASE_URL="$URL" "$S/restore.sh" "$T/nocounts/$(basename "$SET1")"
check "missing .counts: RESTORE_VERIFIED_TABLES_ONLY, exit 3, never full" '[ "$(rc r_nocounts)" = 3 ] && has r_nocounts "RESTORE_VERIFIED_TABLES_ONLY" && ! has r_nocounts "^✓ RESTORE_VERIFIED " && has r_nocounts "no .*counts"'
run r_hand env RESTORE_DB=lvl_handmade DATABASE_URL="$URL" "$S/restore.sh" "$T/handmade/$(basename "$SET1")"
check "hand-made backup (.dump + .sha256 only): TABLES_ONLY, exit 3" '[ "$(rc r_hand)" = 3 ] && has r_hand "RESTORE_VERIFIED_TABLES_ONLY" && ! has r_hand "^✓ RESTORE_VERIFIED "'
run r_tamp env RESTORE_DB=lvl_tampered DATABASE_URL="$URL" "$S/restore.sh" "$T/tampered/$(basename "$SET1")"
check "row counts that differ (stable dump): RESTORE_NOT_VERIFIED, exit 1" '[ "$(rc r_tamp)" = 1 ] && has r_tamp "RESTORE_NOT_VERIFIED" && ! has r_tamp "RESTORE_VERIFIED"'
# Unstable source: a row arrives between the "before" count and the dump (a pg_dump stub writes it first).
mkdir -p "$T/shim-busy"; printf '#!/bin/sh
psql -X -q --no-password -c "INSERT INTO \\"Customer\\"(name) VALUES (\x27arrived during the dump\x27);" > /dev/null || exit 9
exec %s "$@"
' "$REAL_PG_DUMP" > "$T/shim-busy/pg_dump"; chmod +x "$T/shim-busy/pg_dump"
run busy env PATH="$T/shim-busy:$PATH" DATABASE_URL="$URL" BACKUP_DIR="$T/unstable" "$S/backup.sh"
require busy
USET=$(sed -n 's/^✓ BACKUP_ARCHIVE_VALID //p' "$T/log/busy")
check "unstable counts: archive valid, flagged counts_stable_during_dump=no with a TABLES_ONLY warning" 'grep -qx "counts_stable_during_dump=no" "${USET%.dump}.meta" && has busy "RESTORE_TEST_PASSED_TABLES_ONLY"'
run r_busy env RESTORE_DB=lvl_unstable DATABASE_URL="$URL" "$S/restore.sh" "$USET"
check "unstable counts: RESTORE_VERIFIED_TABLES_ONLY, exit 3, never full" '[ "$(rc r_busy)" = 3 ] && has r_busy "RESTORE_VERIFIED_TABLES_ONLY" && has r_busy "changed while the dump ran" && ! has r_busy "^✓ RESTORE_VERIFIED "'

echo "set metadata a FULL result depends on"
variant() { mkdir -m 700 "$T/v-$1"; cp "$BASE1".* "$T/v-$1/"; VB="$T/v-$1/$(basename "$BASE1")"; }   # a fresh copy of set 1
md() { run "md_$1" env RESTORE_DB="md_$1" DATABASE_URL="$URL" "$S/restore.sh" "$VB.dump"; }
db_absent() { [ "$(admin "select count(*) from pg_database where datname = '$1';")" = 0 ]; }
rejected() { [ "$(rc "md_$1")" = 1 ] && has "md_$1" "ARCHIVE_REJECTED" && has "md_$1" "$2" && ! has "md_$1" "RESTORE_COMPLETED" && db_absent "md_$1"; }
weaker() { [ "$(rc "md_$1")" = 3 ] && has "md_$1" "RESTORE_VERIFIED_TABLES_ONLY" && ! has "md_$1" "^✓ RESTORE_VERIFIED "; }
variant nomig;     sed -i.orig '/^migrations=/d' "$VB.meta"; md nomig
check "absent migrations= in .meta: TABLES_ONLY (exit 3), never full" 'weaker nomig && has md_nomig "missing: migrations"'
variant nometa;    rm "$VB.meta"; md nometa
check "absent .meta: TABLES_ONLY (exit 3), never full" 'weaker nometa'
variant legacy;    sed -i.orig '/^backup_status=/d' "$VB.meta"; md legacy
check "older-format .meta (no backup_status): TABLES_ONLY (exit 3), never full" 'weaker legacy'
variant badmig;    sed -i.orig 's/^migrations=.*/migrations=garbage/' "$VB.meta"; md badmig
check "malformed migrations=: ARCHIVE_REJECTED before restoring" 'rejected badmig "migrations"'
variant dupmig;    grep "^migrations=" "$VB.meta" >> "$VB.meta"; md dupmig
check "duplicated migrations=: ARCHIVE_REJECTED" 'rejected dupmig "more than one line"'
variant badsha;    sed -i.orig "s/^archive_sha256=.*/archive_sha256=$(printf "%064d" 0)/" "$VB.meta"; md badsha
check "archive_sha256 contradicting the checksum file: ARCHIVE_REJECTED" 'rejected badsha "archive_sha256"'
variant badname;   sed -i.orig 's/^archive=.*/archive=other.dump/' "$VB.meta"; md badname
check "archive= naming another file: ARCHIVE_REJECTED" 'rejected badname "archive(names other.dump)"'
variant badtables; sed -i.orig 's/^tables=.*/tables=99/' "$VB.meta"; md badtables
check "tables= contradicting .counts: ARCHIVE_REJECTED" 'rejected badtables "tables(.counts lists a different number)"'
variant badstable; sed -i.orig 's/^counts_stable_during_dump=.*/counts_stable_during_dump=maybe/' "$VB.meta"; md badstable
check "malformed counts_stable_during_dump: ARCHIVE_REJECTED" 'rejected badstable "counts_stable_during_dump"'
variant badcounts; sed -i.orig 's/^\(public\.Customer\) [0-9]*$/\1 abc/' "$VB.counts"; md badcounts
check "malformed .counts line: ARCHIVE_REJECTED" 'rejected badcounts ".counts(not"'
variant dupcounts; head -1 "$VB.counts" >> "$VB.counts"; md dupcounts
check "a table listed twice in .counts: ARCHIVE_REJECTED" 'rejected dupcounts "listed twice"'
variant nocountsbody; : > "$VB.counts"; md nocountsbody
check "empty .counts: ARCHIVE_REJECTED" 'rejected nocountsbody ".counts(not"'

echo "required tools; no cmp/diff needed"
mkfarm() {   # <dir> <names to leave out…>: a PATH of links to every command on PATH except those
  local d="$1" ex=" ${*:2} " p f n old="$IFS"
  mkdir -p "$d"; IFS=:; set -- $PATH; IFS="$old"
  for p in "$@"; do [ -d "$p" ] || continue
    for f in "$p"/*; do n=${f##*/}
      [ -x "$f" ] && [ ! -d "$f" ] && [ ! -e "$d/$n" ] || continue
      case "$ex" in *" $n "*) continue ;; esac
      ln -s "$f" "$d/$n"
    done
  done
}
mkfarm "$T/farm-nocmp" cmp diff; mkfarm "$T/farm-noawk" awk
check "test PATHs really lack cmp/diff and awk" '! env PATH="$T/farm-nocmp" bash -c "command -v cmp || command -v diff" > /dev/null && ! env PATH="$T/farm-noawk" bash -c "command -v awk" > /dev/null'
run nocmp_bk env PATH="$T/farm-nocmp" DATABASE_URL="$URL" BACKUP_DIR="$T/nocmp" "$S/backup.sh"
require nocmp_bk
NSET=$(sed -n 's/^✓ BACKUP_ARCHIVE_VALID //p' "$T/log/nocmp_bk")
check "without cmp/diff: backup succeeds and detects stable counts" 'grep -qx "counts_stable_during_dump=yes" "${NSET%.dump}.meta"'
run nocmp_rs env PATH="$T/farm-nocmp" RESTORE_DB=nocmp_full DATABASE_URL="$URL" "$S/restore.sh" "$NSET"
check "without cmp/diff: restore.sh reaches full RESTORE_VERIFIED (exit 0)" '[ "$(rc nocmp_rs)" = 0 ] && has nocmp_rs "^✓ RESTORE_VERIFIED "'
run nocmp_tamp env PATH="$T/farm-nocmp" RESTORE_DB=nocmp_tamp DATABASE_URL="$URL" "$S/restore.sh" "$T/tampered/$(basename "$SET1")"
check "without cmp/diff: a mismatch is listed (- expected / + restored), RESTORE_NOT_VERIFIED, exit 1" '[ "$(rc nocmp_tamp)" = 1 ] && has nocmp_tamp "^- public.Customer " && has nocmp_tamp "^+ public.Customer " && has nocmp_tamp "RESTORE_NOT_VERIFIED"'
run noawk_bk env PATH="$T/farm-noawk" DATABASE_URL="$URL" BACKUP_DIR="$T/noawk" "$S/backup.sh"
check "missing awk: backup.sh stops with a clear error before creating anything" '[ "$(rc noawk_bk)" = 1 ] && has noawk_bk "Required tool(s) not found on PATH: awk" && [ ! -e "$T/noawk" ]'
run noawk_rs env PATH="$T/farm-noawk" RESTORE_DB=noawk DATABASE_URL="$URL" "$S/restore.sh" "$SET1"
check "missing awk: restore.sh stops before connecting" '[ "$(rc noawk_rs)" = 1 ] && has noawk_rs "Required tool(s) not found on PATH: awk" && ! has noawk_rs "ARCHIVE_READABLE" && db_absent noawk'
run noawk_rt env PATH="$T/farm-noawk" "$S/restore-test.sh" "$SET1" "$IMAGE"
check "missing awk: restore-test.sh stops before starting anything" '[ "$(rc noawk_rt)" = 1 ] && has noawk_rt "Required tool(s) not found on PATH: awk" && ! has noawk_rt "Starting"'

# ---- retention (backup.sh, opt-in) --------------------------------------------------------------------
echo "backup.sh — retention"
SRC_ID=$(sed -n 's/^source_identity=//p' "$BASE1.meta")
mkset() {   # <name> <meta body>
  for e in dump dump.sha256 toc counts; do echo x > "$B/$1.$e"; done
  printf '%s\n' "$2" > "$B/$1.meta"; touch -t 202001010000 "$B/$1".*
}
mkset synth-20200101T000000Z "$(printf 'database=synth\nsource_identity=%s\nbackup_status=ARCHIVE_VALID' "$SRC_ID")"
mkset synth-20200102T000000Z "$(printf 'database=synth\nsource_identity=%s\nbackup_status=ARCHIVE_VALID' "$SRC_ID")"; touch "$B/synth-20200102T000000Z.keep"
mkset synth-20200103T000000Z "database=synth"                                                   # older format, no status
mkset synth-20200104T000000Z "$(printf 'database=synth\nsource_identity=9/elsewhere/1\nbackup_status=ARCHIVE_VALID')"
mkset other-20200105T000000Z "$(printf 'database=other\nsource_identity=%s\nbackup_status=ARCHIVE_VALID' "$SRC_ID")"
echo x > "$B/notes.txt"; touch -t 202001010000 "$B/notes.txt"
BEFORE=$(tree_sum "$B")
sleep 1; run noret env DATABASE_URL="$URL" BACKUP_DIR="$B" "$S/backup.sh"
check "no RETENTION_DAYS: nothing is ever deleted" '[ "$(rc noret)" = 0 ] && [ -z "$(printf "%s\n" "$BEFORE" | grep -vxF -f <(tree_sum "$B"))" ]'
sleep 1; run ret env DATABASE_URL="$URL" BACKUP_DIR="$B" RETENTION_DAYS=30 "$S/backup.sh"
check "retention removes only the old complete set of this database and server" '[ "$(rc ret)" = 0 ] && [ ! -e "$B/synth-20200101T000000Z.dump" ] && [ ! -e "$B/synth-20200101T000000Z.meta" ]'
check "retention keeps .keep, older-format, other-server, other-db sets and unrelated files" '[ -e "$B/synth-20200102T000000Z.dump" ] && [ -e "$B/synth-20200103T000000Z.dump" ] && [ -e "$B/synth-20200104T000000Z.dump" ] && [ -e "$B/other-20200105T000000Z.dump" ] && [ -e "$B/notes.txt" ] && [ -f "$SET1" ]'
run ret0 env DATABASE_URL="$URL" BACKUP_DIR="$B" RETENTION_DAYS=0 "$S/backup.sh"; check "RETENTION_DAYS=0 refused" '[ "$(rc ret0)" != 0 ]'

# ---- Docker: restore-test.sh and backup-docker.sh ------------------------------------------------------
if command -v docker > /dev/null && docker image inspect "$IMAGE" > /dev/null 2>&1; then
  echo "restore-test.sh / backup-docker.sh (image $IMAGE, already present; no pull)"
  RAND=$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')
  VOL0=$(docker volume ls -q | sort); CT0=$(docker ps -aq --no-trunc | sort)   # everything that existed before
  DECOY=$(docker create --pull never --label "$RUN_LABEL" --label azad.restore-test=1 --name "azad-restore-test-decoy-$RAND" "$IMAGE"); CONTAINERS="$CONTAINERS $DECOY"
  N0=$(docker ps -aq | wc -l | tr -d ' ')
  printf 'x' >> "$T/bad/$(basename "$SET1")"
  run rt_sum "$S/restore-test.sh" "$T/bad/$(basename "$SET1")" "$IMAGE"
  check "restore-test: checksum mismatch refused before any container starts" '[ "$(rc rt_sum)" != 0 ] && has rt_sum "Checksum" && [ "$(docker ps -aq | wc -l | tr -d " ")" = "$N0" ]'
  head -c 2000 "$SET1" > "$T/bad/$(basename "$SET1")"; (cd "$T/bad" && sha_line "$(basename "$SET1")" > "$(basename "$SET1").sha256"); rm -f "$T/bad/$(basename "$BASE1").meta"
  run rt_corrupt "$S/restore-test.sh" "$T/bad/$(basename "$SET1")" "$IMAGE"
  check "restore-test: corrupt archive fails, its own container removed" '[ "$(rc rt_corrupt)" != 0 ] && ! has rt_corrupt "RESTORE_TEST_PASSED" && [ "$(docker ps -aq | wc -l | tr -d " ")" = "$N0" ]'
  run rt_ok "$S/restore-test.sh" "$SET1" "$IMAGE"
  check "restore-test: three stages and full RESTORE_TEST_PASSED (exit 0)" '[ "$(rc rt_ok)" = 0 ] && has rt_ok "ARCHIVE_READABLE" && has rt_ok "RESTORE_COMPLETED" && has rt_ok "^✓ RESTORE_TEST_PASSED " && ! has rt_ok "TABLES_ONLY" && has rt_ok "applied=2 unfinished=0"'
  check "restore-test: its container removed, the look-alike decoy left alone" '[ "$(docker ps -aq | wc -l | tr -d " ")" = "$N0" ] && docker inspect "$DECOY" > /dev/null 2>&1'

  SRC="azad-bkdocker-src-$RAND"
  run rt_nocounts "$S/restore-test.sh" "$T/nocounts/$(basename "$SET1")" "$IMAGE"
  check "restore-test, missing .counts: RESTORE_TEST_PASSED_TABLES_ONLY, exit 3" '[ "$(rc rt_nocounts)" = 3 ] && has rt_nocounts "RESTORE_TEST_PASSED_TABLES_ONLY" && ! has rt_nocounts "^✓ RESTORE_TEST_PASSED "'
  run rt_busy "$S/restore-test.sh" "$USET" "$IMAGE"
  check "restore-test, unstable counts: RESTORE_TEST_PASSED_TABLES_ONLY, exit 3" '[ "$(rc rt_busy)" = 3 ] && has rt_busy "RESTORE_TEST_PASSED_TABLES_ONLY" && ! has rt_busy "^✓ RESTORE_TEST_PASSED "'
  run rt_tamp "$S/restore-test.sh" "$T/tampered/$(basename "$SET1")" "$IMAGE"
  check "restore-test, row counts that differ: RESTORE_NOT_VERIFIED, exit 1" '[ "$(rc rt_tamp)" = 1 ] && has rt_tamp "RESTORE_NOT_VERIFIED" && ! has rt_tamp "RESTORE_TEST_PASSED"'
  N1=$(docker ps -aq | wc -l | tr -d ' ')
  run rt_badmig "$S/restore-test.sh" "$T/v-badmig/$(basename "$SET1")" "$IMAGE"
  check "restore-test, malformed metadata: ARCHIVE_REJECTED before any container starts" '[ "$(rc rt_badmig)" = 1 ] && has rt_badmig "ARCHIVE_REJECTED" && ! has rt_badmig "Starting" && [ "$(docker ps -aq | wc -l | tr -d " ")" = "$N1" ]'
  run rt_nomig "$S/restore-test.sh" "$T/v-nomig/$(basename "$SET1")" "$IMAGE"
  check "restore-test, absent migrations=: RESTORE_TEST_PASSED_TABLES_ONLY, exit 3" '[ "$(rc rt_nomig)" = 3 ] && has rt_nomig "RESTORE_TEST_PASSED_TABLES_ONLY" && ! has rt_nomig "^✓ RESTORE_TEST_PASSED "'
  check "restore.sh and restore-test.sh give the same guidance with TABLES_ONLY" 'g=$(sed -n "s/.*only the table list[^.]*\. //p" "$T/log/rt_nomig" | sed "s/ The scratch server.*//"); [ -n "$g" ] && grep -qF -- "$g" "$T/log/md_nomig"'
  check "restore-test runs left no container and no volume behind" '[ "$(docker ps -aq --no-trunc | sort)" = "$(printf "%s\n" $CT0 "$(docker inspect -f "{{.Id}}" "$DECOY")" | sort)" ] && [ "$(docker volume ls -q | sort)" = "$(printf "%s\n" $VOL0 $(docker inspect -f "{{range .Mounts}}{{.Name}} {{end}}" "$DECOY") | sort)" ]'
  if docker image inspect "$NONPG_IMAGE" > /dev/null 2>&1; then
    run rt_partial "$S/restore-test.sh" "$SET1" "$NONPG_IMAGE"   # not PostgreSQL: started, never ready (~60 s)
    check "restore-test, partial setup (server never ready): fails, its container and anonymous volume removed" '[ "$(rc rt_partial)" != 0 ] && has rt_partial "did not become ready" && [ "$(docker ps -aq --filter label=azad.restore-test.run | wc -l | tr -d " ")" = 0 ] && [ "$(docker volume ls -q | sort)" = "$(printf "%s\n" $VOL0 $(docker inspect -f "{{range .Mounts}}{{.Name}} {{end}}" "$DECOY") | sort)" ]'
  else
    echo "  (partial-setup restore-test case skipped: $NONPG_IMAGE not present locally)"
  fi
  # Harness partial setup: a container whose start fails is created but its ID never recorded; the run label finds it.
  docker run -d --pull never --label "$RUN_LABEL" --network none --entrypoint /nonexistent-entrypoint "$IMAGE" > /dev/null 2>&1
  check "harness partial setup: a half-created container is found by this run's label" '[ "$(docker ps -aq --filter "label=$RUN_LABEL" | wc -l | tr -d " ")" -ge 2 ]'

  SRCID=$(docker run -d --pull never --label "$RUN_LABEL" --name "$SRC" --network none --tmpfs /var/lib/postgresql/data -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_USER=postgres -e POSTGRES_DB=synthd "$IMAGE"); CONTAINERS="$CONTAINERS $SRCID"
  for _ in $(seq 1 120); do docker exec "$SRCID" pg_isready -q -h 127.0.0.1 -U postgres -d synthd 2>/dev/null && break; sleep 0.5; done
  printf '%s\n' 'CREATE TABLE t(id int); INSERT INTO t SELECT generate_series(1, 42);' | docker exec -i "$SRCID" psql -X -q -h 127.0.0.1 -U postgres -d synthd
  DB2="$T/dbackups"
  run bd_prefix env BACKUP_DIR="$DB2" "$S/backup-docker.sh" "azad-bkdocker-src" synthd
  check "backup-docker: a name prefix is not accepted" '[ "$(rc bd_prefix)" != 0 ] && [ ! -e "$DB2" ]'
  run bd_idpfx env BACKUP_DIR="$DB2" "$S/backup-docker.sh" "${SRCID:0:12}" synthd
  check "backup-docker: an ID prefix is not accepted" '[ "$(rc bd_idpfx)" != 0 ] && has bd_idpfx "exact name" && [ ! -e "$DB2" ]'
  run bd_tmp env BACKUP_DIR="$TMPREAL" "$S/backup-docker.sh" "$SRC" synthd;  check "backup-docker: shared /tmp refused" '[ "$(rc bd_tmp)" != 0 ]'
  run bd_ok env BACKUP_DIR="$DB2" "$S/backup-docker.sh" "$SRC" synthd
  require bd_ok
DSET=$(sed -n 's/^✓ BACKUP_ARCHIVE_VALID //p' "$T/log/bd_ok")
  check "backup-docker: complete set, mode 600, status and identity recorded" '[ "$(rc bd_ok)" = 0 ] && [ "$(find "$DB2" -maxdepth 1 -type f -perm 600 | wc -l | tr -d " ")" = 5 ] && grep -qx "backup_status=ARCHIVE_VALID" "${DSET%.dump}.meta" && grep -qx "migrations=absent" "${DSET%.dump}.meta"'
  DSTAMP=$(sed -n 's/^created_utc=//p' "${DSET%.dump}.meta"); BEFORE=$(tree_sum "$DB2")
  printf '#!/bin/sh\nif [ "$1" = "-u" ] && [ "$2" = "+%%Y%%m%%dT%%H%%M%%SZ" ]; then echo %s; else exec /bin/date "$@"; fi\n' "$DSTAMP" > "$T/shim-date/date"
  run bd_coll env PATH="$T/shim-date:$PATH" BACKUP_DIR="$DB2" "$S/backup-docker.sh" "$SRC" synthd
  check "backup-docker: collision refused, existing set byte-identical" '[ "$(rc bd_coll)" != 0 ] && [ "$(tree_sum "$DB2")" = "$BEFORE" ]'
  run bd_rt "$S/restore-test.sh" "$DSET" "$IMAGE"
  check "backup-docker set passes restore-test, full (42 rows)" '[ "$(rc bd_rt)" = 0 ] && has bd_rt "^✓ RESTORE_TEST_PASSED "'
  remove_own_containers
  check "cleanup: every container of this run gone, with its anonymous volumes" '[ -z "$(docker ps -aq --filter "label=$RUN_LABEL")" ] && [ "$(docker ps -aq --no-trunc | sort)" = "$CT0" ]'
  check "cleanup: no unrelated container, named volume or pre-existing volume removed or added" '[ "$(docker volume ls -q | sort)" = "$VOL0" ]'
else
  echo "Docker tests SKIPPED (docker or image $IMAGE not available locally; this script never pulls)"
fi

# ---- backup-nightly.sh (stand-ins for docker and aws; the throwaway cluster is the "container") ----------
echo "backup-nightly.sh — database + uploads + off-server copy (docker and aws stand-ins, nothing real)"
mkdir -p "$T/shim-docker" "$T/shim-aws"
cat > "$T/shim-docker/docker" <<'SH'
#!/bin/sh
# Test stand-in for docker: one "container" ($FAKE_CONTAINER, id fakecid) whose commands run on the throwaway cluster.
case "$1" in
  inspect)
    [ "$4" = "$FAKE_CONTAINER" ] || [ "$4" = fakecid ] || { echo "Error: No such object: $4" >&2; exit 1; }
    case "$3" in *State.Running*) echo "fakecid /$FAKE_CONTAINER true" ;; *Config.Image*) echo "fake/postgres:test" ;; *) exit 1 ;; esac ;;
  exec)
    shift; [ "$1" != -i ] || shift; [ "$1" = fakecid ] || exit 1; shift
    exec env POSTGRES_USER=owner PGHOST=127.0.0.1 PGPORT="$FAKE_PGPORT" PGPASSWORD="$FAKE_PGPASSWORD" "$@" ;;
  *) exit 1 ;;
esac
SH
cat > "$T/shim-aws/aws" <<'SH'
#!/bin/sh
# Test stand-in for the aws CLI: "s3 cp [flags] <file> s3://bucket/key" copies into $FAKE_S3 and logs the key.
[ "$1" = s3 ] && [ "$2" = cp ] || exit 2
shift 2; while [ $# -gt 2 ]; do shift; done
case "$1" in *"${FAKE_S3_FAIL_ON:-/nothing/}") echo "upload failed" >&2; exit 1 ;; esac
key="${2#s3://}"; mkdir -p "$FAKE_S3/$(dirname "$key")" && cp "$1" "$FAKE_S3/$key" && echo "$key" >> "$FAKE_S3.log"
SH
chmod +x "$T/shim-docker/docker" "$T/shim-aws/aws"
NB="$T/nightly"; UP="$T/app/uploads"; mkdir -p "$UP/units"; echo "photo bytes" > "$UP/units/a.jpg"
NENV=(env PATH="$T/shim-docker:$T/shim-aws:$PATH" FAKE_CONTAINER=azad_test_pg FAKE_PGPORT="$PORT" FAKE_PGPASSWORD="$PW" FAKE_S3="$T/s3")
nsets() { find "$NB" -maxdepth 1 -name 'synth-*.meta' 2>/dev/null | wc -l | tr -d ' '; }
nup() { find "$NB" -maxdepth 1 -name 'uploads-*.tar.gz' 2>/dev/null | wc -l | tr -d ' '; }

run n_noc "${NENV[@]}" BACKUP_DIR="$NB" DB=synth "$S/backup-nightly.sh"
check "nightly: no CONTAINER refused before anything is written" '[ "$(rc n_noc)" != 0 ] && has n_noc "CONTAINER" && [ ! -e "$NB" ]'
run n_s3 "${NENV[@]}" BACKUP_DIR="$NB" CONTAINER=azad_test_pg DB=synth BACKUP_S3_URI=https://example.invalid/x "$S/backup-nightly.sh"
check "nightly: a non-S3 destination refused before anything is written" '[ "$(rc n_s3)" != 0 ] && has n_s3 "s3://bucket/prefix" && [ ! -e "$NB" ]'
run n_up "${NENV[@]}" BACKUP_DIR="$NB" CONTAINER=azad_test_pg DB=synth UPLOADS_DIR=uploads "$S/backup-nightly.sh"
check "nightly: a relative UPLOADS_DIR refused before anything is written" '[ "$(rc n_up)" != 0 ] && has n_up "absolute" && [ ! -e "$NB" ]'
run n_ret0 "${NENV[@]}" BACKUP_DIR="$NB" CONTAINER=azad_test_pg DB=synth RETENTION_DAYS=0 "$S/backup-nightly.sh"
check "nightly: RETENTION_DAYS=0 refused before anything is written" '[ "$(rc n_ret0)" != 0 ] && [ ! -e "$NB" ]'

run n_ok "${NENV[@]}" BACKUP_DIR="$NB" CONTAINER=azad_test_pg DB=synth UPLOADS_DIR="$UP" BACKUP_S3_URI=s3://bkt/azad RETENTION_DAYS=14 "$S/backup-nightly.sh"
require n_ok
NDUMP=$(sed -n 's/^✓ NIGHTLY_BACKUP_DONE //p' "$T/log/n_ok"); NBASE="${NDUMP%.dump}"
NUA=$(sed -n 's/^✓ UPLOADS_ARCHIVED \([^ ]*\) .*/\1/p' "$T/log/n_ok")
check "nightly: database set complete (5 files, mode 600), made by backup-docker.sh" '[ "$(find "$NB" -maxdepth 1 -name "synth-*" -perm 600 | wc -l | tr -d " ")" = 5 ] && grep -qx "backup_status=ARCHIVE_VALID" "$NBASE.meta" && grep -qx "tool=backup-docker.sh" "$NBASE.meta"'
check "nightly: uploads archive holds the uploaded files and its checksum verifies" '[ -f "$NUA" ] && tar -tzf "$NUA" | grep -qx "uploads/units/a.jpg" && (cd "$NB" && sha_verify "$(basename "$NUA").sha256")'
check "nightly: every new file copied off-server, identical, the .meta of the set last" '[ "$(wc -l < "$T/s3.log" | tr -d " ")" = 7 ] && [ "$(tail -n 1 "$T/s3.log")" = "bkt/azad/$(basename "$NBASE").meta" ] && [ "$(sha_stdin < "$T/s3/bkt/azad/$(basename "$NDUMP")")" = "$(sha_stdin < "$NDUMP")" ] && [ "$(sha_stdin < "$T/s3/bkt/azad/$(basename "$NUA")")" = "$(sha_stdin < "$NUA")" ]'

# Retention: old sets / archives of this source are removed; .keep ones, other sources and other files are not.
NSRC=$(sed -n 's/^source_identity=//p' "$NBASE.meta")
nmkset() { for e in dump dump.sha256 toc counts; do echo x > "$NB/$1.$e"; done; printf '%s\n' "$2" > "$NB/$1.meta"; touch -t 202001010000 "$NB/$1".*; }
nmkset synth-20200101T000000Z "$(printf 'database=synth\nsource_identity=%s\nbackup_status=ARCHIVE_VALID' "$NSRC")"
nmkset synth-20200102T000000Z "$(printf 'database=synth\nsource_identity=%s\nbackup_status=ARCHIVE_VALID' "$NSRC")"; touch "$NB/synth-20200102T000000Z.keep"
nmkset synth-20200103T000000Z "$(printf 'database=synth\nsource_identity=9/elsewhere/1\nbackup_status=ARCHIVE_VALID')"
for u in uploads-20200101T000000Z uploads-20200102T000000Z; do echo x > "$NB/$u.tar.gz"; echo x > "$NB/$u.tar.gz.sha256"; touch -t 202001010000 "$NB/$u".*; done
touch "$NB/uploads-20200102T000000Z.keep"; echo x > "$NB/notes.txt"; touch -t 202001010000 "$NB/notes.txt"
sleep 1; run n_ret "${NENV[@]}" BACKUP_DIR="$NB" CONTAINER=azad_test_pg DB=synth UPLOADS_DIR="$UP" RETENTION_DAYS=14 "$S/backup-nightly.sh"
check "nightly retention: removes the old database set and uploads archive of this server" '[ "$(rc n_ret)" = 0 ] && [ ! -e "$NB/synth-20200101T000000Z.dump" ] && [ ! -e "$NB/synth-20200101T000000Z.meta" ] && [ ! -e "$NB/uploads-20200101T000000Z.tar.gz" ] && [ ! -e "$NB/uploads-20200101T000000Z.tar.gz.sha256" ]'
check "nightly retention: keeps .keep sets and archives, other servers, unrelated files and the recent backups" '[ -e "$NB/synth-20200102T000000Z.dump" ] && [ -e "$NB/synth-20200103T000000Z.dump" ] && [ -e "$NB/uploads-20200102T000000Z.tar.gz" ] && [ -e "$NB/notes.txt" ] && [ -f "$NDUMP" ] && [ -f "$NUA" ]'

S_BEFORE=$(nsets); U_BEFORE=$(nup)
sleep 1; run n_s3fail "${NENV[@]}" FAKE_S3_FAIL_ON=.meta BACKUP_DIR="$NB" CONTAINER=azad_test_pg DB=synth UPLOADS_DIR="$UP" BACKUP_S3_URI=s3://bkt/azad "$S/backup-nightly.sh"
check "nightly: a failed off-server copy fails the run; the local backup is kept" '[ "$(rc n_s3fail)" != 0 ] && has n_s3fail "Off-server copy failed" && [ "$(nsets)" = $((S_BEFORE + 1)) ] && [ "$(nup)" = $((U_BEFORE + 1)) ]'
S_BEFORE=$(nsets); U_BEFORE=$(nup)
run n_dbfail "${NENV[@]}" BACKUP_DIR="$NB" CONTAINER=no_such_container DB=synth UPLOADS_DIR="$UP" "$S/backup-nightly.sh"
check "nightly: a failed database backup stops the run before anything else is written" '[ "$(rc n_dbfail)" != 0 ] && has n_dbfail "Database backup failed" && [ "$(nsets)" = "$S_BEFORE" ] && [ "$(nup)" = "$U_BEFORE" ]'

# ---- secrets ------------------------------------------------------------------------------------------
echo "secrets"
check "password absent from every output and every backup file" '! grep -rqF -- "$PW" "$T/log" "$B" "$NB" "$T/s3" && ! grep -rqF -- "$ENC" "$T/log" "$B" "$NB" "$T/s3"'
check "no temporary password file left behind" '[ -z "$(find "${TMPDIR:-/tmp}" -maxdepth 1 -name "azad-pgpass.*" -newer "$T/log/initdb" 2>/dev/null)" ]'

echo
echo "Result: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
