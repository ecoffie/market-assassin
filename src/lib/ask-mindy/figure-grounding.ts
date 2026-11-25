/**
 * Intelligence gate, deterministic grounding of figures (2026-11-25). Every dollar amount and calendar date the
 * answer states in free text must appear in the evidence the analyst was given. A figure that does not is named,
 * so the review fails `reasoned` and the bounded retry fixes it (or the answer is disclosed). Counts are left to the
 * evaluator: the analyst legitimately derives them from the group counts.
 *
 * Matching is by VALUE, not spelling: "$1.2 million" matches "$1.2M"; a figure written at a coarser precision
 * matches when the evidence value rounds to it ("$0.4B" for "$426.0M"). A total the analyst added up itself is not
 * in the evidence and is named.
 */
import type { AnalystDecision } from './analyst';

const UNIT: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };
const MONEY_RE = /\$\s?(\d[\d,]*(?:\.\d+)?)\s?(thousand|million|billion|bn|mm|k|m|b)?\b/gi;

interface Money { text: string; num: number; unit: number; decimals: number }

function moneyIn(text: string): Money[] {
  const out: Money[] = [];
  for (const m of text.matchAll(MONEY_RE)) {
    const raw = m[1].replace(/,/g, '');
    const unit = m[2] ? UNIT[m[2].toLowerCase()] : 1;
    out.push({ text: m[0].trim(), num: Number(raw), unit, decimals: (raw.split('.')[1] || '').length });
  }
  return out.filter((x) => Number.isFinite(x.num));
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MON = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const monthNo = (s: string) => MONTHS.findIndex((m) => m.startsWith(s.toLowerCase().slice(0, 3))) + 1;

/** A calendar date as y/m/d; a missing part is null (e.g. "December 2026" has no day, "Dec 4" no year). */
interface CalDate { text: string; y: number | null; m: number; d: number | null }

function datesIn(text: string): CalDate[] {
  const out: CalDate[] = [];
  const taken: Array<[number, number]> = [];
  const add = (idx: number, len: number, v: CalDate) => {
    if (taken.some(([a, b]) => idx < b && idx + len > a)) return;
    taken.push([idx, idx + len]);
    out.push(v);
  };
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})/g)) add(m.index!, m[0].length, { text: m[0], y: +m[1], m: +m[2], d: +m[3] });
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) add(m.index!, m[0].length, { text: m[0], y: +m[3], m: +m[1], d: +m[2] });
  for (const m of text.matchAll(new RegExp(`\\b${MON}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'))) add(m.index!, m[0].length, { text: m[0], y: +m[3], m: monthNo(m[1]), d: +m[2] });
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})\\s+${MON}\\.?,?\\s+(\\d{4})\\b`, 'gi'))) add(m.index!, m[0].length, { text: m[0], y: +m[3], m: monthNo(m[2]), d: +m[1] });
  for (const m of text.matchAll(new RegExp(`\\b${MON}\\.?,?\\s+(\\d{4})\\b`, 'gi'))) add(m.index!, m[0].length, { text: m[0], y: +m[2], m: monthNo(m[1]), d: null });
  // A bare month and day ("Dec 5") counts only with a capitalised month or an abbreviation with a period, so
  // ordinary words ("you may 3 times", "march 2 crews") are never read as dates.
  for (const m of text.matchAll(new RegExp(`\\b${MON}(\\.?)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'gi'))) {
    if (!/^[A-Z]/.test(m[1]) && !m[2]) continue;
    add(m.index!, m[0].length, { text: m[0], y: null, m: monthNo(m[1]), d: +m[3] });
  }
  return out.filter((x) => x.m >= 1 && x.m <= 12 && (x.d === null || (x.d >= 1 && x.d <= 31)));
}

/** The decision's free text (everything the customer reads except the cited contract ids). */
export function decisionText(d: AnalystDecision): string {
  return [
    d.headline,
    ...d.pursuits.flatMap((p) => [p.title, ...p.why, p.barrier || '', p.next_move]),
    ...(d.also_consider || []),
    d.ruled_out,
    ...d.gaps,
    d.next_question,
  ].join('\n');
}

/** Figures stated in the answer that the evidence does not contain (exact text as written, de-duplicated). */
export function ungroundedFigures(decision: AnalystDecision, evidence: string): string[] {
  const text = decisionText(decision);
  const evMoney = moneyIn(evidence).map((x) => x.num * x.unit);
  const evDates = datesIn(evidence);
  const bad = new Set<string>();
  for (const w of moneyIn(text)) {
    const ok = evMoney.some((e) => Number((e / w.unit).toFixed(w.decimals)) === w.num);
    if (!ok) bad.add(w.text);
  }
  for (const w of datesIn(text)) {
    // Every part the answer states (year, month, day) must match one evidence date.
    const ok = evDates.some((e) => e.m === w.m && (w.y === null || e.y === w.y) && (w.d === null || e.d === w.d));
    if (!ok) bad.add(w.text);
  }
  return [...bad];
}
