# shellcheck shell=bash
# Shared by scripts/backup.sh, backup-docker.sh, backup-nightly.sh, restore.sh and restore-test.sh (bash 3.2
# compatible).
#
# A backup SET is five files that share one base name, <db>-<UTC stamp>:
#   .dump  .dump.sha256  .toc  .counts  .meta
# They are written in a private ".incomplete-…" folder inside the backup folder and only then linked into
# place, the .meta LAST — so a set is complete exactly when its .meta says backup_status=ARCHIVE_VALID.
# Nothing here deletes anything outside the calling invocation's own temporary folder, except the opt-in
# retention helpers (prune_backup_sets, prune_uploads_archives), which remove only what they are told to.
#
# Restore results — the same labels and exit codes from restore-test.sh and restore.sh (see "What a restore
# check can honestly claim" below):
#   ARCHIVE_READABLE → RESTORE_COMPLETED → RESTORE_TEST_PASSED / RESTORE_VERIFIED                         exit 0
#                                        → RESTORE_TEST_PASSED_TABLES_ONLY / RESTORE_VERIFIED_TABLES_ONLY  exit 3
#   ARCHIVE_REJECTED      checksum, archive or set metadata unusable — nothing was restored                exit 1
#   RESTORE_FAILED        pg_restore (or the scratch server) failed                                       exit 1
#   RESTORE_NOT_VERIFIED  restored, but it does not match the backup set                                  exit 1

die() { echo "ERROR: $*" >&2; exit 1; }

# Every external command the scripts rely on, checked up front with one clear error — before anything is
# created. (cmp and diff are deliberately not needed: some minimal Linux images lack diffutils.)
CORE_TOOLS="awk basename cat cut date dirname find grep id ln mkdir mktemp rm sed sort stat tr uniq wc"
require_tools() {   # <command>…  (plus sha256sum or shasum, always)
  local t missing=""
  for t in "$@"; do command -v "$t" > /dev/null 2>&1 || missing="$missing $t"; done
  command -v sha256sum > /dev/null 2>&1 || command -v shasum > /dev/null 2>&1 || missing="$missing sha256sum-or-shasum"
  [ -z "$missing" ] || die "Required tool(s) not found on PATH:$missing"
}

# Byte-equality of two small text files (row-count lists), without cmp.
files_equal() { [ "$(cat "$1"; echo .)" = "$(cat "$2"; echo .)" ]; }

# Lines found in only one of two files, "- " from the first (expected) and "+ " from the second (restored).
show_line_differences() {
  awk 'FILENAME == ARGV[1] { e[$0] = 1; next } { r[$0] = 1 }
       END { for (l in e) if (!(l in r)) print "- " l; for (l in r) if (!(l in e)) print "+ " l }' "$1" "$2" | LC_ALL=C sort -k2
}

sha256_of() {   # prints the SHA-256 of one file
  if command -v sha256sum >/dev/null; then sha256sum < "$1"; else shasum -a 256 < "$1"; fi | cut -d' ' -f1
}

sha256_check() {   # verifies <file>.sha256 ("<hash>  <file name>") against the file next to it
  local dir name
  dir=$(dirname "$1"); name=$(basename "$1")
  [ -f "$1.sha256" ] || { echo "No checksum file $1.sha256" >&2; return 1; }
  # Exactly one line, naming exactly this file — so the check cannot be pointed at some other file.
  awk -v n="$name" 'END { exit !(NR == 1 && $2 == n && $1 ~ /^[0-9a-f]+$/ && length($1) == 64) }' "$1.sha256" \
    || { echo "Malformed checksum file $1.sha256" >&2; return 1; }
  # Output is discarded instead of using --status / -s: GNU sha256sum has only --status and BusyBox only -s.
  if command -v sha256sum >/dev/null; then (cd "$dir" && sha256sum -c "$name.sha256" > /dev/null 2>&1); else (cd "$dir" && shasum -a 256 -c "$name.sha256" > /dev/null 2>&1); fi
}

file_owner_and_mode() {   # "<uid> <octal mode>" (GNU or BSD stat)
  if stat -c '%u %a' / >/dev/null 2>&1; then stat -c '%u %a' "$1"; else stat -f '%u %Lp' "$1"; fi
}

