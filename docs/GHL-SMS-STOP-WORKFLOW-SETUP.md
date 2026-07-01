# GHL Workflow Setup — Mindy SMS STOP Sync

Syncs an inbound **STOP** reply → our `user_notification_settings.sms_opted_out`
so `pursuit-changes` stops texting that user. GHL/carrier already honor STOP
natively (users are protected regardless); this workflow keeps OUR DB flag in sync.

**Why manual:** GHL has no create-workflow API (`POST /workflows/` → 404) and no
PIT-token webhook registration. Workflow creation is UI-only. Verified 2026-07-01.

**Account:** Govcon EDU (Mindy), Delray Beach FL · **Time:** ~2 min

---

## Steps

1. **`app.gohighlevel.com`** → confirm top-left = **Govcon EDU (Mindy)** →
   sidebar **Automation → Workflows**.
2. **`+ Create Workflow`** → **`Start from Scratch`**. Name: `Mindy SMS STOP Sync`
3. **`+ Add New Trigger`** → **`Customer Replied`**.
   - Name: `SMS reply received`
   - **`+ Add filters`** → **`Reply Channel`** = **`SMS`** → **Save Trigger**
4. **`+`** below trigger → **`Webhook`**:
   - **Method:** `POST`
   - **URL:**
     ```
     https://getmindy.ai/api/webhooks/ghl-inbound-sms?token=A6AXAWjSsvFKQCG6BJguA4xDQjL1fFqZ
     ```
   - **Header:** `Content-Type` = `application/json`
   - **Body (JSON):**
     ```json
     { "phone": "{{contact.phone}}", "message": "{{message.body}}" }
     ```
     (If `{{message.body}}` isn't offered, use GHL's inbound-message-body custom
     value — the webhook also reads `body`/`sms`/`text`.)
   - **Save Action**
5. Toggle **Draft → Publish → Save**.

## Test
Text `STOP` to the Mindy number (**+1 508-290-6692**) → check
`sms_opted_out` flips to `true`:
```
curl -s "https://getmindy.ai/api/briefings/preferences?email=eric@govcongiants.com" | python3 -c "import sys,json;print(json.load(sys.stdin).get('sms_opted_out'))"
```
Then text `START` to restore.

## Endpoint reference
- Route: `src/app/api/webhooks/ghl-inbound-sms/route.ts`
- Secret env: `GHL_INBOUND_WEBHOOK_SECRET` (Vercel prod + .env.local). No/wrong
  token → 401. STOP/UNSUBSCRIBE/CANCEL → opt-out; START/SUBSCRIBE → opt back in.
