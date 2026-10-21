#!/usr/bin/env bash
# Nightly backup for AZAD EV POINT on the production host (database in Docker): run by the systemd timer in
# deploy/azad-backup-docker.timer, or by hand. Settings come from the environment:
#
#   BACKUP_DIR      absolute, private folder for the backups (as for backup-docker.sh)            required
#   CONTAINER       the PostgreSQL container's exact name, e.g. azad_ev_postgres                    required
#   DB              the database, e.g. azad_ev                                                      required
#   RETENTION_DAYS  delete this server's backups older than this many days (.keep ones are kept)   optional
#   UPLOADS_DIR     absolute path of the API's uploads folder (photos, documents) to archive too    optional
#   BACKUP_S3_URI   s3://bucket/prefix — copy each new backup there (needs the aws CLI and an
#                   instance role allowed s3:PutObject on that prefix; no keys are stored)         optional
#
# Steps: 1) a database backup set (scripts/backup-docker.sh, with the same retention); 2) the uploads folder as
# uploads-<UTC stamp>.tar.gz + .sha256; 3) older uploads archives pruned; 4) the new files copied to S3, each
# set's .meta last. Any failure stops the run with a non-zero exit (systemd marks the service failed) — a
# backup already written stays in place. Nothing is deleted except by the retention rules above.
set -euo pipefail
umask 077
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib/backup-lib.sh"

BACKUP_DIR="${BACKUP_DIR:-}"; CONTAINER="${CONTAINER:-}"; DB="${DB:-}"
RETENTION_DAYS="${RETENTION_DAYS:-}"; UPLOADS_DIR="${UPLOADS_DIR:-}"; BACKUP_S3_URI="${BACKUP_S3_URI:-}"
[ -n "$BACKUP_DIR" ] || die "Set BACKUP_DIR to the absolute path of the backup folder"
[ -n "$CONTAINER" ] || die "Set CONTAINER to the PostgreSQL container's name"
[ -n "$DB" ] || die "Set DB to the database name"
retention_days_valid "$RETENTION_DAYS"
if [ -n "$UPLOADS_DIR" ]; then
  case "$UPLOADS_DIR" in /*) ;; *) die "UPLOADS_DIR must be an absolute path" ;; esac
  [ -d "$UPLOADS_DIR" ] || die "UPLOADS_DIR is not a folder: $UPLOADS_DIR"
fi
if [ -n "$BACKUP_S3_URI" ]; then
  case "$BACKUP_S3_URI" in s3://?*/?*) ;; *) die "BACKUP_S3_URI must look like s3://bucket/prefix" ;; esac
fi
require_tools $CORE_TOOLS tar
[ -z "$BACKUP_S3_URI" ] || require_tools aws

echo "== Nightly backup $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# 1. Database (backup-docker.sh validates the folder, the container and the database itself).
OUT=$(BACKUP_DIR="$BACKUP_DIR" RETENTION_DAYS="$RETENTION_DAYS" "$HERE/backup-docker.sh" "$CONTAINER" "$DB" 2>&1) \
  || { printf '%s\n' "$OUT"; die "Database backup failed"; }
printf '%s\n' "$OUT"
DUMP=$(printf '%s\n' "$OUT" | sed -n 's/^✓ BACKUP_ARCHIVE_VALID //p')
[ -n "$DUMP" ] && [ -f "$DUMP" ] || die "Database backup reported no archive"
BASE="${DUMP%.dump}"

# 2–3. Uploaded files.
UPLOADS_ARCHIVE=""
if [ -n "$UPLOADS_DIR" ]; then
  echo "→ Archiving uploads from $UPLOADS_DIR"
  UPLOADS_ARCHIVE=$(archive_uploads "$UPLOADS_DIR" "$BACKUP_DIR" | tail -n 1) || die "Uploads archive failed"
  [ -f "$UPLOADS_ARCHIVE" ] || die "Uploads archive failed"
  echo "✓ UPLOADS_ARCHIVED $UPLOADS_ARCHIVE ($(wc -c < "$UPLOADS_ARCHIVE" | tr -d ' ') bytes)"
  if [ -n "$RETENTION_DAYS" ]; then
    echo "→ Retention: removing uploads archives older than $RETENTION_DAYS days (.keep ones are kept)"
    prune_uploads_archives "$BACKUP_DIR" "$RETENTION_DAYS" "$UPLOADS_ARCHIVE"
  fi
fi

# 4. Off-server copy: the uploads archive, then the database set with its .meta last.
if [ -n "$BACKUP_S3_URI" ]; then
  echo "→ Copying to ${BACKUP_S3_URI%/}/"
  FILES=()
  [ -z "$UPLOADS_ARCHIVE" ] || FILES+=("$UPLOADS_ARCHIVE.sha256" "$UPLOADS_ARCHIVE")
  FILES+=("$BASE.dump.sha256" "$BASE.dump" "$BASE.toc" "$BASE.counts" "$BASE.meta")
  s3_copy "$BACKUP_S3_URI" "${FILES[@]}" || die "Off-server copy failed (the local backup is complete and kept)"
  echo "✓ COPIED_OFF_SERVER ${#FILES[@]} files"
fi

echo "✓ NIGHTLY_BACKUP_DONE $DUMP"
