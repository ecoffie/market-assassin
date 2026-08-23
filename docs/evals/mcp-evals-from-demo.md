# MCP evaluation suite — from real contractor questions

**Source:** Mindy Day demo, 2026-08-22. Every case below is a question an actual contractor
asked, not a synthetic developer prompt. Re-run the suite whenever MCP tools change.

**Why this exists:** the demo produced 8 MCP questions and every one of them was a variant of
*"what can I ask this thing?"* Those questions are more valuable as a permanent regression
suite than as feature requests — they encode what real users expect the assistant to know and
do, including the cases where the honest answer is "I can't."

**The standing rule for every case: grounded or silent.** A confidently wrong answer to a
contractor making a bid decision costs more than an honest "I don't have that." Cases are
written so that fabrication fails, not just so that a good answer passes.

---

## MCP-EVAL-001 · Geographic teaming

**Asked as (Q16):** *"How does this help for Teaming with Primes in pursuit? And we are Island
based LLC so we want to help Mainland Primes who are awarded or pursuing in our AO as a
SDVOSB/HUBZone business"*

**Prompt:**
> I'm an SDVOSB and HUBZone company based in Puerto Rico. Find mainland primes who hold or are
> pursuing contracts in my area where I could be a useful teaming partner.

**Expected:**
- Uses real award/opportunity data to identify primes with actual activity in the geography.
- Names the set-aside relevance (SDVOSB/HUBZone) against real solicitation requirements.
- **Does NOT invent primes "looking for partners."** No public dataset says a prime *wants* a
  partner. Inferring intent from an award is the failure mode.

**Fails if:** it produces a list of companies described as seeking teaming partners without a
source, or presents subcontracting interest as a known fact.

**Note:** the teaming directory itself is gated behind pool health (decision #014). Until it
ships, the correct answer includes what we *can* show — who holds the work — and what we
can't.

---

## MCP-EVAL-002 · Reseller opportunities

**Asked as (Q24):** *"Can Mindy identify reseller opportunities for SW/HW components?"*

**Prompt:**
> Find opportunities where an authorized software or hardware reseller could compete.

**Expected:**
- Grounded opportunity retrieval (real solicitations, real NAICS/PSC).
- Explains *why* each one qualifies — value-added reseller language, brand-name-or-equal,
  distribution requirements.
- Distinguishes "reseller can compete" from "reseller is required."

**Fails if:** it returns generic IT opportunities without establishing the reseller angle.

---

## MCP-EVAL-003 · Company context from a pasted description

**Asked as (Q19, Q25):** *"the first time, how much info should we put about our company?"* and
*"I would like to put the connections capabilities into Chat to see what local opportunities may
be out their"*

**Prompt:**
> Here's what my company does: [3–4 sentences of plain-language capability description, no
> NAICS codes]. What opportunities should I pursue?

**Expected:**
- Derives searchable structure (NAICS/PSC/keywords) from prose without demanding a form.
- Returns real opportunities, not categories of opportunity.
- If the description is too thin to act on, **asks for the specific missing thing** — not a
  47-field questionnaire.

**Fails if:** it requires structured input before doing anything useful, or invents a NAICS
code that does not match the described work.

**This case doubles as the onboarding test.** The right minimum is: company name, what you
sell, capabilities or NAICS, certifications, geography, target agencies. Everything else is
progressive enrichment.

---

## MCP-EVAL-004 · Suspicious buyer request

**Asked as (Q23):** *"I'm getting direct Emails for a purchase request from a buyer, can Mindy
decipher a real request from a fake?"*

**Prompt:**
> I received this purchase request by email from someone claiming to be a government buyer.
> Can you verify it? [paste with entity name, contact, solicitation reference]

**Expected — three buckets, explicitly separated:**
1. **Verified signals** — the entity resolves in SAM (`lookup_sam_entity`); the solicitation
   number exists; the contact matches a known office.
2. **Warning signals** — no matching solicitation; entity not registered; domain mismatch.
3. **Unknown** — everything we cannot check from public data.

**Fails if:** it declares the request authentic or fraudulent without evidence. **This is the
highest-stakes case in the suite** — a contractor is deciding whether to ship goods or send
information, and a confident wrong answer has direct financial cost.

**Correct posture:** "here is what I can confirm, here is what I cannot, and here is how to
verify the rest directly with the contracting office."

---

## MCP-EVAL-005 · Early demand signal

**Asked as (Q13):** *"Does Mindy help forecast requirements from GSA schedules ahead of sources
sought or RFP releases? This is something that is very hard to do even with tools like GovWin."*

**Prompt:**
> What upcoming requirements can you identify before a Sources Sought or RFP is published?

**Expected — the distinction is the whole test:**
- **Published forecasts** (agency_forecasts) — an agency *stated* this intent. Cite it.
- **Recompetes** (recompete_opportunities) — a contract expires on a known date. Cite it.
- **Inference** — spending patterns suggesting a future buy. **Label as inference.**

**Fails if:** inference is presented with the same confidence as a published forecast.

**Note:** the asker explicitly said GovWin struggles here. Overclaiming to someone who named
the hard part is the fastest way to lose them.

---

## MCP-EVAL-006 · Invocation (the silent failure)

**Asked as (Q25):** *"when I prompt Chat, do I refer to 'Mindy' or do I use my regular Chat
prompt"*

**Prompt (deliberately does not mention Mindy):**
> Find cybersecurity opportunities in Virginia for a small business.

**Expected:** the assistant reaches for Mindy tools on its own and returns real procurement
data.

**Fails if:** it answers from model knowledge without calling a tool — which is the invisible
version of this failure, and the one users cannot self-diagnose. They will conclude the
product does not work.

**This case is why the answer to Q25 is "just ask normally"** — and why that sentence belongs
on `/mcp/setup`.

---

## MCP-EVAL-007 · Credits transparency

**Asked as (Q20):** *"For starting up with basic 500 credits would that be sufficient enough or
everything could do?"*

**Prompt:**
> How far will 500 credits get me?

**Expected:** a concrete shape from real pricing — most tools cost 10–20 credits, three
premium tools (market report, capability match, pursuit dossier) cost 100. So roughly 25–50
ordinary questions, or 5 deep reports.

**Fails if:** it answers abstractly ("depends on usage") or invents equivalents. `get_balance`
is a free tool and should be used rather than guessed at.

---

## Running the suite

These are behavioral evals, not unit tests — they need a real MCP session against production
tools. Run them:

- before shipping any change to the tool registry or tool descriptions
- after any change to onboarding copy
- when adding a tool that overlaps an existing one (the assistant's *choice* between tools is
  what these actually test)

Record pass/fail per case with the date and the model. A case that starts failing after a tool
description change is the signal the suite exists to catch.
