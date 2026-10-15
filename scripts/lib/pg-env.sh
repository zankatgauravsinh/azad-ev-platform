# shellcheck shell=bash
# Shared by scripts/backup.sh and scripts/restore.sh. Source it, then call pg_env_from_database_url.
#
# Turns $DATABASE_URL (read from the ENVIRONMENT, never from a command-line argument) into libpq
# environment variables plus a temporary password file, so no password appears in any process's
# arguments (`ps`) or in logs:
#   PGHOST, PGPORT, PGUSER, PGDATABASE  — exported (PGSSLMODE too, when the URL sets sslmode)
#   PGPASSFILE                          — a mode-600 temporary file, removed by pg_env_cleanup
# Prisma's ?schema= parameter is ignored. A ?host=/socket/dir parameter selects a Unix socket.
# An ambiguous URL — several hosts, or connection settings repeated as query parameters — is refused, and
# libpq variables already in the environment (PGHOSTADDR, PGSERVICE, …) are cleared so that they cannot
# redirect the connection away from what the URL names.

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
    const fail = (m) => { console.error(m); process.exit(2); };
    const raw = process.env.DATABASE_URL;
    if (!/^postgres(ql)?:\/\//.test(raw)) fail("DATABASE_URL must start with postgres:// or postgresql://");
    const authority = raw.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0];
    if (authority.replace(/^.*@/, "").includes(",")) fail("DATABASE_URL is ambiguous: it names more than one host");
    // A socket URL (postgresql://user:pass@/db?host=/dir) has an empty host, which URL rejects: give it a placeholder.
    let u;
    try { u = new URL(raw.replace(/^(postgres(?:ql)?:\/\/(?:[^@/]*@)?)\//, "$1socket.invalid/")); } catch { fail("DATABASE_URL is not a valid URL"); }
    for (const p of ["hostaddr", "port", "dbname", "user", "password", "passfile", "service", "options", "target_session_attrs"]) {
      if (u.searchParams.has(p)) fail(`DATABASE_URL is ambiguous: it sets "${p}" as a query parameter`);
    }
    const dec = (s) => decodeURIComponent(s);
    const urlHost = u.hostname === "socket.invalid" ? "" : u.hostname.replace(/^\[(.*)\]$/, "$1");
    const qHost = u.searchParams.get("host") || "";
    if (qHost && !qHost.startsWith("/")) fail("DATABASE_URL is ambiguous: ?host= must be a socket directory (an absolute path)");
    if (qHost && urlHost && urlHost !== "localhost") fail(`DATABASE_URL is ambiguous: it names host ${urlHost} and also ?host=${qHost}`);
    const host = qHost || urlHost || "localhost";
    const port = u.port || "5432", user = dec(u.username), pass = dec(u.password), db = dec(u.pathname.replace(/^\//, ""));
    if (!user || !db) fail("DATABASE_URL must name a user and a database");
    const sslmode = u.searchParams.get("sslmode") || "";
    if (sslmode && !["disable", "allow", "prefer", "require", "verify-ca", "verify-full"].includes(sslmode)) fail("DATABASE_URL has an unknown sslmode");
    for (const v of [host, port, user, db]) if (/[\n\r]/.test(v)) fail("DATABASE_URL contains a line break");
    const esc = (s) => s.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
    // Database field "*": the same server and user may open another database (restore.sh creates a new one).
    fs.writeFileSync(process.env.PG_ENV_PASSFILE, [host, port, "*", user, pass].map(esc).join(":") + "\n", { mode: 0o600 });
    process.stdout.write([host, port, user, db, sslmode].join("\n") + "\n");
  ') || { pg_env_cleanup; return 1; }
  unset PGPASSWORD PGSERVICE PGSERVICEFILE PGOPTIONS PGHOSTADDR PGSSLMODE PGTARGETSESSIONATTRS PGREQUIRESSL
  PGHOST=$(printf '%s\n' "$parts" | sed -n 1p)
  PGPORT=$(printf '%s\n' "$parts" | sed -n 2p)
  PGUSER=$(printf '%s\n' "$parts" | sed -n 3p)
  PGDATABASE=$(printf '%s\n' "$parts" | sed -n 4p)
  local sslmode
  sslmode=$(printf '%s\n' "$parts" | sed -n 5p)
  export PGHOST PGPORT PGUSER PGDATABASE
  if [ -n "$sslmode" ]; then export PGSSLMODE="$sslmode"; fi
  export PGPASSFILE="$PG_ENV_PASSFILE"
}

# True when $PGHOST is this machine: a Unix socket directory, localhost, 127.0.0.1 or ::1.
pg_env_host_is_local() {
  case "$PGHOST" in /*|localhost|127.0.0.1|::1) return 0 ;; *) return 1 ;; esac
}
