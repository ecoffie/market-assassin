/**
 * Shared DB connection-string resolver for one-off migration/setup scripts.
 *
 * NEVER hardcode the Postgres connection string in a script — it leaks through
 * git history (2026-07-09: a plaintext prod password was found committed and
 * had to be rotated). Always read it from the environment.
 *
 * Set DATABASE_URL to the Supabase pooler connection string (Connect →
 * Direct → Transaction pooler, port 6543) in your shell or gitignored
 * .env.local before running any of these scripts.
 */
function getDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'Missing DATABASE_URL env var.\n' +
        'Set it to the Supabase pooler connection string (port 6543) and re-run, e.g.:\n' +
        '  DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-us-east-1.pooler.supabase.com:6543/postgres" node scripts/<script>.js'
    );
    process.exit(1);
  }
  return url;
}

module.exports = { getDatabaseUrl };