# The backup folder must be an absolute, normalised path that is not a symbolic link. An existing folder must
# belong to the current user and be closed to everyone else (mode 700 or stricter) — it is never chmod-ed,
# so a shared folder such as /tmp or a home directory is refused instead of being altered. A missing folder
# is created with mode 700.
backup_dir_prepare() {
  local d="$1" owner mode
  [ -n "$d" ] || die "BACKUP_DIR is empty"
  case "$d" in /*) ;; *) die "BACKUP_DIR must be an absolute path" ;; esac
  case "$d" in */|*//*|*/./*|*/../*|*/.|*/..) die "BACKUP_DIR must be a normalised absolute path (no trailing '/', '.', '..' or '//'): $d" ;; esac
  [ ! -L "$d" ] || die "BACKUP_DIR is a symbolic link; give the real path: $d"
  if [ -e "$d" ]; then
    [ -d "$d" ] || die "BACKUP_DIR exists but is not a folder: $d"
    read -r owner mode <<EOF
$(file_owner_and_mode "$d")
EOF
    [ "$owner" = "$(id -u)" ] || die "BACKUP_DIR is not owned by the current user: $d"
    [ $((8#$mode & 8#077)) -eq 0 ] || die "BACKUP_DIR is open to other users (mode $mode); use a private folder, or run: chmod 700 '$d'"
  else
    (umask 077 && mkdir -p -m 700 "$d") || die "Cannot create BACKUP_DIR $d"
  fi
}

# Links every file of a finished set from its private folder into place, the .meta last. ln never replaces an
# existing file; on any failure the links made by THIS call are removed again and it returns 1.
publish_backup_set() {   # <work dir> <base path>
  local work="$1" base="$2" made="" ext
  for ext in dump dump.sha256 toc counts meta; do
    if ln "$work/set.$ext" "$base.$ext" 2>/dev/null; then
      made="$made $base.$ext"
    else
      echo "Refusing to overwrite existing $base.$ext" >&2
      for ext in $made; do rm -f "$ext"; done
      return 1
    fi
  done
}

# Fails when any file of the set already exists (an early, friendly check; publish_backup_set is the real guard).
backup_set_absent() {   # <base path>
  local ext
  for ext in dump dump.sha256 toc counts meta; do
    [ ! -e "$1.$ext" ] || { echo "Refusing to overwrite existing $1.$ext" >&2; return 1; }
  done
}

# Prisma migration history as one line: "applied=<n> unfinished=<n> latest=<name>", or "absent".
# Two statements because a query that names a missing table fails before it runs.
MIGRATIONS_PRESENT_SQL="select to_regclass('public._prisma_migrations') is not null;"
MIGRATIONS_STATE_SQL="select 'applied='||count(*) filter (where finished_at is not null and rolled_back_at is null)||' unfinished='||count(*) filter (where finished_at is null or rolled_back_at is not null)||' latest='||coalesce(max(migration_name) filter (where finished_at is not null and rolled_back_at is null), 'none') from public._prisma_migrations;"

# Before anything is restored: the checksum must match, and a .meta (when present) must describe a complete set.
verify_archive_set() {   # <archive>
  local a="$1" base="${1%.dump}"
  [ -f "$a" ] || die "ARCHIVE_REJECTED: Archive not found: $a"
  case "$a" in *.dump) ;; *) die "ARCHIVE_REJECTED: Not a .dump archive: $a" ;; esac
  sha256_check "$a" || die "ARCHIVE_REJECTED: Checksum missing or mismatched for $a — the archive is not used"
  if [ -f "$base.meta" ]; then
    if grep -q '^backup_status=' "$base.meta"; then
      grep -qx 'backup_status=ARCHIVE_VALID' "$base.meta" || die "ARCHIVE_REJECTED: $base.meta does not mark this backup as complete"
    else
      echo "→ $base.meta predates backup_status (an older backup); relying on the checksum"
    fi
  fi
  echo "→ Checksum OK"
}

# ---- What a restore check can honestly claim --------------------------------------------------------------
# A checksum proves only that the archive is the file the backup wrote, not that it holds all the data. So a
# restore is compared with the source, and the result says how far that comparison went:
#   full         the set's metadata is complete and consistent (verify_set_metadata), every table's exact row
#                count equals <base>.counts, AND the migration history equals the one recorded in <base>.meta
#   tables_only  only the table list could be compared, because
#                - the row counts changed while pg_dump ran: they are taken just before and just after the
#                  dump, in separate sessions, outside the dump's own snapshot, so <base>.counts need not
#                  describe the archived data; or
#                - there is no <base>.counts (a hand-made backup): the list then comes from the archive's own
#                  table of contents; or
#                - <base>.meta (or a field a full check needs) is absent — an older or hand-made set.
# verify_set_metadata, verify_restored_counts and verify_restored_migrations set SET_METADATA / VERIFY_COUNTS /
# VERIFY_MIGRATIONS (and return 1 on anything malformed or mismatched); restore_verification_level combines
# them. Callers print a *_TABLES_ONLY result and exit 3 for tables_only, so a weaker check is never reported,
# or scripted, as a full one.
SET_METADATA=""; VERIFY_COUNTS=""; VERIFY_MIGRATIONS=""

# <meta> <key>: prints the value. Status 0 = exactly one "key=" line, 1 = none, 2 = more than one.
meta_value() {
  local n
  n=$(grep -c "^$2=" "$1" 2> /dev/null) || n=0
  if [ "$n" -eq 0 ]; then return 1; elif [ "$n" -gt 1 ]; then return 2; fi
  sed -n "s/^$2=//p" "$1"
}

# Before anything is restored: can this set's metadata support a FULL verification? A file or field that is
# ABSENT only rules a full result out (SET_METADATA=partial: an older or hand-made set). One that is PRESENT
# but malformed, duplicated or contradicting the archive refuses the set (return 1): it is mixed up or damaged,
# and no result built on it could be trusted.
verify_set_metadata() {   # <archive>
  local a="$1" m="${1%.dump}.meta" c="${1%.dump}.counts" missing="" bad="" key v rc
  SET_METADATA=""
  if [ ! -f "$c" ]; then
    missing="$missing .counts"
  elif [ ! -s "$c" ] || ! awk 'NF != 2 || $1 !~ /^[^.]+[.][^.]/ || $2 !~ /^[0-9]+$/ { exit 1 }' "$c"; then
    bad="$bad .counts(not \"schema.table count\" lines)"
  elif [ -n "$(cut -d' ' -f1 "$c" | LC_ALL=C sort | uniq -d)" ]; then
    bad="$bad .counts(a table listed twice)"
  fi
  if [ ! -f "$m" ]; then
    missing="$missing .meta"
  else
    for key in backup_status archive archive_sha256 tables counts_stable_during_dump migrations; do
      v=$(meta_value "$m" "$key"); rc=$?
      if [ "$rc" = 1 ]; then missing="$missing $key"; continue; fi
      if [ "$rc" != 0 ]; then bad="$bad $key(more than one line)"; continue; fi
      case "$key" in
        backup_status) [ "$v" = ARCHIVE_VALID ] || bad="$bad backup_status" ;;
        archive) [ "$v" = "$(basename "$a")" ] || bad="$bad archive(names $v)" ;;
        archive_sha256) [ "$v" = "$(cut -d' ' -f1 "$a.sha256")" ] || bad="$bad archive_sha256(differs from the checksum file)" ;;
        tables) case "$v" in ''|*[!0-9]*) bad="$bad tables" ;; *)
                  if [ -f "$c" ] && [ "$v" != "$(wc -l < "$c" | tr -d ' ')" ]; then bad="$bad tables(.counts lists a different number)"; fi ;; esac ;;
        counts_stable_during_dump) case "$v" in yes|no) ;; *) bad="$bad counts_stable_during_dump" ;; esac ;;
        migrations) printf '%s\n' "$v" | grep -qxE 'absent|applied=[0-9]+ unfinished=[0-9]+ latest=[^ ]+' || bad="$bad migrations" ;;
      esac
    done
  fi
  if [ -n "$bad" ]; then echo "The backup set's metadata is malformed or inconsistent:$bad" >&2; return 1; fi
  if [ -n "$missing" ]; then
    SET_METADATA=partial; echo "→ Set metadata incomplete (missing:$missing): only a TABLES_ONLY result is possible"
  else
    SET_METADATA=complete; echo "→ Set metadata complete and consistent with the archive"
  fi
}

