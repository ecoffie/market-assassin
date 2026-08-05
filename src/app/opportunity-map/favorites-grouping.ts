/**
 * Saved-inbox grouping + saved-row→card mapping — the PURE logic behind
 * /opportunity-map/favorites (the Decision-Card inbox).
 *
 * The favorites PAGE renders client-side from an inline JS string (route.ts) for zero-hydration
 * speed. This module is the TESTABLE mirror of that string's core decisions — the grouping/priority
 * rule (a row lands in EXACTLY ONE group) and the saved-row→`o` mapping — so a unit test can pin the
 * behavior. Keep the two in sync: any change to groupOf / toO / reasonsFor here or in route.ts must
 * be mirrored (this is the copy-not-extract tradeoff, documented in route.ts).
 *
 * GROUND-IN-REAL-DATA: no fabricated signals. Needs-Attention reasons are ONLY the two we can ground
 * (closing ≤3d + deadline-moved). The cancelled/awarded read-time delta is DEFERRED — there is no
 * snapshot notice_type column on user_saved_opportunities (schema 20260726), so it can't be derived.
 */

/** One persisted DNA strand (a subset of genome.ts's Strand — what the card render reads). */
export interface SavedDnaStrand {
  key: string;
  label: string;
  tone?: 'good' | 'watch' | 'neutral';
  tier?: 1 | 2 | 3;
}

/** The saved row shape returned by GET /api/opportunities/save (hydrated). */
export interface SavedRow {
  notice_id?: string | null;
  id?: string | null;
  title?: string | null;
  agency?: string | null;
  sub_tier?: string | null;
  naics_code?: unknown;
  naics?: unknown;
  set_aside?: string | null;
  set_aside_code?: string | null;
  set_aside_description?: string | null;
  notice_type?: string | null;
  solicitation_number?: string | null;
  response_deadline?: string | null;
  /** the row's OWN snapshot deadline (captured at save time) — for the deadline-moved delta */
  saved_response_deadline?: string | null;
  pop_state?: string | null;
  intel_value_range?: { low?: number; median?: number; high?: number; label?: string } | null;
  opportunity_dna?: SavedDnaStrand[] | null;
  opportunity_dna_keys?: string[] | null;
  estimated_value?: number | null;
}

export type GroupKey = 'attn' | 'soon' | 'watch' | 'closed';

/** The pin-shaped object the copied Decision-Card helpers consume. */
export interface CardO {
  nid: string;
  src: 'SAM' | 'FORECAST';
  title: string;
  agency: string;
  subAgency: string;
  naics: string;
  set: string;
  close: string;
  notice_type: string;
  sol: string;
  loc: string;
  dna: SavedDnaStrand[];
  est: number;
  estLow: number;
  estHigh: number;
  estN: number;
  estRange: string;
}

/** Local-noon anchor for a clean integer day-diff (mirrors template.html's TODAY). */
function todayNoon(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
}

/** Comparable-award count parsed from intel_value_range.label ("62 comparable …" -> 62), else 0. */
export function estComparableCount(vr: SavedRow['intel_value_range']): number {
  const label = vr && typeof vr === 'object' && typeof vr.label === 'string' ? vr.label : '';
  const m = /^\s*(\d{1,6})\s+comparable\b/i.exec(label);
  return m ? parseInt(m[1], 10) : 0;
}

/** FORECAST detection from the persisted genome keys, else notice_type text. */
export function isForecast(r: SavedRow): boolean {
  const keys = Array.isArray(r.opportunity_dna_keys) ? r.opportunity_dna_keys : [];
  if (keys.indexOf('forecast') >= 0) return true;
  const nt = String(r.notice_type || '').toLowerCase();
  return /forecast/.test(nt);
}

/** Coerce a saved row's NAICS (string | ["337121"] | {code} | null) to one clean code string. */
export function naicsCode(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return naicsCode(v[0]);
  if (typeof v === 'object') {
    const o = v as { code?: unknown; value?: unknown };
    return naicsCode(o.code != null ? o.code : o.value);
  }
  const s = String(v).trim();
  return s === '[object Object]' ? '' : s;
}

/** Human set-aside label, FAR-citation trimmed. */
export function setAsideLabel(r: SavedRow): string {
  let s = String(r.set_aside_description || r.set_aside_code || r.set_aside || '').trim();
  s = s.replace(/\s*\(FAR[^)]*\)\s*$/i, '').trim();
  return s;
}

