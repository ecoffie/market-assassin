/**
 * Pursuits page — the GROUNDED derivation helpers (Eric 2026-08-05, from the approved mockup).
 *
 * The page shows health / progress / weighted-pipeline / groups that user_pipeline doesn't STORE —
 * they are DERIVED from real columns (stage, win_probability, response_deadline, next_action_date,
 * priority). Eric's rule: every number traces to a real field or a clearly-labeled derivation, never
 * a fabricated value. This locks those derivation functions so a refactor can't silently change what
 * "At Risk" or "$21.7M weighted" means.
 *
 * The helpers live in route.ts's client <script> as a TS template literal (so \\u / \\$ are escaped
 * one level). We extract each function body, un-escape the template level, and eval it — the SAME
 * technique the drawer-parity test uses — so the test tracks the SHIPPED source, not a copy.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, 'pursuits/route.ts'), 'utf8');

// Pull `function <name>(...) { ... }` out of the template literal, brace-matched, and un-escape the
// one template-literal level (\\u -> \u, \\$ -> \$, \\. -> \., \\d -> \d, etc. — i.e. \\ -> \).
function extract(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing ${name}`);
  const open = src.indexOf('{', start);
  let depth = 0;
  let i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  return src.slice(start, i).replace(/\\\\/g, '\\');
}

// Build a sandbox with the helpers + the tiny date scaffolding they reference (DAY, startOfToday,
// parseDate). We pin "today" to a fixed date so relative-date assertions are deterministic.
function buildHelpers(todayISO: string) {
  const scaffold = `
    var DAY = 86400000;
    var __TODAY = new Date('${todayISO}T00:00:00');
    function startOfToday(){ return new Date(__TODAY.getFullYear(), __TODAY.getMonth(), __TODAY.getDate()); }
  `;
  const names = ['parseMoney', 'fmtMoney', 'stageProb', 'stageProgress', 'stageLabel',
    'parseDate', 'daysUntil', 'isActive', 'isNeedsAttention', 'deriveHealth', 'weightedValue',
    'humanizeAction'];
  // humanizeAction references a top-level `var ACTION_KEY_LABELS = {...}` outside its own body;
  // pull that literal in too so the extracted function resolves it.
  const keyLabels = src.slice(src.indexOf('var ACTION_KEY_LABELS='),
    src.indexOf('};', src.indexOf('var ACTION_KEY_LABELS=')) + 2).replace(/\\\\/g, '\\');
  const body = scaffold + keyLabels + '\n' + names.map(extract).join('\n') + `\n; return { ${names.join(', ')} };`;
  // eslint-disable-next-line no-new-func
  return new Function(body)() as Record<string, (...a: unknown[]) => unknown>;
}

const H = buildHelpers('2026-08-05');

describe('parseMoney / fmtMoney — real value strings, no fabrication', () => {
  it('parses $X.XM / $XXXK / plain numbers', () => {
    expect(H.parseMoney('$6.2M')).toBe(6_200_000);
    expect(H.parseMoney('$1.8M')).toBe(1_800_000);
    expect(H.parseMoney('$900K')).toBe(900_000);
    expect(H.parseMoney('12500000')).toBe(12_500_000);
    expect(H.parseMoney(4_300_000)).toBe(4_300_000);
    expect(H.parseMoney(null)).toBe(0);          // no value → 0, never a guess
    expect(H.parseMoney('n/a')).toBe(0);
  });
  it('formats dollars back to compact labels', () => {
    expect(H.fmtMoney(48_200_000)).toBe('$48.2M');
    expect(H.fmtMoney(900_000)).toBe('$900K');
    expect(H.fmtMoney(1_800_000_000)).toBe('$1.8B');
    expect(H.fmtMoney(0)).toBe('—');        // nothing → em-dash, not $0
  });
});

describe('weightedValue — uses REAL win_probability, stage default only as labeled fallback', () => {
  it('uses the stored win_probability when present', () => {
    // $6.2M at a real 60% = $3.72M — the real number wins, NOT the stage default.
    expect(H.weightedValue({ value_estimate: '$6.2M', win_probability: 60, stage: 'bidding' }))
      .toBeCloseTo(3_720_000, 0);
  });
  it('falls back to the stage default only when win_probability is absent', () => {
    // no win_probability → stageProb('pursuing')=40 → $1.8M × .40 = $720k
    expect(H.weightedValue({ value_estimate: '$1.8M', stage: 'pursuing' })).toBeCloseTo(720_000, 0);
  });
  it('never invents a value — $0 value → $0 weighted', () => {
    expect(H.weightedValue({ value_estimate: '', stage: 'bidding', win_probability: 70 })).toBe(0);
  });
});

describe('isNeedsAttention / deriveHealth — grounded in real dates + priority', () => {
  const overdue = { stage: 'bidding', next_action_date: '2026-08-01' };   // action 4d overdue vs 08-05
  const dueSoon = { stage: 'pursuing', response_deadline: '2026-08-07' }; // deadline in 2d
  const critical = { stage: 'tracking', priority: 'critical', next_action: 'call', next_action_date: '2026-09-01' };
  const healthy = { stage: 'pursuing', next_action: 'draft', next_action_date: '2026-09-01', response_deadline: '2026-12-01' };
  const stalled = { stage: 'tracking' };                                  // no action, no dates
  const closed = { stage: 'won', next_action_date: '2020-01-01' };        // past, but not active

  it('flags overdue next action, near deadline, and critical/high priority', () => {
    expect(H.isNeedsAttention(overdue)).toBe(true);
    expect(H.isNeedsAttention(dueSoon)).toBe(true);
    expect(H.isNeedsAttention(critical)).toBe(true);
    expect(H.isNeedsAttention(healthy)).toBe(false);
    expect(H.isNeedsAttention(closed)).toBe(false);   // won/lost/archived are never "needs attention"
  });
  it('deriveHealth returns {level, reason} — level from real signals, reason a grounded phrase', () => {
    // Redesign 2026-08-05: deriveHealth returns an OBJECT so the health chip can show WHY
    // ("At Risk · action overdue"), not just the color. Level semantics are unchanged.
    expect((H.deriveHealth(overdue) as { level: string }).level).toBe('at_risk');
    expect((H.deriveHealth(dueSoon) as { level: string }).level).toBe('at_risk');   // <=3d deadline
    expect((H.deriveHealth(stalled) as { level: string }).level).toBe('stalled');   // tracking, no action, no dates
    expect((H.deriveHealth(healthy) as { level: string }).level).toBe('healthy');
    expect((H.deriveHealth(closed) as { level: string }).level).toBe('healthy');    // inactive → not a risk
    // reason is a real grounded phrase on risk states, empty on healthy (renders "On track").
    expect((H.deriveHealth(overdue) as { reason: string }).reason).toBe('action overdue');
    expect((H.deriveHealth(stalled) as { reason: string }).reason).toBe('no next action');
    expect((H.deriveHealth(healthy) as { reason: string }).reason).toBe('');
  });
});

describe('humanizeAction — an internal action-key enum never renders as the dominant sentence', () => {
  // Real rows carry next_action='request_pursuit_brief' (an internal key leaked into the human
  // field). Since next_action is now the big focal line, a bare snake_case enum must be humanized
  // to a friendly label or suppressed — never shown raw. (Eric 2026-08-05.)
  it('maps known action keys to friendly labels', () => {
    expect(H.humanizeAction('request_pursuit_brief')).toBe('Request a pursuit brief');
    expect(H.humanizeAction('draft_response')).toBe('Draft your response');
    expect(H.humanizeAction('submit_loi')).toBe('Submit letter of intent');
  });
  it('an UNKNOWN snake_case key falls back to empty (→ "No next step set"), never raw', () => {
    expect(H.humanizeAction('some_unknown_key')).toBe('');
    expect(H.humanizeAction('foo_bar_baz')).toBe('');
  });
  it('a genuine human sentence passes through verbatim', () => {
    expect(H.humanizeAction('Call the KO to confirm the site visit')).toBe('Call the KO to confirm the site visit');
    expect(H.humanizeAction('Waiting for amendment')).toBe('Waiting for amendment');
    expect(H.humanizeAction('')).toBe('');
    expect(H.humanizeAction(null)).toBe('');
  });
});

// ── Phase 2 derivations: sectionForAction (Proposal Workspace routing) + the Today's-Priorities
//    ranker. Same extract+eval technique as above, with a sandbox that also pulls the two `var`
//    literals (ACTION_KEY_LABELS, WORK_CATEGORY_LABELS) + MAX_PRIORITIES the functions reference. ──
function pullVar(decl: string): string {
  const i = src.indexOf(decl);
  if (i < 0) throw new Error(`missing ${decl}`);
  const end = src.indexOf(';', i);
  return src.slice(i, end + 1).replace(/\\\\/g, '\\');
}

function buildPhase2(todayISO: string) {
  const scaffold = `
    var DAY = 86400000;
    var __TODAY = new Date('${todayISO}T00:00:00');
    function startOfToday(){ return new Date(__TODAY.getFullYear(), __TODAY.getMonth(), __TODAY.getDate()); }
  `;
  const keyLabels = src.slice(src.indexOf('var ACTION_KEY_LABELS='),
    src.indexOf('};', src.indexOf('var ACTION_KEY_LABELS=')) + 2).replace(/\\\\/g, '\\');
  const wcLabels = src.slice(src.indexOf('var WORK_CATEGORY_LABELS='),
    src.indexOf('};', src.indexOf('var WORK_CATEGORY_LABELS=')) + 2).replace(/\\\\/g, '\\');
  const maxPrio = pullVar('var MAX_PRIORITIES=');
  const names = ['parseDate', 'daysUntil', 'isActive', 'humanizeAction',
    'sectionForAction', 'workspaceHref', 'isProposal',
    'dueThisWeek', 'dueToday', 'priorityFor', 'rankedPriorities', 'priorityLabel'];
  const body = scaffold + keyLabels + '\n' + wcLabels + '\n' + maxPrio + '\n'
    + names.map(extract).join('\n') + `\n; return { ${names.join(', ')} };`;
  // eslint-disable-next-line no-new-func
  return new Function(body)() as Record<string, (...a: unknown[]) => unknown>;
}

const P2 = buildPhase2('2026-08-05');

describe('sectionForAction — fuzzy-match action text to a REAL workspace section key, else null', () => {
  const REAL_KEYS = ['overview', 'compliance', 'outline', 'exec_summary', 'technical', 'management',
    'quality', 'transition', 'risk', 'past_performance', 'pricing', 'teaming', 'attachments', 'final', 'submit'];
  it('maps each documented phrase to its section key', () => {
    expect(P2.sectionForAction('Write the exec summary')).toBe('exec_summary');
    expect(P2.sectionForAction('Draft the executive summary')).toBe('exec_summary');
    expect(P2.sectionForAction('Finish the technical approach')).toBe('technical');
    expect(P2.sectionForAction('tech approach draft')).toBe('technical');
    expect(P2.sectionForAction('Update the staffing plan')).toBe('management');
    expect(P2.sectionForAction('Add key personnel resumes')).toBe('management');
    expect(P2.sectionForAction('Pull past performance references')).toBe('past_performance');
    expect(P2.sectionForAction('Attach CPARS')).toBe('past_performance');
    expect(P2.sectionForAction('Build the pricing workbook')).toBe('pricing');
    expect(P2.sectionForAction('Finalize cost volume')).toBe('pricing');
    expect(P2.sectionForAction('Complete the compliance matrix')).toBe('compliance');
    expect(P2.sectionForAction('Shred the RFP')).toBe('compliance');
    expect(P2.sectionForAction('Draft the outline')).toBe('outline');
    expect(P2.sectionForAction('Line up teaming partners')).toBe('teaming');
    expect(P2.sectionForAction('Find subs')).toBe('teaming');
    expect(P2.sectionForAction('Submit the proposal')).toBe('submit');
  });
  it('returns null on no confident match (→ workspace default, never a wrong section)', () => {
    expect(P2.sectionForAction('Call the KO')).toBeNull();
    expect(P2.sectionForAction('Follow up with the customer')).toBeNull();
    expect(P2.sectionForAction('')).toBeNull();
    expect(P2.sectionForAction(null)).toBeNull();
    expect(P2.sectionForAction(undefined)).toBeNull();
  });
  it('only EVER returns one of the 15 real keys (fuzzed over many phrases)', () => {
    const phrases = ['exec summary', 'technical volume', 'management approach', 'past performance',
      'pricing model', 'compliance shred', 'outline the response', 'teaming agreement', 'submit now',
      'random unrelated text', 'meet the incumbent', 'review the sow', 'nothing here'];
    phrases.forEach((ph) => {
      const k = P2.sectionForAction(ph);
      if (k !== null) expect(REAL_KEYS).toContain(k);
    });
  });
});

describe('workspaceHref — grounded ?pursuit + ?section only when named', () => {
  it('deep-links the section when the action names one', () => {
    expect(P2.workspaceHref({ id: 'abc', next_action: 'Write the exec summary' }))
      .toBe('/opportunity-map/proposal?pursuit=abc&section=exec_summary');
  });
  it('opens the workspace default (no &section) when the action is vague', () => {
    expect(P2.workspaceHref({ id: 'abc', next_action: 'Call the KO' }))
      .toBe('/opportunity-map/proposal?pursuit=abc');
  });
  it('falls back to a bare workspace open when there is no id', () => {
    expect(P2.workspaceHref({ next_action: 'Write the exec summary' }))
      .toBe('/opportunity-map/proposal');
  });
  it('isProposal is true ONLY for work_category==="proposal"', () => {
    expect(P2.isProposal({ work_category: 'proposal' })).toBe(true);
    expect(P2.isProposal({ work_category: 'capture' })).toBe(false);
    expect(P2.isProposal({ work_category: '' })).toBe(false);
    expect(P2.isProposal({})).toBe(false);
  });
});

describe('priorityFor / rankedPriorities — Today’s Priorities ranking, grounded tiers', () => {
  // today pinned to 2026-08-05.
  const needsToday = { stage: 'pursuing', needs_me_today: true, next_action: 'x', next_action_date: '2026-08-20' };
  const dueTodayP = { stage: 'pursuing', response_deadline: '2026-08-05', next_action: 'x' };
  const dueIn3 = { stage: 'pursuing', next_action_date: '2026-08-08', next_action: 'x' };
  const dueIn6 = { stage: 'bidding', response_deadline: '2026-08-11', next_action: 'x' };
  const stalled = { stage: 'tracking' };                          // no action, no dates
  const quiet = { stage: 'pursuing', next_action: 'x', next_action_date: '2026-10-01' }; // no signal
  const closed = { stage: 'won', needs_me_today: true };          // inactive → never appears

  it('assigns the correct tier + grounded reason', () => {
    expect((P2.priorityFor(needsToday) as { tier: number }).tier).toBe(1);
    expect((P2.priorityFor(needsToday) as { reason: string }).reason).toBe('Needs you today');
    expect((P2.priorityFor(dueTodayP) as { tier: number }).tier).toBe(2);
    expect((P2.priorityFor(dueTodayP) as { reason: string }).reason).toBe('Due today');
    expect((P2.priorityFor(dueIn3) as { tier: number }).tier).toBe(3);
    expect((P2.priorityFor(dueIn3) as { reason: string }).reason).toBe('Due in 3 days');
    expect((P2.priorityFor(stalled) as { tier: number }).tier).toBe(4);
    expect((P2.priorityFor(stalled) as { reason: string }).reason).toBe('No next action');
  });
  it('a pursuit with no real signal returns null (never padded)', () => {
    expect(P2.priorityFor(quiet)).toBeNull();
  });
  it('inactive pursuits never rank, even if flagged needs_me_today', () => {
    expect(P2.priorityFor(closed)).toBeNull();
  });
  it('rankedPriorities sorts by tier then soonest date, and lists only ACTIONABLE rows', () => {
    const list = [dueIn6, stalled, needsToday, dueTodayP, dueIn3, quiet, closed];
    const ranked = P2.rankedPriorities(list) as Array<{ pr: { tier: number } }>;
    // quiet + closed drop out, and so does `stalled` (tier 4) — it carries NO next_action, so there
    // is nothing to DO on it today. Today is an action queue, not a list of records (Eric
    // 2026-08-13: "don't populate Today just because you have empty space"); a pursuit with no
    // action belongs in "Waiting on you", which counts exactly that set.
    expect(ranked.map((r) => r.pr.tier)).toEqual([1, 2, 3, 3]);
    // within tier 3, dueIn3 (3 days) precedes dueIn6 (6 days).
    const tier3 = ranked.filter((r) => r.pr.tier === 3) as Array<{ p: unknown; pr: { reason: string } }>;
    expect((tier3[0].pr as { reason: string }).reason).toBe('Due in 3 days');
    expect((tier3[1].pr as { reason: string }).reason).toBe('Due in 6 days');
  });
  it('caps at MAX_PRIORITIES rows', () => {
    const many = [];
    for (let i = 0; i < 20; i++) many.push({ stage: 'pursuing', needs_me_today: true, next_action: 'x' });
    expect((P2.rankedPriorities(many) as unknown[]).length).toBe(8);
  });
});

describe('priorityLabel — the ACTION, because that is what you do', () => {
  // Changed 2026-08-13. It used to lead with the work category, so a queue of real work read as a
  // queue of labels ("Research", "Proposal") and the actual task was demoted to a subtitle. The
  // lead is now the action itself — "Draft your response" — with the category as a quiet qualifier
  // on the list row instead.
  it('leads with the action, even when a category is set', () => {
    expect(P2.priorityLabel({ work_category: 'proposal', next_action: 'Call the KO' })).toBe('Call the KO');
    expect(P2.priorityLabel({ next_action: 'request_pursuit_brief' })).toBe('Request a pursuit brief');
  });
  it('is empty when there is no real action — and such rows never reach Today', () => {
    // The old "Next up" fallback is gone: rankedPriorities admits only rows WITH an action, so a
    // blank label is unreachable by construction rather than papered over with a neutral word.
    expect(P2.priorityLabel({ work_category: 'capture' })).toBe('');
    expect(P2.priorityLabel({ next_action: 'some_unknown_key' })).toBe('');
    expect(P2.rankedPriorities([{ stage: 'pursuing', work_category: 'capture', needs_me_today: true }])).toEqual([]);
  });
});

describe('stage helpers — labels + progress, deterministic', () => {
  it('maps internal stages to the workflow chip labels', () => {
    expect(H.stageLabel('pursuing')).toBe('Capture');
    expect(H.stageLabel('bidding')).toBe('Proposal');
    expect(H.stageLabel('tracking')).toBe('Research');
    expect(H.stageLabel('submitted')).toBe('Submitted');
  });
  it('progress % climbs monotonically with the stage', () => {
    const p = ['tracking', 'pursuing', 'bidding', 'submitted'].map((s) => H.stageProgress(s) as number);
    expect(p).toEqual([15, 40, 70, 100]);
    for (let i = 1; i < p.length; i++) expect(p[i]).toBeGreaterThan(p[i - 1]);
  });
  it('isActive excludes won/lost/archived', () => {
    expect(H.isActive({ stage: 'pursuing' })).toBe(true);
    expect(H.isActive({ stage: 'won' })).toBe(false);
    expect(H.isActive({ stage: 'archived' })).toBe(false);
  });
});

describe('the Next Action modal asks three questions, not five', () => {
  // Eric 2026-08-13: "The modal currently asks the user to make too many decisions to set one
  // action." Category -> Action -> Due. Owner is implicit on a solo account; "Needs me today" was
  // redundant with Due (choosing Today IS needing it today) and is derived on save.
  const src = readFileSync(join(__dirname, 'pursuits/route.ts'), 'utf8');

  it('has no Owner field and no Needs-me-today toggle', () => {
    expect(src).not.toContain('id="naOwner"');
    expect(src).not.toContain('id="naToday"');
    expect(src).not.toContain('Flag this as something to handle today');
  });

  it('still asks the three that matter', () => {
    expect(src).toContain('id="naCats"');    // 1 what kind of work
    expect(src).toContain('id="naAction"');  // 2 what specifically (optional)
    expect(src).toContain('id="naDue"');     // 3 when
  });

  it('derives needs_me_today from the Due choice and sets owner silently', () => {
    expect(src).toContain("needs_me_today:(NA_STATE.dueMode==='today')");
    expect(src).toContain('owner_email:em');
  });
});

describe('the row shows the work CATEGORY, not the colliding stage chip', () => {
  const src = readFileSync(join(__dirname, 'pursuits/route.ts'), 'utf8');

  it('leads the action line with the category', () => {
    // stageLabel maps tracking->"Research" and bidding->"Proposal" — the SAME words the category
    // vocabulary uses — so a stage chip beside a category-driven action looked like contradictory
    // data when it was really two fields sharing four words.
    expect(src).toContain("var label=wcLabel?('<span class=\"row-cat\">'+esc(wcLabel.toUpperCase())+'</span>'):''");
    expect(src).not.toContain("var label='<span class=\"row-nalabel\">Next action</span>'");
  });

  it('drops the stage cell from action rows', () => {
    expect(src).toContain("return '<div class=\"prow\">'+ic+rowMain(p)+healthCell(healthHr)+valueCell(p)+cta(p)+kebab(p)+'</div>'");
    // The two vocabularies still exist separately — this is a DISPLAY fix, not a data change.
    expect(src).toContain("stageLabel(stage){ return ({tracking:'Research'");
  });

  it('never guesses a category it does not have', () => {
    expect(src).toContain('WORK_CATEGORY_LABELS[wcRaw]||');
  });
});

/**
 * The primary CTA must open the WORK, not the bookkeeping (Eric 2026-08-18: "I don't want to set
 * an action, I want to get to the draft stage").
 *
 * Measured before this change: 74 of 79 real pursuits had no next_action, so cta() returned a
 * "Set next action" BUTTON for nearly the whole queue — and the Proposal Workspace was reachable
 * only after filling in that form. The Workspace itself needs neither next_action nor
 * work_category (verified live: a bare stage='tracking' row rendered its real title, 3 attached
 * solicitation documents, a Vault-grounded Executive Summary and 15 sections).
 */
describe('pursuits: the primary CTA opens the draft, not a form', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/app/opportunity-map/pursuits/route.ts'),
    'utf8',
  );
  const ctaFn = src.slice(src.indexOf('function cta(p){'), src.indexOf('function humanizeAction('));

  it('routes a pursuit with NO next_action to the Proposal Workspace', () => {
    expect(ctaFn).toContain('Start draft');
    expect(ctaFn).toContain('workspaceHref(p)');
  });

  it('never makes "Set next action" the primary CTA again', () => {
    // the toll booth: a primary BUTTON that opens the modal instead of the workspace
    expect(ctaFn).not.toMatch(/class="row-cta pri"[^>]*data-setstep/);
  });

  it('keeps a way to set a next action (kebab menu + inline empty state)', () => {
    // demoted, never removed — someone may genuinely want to log a note
    expect(src).toContain('data-kact="setstep"');
    expect(src).toContain('data-setstep=');
  });
});
