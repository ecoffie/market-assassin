/**
 * MRR Block 2 — requirement intake + normalizer.
 *
 * One validated JSON/CLI input → one DETERMINISTIC normalized object.
 *
 * The rule that governs every line here: normalize SHAPE, never invent CONTENT.
 * Trimming whitespace and upper-casing a state code is normalization. Filling a
 * blank NAICS with a plausible one is fabrication — and a fabricated NAICS in
 * §5 changes which market a contracting officer believes they surveyed.
 * Absent optional codes therefore stay `undefined` and become `unknown` at the
 * renderer, never an empty string and never a zero.
 *
 * Spec: WEEKEND.md Block 2; mrw-phase1-dev-spec.md §1.
 */
import type { NormalizedRequirement, Requirement } from './types';

export class RequirementValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    const fields = Object.keys(fieldErrors).sort().join(', ');
    super(`Requirement validation failed for: ${fields}`);
    this.name = 'RequirementValidationError';
  }
}

/** Collapse internal whitespace runs and trim. Returns undefined for blank. */
function normText(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length > 0 ? s : undefined;
}

/**
 * NAICS: 2–6 digits. A 6-digit code is exact; 2–5 digits is a prefix.
 * Anything else is rejected rather than coerced — a silently truncated code
 * would survey the wrong market.
 */
export function normalizeNaics(v: unknown): { value?: string; error?: string } {
  const s = normText(v);
  if (!s) return {};
  const digits = s.replace(/[^0-9]/g, '');
  if (digits.length === 0) return { error: `NAICS "${s}" contains no digits` };
  if (digits.length < 2 || digits.length > 6) {
    return { error: `NAICS "${s}" must be 2–6 digits (got ${digits.length})` };
  }
  return { value: digits };
}

/** PSC: 4 alphanumeric characters, upper-cased (e.g. "DA01", "R425"). */
export function normalizePsc(v: unknown): { value?: string; error?: string } {
  const s = normText(v);
  if (!s) return {};
  const c = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c.length !== 4) return { error: `PSC "${s}" must be 4 alphanumeric characters (got ${c.length})` };
  return { value: c };
}

/** US state → 2-letter upper-case code. Only a already-2-letter token is accepted. */
export function normalizeState(v: unknown): { value?: string; error?: string } {
  const s = normText(v);
  if (!s) return {};
  const c = s.toUpperCase().replace(/[^A-Z]/g, '');
  if (c.length !== 2) {
    return { error: `place_of_performance_state "${s}" must be a 2-letter code` };
  }
  return { value: c };
}

/** ISO-8601 date passthrough. Invalid dates are an error, never a silent drop. */
export function normalizeDate(v: unknown, field: string): { value?: string; error?: string } {
  const s = normText(v);
  if (!s) return {};
  const t = Date.parse(s);
  if (Number.isNaN(t)) return { error: `${field} "${s}" is not a parseable date` };
  return { value: new Date(t).toISOString() };
}

/**
 * Validate + normalize. Throws RequirementValidationError with FIELD-SPECIFIC
 * messages (WEEKEND.md Block 2 done-test) rather than a single generic failure.
 */
export function normalizeRequirement(input: Record<string, unknown>): NormalizedRequirement {
  const errors: Record<string, string> = {};
  const notes: string[] = [];

  // --- required fields ---
  const title = normText(input.title);
  const agency = normText(input.agency);
  const keyword = normText(input.keyword);
  const description = normText(input.description);

  if (!title) errors.title = 'title is required and must be a non-empty string';
  if (!agency) errors.agency = 'agency is required and must be a non-empty string';
  if (!keyword) errors.keyword = 'keyword is required and must be a non-empty string';
  if (!description) errors.description = 'description is required and must be a non-empty string';

  // --- optional coded fields: absent stays ABSENT (never "" and never 0) ---
  const naics = normalizeNaics(input.naics);
  if (naics.error) errors.naics = naics.error;
  const psc = normalizePsc(input.psc);
  if (psc.error) errors.psc = psc.error;
  const state = normalizeState(input.place_of_performance_state);
  if (state.error) errors.place_of_performance_state = state.error;

  const popIn = (input.pop ?? {}) as Record<string, unknown>;
  const popStart = normalizeDate(popIn.start, 'pop.start');
  if (popStart.error) errors['pop.start'] = popStart.error;
  const popEnd = normalizeDate(popIn.end, 'pop.end');
  if (popEnd.error) errors['pop.end'] = popEnd.error;

  let estValue: number | undefined;
  if (input.est_value !== undefined && input.est_value !== null && input.est_value !== '') {
    const n = typeof input.est_value === 'number' ? input.est_value : Number(input.est_value);
    if (!Number.isFinite(n)) errors.est_value = `est_value "${String(input.est_value)}" is not a finite number`;
    else if (n < 0) errors.est_value = 'est_value must not be negative';
    else estValue = n;
  }

  if (Object.keys(errors).length > 0) throw new RequirementValidationError(errors);

  // --- normalization notes (they become appendix provenance, not silent edits) ---
  // Compare against the RAW input, not a pre-trimmed copy: `' da01 '` normalizes
  // to `'DA01'`, and comparing trimmed-to-normalized would call that "unchanged"
  // and silently drop the note. The appendix must show every edit we made.
  if (typeof input.naics === 'string' && naics.value && input.naics !== naics.value) {
    notes.push(`naics normalized "${input.naics}" → "${naics.value}"`);
  }
  if (typeof input.psc === 'string' && psc.value && input.psc !== psc.value) {
    notes.push(`psc normalized "${input.psc}" → "${psc.value}"`);
  }
  if (!naics.value) notes.push('naics not supplied — must be DERIVED from grounded coverage evidence');
  if (!psc.value) notes.push('psc not supplied — must be DERIVED from grounded coverage evidence');
  if (normText(input.set_aside_hint)) {
    notes.push('set_aside_hint carried as a HYPOTHESIS only — never rendered as fact');
  }

  const normalized: Requirement = {
    title: title!,
    agency: agency!,
    keyword: keyword!,
    description: description!,
    ...(normText(input.sub_agency) ? { sub_agency: normText(input.sub_agency)! } : {}),
    ...(normText(input.office) ? { office: normText(input.office)! } : {}),
    ...(naics.value ? { naics: naics.value } : {}),
    ...(psc.value ? { psc: psc.value } : {}),
    ...(estValue !== undefined ? { est_value: estValue } : {}),
    ...(popStart.value || popEnd.value
      ? { pop: { ...(popStart.value ? { start: popStart.value } : {}), ...(popEnd.value ? { end: popEnd.value } : {}) } }
      : {}),
    ...(state.value ? { place_of_performance_state: state.value } : {}),
    ...(normText(input.set_aside_hint) ? { set_aside_hint: normText(input.set_aside_hint)! } : {}),
    ...(normText(input.solicitation_number) ? { solicitation_number: normText(input.solicitation_number)! } : {}),
    ...(normText(input.notice_id) ? { notice_id: normText(input.notice_id)! } : {}),
  };

  return { normalized, original: { ...input }, notes };
}
