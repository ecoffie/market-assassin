Check all access for a customer email across KV, Supabase, and Stripe.

Open the check-access admin endpoint in the browser for the given email:

```
https://tools.govcongiants.org/api/admin/check-access?password=galata-assassin-2026&email=$ARGUMENTS
```

This shows:
- All KV access keys (ma, contentgen, ospro, recompete, dbaccess, briefings)
- Supabase user_profiles flags
- Purchase history
- Briefing profile and recent deliveries
- Gap detection (KV vs Supabase mismatches)

Open the URL in the browser using the `open` command. If the email argument is missing, ask for it.
