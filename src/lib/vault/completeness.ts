/**
 * Vault completeness + past-performance provenance — the two GROUNDED calculations
 * behind the /opportunity-map/vault page.
 *
 * These are extracted as a pure, transport-free module (no fetch, no DOM) so:
 *  1. The map vault page can inline them into its client script, AND
 *  2. They can be unit-tested against the real payload shapes.
 *
 * The completeness calc is a faithful port of VaultPanel.tsx's 7-check meter
 * (`src/components/app/panels/VaultPanel.tsx` — the vaultChecks array). Keep the
 * two in sync: same 7 checks, same order, same "first 3 missing" rule.
 *
 * GROUND RULE: every value here comes from the real /api/app/vault payload. A
 * missing/empty section is a real 0, never a fabricated row. The provenance badge
 * reads the REAL `source` column on user_past_performance — there is NO
 * "SAM-matched" source (that column value does not exist; do not invent it).
 */

export type VaultSection = 'identity' | 'past_performance' | 'capabilities' | 'team' | 'documents';

export interface VaultIdentity {
  legal_name?: string | null;
  uei?: string | null;
  one_liner?: string | null;
  certifications?: string[] | null;
  [k: string]: unknown;
}

export interface VaultPayload {
  identity?: VaultIdentity | null;
  past_performance?: unknown[] | null;
  capabilities?: unknown[] | null;
  team?: unknown[] | null;
  documents?: unknown[] | null;
}

export interface VaultCheck {
  done: boolean;
  label: string;
  section: VaultSection;
}

export interface VaultCompleteness {
  checks: VaultCheck[];
  doneCount: number;
  /** round(doneCount / 7 * 100) */
  pct: number;
  /** the FIRST 3 not-done checks, in check order — drives the "N things left" to-do list */
  missing: VaultCheck[];
  complete: boolean;
}

function nonEmptyStr(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}
function len(v: unknown[] | null | undefined): number {
  return Array.isArray(v) ? v.length : 0;
}

/**
 * The 7 weighted checks (ported verbatim from VaultPanel.tsx):
 *  1. identity.legal_name && identity.uei
 *  2. identity.certifications.length > 0
 *  3. identity.one_liner
 *  4. past_performance.length > 0
 *  5. capabilities.length > 0
 *  6. team.length > 0
 *  7. documents.length > 0
 */
export function computeVaultCompleteness(payload: VaultPayload): VaultCompleteness {
  const id = payload.identity || {};
  const checks: VaultCheck[] = [
    { done: nonEmptyStr(id.legal_name) && nonEmptyStr(id.uei), label: 'Add your legal name + UEI', section: 'identity' },
    { done: len(id.certifications as unknown[]) > 0, label: 'List your certifications', section: 'identity' },
    { done: nonEmptyStr(id.one_liner), label: 'Write your one-liner', section: 'identity' },
    { done: len(payload.past_performance) > 0, label: 'Add past performance', section: 'past_performance' },
    { done: len(payload.capabilities) > 0, label: 'Add capabilities', section: 'capabilities' },
    { done: len(payload.team) > 0, label: 'Add key personnel', section: 'team' },
    { done: len(payload.documents) > 0, label: 'Upload a capability statement', section: 'documents' },
  ];
  const doneCount = checks.filter((c) => c.done).length;
  const pct = Math.round((doneCount / checks.length) * 100);
  const missing = checks.filter((c) => !c.done).slice(0, 3);
  return { checks, doneCount, pct, missing, complete: doneCount === checks.length };
}

/**
 * Past-performance provenance badge, from the REAL `source` column on
 * user_past_performance. The migration defines exactly three source values:
 *   'manual'          -> "Self-added"
 *   'parsed_cap_stmt' -> "From cap statement"
 *   'bulk_upload'     -> "Imported"
 * Anything else (incl. null/undefined) falls back to "Self-added" — the honest
 * default for a hand-entered row. There is deliberately NO "SAM-matched" label:
 * no such source exists, so we never fabricate one.
 */
export function pastPerfProvenanceLabel(source: unknown): string {
  switch (String(source || '').trim()) {
    case 'parsed_cap_stmt':
      return 'From cap statement';
    case 'bulk_upload':
      return 'Imported';
    case 'manual':
    default:
      return 'Self-added';
  }
}

/**
 * Per-KNOWLEDGE-GROUP completeness — the "Identity 100% / Capabilities 40% /
 * Experience 80% / Positioning 20%" breakdown (Eric: "instead of 43%, show me
 * where to improve"). Each group is a set of grounded checks over the REAL
 * payload; pct = round(done/total*100). NOTHING is fabricated — an empty field
 * is a real miss, never a filler value.
 *
 * The four groups mirror the four questions Mindy is really asking:
 *   identity     — "Who are you?"            (legal_name+uei · cage · primary_naics)
 *   capabilities — "What do you do?"         (capabilities · documents/cap-statement)
 *   experience   — "What have you done?"     (past_performance · team · contract_vehicles)
 *   positioning  — "How should Mindy describe you?" (one_liner · elevator_pitch · certifications)
 *
 * Uses the SAME payload the page already fetches — identity.* fields
 * (cage_code, primary_naics, elevator_pitch, contract_vehicles) are real columns
 * on user_identity_profile (migration 20260526_profile_vault.sql).
 */
export type VaultGroupKey = 'identity' | 'capabilities' | 'experience' | 'positioning';

export interface VaultGroup {
  key: VaultGroupKey;
  /** the display title */
  title: string;
  /** the question Mindy is really asking */
  question: string;
  done: number;
  total: number;
  pct: number;
  /** which tab the group's "Teach Mindy ->" jumps to */
  section: VaultSection;
}

export function computeVaultGroups(payload: VaultPayload): VaultGroup[] {
  const id = (payload.identity || {}) as Record<string, unknown>;
  const g = (checks: boolean[]): { done: number; total: number; pct: number } => {
    const total = checks.length;
    const done = checks.filter(Boolean).length;
    return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
  };
  const identity = g([
    nonEmptyStr(id.legal_name) && nonEmptyStr(id.uei),
    nonEmptyStr(id.cage_code),
    len(id.primary_naics as unknown[]) > 0,
  ]);
  const capabilities = g([
    len(payload.capabilities) > 0,
    len(payload.documents) > 0,
  ]);
  const experience = g([
    len(payload.past_performance) > 0,
    len(payload.team) > 0,
    len(id.contract_vehicles as unknown[]) > 0,
  ]);
  const positioning = g([
    nonEmptyStr(id.one_liner),
    nonEmptyStr(id.elevator_pitch),
    len(id.certifications as unknown[]) > 0,
  ]);
  return [
    { key: 'identity', title: 'Identity', question: 'Who are you?', section: 'identity', ...identity },
    { key: 'capabilities', title: 'Capabilities', question: 'What do you do?', section: 'capabilities', ...capabilities },
    { key: 'experience', title: 'Experience', question: 'What have you done?', section: 'past_performance', ...experience },
    { key: 'positioning', title: 'Positioning', question: 'How should Mindy describe you?', section: 'identity', ...positioning },
  ];
}
