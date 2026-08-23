/**
 * FAILURE-CLASS REGISTRY — the classes discovered by the 2026-08-23 integrity audit, as data.
 *
 * Eric: "That's not busywork. Every new integrity incident gets classified. Then CI, Platform
 * Health, and coding guidelines can learn from the incident history. You're slowly turning
 * one-off discoveries into institutional knowledge."
 *
 * The prose version (with the full story of each) is
 * `docs/engineering/silent-failure-registry.md`. THIS file is the machine-readable half: a
 * stable id per class, the detector that catches it (or `null` where none exists yet), and the
 * real incident that proves it is not hypothetical.
 *
 * ⚠️ Every entry's `incident` is a MEASURED instance from production, not an example. If you
 * add a class, add the incident that justified it — a class with no incident is a guess.
 *
 * ⚠️ THIS FILE IS EVIDENCE, NOT ARCHITECTURE. It deliberately has NO dependencies and defines
 * no framework. Eric, 2026-08-23: "treat this audit as requirements discovery… when the audit
 * reaches zero unresolved findings — not zero warnings — we will freeze the failure taxonomy
 * and design the Integrity contracts from the evidence." A first attempt at those contracts was
 * written and REVERTED for exactly this reason: it was designed before the evidence was in.
 */

/** Which of the four measurement properties a class violates. */
type MeasurementProperty = 'runs' | 'complete' | 'current' | 'honest';

export interface FailureClass {
  /** Stable id — cite this in commits, ledger rows and incident notes. */
  id: `INT-${string}`;
  name: string;
  /** What it looks like in the wild. */
  signature: string;
  /** The measured production instance that put it in the registry. */
  incident: string;
  /** Which measurement property it violates (null = not a measurement property). */
  violates: MeasurementProperty | null;
  /** The automated check that catches it today, or null if it is still human-only. */
  detector: string | null;
}

export const FAILURE_CLASSES: FailureClass[] = [
  {
    id: 'INT-001',
    name: 'Truncated list treated as complete population',
    signature: 'A capped read (PostgREST returns ≤1,000 rows, no error, no flag) is counted as "all".',
    incident: 'admin/user-breakdown reported 1,000 users when the real figure was 10,667 (10.7×).',
    violates: 'complete',
    detector: 'scripts/audit-api-truncation.mjs',
  },
  {
    id: 'INT-002',
    name: 'Unknown/null converted to zero',
    signature: '`count ?? 0` turns "I could not measure this" into a load-bearing figure.',
    incident: 'cron/snapshot-metrics recorded a real 0 for nine days — 190 emails erased from history.',
    violates: 'honest',
    detector: 'scripts/audit-supabase-errors.mjs (rule B)',
  },
  {
    id: 'INT-003',
    name: 'Missing relation treated as empty population',
    signature: 'A query against a table that does not exist returns count=null, HTTP 204, error=null — NO error at all.',
    incident: 'forecasts?mode=coverage reported success:true with 0 sources / 0.0% / an 80% gap; the real table has 11 sources and 94.5%.',
    violates: 'runs',
    detector: null, // human-only today — see the follow-up in the registry doc
  },
  {
    id: 'INT-004',
    name: 'Legacy classification logic on current data',
    signature: 'A matcher still hunts a shape the product stopped emitting, so everything scores zero.',
    incident: 'admin/feature-usage matched legacy URLs after the app consolidated to /app — 0 views for every feature.',
    violates: 'current',
    detector: null,
  },
  {
    id: 'INT-005',
    name: 'Capped RETURNING payload treated as write count',
    signature: 'UPDATE/upsert affects every matching row, but `.select()` returns ≤1,000 of them; the caller counts the payload.',
    incident: 'The recompete prune under-reported against a 137,186-row candidate set.',
    violates: 'complete',
    detector: null,
  },
  {
    id: 'INT-006',
    name: 'No work performed but operation reports success',
    signature: 'A job is error-free while accomplishing nothing, and returns success:true.',
    incident: 'planner/weekly-digest skipped EVERY user (its table does not exist) and reported success.',
    violates: 'honest',
    detector: null,
  },
  {
    id: 'INT-007',
    name: 'Monitor itself observes an incomplete population',
    signature: 'The guard cannot see the whole population it exists to guard.',
    incident: 'admin/email-guard read ~1,000 of 2,633 daily sends — the over-send monitor under-reported over-senders.',
    violates: 'complete',
    detector: 'scripts/audit-api-truncation.mjs',
  },
  {
    id: 'INT-010',
    name: 'Partial population corrupts ORDERING, not just counts',
    signature:
      'A ranking, recommendation or "top N" is computed over a truncated read. No population ' +
      'figure is displayed, so nothing looks wrong — but the ORDER changed, and the order is ' +
      'what the human acts on.',
    incident:
      'target-market-research ranked agencies by open-opportunity count using 1,000 of 15,065 ' +
      'notices (6.6%). Which agency appeared #1 was decided by whichever rows landed in the ' +
      'first page.',
    violates: 'complete',
    detector: null,
  },
  {
    id: 'INT-011',
    name: 'Truncation BEFORE batching creates a permanently unreachable segment',
    signature:
      'A job reads its audience, truncates, then filters/batches. The rows past the cap are ' +
      'dropped before the batch cursor ever sees them, so re-running NEVER reaches them — ' +
      'unlike ordinary truncation, more runs do not help.',
    incident:
      'weekly-alerts read 1,000 of 2,028 eligible users before dedup+batch (~1,028 never ' +
      'queued on ANY cycle); send-alert-invite did the same with 1,000 of 10,670.',
    violates: 'complete',
    detector: null,
  },
  {
    id: 'INT-008',
    name: 'Diagnostic probe itself invalid',
    signature: 'The measurement tool has the defect it is measuring, so its output is evidence of nothing.',
    incident: 'A probe sampling alert_log hit the same 1,000-row cap; a `curl -w` printed blank and was read as "network blocked".',
    violates: null,
    detector: null,
  },
  {
    id: 'INT-009',
    name: 'Edit command succeeds without semantic change',
    signature: 'A string-replace whose anchor misses writes nothing and exits 0 — the commit says fixed, the file is unchanged.',
    incident: 'aggregate-profiles shipped "fixed" and unchanged (still 1,000 of 1,364); it recurred 3 more times the same day.',
    violates: null,
    detector: 'scripts/verify-edit.mjs',
  },
];

/** Classes with no automated detector — the honest backlog, not a gap to hide. */
export function undetectedClasses(): FailureClass[] {
  return FAILURE_CLASSES.filter((c) => c.detector === null);
}

export function failureClass(id: string): FailureClass | undefined {
  return FAILURE_CLASSES.find((c) => c.id === id);
}