/** Days until the (live) response deadline, or null when undated. */
export function daysLeft(r: SavedRow, now: Date = new Date()): number | null {
  const d = String(r.response_deadline || '').slice(0, 10);
  if (!d) return null;
  return Math.round((new Date(d + 'T12:00:00').getTime() - todayNoon(now).getTime()) / 864e5);
}

/** The deadline MOVED since save (both snapshot + live present and differ). */
export function deadlineMoved(r: SavedRow): boolean {
  const live = String(r.response_deadline || '').slice(0, 10);
  const snap = String(r.saved_response_deadline || '').slice(0, 10);
  if (!live || !snap || live === snap) return false;
  return true;
}

/**
 * The group a saved row belongs to — EXACTLY ONE, by priority:
 *   Needs Attention (closing ≤3d, or deadline moved) > Closed (expired open) > Closing Soon (4–7d)
 *   > Watching (everything else active, incl. forecasts / undated / far-out).
 * FORECAST is never "closed" (no response-deadline semantics) -> Watching unless a delta flags it.
 */
export function groupOf(r: SavedRow, now: Date = new Date()): GroupKey {
  const fore = isForecast(r);
  const d = fore ? null : daysLeft(r, now);
  const moved = !fore && deadlineMoved(r);
  if ((d != null && d >= 0 && d <= 3) || moved) return 'attn';
  if (d != null && d < 0) return 'closed';
  if (d != null && d >= 4 && d <= 7) return 'soon';
  return 'watch';
}

/** Grounded "why it needs attention" reasons (closing-soon + deadline-moved only; no fabrication). */
export function reasonsFor(r: SavedRow, now: Date = new Date()): string[] {
  const out: string[] = [];
  const d = daysLeft(r, now);
  if (d != null && d >= 0 && d <= 3) out.push(d === 0 ? 'Closes today' : d === 1 ? 'Closes in 1 day' : `Closes in ${d} days`);
  if (deadlineMoved(r)) out.push('Deadline moved');
  return out;
}

/** DNA strand read order (mirrors dnaOrder/dnaTop in template.html). */
export function dnaOrder(dna: SavedDnaStrand[]): SavedDnaStrand[] {
  const RANK: Record<string, number> = {
    repeat_buyer: 0, sb_friendly: 1, posts_early: 2, sources_sought: 3, early_cycle: 4,
    recompete: 5, forecast: 6, set_aside: 7, full_open: 8, closes_soon: 9, last_chance: 10,
  };
  const tone: Record<string, number> = { good: 0, watch: 1, neutral: 2 };
  return dna.slice().sort((a, b) => {
    const ra = a.key in RANK ? RANK[a.key] : 50;
    const rb = b.key in RANK ? RANK[b.key] : 50;
    return (a.tier || 1) - (b.tier || 1) || ra - rb || (tone[a.tone || 'neutral'] || 0) - (tone[b.tone || 'neutral'] || 0);
  });
}

/** Top n strand LABELS for the identity line / "Saved because" (empty when no genome). */
export function dnaTop(dna: SavedDnaStrand[] | null | undefined, n: number): string[] {
  if (!dna || !dna.length) return [];
  return dnaOrder(dna).slice(0, n).map((s) => s.label);
}

/** The "Saved because <strand>" line text, or '' when there are no strands (OMIT, never a placeholder). */
export function savedBecause(r: SavedRow): string {
  const top = dnaTop(r.opportunity_dna, 1);
  return top.length ? top[0] : '';
}

/** Map a saved row -> the pin-shaped card object the copied helpers consume. */
export function toO(r: SavedRow): CardO {
  const vr = r.intel_value_range && typeof r.intel_value_range === 'object' ? r.intel_value_range : null;
  const fore = isForecast(r);
  return {
    nid: String(r.notice_id || r.id || ''),
    src: fore ? 'FORECAST' : 'SAM',
    title: r.title || '',
    agency: r.agency || '',
    subAgency: r.sub_tier || '',
    naics: naicsCode(r.naics_code != null ? r.naics_code : r.naics),
    set: setAsideLabel(r),
    close: String(r.response_deadline || '').slice(0, 10),
    notice_type: r.notice_type || '',
    sol: r.solicitation_number || r.notice_id || '',
    loc: r.pop_state || '',
    dna: Array.isArray(r.opportunity_dna) ? r.opportunity_dna : [],
    est: vr && typeof vr.median === 'number' ? vr.median : 0,
    estLow: vr && typeof vr.low === 'number' ? vr.low : 0,
    estHigh: vr && typeof vr.high === 'number' ? vr.high : 0,
    estN: estComparableCount(vr),
    estRange: '',
  };
}