# The tables in an archive's table of contents (pg_restore --list output), as "schema.table", in byte order.
toc_tables() { awk '$3 ~ /^[0-9]+$/ && $4 == "TABLE" && $5 != "DATA" && $5 != "ATTACH" { print $5 "." $6 }' "$1" | LC_ALL=C sort; }

# Compares the restored database's tables and exact row counts with <base>.counts (or, without one, its
# table list with the archive's table of contents).
verify_restored_counts() {   # <base path> <restored counts file> <archive table of contents>
  local base="$1" got="$2" toc="$3" tables
  VERIFY_COUNTS=""
  tables=$(wc -l < "$got" | tr -d ' ')
  [ "$tables" -gt 0 ] || { echo "The restored database has no tables" >&2; return 1; }
  if [ ! -f "$base.counts" ]; then
    [ -s "$toc" ] && [ "$(toc_tables "$toc")" = "$(cut -d' ' -f1 "$got" | LC_ALL=C sort)" ] \
      || { echo "No $base.counts, and the restored tables differ from the archive's table of contents" >&2; return 1; }
    echo "→ All $tables tables listed in the archive were restored; row counts NOT verified (no $base.counts)"
    VERIFY_COUNTS=tables_only
  elif files_equal "$base.counts" "$got"; then
    echo "→ All $tables tables and their exact row counts match $base.counts"
    VERIFY_COUNTS=exact
  elif grep -qx 'counts_stable_during_dump=no' "$base.meta" 2>/dev/null && [ "$(cut -d' ' -f1 "$base.counts")" = "$(cut -d' ' -f1 "$got")" ]; then
    echo "→ All $tables tables present; row counts NOT verified: they changed while the dump ran, so $base.counts need not describe the archived snapshot"
    VERIFY_COUNTS=tables_only
  else
    echo "Restored tables or row counts differ from $base.counts (- expected, + restored):" >&2; show_line_differences "$base.counts" "$got" >&2; return 1
  fi
}

