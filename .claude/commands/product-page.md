Create a new product/tool page at `/src/app/$ARGUMENTS/page.tsx`.

The page should follow the existing pattern:
- Dark theme (bg-gray-950, gray-900 cards, gray-800 borders)
- Email gate: user enters email → check KV access → show tool or denied state
- Denied state: show price, what's included, CTA to `/store`
- localStorage persistence for email (key: `{tool}_access_email`)
- "Switch account" link to clear localStorage
- "Back to Tools" link to homepage
- Responsive layout (mobile-first)

Ask me for:
1. Tool name and description
2. KV key prefix (for access check)
3. Price and what tier/bundle includes it
4. Main features to show in the denied state CTA

Then generate the full page.tsx with email gate, access check via `/api/briefings/verify` pattern (POST to a verify endpoint), and the tool UI shell.
