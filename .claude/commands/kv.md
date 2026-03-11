Direct Vercel KV operation via admin endpoint.

Parse the arguments and open the appropriate URL:

- `/kv get ma:user@email.com` → open `https://tools.govcongiants.org/api/admin/kv?password=galata-assassin-2026&action=get&key=ma:user@email.com`
- `/kv set briefings:user@email.com true` → open with `&action=set&key=...&value=true`
- `/kv del briefings:user@email.com` → open with `&action=del&key=...`
- `/kv keys ma:*` → open with `&action=keys&pattern=ma:*`
- `/kv scan briefings:*` → open with `&action=scan&pattern=briefings:*` (shows keys + values)

Arguments: $ARGUMENTS

Open the constructed URL in the browser using the `open` command. If no arguments provided, show usage examples.
