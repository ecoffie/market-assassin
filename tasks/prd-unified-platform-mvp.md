# PRD: Unified Platform MVP

> **Timeline:** 2 weeks (Musk compression)
> **Goal:** Migrate OpenGovIQ to Next.js, ship unified nav, close Laurie

---

## 1. Problem Statement

**Who has this problem?**
- Eric (platform fragmentation)
- 4 OpenGovIQ customers (stuck on Base44)
- Laurie Sayles (wants team access to MI)

**What's the pain?**
- Users navigate 11 separate tools
- OpenGovIQ on separate platform (Base44) with 4 customers
- Can't sell team tier without unified experience
- Laurie waiting to buy

**How do they solve it today?**
- Multiple logins, multiple tabs
- Manual copy/paste between tools

**Evidence this is real:**
- [x] Laurie explicitly asked for Deltek alternative
- [x] 4 OpenGovIQ customers paying monthly
- [x] Eric wants to consolidate

---

## 2. Competitive Context

| Competitor | How They Solve It | Price | Gap We Exploit |
|------------|-------------------|-------|----------------|
| Deltek | Full platform | $29K/yr avg | Too expensive, no daily briefings |
| Unanet | CRM + ERP | $2.5K-$50K/yr | Complex setup, no daily intel |

**Why will users choose us?**
- 80% cheaper
- Daily briefings they don't have
- Simple, works today

---

## 3. Solution

**One-sentence description:**
Users get one unified dashboard with all intelligence tools accessible via sidebar, plus ability to save opportunities to pipeline.

**Which tool does this live in?**
- [x] Market Assassin (tools.govcongiants.org)

**User flow:**
1. User logs in → sees unified dashboard
2. User searches opportunities → clicks "Save to Pipeline"
3. User views pipeline → sees all saved opportunities with contacts

---

## 4. Success Metrics

| Metric | Current | Target | How We Measure |
|--------|---------|--------|----------------|
| Tools feel unified | 0% | 100% | Single sidebar on all pages |
| OpenGovIQ migrated | Base44 | Supabase | Data moved, Base44 off |
| Laurie closed | Waiting | Signed | Contract signed |

**What would make us kill this feature?**
- If Laurie doesn't buy after seeing it
- If 4 OpenGovIQ customers reject migration

---

## 5. Scope

**In scope (MVP):**
- [x] Unified sidebar on all pages
- [x] "Save to Pipeline" button on opportunities
- [x] Simple contacts table
- [x] Migrate contacts + pipeline from Base44
- [x] Turn off Base44

**Out of scope (DELETE per Musk algorithm):**
- AI Workbench (nobody paying)
- Automation engine (we have crons)
- Email integration (use Gmail)
- Activity logs (nobody asked)
- Complex proposal manager (PDF export only later)
- Role-based permissions (shared login first)

**Dependencies:**
- [x] Base44 export access (Eric)
- [ ] Supabase schema (3 tables)

---

## 6. Technical Approach

**Data source(s):**
- Base44 CSV export (contacts, pipeline)
- Existing Supabase tables

**Database tables needed:**
```sql
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  name TEXT,
  email TEXT,
  company TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE pipeline_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  opportunity_id TEXT,
  title TEXT,
  stage TEXT DEFAULT 'tracking',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES contacts(id),
  content TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**UI changes:**
- Add `<UnifiedSidebar />` to layout
- Add "Save to Pipeline" button to opportunity cards
- Add contacts panel to BD Assist

**Estimated effort:**
- [x] Small (< 1 day) - Supabase tables
- [x] Small (< 1 day) - Save to Pipeline button
- [x] Medium (1-3 days) - Unified sidebar
- [x] Small (< 1 day) - Data migration

**Total: ~5 days development**

---

## 7. Execution Plan (2 Weeks)

### Week 1: Build

| Day | Task | Owner | Status |
|-----|------|-------|--------|
| Mon | Export contacts + pipeline from Base44 | Eric | ⬜ |
| Mon | Create 3 Supabase tables | Claude | ⬜ |
| Tue | Import CSV to Supabase | Claude | ⬜ |
| Wed | Add "Save to Pipeline" button | Claude | ⬜ |
| Thu | Add unified sidebar | Claude | ⬜ |
| Fri | Test with 1 OpenGovIQ customer | Eric | ⬜ |

### Week 2: Ship

| Day | Task | Owner | Status |
|-----|------|-------|--------|
| Mon | Fix bugs from feedback | Claude | ⬜ |
| Tue | Add contacts panel to BD Assist | Claude | ⬜ |
| Wed | Migrate remaining 3 customers | Eric | ⬜ |
| Thu | Send Base44 shutdown notice | Eric | ⬜ |
| Fri | Turn off Base44 | Eric | ⬜ |

---

## 8. Go-to-Market

**Pricing impact:**
- [x] Included in existing MI Pro ($149/mo)
- [x] Included in existing bundles

**Marketing angle:**
> "One platform. One login. Everything a BD team needs."

**Launch checklist:**
- [ ] Feature complete and tested
- [ ] 4 OpenGovIQ customers migrated
- [ ] Base44 turned off
- [ ] Laurie demo scheduled

---

## 9. Approval

**Status:** Ready for Review

**Approved by:**

**Ship date:** May 17, 2026 (2 weeks from now)

---

*Created: May 3, 2026*
