# Feature Evaluation Criteria

Use this checklist before marking any feature as complete. Run through each section relevant to the feature type.

---

## 1. Code Quality

- [ ] **No TypeScript errors** - `npx tsc --noEmit` passes
- [ ] **No ESLint warnings** - `npm run lint` passes
- [ ] **No console.log in production code** - only console.error for actual errors
- [ ] **No hardcoded secrets** - all credentials in .env
- [ ] **No TODO/FIXME left behind** - resolve or document in tasks/todo.md
- [ ] **Functions < 50 lines** - extract helpers if longer
- [ ] **Consistent naming** - camelCase for functions, PascalCase for components

---

## 2. API Endpoints

- [ ] **Returns proper status codes** - 200/201 success, 400 bad request, 401 unauthorized, 500 error
- [ ] **Validates input** - check required fields, types, formats
- [ ] **Handles errors gracefully** - try/catch with meaningful error messages
- [ ] **Rate limiting considered** - for public endpoints
- [ ] **Auth check if needed** - verify user has access
- [ ] **Tested with curl** - verify manually before deploy
- [ ] **Response shape documented** - types match actual response

**Test template:**
```bash
# Success case
curl -s "https://tools.govcongiants.org/api/[endpoint]" | jq .

# Error case (missing param)
curl -s "https://tools.govcongiants.org/api/[endpoint]" | jq .

# Auth check (if applicable)
curl -s "https://tools.govcongiants.org/api/[endpoint]?email=unauthorized@test.com" | jq .
```

---

## 3. Database Changes

- [ ] **Migration SQL tested locally** - run in Supabase SQL editor
- [ ] **Indexes added for query patterns** - check WHERE/JOIN columns
- [ ] **RLS policies configured** - if table has user data
- [ ] **Default values set** - for new columns
- [ ] **Backward compatible** - existing data still works
- [ ] **Migration file saved** - in `src/lib/supabase/`

**Verify schema:**
```sql
-- Check table structure
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = '[table_name]';

-- Check indexes
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = '[table_name]';
```

---

## 4. UI Pages

- [ ] **Mobile responsive** - test at 375px width
- [ ] **Loading states** - show spinner/skeleton while fetching
- [ ] **Error states** - display user-friendly error messages
- [ ] **Empty states** - handle zero results gracefully
- [ ] **Form validation** - client-side before submit
- [ ] **Keyboard accessible** - tab navigation works
- [ ] **Consistent styling** - matches GovCon Giants design system
- [ ] **No layout shift** - content doesn't jump on load

**Design system colors:**
- Primary blue: `#1e3a8a`
- Purple accent: `#7c3aed`
- Success green: `#10b981`
- Error red: `#dc2626`

**Test checklist:**
- [ ] Chrome desktop
- [ ] Chrome mobile (DevTools)
- [ ] Safari (if available)
- [ ] Dark mode (if applicable)

---

## 5. Email Templates

- [ ] **Renders in Gmail** - test with real send
- [ ] **Renders in Outlook** - test with real send
- [ ] **Mobile friendly** - single column, large tap targets
- [ ] **Links work** - all CTAs point to correct URLs
- [ ] **Unsubscribe link** - at bottom of all marketing emails
- [ ] **No broken images** - use absolute URLs
- [ ] **Plain text fallback** - for email clients that block HTML

**Test command:**
```bash
curl -X POST "https://tools.govcongiants.org/api/admin/send-test-email?email=[your-email]&template=[template-name]&password=galata-assassin-2026"
```

---

## 6. Briefing Generators

- [ ] **Returns data** - not null/empty for test user
- [ ] **Performance < 10s** - total generation time
- [ ] **Handles no data gracefully** - returns appropriate message
- [ ] **Saves to database** - briefing_log entry created
- [ ] **Email template generates** - HTML output is valid
- [ ] **Personalization works** - uses user's NAICS/agencies
- [ ] **All sections populated** - no empty sections in output

**Test command:**
```bash
curl -s "https://tools.govcongiants.org/api/admin/generate-[type]-briefing?email=test@example.com&password=galata-assassin-2026&format=full" | jq '.briefing | keys'
```

---

## 7. Stripe/Payment Integration

- [ ] **Test mode first** - use Stripe test keys
- [ ] **Webhook signature verified** - don't process unsigned webhooks
- [ ] **Idempotent** - same event twice doesn't double-grant
- [ ] **All access granted** - KV + Supabase flags + email sent
- [ ] **Error logging** - failed webhooks logged for debugging
- [ ] **Customer email captured** - for order lookup

**Test webhook:**
```bash
stripe trigger checkout.session.completed --add checkout_session:customer_email=test@example.com
```

---

## 8. Security

- [ ] **No SQL injection** - use parameterized queries
- [ ] **No XSS** - sanitize user input in HTML
- [ ] **Admin endpoints protected** - require password param
- [ ] **Sensitive data not logged** - no passwords/tokens in console
- [ ] **CORS configured** - if API called from other domains
- [ ] **Rate limiting** - for auth/payment endpoints

---

## 9. Performance

- [ ] **API response < 2s** - for simple queries
- [ ] **Page load < 3s** - initial render
- [ ] **No N+1 queries** - batch database calls
- [ ] **Images optimized** - use Next.js Image component
- [ ] **Lazy loading** - for below-fold content
- [ ] **Caching where appropriate** - KV for expensive lookups

---

## 10. Documentation

- [ ] **CLAUDE.md updated** - if new feature/session
- [ ] **tasks/todo.md updated** - mark items complete
- [ ] **Code comments for complex logic** - not obvious code
- [ ] **API documented** - params, response, errors
- [ ] **Admin endpoints listed** - in CLAUDE.md

---

## Quick Pre-Commit Checklist

Before every `git commit`:

```
[ ] Does it work? (tested manually)
[ ] Does it break anything else? (related features)
[ ] Is the code clean? (no debug code left)
[ ] Is it documented? (CLAUDE.md if needed)
```

---

## Feature-Specific Checklists

### New Tool Page
1. [ ] Page renders at `/[tool-name]`
2. [ ] Access control working (if paid)
3. [ ] Mobile responsive
4. [ ] All buttons/links work
5. [ ] Form validation
6. [ ] Success/error states
7. [ ] Linked from store page

### New API Endpoint
1. [ ] Route file at correct path
2. [ ] Input validation
3. [ ] Error handling
4. [ ] Response type matches TypeScript
5. [ ] Tested with curl
6. [ ] Auth check (if needed)

### New Briefing Type
1. [ ] Types defined
2. [ ] Data aggregator fetches data
3. [ ] Email template generates HTML
4. [ ] Generator orchestrates all steps
5. [ ] Admin endpoint for testing
6. [ ] Integrated into send-briefings cron
7. [ ] Uses smart profile for personalization

### Database Schema Change
1. [ ] Migration SQL written
2. [ ] Migration tested in Supabase
3. [ ] TypeScript types updated
4. [ ] Service functions updated
5. [ ] Existing data handled
6. [ ] Migration file committed

---

*Last Updated: March 17, 2026*
