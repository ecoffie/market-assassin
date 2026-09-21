# PRD: Mindy Chat v1

**Owner:** Eric Coffie
**Status:** Scoped 2026-05-27, ready to build pending Groq Dev Tier upgrade
**Estimated build:** 3-4 hours start to live
**Why:** Single biggest feature unlock from v1 → v2. Users associate "type a question, get a cited answer" with Claude-tier AI. Without chat, Mindy is a search tool; with chat, Mindy is an agent.

---

## What v1 looks like (90-second user demo)

1. User opens `/app`, clicks "Mindy Chat" in the sidebar Intelligence section.
2. They see an empty chat panel with a few starter prompts:
   - "How do I respond to a Sources Sought?"
   - "What's the difference between 8(a) and HUBZone?"
   - "Find me primes that hold IDIQs with NAVFAC"
   - "Draft me a one-paragraph cap statement intro"
3. User types: *"How do I win an 8(a) construction contract with no past performance?"*
4. Response streams in 2-4 seconds:
   ```
   Three patterns work for first-time 8(a) construction winners, drawn from
   guests on the GovCon Giants podcast:

   1. Start with subcontracting under a prime ASL Construction's owner...
      [→ Episode 326: $4.2M subcontract closed 4 months after going broke]

   2. Lean on mentor-protégé relationships. Episode 187's HUBZone winner...
      [→ Episode 187: HUBZone construction win without primes]

   3. Use simplified acquisition contracts (<$350K) as your past performance ramp.
      Federal agencies sole-source 33% of SAT contracts to 8(a)s with no prior history.
      [→ Strategies-for-Response-to-Sources-Sought-Notice]

   Want me to draft a teaming pitch email for path 1, or pull a list of
   primes with current 8(a) subcontracting plans?
   ```
5. Each cited source is clickable — opens episode page, RAG doc viewer, or relevant Mindy panel.
6. User clicks "draft a teaming pitch email" → Mindy generates it inline.

---

## Build scope — what ships in v1

### A. UI
- New `MindyChatPanel.tsx` (~250 lines), mounted as `'chat'` AppPanel
- Sidebar entry under Intelligence section (top), badge: `AI` (existing convention)
- Layout:
  - Header: "Mindy Chat" + small "powered by your 8-year knowledge base" subtext
  - Empty state: 4 starter prompts as clickable chips
  - Message list (scrolling, auto-scroll to bottom on new message)
  - Input box (textarea, Cmd+Enter to send)
  - Streaming indicator while waiting for response
- Citations: inline as `[→ Episode 326]` styled links that open in side drawer or new tab

