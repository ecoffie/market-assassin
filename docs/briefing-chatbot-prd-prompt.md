# Briefing Chatbot PRD Prompt

This is a **prompt you can copy and use** to generate a Product Requirements Document (PRD) for the briefing chatbot. Paste it into a new chat or hand it to a contractor/AI to produce the full PRD.

---

## The Prompt

```
Create a Product Requirements Document (PRD) for a **Briefing Chatbot** — a conversational AI that lets users engage with their personalized Daily GovCon Briefings via messaging platforms (WhatsApp, Telegram, Discord, SMS, etc.), not on our website.

### Critical Distinction
This is NOT a generic chatbot. It is a **personalized briefing assistant** that:
- Responds using the user's own research data (agencies, NAICS codes, opportunities, recompetes, etc.)
- Draws context from their Daily Briefings — the same intelligence they receive via email
- Knows what they care about because we capture their searches across our GovCon tools (Market Assassin, Recompete Tracker, Opportunity Hunter, Contractor Database, Content Reaper)

### Context: Existing System
We already have a Daily Briefings system that:
1. **Captures user searches** across tools → stored in `user_search_history` (tool, search_type, search_value, metadata)
2. **Aggregates into a watchlist** → `user_briefing_profile` with: naics_codes, agencies, zip_codes, keywords, watched_companies, watched_contracts (with frequency weights)
3. **Generates personalized briefings** daily → opportunities, recompetes, contract awards, contractor changes, web intelligence — all filtered by their profile
4. **Delivers via email** (and optionally SMS) — cron at 9 AM UTC
5. **Logs each briefing** → `briefing_log` stores `briefing_content` (JSONB), `briefing_html`, `briefing_sms` — designed for chatbot context

### User Engagement Model
- Users receive their briefing via email/SMS
- They can then **chat with the bot** on the same channel or a linked channel (WhatsApp, Telegram, Discord, etc.)
- The bot answers questions about *their* briefing: "Tell me more about that DHS opportunity," "Why is that recompete urgent?," "What agencies are in my briefing today?"
- The bot can also answer follow-ups: "What NAICS codes am I watching?," "Any new awards for [agency]?," "Summarize my top 3 items"

### PRD Requirements
The PRD should cover:

1. **Product Overview**
   - Vision: Conversational access to personalized GovCon intelligence
   - Target user: GovCon contractors who receive Daily Briefings
   - Success metrics: engagement rate, questions answered, retention

2. **Channel Strategy**
   - Multi-channel support: WhatsApp, Telegram, Discord, SMS (Twilio)
   - User links their messaging identity to their GovCon account (email)
   - Channel preference stored in user profile
   - Consider: Which channels first? (WhatsApp Business API, Telegram Bot API, Discord Slash Commands)

3. **Data & Context Architecture**
   - Primary context: `briefing_log.briefing_content` for the user's most recent briefings (last 7–14 days)
   - Secondary: `user_briefing_profile` (watchlist, preferences)
   - Tertiary: `user_search_history` for "what have I been researching?"
   - Access control: User must be identified (email) and have `access_briefing_chat` or equivalent
   - Data freshness: Briefing content is daily; chatbot should know "as of [date]"

4. **Conversation Capabilities**
   - Answer questions about today's/yesterday's briefing items
   - Explain why an item was included (relevance to their NAICS/agencies)
   - Summarize, compare, drill down ("Tell me more about item #3")
   - Clarify GovCon terms (SAT, recompete, set-aside, etc.) in context
   - Out-of-scope handling: "I can only answer questions about your briefings. For [X], use [tool link]."
   - Proactive: Optional "Want a summary?" when user opens chat after receiving briefing

5. **Technical Architecture**
   - Chat API that: receives message from channel adapter → resolves user identity → fetches briefing context → calls LLM with system prompt + context → returns response → sends via channel
   - System prompt must inject: user's watchlist, briefing items (structured), date scope
   - Token budget: Briefing content can be large; consider summarization or chunking
   - Rate limiting, abuse prevention

6. **Identity & Linking**
   - User links phone/WhatsApp/Telegram/Discord to their GovCon account (email)
   - Verification flow (e.g., code sent to email or channel)
   - Schema: `user_briefing_profile.preferences` or new `user_chat_channels` table

7. **Phased Rollout**
   - Phase 1: Single channel (e.g., WhatsApp or Telegram), email-linked users only
   - Phase 2: Multi-channel, SMS fallback
   - Phase 3: Proactive nudges, richer Q&A (e.g., "What should I bid on?")

8. **Non-Goals (Explicitly Out of Scope)**
   - Generic GovCon Q&A not tied to user's data
   - Chatbot on the website (this is messaging-only)
   - Replacing the email briefing (chat is additive)
   - Real-time data (briefing is daily; chat reflects last briefing)

9. **Dependencies**
   - Existing: `user_briefing_profile`, `briefing_log`, `user_search_history`, briefing generator
   - New: Channel adapters (WhatsApp Business API, Telegram Bot API, etc.), chat API route, LLM integration (Groq/OpenAI)

10. **Open Questions for PRD**
    - Which messaging channel to prioritize?
    - Should chat be included in Federal Help Center ($99/mo) or separate tier?
    - Moderation and content boundaries?
```

---

## Key Data References (for the PRD author)

| Data Source | Location | Purpose |
|-------------|----------|---------|
| User watchlist | `user_briefing_profile` | NAICS, agencies, companies, keywords, zip codes |
| Briefing content | `briefing_log.briefing_content` | Full structured briefing per user per date |
| Search history | `user_search_history` | What user has searched (tool, type, value) |
| Access flag | `user_profiles.access_briefing_chat` | Schema already has this column |
| Delivery prefs | `user_briefing_profile.preferences` | Can extend for channel (WhatsApp, etc.) |

---

## Suggested PRD Output Structure

When you run this prompt, ask the output to follow:

1. Executive Summary
2. Problem & Opportunity
3. User Stories
4. Data & Context Model (with diagram)
5. Channel Integration Specs
6. Conversation Design & Example Flows
7. Technical Architecture
8. Security & Privacy
9. Phased Roadmap
10. Success Metrics & KPIs
11. Appendix: Schema references, API stubs

---

## How to Use This Prompt

1. **Copy the full prompt** (the block above starting with "Create a Product Requirements Document")
2. Paste into a new Cursor chat, Claude, or hand to a product/engineering contractor
3. Optionally attach: `src/lib/supabase/briefings-schema.sql`, `src/lib/briefings/delivery/types.ts`
4. Refine the PRD based on your channel priorities (WhatsApp vs Telegram vs Discord) and pricing decisions
