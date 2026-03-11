Create a new admin endpoint at `/src/app/api/admin/$ARGUMENTS/route.ts`.

Follow the Admin Endpoint Standard from CLAUDE.md:
- Password auth via `?password=` query param (use `ADMIN_PASSWORD` env var with fallback `galata-assassin-2026`)
- GET = read/preview (safe, no side effects)
- POST = execute (writes data), with `?mode=preview` (default) vs `?mode=execute`
- Response shape: `{ success: boolean, message: string, data?: any, errors?: string[] }`
- Use Supabase service role client when DB access needed
- Use `@vercel/kv` when KV access needed
- Include usage/help response when called with no params

The endpoint name is: $ARGUMENTS

Ask me what this endpoint should do, then generate the full route.ts file.
