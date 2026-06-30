# GHL Build Guide — Mindy Win-Back Workflow

**Why this is a guide, not an automation:** GHL has **no API to create workflows** (verified: `POST /workflows/`
returns 404; the v2 API is read/trigger only). Workflows are built in the GHL UI. This walks you through it
click-by-click — ~10 minutes. Email copy lives in `MINDY-WINBACK-SEQUENCE.md`.

**Account:** GHL location `AMkIivLuREYwsX5GhAAL` (the one where the bootcamp alumni live).
**Segment:** tag `mindy-profile-incomplete` (~4,324 contacts).
**Goal:** profile setup. **CTA link everywhere:** `https://getmindy.ai/profile/setup`

---

## STEP 0 — Pre-flight (2 min)

1. Confirm sending domain is authenticated in GHL: **Settings → Email Services → Dedicated Domain**
   (should be `send.getmindy.ai` per your marketing rail). If not verified, do that first or sends will spam-folder.
2. Confirm the segment exists: **Contacts → Smart Lists →** filter by tag `mindy-profile-incomplete` →
   you should see ~4,324.

---

## STEP 1 — Create the workflow

1. Left nav → **Automation → Workflows → + Create Workflow → Start from scratch.**
2. Name it: **`Mindy Win-Back — Profile Setup`**. Save.

---

## STEP 2 — Trigger (who enters)

1. Click **+ Add New Trigger.**
2. Choose **"Contact Tag"** (trigger type: *Contact Tag Updated / Tag Added*).
3. Configure:
   - **Filter:** `Tag` **is** `mindy-profile-incomplete`
4. (Recommended) Click **+ Add filters** → also require **`Tag` is not `mindy-configured`** so anyone
   already set up never enters.
5. Save trigger.

> For the initial blast to the existing ~4,324: after publishing, use **Contacts → Smart List
> (tag = mindy-profile-incomplete) → Bulk Action → "Add to Workflow" → select this workflow.** The
> trigger handles anyone newly tagged later.

---

## STEP 3 — Build the 5 emails with waits

Pattern: **Email → Wait → Email → Wait …** Pull each email's subject/body from `MINDY-WINBACK-SEQUENCE.md`.

| Step | Action | Setting |
|------|--------|---------|
| 1 | **Send Email** | Email 1 (Day 0). From: Eric Coffie / GovCon Giants. Subject A. |
| 2 | **Wait** | 2 days |
| 3 | **Send Email** | Email 2 |
| 4 | **Wait** | 3 days (→ Day 5) |
| 5 | **Send Email** | Email 3 |
| 6 | **Wait** | 4 days (→ Day 9) |
| 7 | **Send Email** | Email 4 |
| 8 | **Wait** | 5 days (→ Day 14) |
| 9 | **Send Email** | Email 5 |

For each **Send Email** step:
- **Subject:** paste Subject A from the doc (use Subject B as an A/B split if you want — GHL: "Add A/B" on the email step).
- **Body:** paste the email body. Replace the `👉 [text]({{SETUP_URL}})` markdown with a real GHL button/link
  → URL `https://getmindy.ai/profile/setup`.
- **Merge field:** the doc's `{{first_name}}` → GHL's `{{contact.first_name}}`.
- **From name / email:** Eric Coffie, an address on `send.getmindy.ai`.

For each **Wait** step: **Add Step → Wait → "Wait for X days."**

---

## STEP 4 — Exit condition (so converters stop getting nudged)

Add this so anyone who sets up their profile mid-sequence drops out:

**Option A (simplest):** At the very top of the workflow, **Settings (gear) → "Remove from this workflow"**
when **tag `mindy-configured` is added.** GHL: add a **Goal / Event trigger** "Contact Tag = mindy-configured"
that jumps to **End** (Goal events pull a contact out as soon as they qualify).

**Option B:** Between each email, add an **If/Else: tag `mindy-configured`? → yes: End; no: continue.**

> For either to fire, re-run the tag sync during the campaign so set-ups get re-tagged:
> `npx tsx scripts/sync-mindy-tags-to-ghl.ts --apply` (a few times over the 2 weeks, or schedule it).
> The script flips configured users — but note the CURRENT script only ADDS `mindy-profile-incomplete`;
> it does not yet add `mindy-configured` or remove the incomplete tag on conversion. See "Gap" below.

---

## STEP 5 — Workflow settings

- **Re-entry:** OFF (a contact shouldn't run twice).
- **Stop on reply / Stop on unsubscribe:** ON.
- **Sending window:** business hours, contact timezone if available.
- **Save → Publish.**

---

## STEP 6 — Launch (recommended: test first)

Per the sequence doc's test option:
1. **First send Email 1 only** to a slice (or all) and watch open rate for 24–48h.
2. Healthy opens (warm alumni should open well) → enroll the full segment (Step 2 bulk action).
3. Soft opens → trim to 2–3 emails to protect `send.getmindy.ai` reputation before blasting all 5.

---

## Gap to close for the exit condition to fully work (optional follow-up)

The tag-sync script (`scripts/sync-mindy-tags-to-ghl.ts`) currently tags `mindy-profile-incomplete` only.
For Step 4's exit to fire automatically, it should ALSO:
- tag `mindy-configured` (and remove `mindy-profile-incomplete`) when a user's profile becomes custom.

That's a ~10-line change to the runner (the `removeTagFromContact` + `addTagToContact` for the configured
branch already exist in `src/lib/ghl/tag-sync.ts`). Ask me to add a `--bidirectional` mode and I'll wire it.
Until then, the exit condition just won't have anything to fire on — harmless, the sequence still completes.

---

*Created 2026-06-30. GHL has no workflow-create API — this is the manual build path. Copy lives in
MINDY-WINBACK-SEQUENCE.md.*
