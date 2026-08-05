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
    expect((H.deriveHealth(stalled) as { reason: string }).reason).toBe('no next step');
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
