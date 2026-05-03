# Feature Pipeline: Idea → Ship

How features move from competitive intel to production. Every feature follows this flow.

---

## Pipeline Stages

```
[INTAKE] → [VALIDATE] → [SPEC] → [BUILD] → [SHIP] → [MEASURE]
```

---

## 1. INTAKE

**Where features come from:**

| Source | Location | Check Frequency |
|--------|----------|-----------------|
| Competitor gaps | `COMPETITIVE-INTEL.md` | Weekly |
| User requests | Support emails, bootcamp feedback | Ongoing |
| SEO opportunities | `~/govcon-funnels/SEO-3-MONTH-PLAN.md` | Weekly |
| Market signals | Reddit, LinkedIn, industry news | Weekly |
| Internal ideas | Slack, session notes | Ongoing |

**Intake format:**
```
Feature: [name]
Source: [competitor gap / user request / SEO / idea]
Evidence: [link to request, review, etc.]
Tool: [which tool this belongs in]
Quick win or strategic: [quick = <1 day, strategic = larger]
```

**Add to:** `tasks/feature-intake.md` (backlog)

---

## 2. VALIDATE

Before writing a PRD, answer:

- [ ] **Is this real?** Do we have evidence 3+ users want this?
- [ ] **Does it steal share?** Which competitor does this hurt?
- [ ] **Does it compound?** Does this make other features more valuable?
- [ ] **Can we ship in <1 week?** If not, can we scope down?

**Kill criteria:**
- No evidence of demand
- Doesn't differentiate from competitors
- Effort > value
- Distracts from core tool improvement

---

## 3. SPEC

**Create PRD:** Copy `PRD-TEMPLATE.md` → `tasks/prd-[feature-name].md`

**Required sections:**
1. Problem statement with evidence
2. Competitive context
3. Solution (user flow, output)
4. Success metrics
5. Scope (MVP, out of scope)
6. Technical approach
7. Go-to-market

**Approval:** Eric reviews, approves, assigns ship date.

---

## 4. BUILD

**Pre-build checklist:**
- [ ] PRD approved
- [ ] Added to `tasks/todo.md` with checkable items
- [ ] Dependencies identified (API keys, schema changes, etc.)

**During build:**
- Mark todos in_progress → completed as you go
- If blocked, update todo and flag immediately
- If scope creeps, stop and update PRD

**Build standards:**
- Follow patterns in `market-assassin/CLAUDE.md`
- Check `tasks/lessons.md` for known pitfalls
- No simulated data in production

---

## 5. SHIP

**Pre-ship checklist:**
- [ ] Feature works end-to-end
- [ ] No console errors
- [ ] Mobile responsive (if UI)
- [ ] Access control working (if gated)
- [ ] Stripe configured (if paid)

**Ship checklist:**
- [ ] Push to main
- [ ] Verify on production URL
- [ ] Update `TOOL-BUILD.md` status
- [ ] Update `MEMORY.md` with session notes
- [ ] Draft announcement (email, social)

**Announce:**
- Email existing users (if relevant)
- LinkedIn post
- Update landing page

---

## 6. MEASURE

**After 1 week:**
- [ ] Check usage metrics (if trackable)
- [ ] Review user feedback
- [ ] Note in `COMPETITIVE-INTEL.md` if this closed a gap

**After 1 month:**
- [ ] Did it move the needle?
- [ ] Keep, iterate, or kill?

---

## Quick Reference: File Locations

| Purpose | File |
|---------|------|
| Competitor tracking | `COMPETITIVE-INTEL.md` |
| Feature backlog | `tasks/feature-intake.md` |
| Active PRDs | `tasks/prd-*.md` |
| Current work | `tasks/todo.md` |
| Roadmap | `market-assassin/TOOL-BUILD.md` |
| SEO plan | `~/govcon-funnels/SEO-3-MONTH-PLAN.md` |
| Lessons | `tasks/lessons.md` |
| Session history | `market-assassin/MEMORY.md` |

---

## Parallel Tracks

Features and SEO work in parallel:

```
TOOLS (market-assassin)          SEO (govcon-funnels)
├── Build features         ←→    ├── Target keywords
├── Ship to tools.gov...         ├── Content/guides
└── Upsell in-app               └── Drive traffic to tools
```

**Synergy examples:**
- SEO targets "cage code lookup" → build free CAGE tool → capture leads → upsell MA
- Competitor review mentions "no teaming" → build teaming feature → write "how to find teaming partners" guide

---

*Last Updated: March 14, 2026*