# Checks the restored migration history: always clean; equal to the source's when the .meta recorded it.
verify_restored_migrations() {   # <base path> <restored state line, or "absent">
  local base="$1" state="$2" expected
  VERIFY_MIGRATIONS=""
  expected=$(sed -n 's/^migrations=//p' "$base.meta" 2>/dev/null || true)
  if [ -n "$expected" ] && [ "$expected" != "$state" ]; then
    echo "Restored migration history ($state) differs from the source's ($expected)" >&2; return 1
  fi
  case "$state" in
    absent) echo "→ No Prisma migration history in this database" ;;
    *" unfinished=0 "*) echo "→ Prisma migrations: $state" ;;
    *) echo "Prisma migration history is not clean: $state" >&2; return 1 ;;
  esac
  if [ -n "$expected" ]; then VERIFY_MIGRATIONS=matched; else
    VERIFY_MIGRATIONS=clean_only; echo "→ Migration history NOT compared with the source (no migrations= in $base.meta)"
  fi
}

# "full" only when all three checks reached their strongest level; anything else is "tables_only".
restore_verification_level() {
  if [ "$SET_METADATA" = complete ] && [ "$VERIFY_COUNTS" = exact ] && [ "$VERIFY_MIGRATIONS" = matched ]; then echo full; else echo tables_only; fi
}

# The operator guidance printed with every *_TABLES_ONLY result.
TABLES_ONLY_GUIDANCE="Row counts and/or the migration history were NOT verified against the source, so this is NOT a full verification and not enough for a release. Back up again in a quiet window (API stopped) and re-test until the full result."

# ---- Retention (opt-in) -------------------------------------------------------------------------------
retention_days_valid() {   # <value>: '' (no pruning) or a whole number of days, 1 or more
  case "$1" in '') ;; *[!0-9]*|0) die "RETENTION_DAYS must be a whole number of days (1 or more), or unset for no pruning" ;; esac
}

