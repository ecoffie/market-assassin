# PRD — Email-in to Mindy (TripIt-for-Opportunities)

**Status:** v2.0 (net-new infra). The lead v2.0 capability.
**Owner framing (Eric):** "Users get opps from labs / AF / Army / NECO / eBuy —
sources we don't scrape. Like TripIt (`plans@tripit.com`), let them forward any
opportunity into Mindy and have it tracked + managed."

---

## 1. The problem & the play

Mindy only knows **SAM.gov** today. But a real BD team lives across **NIH/DARPA/NSF
labs, AF/Army open solicitations, agency portals, NECO, GSA eBuy** — none of which
Mindy ingests. Users want to **forward any opportunity email into Mindy** and have
it become a tracked pursuit, with the same change-alerts + Proposal Assist as a SAM
opp.

**The model (TripIt):** forward to a Mindy address → it appears in your account.
Zero friction, any source, fully managed.

**Decided shape (June 2026):** a forwarded email → **a tracked Pursuit** (a
`user_pipeline` row), ingested via a **per-user forwarding address**.

---

## 2. What exists to reuse (verified)

| Need | Already in the codebase |
|---|---|
| Pursuit record | `user_pipeline` — has `user_email`, `source`, `external_url`, `title`, `agency`, `response_deadline`, `notice_id`, `notes`, `workspace_id`. A `source='email-in'` row slots right in. |
| Pursuit insert path | `src/app/api/pipeline/route.ts` (POST) — reuse, don't reinvent. |
| Email vendor | **Resend** (primary). A `src/app/api/webhooks/resend/` route ALREADY exists → **Resend Inbound** is the natural choice (no new vendor). |
| Webhook security pattern | `src/app/api/stripe-webhook/route.ts` — signature verify + structured handling. Mirror it. |
| Attachment text extraction | `src/lib/sam/pdf-extract.ts` (`extractPdf/Docx/Txt`). |
| Parse the email body → title/agency/deadline/codes | `src/lib/market/profile-from-text.ts`, `keyword-coverage.ts`, `callLLM({job:'reasoning'})`. |
| User identity | `user_profiles` has `id`, `user_id`, `email`, `tier` — map the forwarding address to a stable **user_id**, not just the From email. |

**Net-new (the actual build):** inbound-email provider config + MX record, an
inbound webhook route, per-user address mapping, spoofing/security, dedup, the
parse→pursuit assembler, and the UI to show a user their address + the imported
pursuits.

---

## 3. Architecture

```
User forwards an opp email  →  track-<userid>@in.getmindy.ai
        │
        ▼  (MX → Resend Inbound → webhook POST)
/api/webhooks/inbound-email
   1. Verify it's really from Resend (signature) — reject otherwise
   2. Resolve recipient address → user_id → user_email   (the mapping)
   3. Verify the FORWARDING sender (anti-spoof — see §5)
   4. Parse: subject + body + attachments
        - LLM extract: title, agency, deadline, source URL, NAICS/PSC
        - pdf-extract any attachments → store text (Vault, linked)
   5. Dedup: same source URL / title+agency already imported? skip.
   6. INSERT user_pipeline { user_email, source:'email-in', title, agency,
        external_url, response_deadline, notice_id:null, notes:<original subject>,
        stage:'tracking' }
   7. Confirm back to the user (email or in-app notification): "Added <title>."
        │
        ▼
Shows in My Pursuits — gets change-alerts + Proposal Assist like any pursuit.
```

### Addressing (per-user)
- **`track-<userid>@in.getmindy.ai`** (or `track+<userid>@getmindy.ai` with plus-
  addressing). The `<userid>` is the stable `user_profiles.user_id`, NOT the email
  — so it maps even if they forward from a different address, and the address is
  shown in their settings ("Your Mindy inbox: …").
- Requires an **MX record** on the inbound subdomain (`in.getmindy.ai`) pointing at
  the provider, + the provider configured to POST to the webhook.

---

