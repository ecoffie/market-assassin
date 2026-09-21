# Mindy v2 Build List — Claude for Government Contractors

**Status:** Drafted 2026-05-27. Predicated on upgrade to Groq Dev Tier ($25/mo) — without it, items 1, 4, 5, 7, 9 are throughput-blocked.

**Foundation already shipped (v1):**
- RAG library: 1,000+ docs (Eric's 8-year teaching corpus + 743 podcast episodes ingested)
- Profile Vault: persistent user knowledge base
- Pursuit Document Pipeline: auto-ingest SAM resources into Proposal Assist
- Daily alerts + Mindy Insight cards
- **Today's Intel guest lessons (June 2026):** Podcast `key_lessons` on dashboard hero card via pulse vs lesson; `tasks/podcast-highlights-QA.md`
- Proposal Assist v2 with anti-repetition memory + 12 content lenses
- Pipeline Tracker, Teaming CRM, Market Research, Forecast Intelligence

**v2 thesis:** v1 made Mindy a smart search + draft tool. v2 makes Mindy a real-time agent. The corpus + Dev Tier together unlock a different product category.

---

## Tier 1 — Killer features (ship in week 1-2)

### 1. Mindy Chat — RAG-backed Q&A
**Status:** Shipped (v1) — `/app` chat + `podcast-search.ts` episode cards
**Estimated build:** 3-4 hours (initial)
**Dev Tier requirement:** Sustained 30+ RPM across users
**Pitch:** Type a question, get an answer grounded in 8 years of teaching + 743 guest interviews, with citations.

**Why it matters:** Single biggest feature unlock. Users associate "type a question, get a cited answer" with "this is Claude-tier AI." Every other v2 feature is incremental; chat is a different product category.

**Build:**
- New `/app/chat` panel + endpoint `/api/app/chat`
- Streams Groq Llama 3.3 70B responses
- Retrieves from existing RAG library + user's vault + extracted podcast metadata
- Cites episode link / teaching doc / vault entry inline
- Per-session memory; opt-in conversation history saved to `mindy_chat_sessions`

### 2. Voice-input opportunity capture
**Estimated build:** 2 hours
**Dev Tier requirement:** Whisper at 28,800 ASPH
**Pitch:** Hold a button on mobile, talk for 30 seconds — Mindy creates the pipeline row, including agency, contact, NAICS, and deadline.

**Why it matters:** The killer mobile feature. BD reps don't open laptops between meetings. Voice → structured pursuit is the lowest-friction capture surface in federal contracting.

**Build:**
- Mobile-first record button in Pipeline panel
- Whisper transcribes locally-captured audio
- Llama extracts `{agency, opp_type, naics, key_dates, notes}` from transcript
- Pre-fills new pursuit row, user confirms

### 3. Daily AI briefing voice-overs
**Estimated build:** 1 day (incl. TTS provider integration)
**Dev Tier requirement:** None for output; benefits from chat for follow-up Qs
**Pitch:** Your daily Mindy briefing comes as a 3-min audio file. Play it during your commute.

**Why it matters:** Pure differentiator. No competitor has it. "Claude voice mode" for federal contracting. Drives daily engagement.

**Build:**
- ElevenLabs or PlayHT integration for narration
- Daily cron: generate `<audio>` URL alongside email HTML
- Embed audio player in alert email + dashboard
- Stretch: voice-clone Eric from podcast corpus (#12)

### 4. Streaming Proposal Assist
**Estimated build:** 1.5 days
**Dev Tier requirement:** 300K TPM for real-time iteration
**Pitch:** Type feedback, Mindy rewrites in real-time. Drafts feel like a conversation, not a black box.

**Why it matters:** Today's UX: click → wait 8 sec → read → start over. Streaming + iteration is what makes ChatGPT feel like ChatGPT. Same model, different perceived speed.

**Build:**
- Switch existing Proposal Assist v2 endpoints to streaming responses
- New inline "rewrite this section" affordance
- Conversation memory per draft so Mindy doesn't forget earlier context

---

## Tier 2 — High value (ship over weeks 3-6)

### 5. Smart RFP ingest
**Estimated build:** 2-3 days
**Dev Tier requirement:** Handle 30K-token RFPs cleanly
**Pitch:** Upload a 200-page RFP, get the compliance matrix + evaluation factors + page limits + dates + submission rules in 90 seconds.

**Why it matters:** Turns Mindy into a real proposal-management workflow, not a draft tool. Pulls users from one-off drafts into recurring usage.

**Build:** Extends existing pursuit-docs pipeline. Llama extracts structured RFP intel, stores in `pursuit_compliance` table, surfaces in Proposal Assist as section-by-section guardrails.

### 6. Live SAM.gov anomaly detection
**Estimated build:** 2 days
**Dev Tier requirement:** 100K-token daily batch job
**Pitch:** Every morning Mindy reads every new SAM.gov opportunity and flags the 50 most "suspicious wins" — sole-source notices, unusual set-asides, agencies that rarely buy this NAICS.

**Why it matters:** Surfaces what humans miss. The exclusive intel angle that justifies $149/mo.

**Build:** Daily cron, Llama scans 24 hrs of opportunities against historical patterns, writes to `mindy_anomalies` table, surfaces in Today's Intel.

### 7. Multi-step BD agent
**Estimated build:** 1 week
**Dev Tier requirement:** 300 RPM for multi-call agent orchestration
**Pitch:** "Find me 5 prime contractors with offices in Florida who hold IDIQs with the VA expiring in 2026, and draft outreach emails to each based on their public capability statements."

**Why it matters:** This is the "agentic" Claude moment. Multi-tool orchestration that touches USASpending + SAM + contractor DB + vault + draft generator. Today's per-min limits make this impossible.

**Build:** Tool-use loop over existing MCP servers. New `/api/app/agent` endpoint. Streams progress to UI.

### 8. Capability statement from podcast
**Estimated build:** 3 hours
**Dev Tier requirement:** Llama TPM headroom
**Pitch:** "Episode 187's guest won a HUBZone contract using this 3-page format — here's your capability statement modeled on hers."

**Why it matters:** Concrete example > generic template. Uses extracted metadata to match user's profile to winners.

**Build:** New flow in Vault → Cap Statement. Llama selects best-matching guest from `podcast_episode_metadata`, generates cap statement using both vault data and guest's structure.

### 9. Competitor watch agent
**Estimated build:** 1 day
**Dev Tier requirement:** Daily multi-prime scans
**Pitch:** Add Booz Allen + Leidos + SAIC to your watch list. Get a daily summary of every SAM.gov action involving them that affects your pursuits.

**Why it matters:** Catches sub-opportunities and recompetes users would otherwise miss. Defensive moat against churn.

**Build:** `user_competitor_watches` table, daily cron, Llama summarizes activity per watched prime, surfaces in dashboard + email.

---

### 10. Event contact follow-up
**Estimated build:** 2-3 days (MVP)
**Dev Tier requirement:** Pro for auto-send; capture + calendar reminders on Free
**Pitch:** Walk out of an industry day with 15 business cards. Drop them into Mindy — she drafts the follow-up, sends it, and puts the next touch on your calendar. Never lose a contact again.

**Why it matters:** BD is relationships, not just opportunities. Converts Mindy from "find the opp" to "work the relationship that wins it" — the other half of BD. High-ceiling/low-floor, no new surface area.

**Build (reuse, don't add):** extend `user_teaming_partners` (+6 nullable cols: source, met_at, met_on, followup_cadence, followup_paused, last_followup_day); quick-capture in the Teaming/Contacts panel; AI-drafted first email via `callLLM()` grounded in notes; **dispatcher** job `contact-followups` (mirrors `upgrade-drip`, Day 1→7→30→90) via `sendEmail()` from `mail.getmindy.ai`; calendar reminders reuse the launch `.ics`/Google-Calendar helper. Status ≥ responded pauses the cadence. No vercel.json cron.

**Full spec:** [`docs/PRD-event-contact-followup.md`](../PRD-event-contact-followup.md) — incl. 3 open questions (auto-send on Free?, sender deliverability, CAN-SPAM posture).

---

## Tier 3 — Mature platform features (months 2-3)

### 10. Pursuit Brief autofill from meeting transcript
**Estimated build:** 1 day
**Pitch:** Drop a customer-call recording, Mindy extracts every action item and pre-fills 5 pursuit briefs.

**Build:** Whisper → Llama → multi-pursuit upsert.

### 11. Long-form embeddings + semantic search
**Estimated build:** 2 days
**Pitch:** "Find episodes that talk about a similar story arc to mine" — not just keyword match.

**Build:** Add `embedding vector(1536)` column to `mindy_rag_chunks`. Embedding pass via OpenAI (Groq doesn't ship embeddings yet). `retrieveRagContext()` already designed for this swap-in.

### 12. Voice-cloned Mindy host
**Estimated build:** 1 week (ElevenLabs voice training)
**Pitch:** Daily briefings narrated in Eric's voice.

**Why it matters:** Churn drops to near-zero — users hear a familiar coach every morning. Podcast back-catalog has Eric's voice in 743 episodes; we already have the training data.

### 13. Daily SMS via Twilio
**Estimated build:** 1 day
**Pitch:** *"Mindy: 2 RFPs match your profile, deadline Friday. Reply YES to track both."*

**Why it matters:** Lowest-friction product surface. Reply-to-track is one tap.

### 14. Weekly accountability briefings
**Estimated build:** 1 day
**Pitch:** *"Last week you tracked 3 pursuits. You haven't moved them since Tuesday. Bump or archive?"*

**Why it matters:** Mindy as BD coach, not just search tool. Drives weekly engagement.

---

## Sequencing recommendation

**Week 1:** Dev Tier upgrade + #1 Mindy Chat (gets v2 live in a week, every other feature stacks on top)
**Week 2:** #2 Voice input + #4 Streaming Proposal Assist (turns Mindy into a real-time agent)
**Week 3:** #3 Voice-over briefings + #5 RFP ingest (differentiation + workflow depth)
**Week 4-6:** #6 Anomaly detection, #7 BD agent, #8 Cap statement from podcast (defensive moat)
**Month 2-3:** Tier 3 features as growth/retention investments

**Total cost surface (back of envelope):**
- Groq Dev Tier: $25/mo
- ElevenLabs voice (if used): ~$22/mo
- OpenAI embeddings (one-time): ~$50
- Twilio SMS: ~$0.0075/msg
- All-in monthly variable cost at 1,000 active users: ~$200/mo

Pricing math: at $149/mo Pro tier, 1,000 users = $149K/mo revenue, $200/mo variable cost = 99.9% gross margin. The economics are absurd because Groq's pricing is.

---

*Living document — update as features ship or scope changes.*
