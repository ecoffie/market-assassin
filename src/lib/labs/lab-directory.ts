/**
 * National lab / FFRDC supplier directory (Eric, 2026-11-28): how a small business sells to a DOE national lab.
 *
 * Static, curated (src/data/national-lab-suppliers.json). Official lab or DOE pages only. Every published field is
 * { value, source_url, retrieved_on }; a field the lab does not publish is { value: null } and reads "not published" —
 * never filled in. No guessed personal emails. Coverage is stated ("N of 17 DOE labs").
 *
 * Why it matters: M&O contractors (e.g. NTESS/Sandia, $44B) report no subawards to FSRS (measured 2026-11-28), so lab
 * buying is invisible in federal award data; the lab's own supplier portal is the channel.
 */
import data from '@/data/national-lab-suppliers.json';

export interface Sourced<T> { value: T | null; source_url: string | null; retrieved_on: string | null }

export interface LabSupplierEntry {
  id: string;
  aliases: string[];
  name: Sourced<string>;
  state: Sourced<string>;
  operator: Sourced<string>;
  operator_uei: Sourced<string>;
  supplier_portal_url: Sourced<string>;
  registration_system: Sourced<string>;
  small_business_goal: Sourced<string>;
  small_business_office: Sourced<string>;
  top_naics: Sourced<string>;
  buying_rules: Sourced<string[]>;
}

export const LAB_FIELDS = [
  'name', 'state', 'operator', 'operator_uei', 'supplier_portal_url', 'registration_system',
  'small_business_goal', 'small_business_office', 'top_naics', 'buying_rules',
] as const;

/** The 17 DOE national laboratories (the denominator for coverage). */
export const DOE_LAB_COUNT = 17;

const DOC = data as { labs: LabSupplierEntry[] };
export const LAB_ENTRIES: readonly LabSupplierEntry[] = DOC.labs;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** "how do I sell to Sandia" → the Sandia entry. Matches id, name or an alias as whole words. */
export function findLabs(query: string): LabSupplierEntry[] {
  const q = ` ${norm(query)} `;
  if (!q.trim()) return [];
  return LAB_ENTRIES.filter((l) =>
    [l.id, l.name.value || '', ...l.aliases].some((k) => { const n = norm(k); return n && q.includes(` ${n} `); }));
}

/** The answer shape for Ask Mindy: entries (unpublished fields marked), plus the coverage statement. */
export function labDirectoryAnswer(query: string | null | undefined): Record<string, unknown> {
  const all = !query || /\b(national )?labs?\b|ffrdc|laboratories/i.test(query) && findLabs(query).length === 0;
  const hits = all ? [...LAB_ENTRIES] : findLabs(query || '');
  const present = (f: Sourced<unknown>) => f.value != null && !(Array.isArray(f.value) && f.value.length === 0);
  return {
    ok: true,
    coverage: `${LAB_ENTRIES.length} of ${DOE_LAB_COUNT} DOE national labs are in this directory (official lab or DOE pages only).`,
    matched: hits.length,
    labs: hits.map((l) => ({
      id: l.id,
      ...Object.fromEntries(LAB_FIELDS.map((k) => {
        const f = l[k] as Sourced<unknown>;
        return [k, present(f) ? { value: f.value, source_url: f.source_url } : { value: null, note: 'not published' }];
      })),
    })),
    rules: [
      'Cite each fact with its source_url. A field marked "not published" is unknown: say the lab does not publish it; never fill it in.',
      'M&O contractors buy through their own supplier portals; these purchases do not appear in SAM.gov or FSRS subaward data.',
      ...(hits.length === 0 && query ? [`No lab in this directory matches "${query}". Say so and state the coverage line.`] : []),
    ],
  };
}

/** Rows (and fields) that carry a value without a source — must be empty. Used by the unit test. */
export function unsourcedFields(entries: readonly LabSupplierEntry[] = LAB_ENTRIES): string[] {
  const bad: string[] = [];
  for (const l of entries) {
    for (const k of LAB_FIELDS) {
      const f = l[k] as Sourced<unknown>;
      const has = f && f.value != null && !(Array.isArray(f.value) && f.value.length === 0);
      if (has && (!f.source_url || !/^https:\/\//.test(f.source_url) || !f.retrieved_on)) bad.push(`${l.id}.${k}`);
    }
  }
  return bad;
}
