# shellcheck shell=bash
# Shared by scripts/backup.sh and scripts/restore.sh. Source it, then call pg_env_from_database_url.
#
# Turns $DATABASE_URL (read from the ENVIRONMENT, never from a command-line argument) into libpq
# environment variables plus a temporary password file, so no password appears in any process's
# arguments (`ps`) or in logs:
#   PGHOST, PGPORT, PGUSER, PGDATABASE  — exported
#   PGPASSFILE                          — a mode-600 temporary file, removed by pg_env_cleanup
# Prisma's ?schema= parameter is ignored. A ?host=/socket/dir parameter selects a Unix socket.

pg_env_cleanup() {
  if [ -n "${PG_ENV_PASSFILE:-}" ]; then rm -f "$PG_ENV_PASSFILE"; fi
}

pg_env_from_database_url() {
  : "${DATABASE_URL:?DATABASE_URL must be set in the environment}"
  command -v node >/dev/null || { echo "node is required to read DATABASE_URL safely" >&2; return 1; }
  PG_ENV_PASSFILE=$(umask 077 && mktemp "${TMPDIR:-/tmp}/azad-pgpass.XXXXXX")
  local parts
  parts=$(PG_ENV_PASSFILE="$PG_ENV_PASSFILE" node -e '
    const fs = require("fs");
    let u;
    try { u = new URL(process.env.DATABASE_URL); } catch { console.error("DATABASE_URL is not a valid URL"); process.exit(2); }
    if (!/^postgres(ql)?:$/.test(u.protocol)) { console.error("DATABASE_URL must start with postgres:// or postgresql://"); process.exit(2); }
    const dec = (s) => decodeURIComponent(s);
    const host = u.searchParams.get("host") || u.hostname.replace(/^\[(.*)\]$/, "$1") || "localhost";
    const port = u.port || "5432", user = dec(u.username), pass = dec(u.password), db = dec(u.pathname.replace(/^\//, ""));
    if (!user || !db) { console.error("DATABASE_URL must name a user and a database"); process.exit(2); }
    for (const v of [host, port, user, db]) if (/[\n\r]/.test(v)) { console.error("DATABASE_URL contains a line break"); process.exit(2); }
    const esc = (s) => s.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
    fs.writeFileSync(process.env.PG_ENV_PASSFILE, [host, port, db, user, pass].map(esc).join(":") + "\n", { mode: 0o600 });
    process.stdout.write([host, port, user, db].join("\n") + "\n");
  ') || { pg_env_cleanup; return 1; }
  PGHOST=$(printf '%s\n' "$parts" | sed -n 1p)
  PGPORT=$(printf '%s\n' "$parts" | sed -n 2p)
  PGUSER=$(printf '%s\n' "$parts" | sed -n 3p)
  PGDATABASE=$(printf '%s\n' "$parts" | sed -n 4p)
  export PGHOST PGPORT PGUSER PGDATABASE
  export PGPASSFILE="$PG_ENV_PASSFILE"
  unset PGPASSWORD PGSERVICE PGSERVICEFILE PGOPTIONS
}
