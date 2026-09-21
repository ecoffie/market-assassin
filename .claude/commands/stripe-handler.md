Generate a new Stripe webhook handler case block for a new product.

I need the following info (ask if not provided in $ARGUMENTS):
1. Product name (e.g., "AI Proposal Writer")
2. Price (e.g., $297)
3. Stripe metadata key and value (e.g., `tier: proposal_writer`)
4. KV key prefix (e.g., `proposals`)
5. Supabase access flag name (e.g., `access_proposal_writer`)
6. Which email template function to call

Then generate:
1. The webhook case block for `/src/app/api/stripe-webhook/route.ts` (triple-write: Supabase purchases + user_profiles + KV + email)
2. The KV grant in `access-codes.ts` pattern
3. The Supabase flag in `user-profiles.ts` tier mapping
4. The email template function signature for `send-email.ts`

Follow the triple-write pattern from the existing webhook. Never use `continue` after Supabase failures — KV must always execute.
