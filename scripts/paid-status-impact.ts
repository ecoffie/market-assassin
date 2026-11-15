/**
 * Print which accounts change classification under PAID_STATUS_RESOLVER=true.
 * Read-only and offline: reads a FIXTURE file of PaidStatusFacts, never a database.
 *
 *   npx tsx scripts/paid-status-impact.ts [fixture.json]
 *   (default: tests/fixtures/paid-status-impact.fixture.json — synthetic accounts only)
 *
 * The fixture is [{ label, facts }] where facts.now may be an ISO string.
 */
import { readFileSync } from 'fs';
import { impactReport, type ImpactFixture } from '@/lib/entitlements/paid-status-impact';

const path = process.argv[2] || 'tests/fixtures/paid-status-impact.fixture.json';
const raw = JSON.parse(readFileSync(path, 'utf8')) as Array<{ label: string; facts: Record<string, unknown> }>;
const fixtures: ImpactFixture[] = raw.map(({ label, facts }) => ({
  label,
  facts: { ...facts, now: typeof facts.now === 'string' ? Date.parse(facts.now) : (facts.now as number) } as ImpactFixture['facts'],
}));
const rows = impactReport(fixtures);
const changed = rows.filter((r) => r.changed);
console.table(rows.map((r) => ({
  account: r.label, kind: r.kind,
  guard: `${r.guardOld ? 'allow' : 'block'} -> ${r.guardNew ? 'allow' : 'block'}`,
  activationPaid: `${r.activationOld} -> ${r.activationNew}`,
  changed: r.changed ? 'YES' : '',
})));
console.log(`${changed.length} of ${rows.length} accounts change classification.`);