## 4. Provider decision (Resend Inbound vs alternatives)
| Option | Pros | Cons |
|---|---|---|
| **Resend Inbound** (recommended) | Already our vendor; one dashboard; `webhooks/resend` route exists | Inbound is newer; confirm attachment + size support |
| SendGrid Inbound Parse | Mature, battle-tested inbound | New vendor + key |
| Postmark Inbound | Clean inbound API | New vendor |
| Cloudflare Email Workers | Cheap, flexible | More glue code; you parse MIME yourself |

**Start with Resend Inbound** (no new vendor). Fall back to SendGrid Inbound Parse
if Resend's inbound attachment handling is insufficient — decide after a spike.

---

## 5. Security (the part that must not be skipped)
Inbound email is an **untrusted, spoofable** entry point that writes to a user's
account. Guardrails:
- **Provider signature verify** — only accept POSTs the provider signed (mirror the
  stripe-webhook verify). Reject everything else.
- **Anti-spoof the forwarder** — the recipient address (`<userid>`) identifies the
  account, but anyone could email it. Require the **From** to be a known address on
  that account (`user_profiles.email` or a user-added "allowed senders" list), OR
  check **SPF/DKIM pass** on the inbound message. If neither, hold the import in a
  "pending review" state in-app rather than auto-creating the pursuit.
- **Attachment limits** — cap size + count; allow only pdf/docx/txt; scan/skip
  anything executable.
- **Rate-limit per user** — prevent a flood (accidental or malicious) from spamming
  the pipeline.
- **No code execution / no link auto-fetch** beyond the source URL field.

---

## 6. Edge cases
- **Forwarded chains** ("Fwd: Fwd:") — strip quoting; extract the innermost opp.
- **No clear opp in the email** — create a minimal pursuit from the subject +
  attachments, flag "needs review" rather than dropping it.
- **Duplicate forwards** — dedup by source URL, else title+agency+deadline.
- **Attachments only, empty body** — extract from the attachment (it's often the
  actual solicitation PDF).
- **Multi-recipient / cc** — only the `<userid>` address maps; ignore other To/Cc.

---

## 7. Build phases
1. **Spike** — stand up Resend Inbound on `in.getmindy.ai`, MX record, a webhook that
   logs the raw inbound payload. Confirm attachments arrive.
2. **Mapping + security** — recipient→user_id resolve, signature verify, anti-spoof
   (allowed-senders / SPF-DKIM), pending-review fallback.
3. **Parse→pursuit** — LLM extract + pdf-extract → `user_pipeline` insert (reuse the
   pipeline POST logic). Dedup.
4. **UI** — show the user their forwarding address in settings; an "Imported via
   email" view + the pending-review queue; confirmation notification.
5. **(Optional) attachments → Vault** — store the forwarded docs linked to the
   pursuit (so Proposal Assist can use them).

## 8. Success criteria
- [ ] Forward a real lab/AF/Army solicitation email → a pursuit appears in My
      Pursuits with correct title/agency/deadline/link within ~1 min.
- [ ] A spoofed sender (not on the account) → held in pending-review, NOT
      auto-created.
- [ ] Attachments extracted; the source PDF is readable in the pursuit.
- [ ] Duplicate forward → no duplicate pursuit.
- [ ] Provider signature verified; non-signed POSTs rejected.
- [ ] The user's forwarding address is visible in settings.

## 9. Open decisions for build time
- Auto-create vs always-pending-review for first import from a new sender?
- Address format: `track-<id>@in.getmindy.ai` (subdomain) vs `track+<id>@getmindy.ai`
  (plus-addressing on the root) — depends on what the provider + DNS support cleanly.
- Tier-gate it (Pro-only) or free? (It's a strong Pro feature.)

## 10. Why it's v2.0 not v1.1
Net-new inbound-email plumbing — provider + MX + webhook + spoofing security + the
parse pipeline. Not a wiring change. But it reuses `user_pipeline`, Resend,
`pdf-extract`, and `buildProfileFromText`, so once the infra is up the feature
itself is small.

*Related: `tasks/BACKLOG-later.md` (v2.0 shape), `docs/ROADMAP.md` (v2.0 item A).*