# Removes COMPLETE sets of <db> from the same source (<source identity> in the .meta) whose .meta is older than
# <days> days — never <current base>, a set with a <base>.keep file, an older-format set or anything else.
prune_backup_sets() {   # <backup dir> <db> <source identity> <days> <current base>
  local dir="$1" db="$2" src="$3" days="$4" current="$5"
  echo "→ Retention: removing complete sets of '$db' from this same server older than $days days (.keep sets are kept)"
  find "$dir" -maxdepth 1 -type f -name "$db-????????T??????Z.meta" -mtime "+$days" | sort | while IFS= read -r meta; do
    old="${meta%.meta}"
    [ "$old" != "$current" ] || continue
    [ ! -e "$old.keep" ] || { echo "  kept $(basename "$old") (.keep)"; continue; }
    grep -qx 'backup_status=ARCHIVE_VALID' "$meta" && grep -qx "database=$db" "$meta" && grep -qx "source_identity=$src" "$meta" \
      || { echo "  kept $(basename "$old") (not a complete set of this database on this server)"; continue; }
    rm -f "$old.dump" "$old.dump.sha256" "$old.toc" "$old.counts" "$old.meta"
    echo "  removed $(basename "$old")"
  done
}

# ---- Uploaded files (photos, documents) ---------------------------------------------------------------
# Archives the uploads folder as <backup dir>/uploads-<UTC stamp>.tar.gz with a .sha256 next to it. Built in a
# private temporary file, checked (the archive lists) and only then linked into place — never overwriting.
# Prints the archive's path on its last line.
archive_uploads() {   # <uploads dir> <backup dir>
  local src="$1" dir="$2" stamp name work
  stamp=$(date -u +%Y%m%dT%H%M%SZ); name="uploads-$stamp.tar.gz"
  [ ! -e "$dir/$name" ] && [ ! -e "$dir/$name.sha256" ] || { echo "Refusing to overwrite existing $dir/$name" >&2; return 1; }
  work=$(mktemp -d "$dir/.incomplete-$name.XXXXXX") || return 1
  if ! tar -C "$(dirname "$src")" -czf "$work/a.tar.gz" "$(basename "$src")" \
     || ! tar -tzf "$work/a.tar.gz" > /dev/null; then
    rm -rf "$work"; echo "Could not archive $src" >&2; return 1
  fi
  printf '%s  %s\n' "$(sha256_of "$work/a.tar.gz")" "$name" > "$work/a.tar.gz.sha256"
  if ! ln "$work/a.tar.gz" "$dir/$name" 2>/dev/null || ! ln "$work/a.tar.gz.sha256" "$dir/$name.sha256" 2>/dev/null; then
    rm -f "$dir/$name"; rm -rf "$work"; echo "Refusing to overwrite existing $dir/$name" >&2; return 1
  fi
  rm -rf "$work"
  sha256_check "$dir/$name" || { rm -f "$dir/$name" "$dir/$name.sha256"; echo "Checksum verification failed for $dir/$name" >&2; return 1; }
  echo "$dir/$name"
}

# Removes uploads-<stamp>.tar.gz archives (and their .sha256) older than <days> days, except those with a .keep
# file and <current>.
prune_uploads_archives() {   # <backup dir> <days> <current archive>
  local dir="$1" days="$2" current="$3"
  find "$dir" -maxdepth 1 -type f -name 'uploads-????????T??????Z.tar.gz' -mtime "+$days" | sort | while IFS= read -r a; do
    [ "$a" != "$current" ] || continue
    [ ! -e "${a%.tar.gz}.keep" ] || { echo "  kept $(basename "$a") (.keep)"; continue; }
    rm -f "$a" "$a.sha256"
    echo "  removed $(basename "$a")"
  done
}

# ---- Off-server copy ----------------------------------------------------------------------------------
# Copies files to an S3 prefix (s3://bucket/prefix), in the order given — put a set's .meta last, so a copy
# whose .meta is present is complete. Needs only s3:PutObject (an instance role; no keys on disk).
s3_copy() {   # <s3 uri> <file>…
  local uri="${1%/}" f; shift
  for f in "$@"; do
    aws s3 cp --only-show-errors --no-progress "$f" "$uri/$(basename "$f")" || { echo "Upload to $uri failed for $(basename "$f")" >&2; return 1; }
  done
}
