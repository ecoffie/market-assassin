# GHL SMS STOP Sync

Keeps our `user_notification_settings.sms_opted_out` in sync with a user's real
STOP so `pursuit-changes` stops texting them. **GHL/carrier already honor STOP
natively — users are protected regardless of our flag.**

## How STOP actually syncs (verified 2026-07-01)

**GHL intercepts STOP as a system keyword.** When a user texts STOP, GHL sets the
contact to permanent SMS DND (`dndSettings.SMS = {status:'permanent', message:'STOP_KEYWORD'}`)
and sends the native unsubscribe reply — it does **NOT** fire the "Customer Replied"
workflow for STOP. So a webhook/workflow **cannot** catch STOP. Proven live:
- Contact after STOP: `dndSettings.SMS.status = 'permanent'` (STOP_KEYWORD).
- Sending to that contact returns `400 CONVERSATIONS_MSG_UNSUBSCRIBED_SMS`
  ("Cannot send message as <phone> has unsubscribed").

**The real sync path = self-healing on send.** `sendViaGHL` detects that 400 and
returns `optedOut:true`; `pursuit-changes` then sets `sms_opted_out=true` +
`sms_enabled=false` on the matching row. GHL is the source of truth; our DB
mirrors it the first time we try to text an opted-out user. Zero new infra.

The inbound webhook below still exists and is useful for **non-STOP** control words
(HELP is auto-answered by GHL; a manual "UNSUBSCRIBE"/"CANCEL" typed as a normal
reply, or a "START"/"SUBSCRIBE" re-opt-in) — those DO fire the workflow. STOP does not.

**Why the workflow is manual:** GHL has no create-workflow API (`POST /workflows/`
→ 404) and no PIT-token webhook registration. Workflow creation is UI-only.

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