### B. Endpoint: `POST /api/app/chat`
- Auth: same `verifyUserOwnsEmail` pattern as other /app/* routes
- Request body:
  ```ts
  {
    email: string;
    message: string;
    sessionId?: string;          // optional — server creates if missing
    conversationHistory?: { role: 'user' | 'assistant', content: string }[];
  }
  ```
- Response: Server-Sent Events stream of:
  ```ts
  { type: 'token', content: string }
  { type: 'citation', source: { title: string, url: string, doc_type: string } }
  { type: 'done', sessionId: string }
  ```

### C. Server pipeline (per message)
1. **Retrieve.** Call existing `retrieveRagContext({ query: message, limit: 8, maxChars: 6000 })`.
   Bonus: also pull vault data via existing `loadUserVault(email)` for personalization.
2. **Augment.** Build system prompt with:
   - Mindy persona (terse, Eric-style voice, NEVER mention Eric by name — exit-strategy rule)
   - Retrieved RAG chunks as context
   - User's vault summary (NAICS, business type, capabilities)
   - Last 6 messages of conversation history for continuity
3. **Stream.** Call Groq Llama 3.3 70B with `stream: true`. Pipe tokens to SSE.
4. **Cite.** After response complete, emit one `{ type: 'citation' }` event per RAG chunk the response leaned on. (Simple heuristic v1: cite every chunk passed to the model that has a doc_title.)
5. **Persist.** Async-write the exchange to `mindy_chat_messages` (fire-and-forget, no blocking).

### D. Storage: `mindy_chat_sessions` + `mindy_chat_messages`
```sql
CREATE TABLE mindy_chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  title TEXT,                    -- auto-generated from first user message
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  message_count INT DEFAULT 0
);

CREATE TABLE mindy_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES mindy_chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,            -- 'user' | 'assistant'
  content TEXT NOT NULL,
  cited_sources JSONB DEFAULT '[]'::jsonb,
  tokens_used INT,
  latency_ms INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### E. Brand & tone constraints
- **Voice:** Mindy — friendly, direct, Eric-style cadence, never says "I'm an AI". When she doesn't know, says "I don't have that info — try X."
- **NO personal attribution:** never name Eric, never say "Eric on...". Cite "Episode 326" not "Eric's episode 326". Exit-strategy rule.
- **Plain language:** no jargon. Federal acronyms (NAICS, OSBP, FAR) are fine; tech jargon (TAL, ICP, ABM) is not.

---

## Out of scope for v1 (explicitly deferred)

- **Tool use / agent loop.** v1 is single-turn RAG. Multi-step agent (BD agent, search SAM live, draft email) is v2 = Mindy Chat v2.
- **Voice input.** Separate feature (#2 in build list).
- **Persistent sidebar with chat history.** v1 has one current session; resumable history is v2.
- **Multi-modal (image upload).** Llama on Groq isn't multimodal; defer until model swap.
- **Inline draft-into-Pursuit actions.** "Draft me a teaming pitch" returns markdown text in v1. Wiring that into a one-click "Add to Pipeline" or "Save to Vault" is v1.1.
- **Streaming citations.** v1 emits citations after the response completes. True streaming citations (showing source as model retrieves it) is v2.

---

## Success metrics (week 1 post-launch)

| Metric | Target |
|---|---|
| % of /app users who try chat at least once | 40% |
| Avg messages per session | 3+ |
| Avg session length (min) | 4+ |
| Cited-source click-through rate | 25% |
| Free → Pro conversion among chat users | 2x baseline |

Track via existing `user_engagement_events` table + new `event_source: 'mindy_chat'`.

---

## Build plan (4 hours)

| Block | Time | What |
|---|---|---|
| 1 | 30 min | Migration: `mindy_chat_sessions` + `mindy_chat_messages` tables. Apply via Supabase SQL editor. |
| 2 | 45 min | Endpoint `/api/app/chat/route.ts`. Server-Sent Events streaming. Hooks into existing `retrieveRagContext()` + `loadUserVault()`. |
| 3 | 90 min | UI: `MindyChatPanel.tsx`. Empty state + message list + input + streaming render + inline citations. |
| 4 | 30 min | Wire into sidebar + `panels/index.tsx` switch. Add `'chat'` to `AppPanel` type. |
| 5 | 45 min | Smoke test live: 10 representative queries (federal acronyms, "find me X", "draft me Y"), tune system prompt + retrieval limits, fix any streaming UI bugs. |

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Rate limits hit during launch | Dev Tier upgrade pre-launch. Add Groq 429 backoff in endpoint. |
| Retrieved context goes stale (transcripts still ingesting) | Acceptable — corpus grows daily. v1 ships against whatever's indexed when launched. |
| Hallucinations in cited sources | System prompt forces "if no source supports this, say you don't have that info." |
| User asks something off-topic (general Q&A) | System prompt scopes Mindy to federal contracting. Out-of-scope queries return "I'm focused on federal contracting — try [X panel] for that." |
| Streaming UI feels janky on slow connections | Show typing indicator + buffer tokens server-side if needed. |

---

## Open questions for Eric

1. **Sidebar placement:** "Mindy Chat" above or below "Today's Intel"? (My recommendation: above — it's the new flagship.)
2. **Chat history visibility:** Show last 5 sessions as a left-rail in v1, or pure single-session? (My recommendation: single-session for v1, history in v1.1.)
3. **Default temperature:** Conservative (0.3) for citations, or warmer (0.6) for personality? (My recommendation: 0.3 — citations matter more than wit.)
4. **Public chat URL:** Should anonymous users be able to try chat as a marketing wedge, or strictly authenticated? (My recommendation: authenticated only for v1, anonymous demo as v1.2 growth move.)

---

*Once Dev Tier is live, this is a one-day ship.*
