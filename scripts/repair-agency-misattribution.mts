/**
 * POTATO 0 — repair PROVEN agency mis-attributions in the shipped pain-point corpus.
 *
 * SCOPE IS DELIBERATELY TINY. Only records where the GAO title NAMES ITS OWN SUBJECT
 * AGENCY and sits in a different bucket are touched. No fuzzy inference, no error-rate
 * estimate, no global migration (the audit proved automated estimates produce false
 * positives — see docs/strategic-intelligence-core-audit.md).
 *
 * ROOT CAUSE (proven 2026-09-13 by executing the real extractAgenciesFromTitle from
 * src/lib/agency-intelligence/fetchers/govinfo.ts): unanchored substring matching in
 * AGENCY_MAPPINGS, where one title fans out to EVERY matching agency with no primary:
 *     "ICE" => Department of Homeland Security  matches inside "Serv-ICE-s"
 *     "EPA" => Environmental Protection Agency  matches inside "D-epa-rtment"
 * plus a /Department of (\w+)/ fallback that persisted junk keys ("Department of the").
 * Recurrence is prevented by src/lib/strategic-intel/agency-resolver.ts.
 *
 * NOTE: two DB rows (VA<-"FAA's Modernization Program", DHS<-"HHS: Management
 * Challenges") are NOT listed here: they exist in agency_intelligence but never
 * reached the shipped JSON. Repairing the DB is out of scope for Potato 0.
 *
 * Dry-run by default. `--go` writes.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'src/data/agency-pain-points.json';
const GO = process.argv.includes('--go');

/** [bucket to edit, title fragment, action, destination for a move] */
type Repair = { bucket: string; frag: string; action: 'remove' | 'move'; to?: string };

const REPAIRS: Repair[] = [
  // ── The "EPA"-inside-"Department" and fan-out collisions landing on VA ──
  { bucket: 'Department of Veterans Affairs', frag: "Hazardous Waste: Observations on EPA's Cleanup Program", action: 'remove' },
  { bucket: 'Department of Veterans Affairs', frag: "Air Traffic Control: Observations on FAA's Air Traffic Control Modernization", action: 'remove' },
  { bucket: 'Department of Veterans Affairs', frag: 'Department of the Interior: Observations on Performance Plan', action: 'remove' },
  // ── The "ICE"-inside-"Services" collision landing on DHS ──
  { bucket: 'Department of Homeland Security', frag: 'Department of Health and Human Services: Strategic Planning', action: 'remove' },
  { bucket: 'Department of Homeland Security', frag: 'Social Security Administration: SSA Needs to Act Now', action: 'remove' },
  { bucket: 'Department of Homeland Security', frag: 'SSA Customer Service: Broad Service Delivery', action: 'remove' },
  // ── EPA bucket holding other agencies' findings ──
  { bucket: 'Environmental Protection Agency', frag: 'Department of the Interior: Observations on Performance Plan', action: 'remove' },
  { bucket: 'Environmental Protection Agency', frag: 'Department of Health and Human Services: Strategic Planning', action: 'remove' },
  { bucket: 'Environmental Protection Agency', frag: 'Department of the Interior: Year 2000 Computing Crisis', action: 'remove' },
  // ── SEC bucket holding an SSA finding ──
  { bucket: 'Securities and Exchange Commission', frag: 'Social Security Administration: SSA Needs to Act Now', action: 'remove' },
  // ── Junk parse-artifact buckets ──
  { bucket: 'Department of the', frag: 'Department of the Interior: Observations on Performance Plan', action: 'remove' },
  { bucket: 'Department of the', frag: 'Department of the Interior: Year 2000 Computing Crisis', action: 'remove' },
  { bucket: 'Department of Health', frag: 'Department of Health and Human Services: Strategic Planning', action: 'remove' },
  // ── MOVES: these exist NOWHERE else. Removing them would LOSE data. ──
  { bucket: 'Department of Health', frag: 'Department of Health and Human Services: Management Challenges', action: 'move', to: 'Department of Health and Human Services' },
  { bucket: 'Department of Commerce', frag: 'Social Security Administration: Information Technology Challenges', action: 'move', to: 'Social Security Administration' },
];

const doc = JSON.parse(readFileSync(FILE, 'utf8')) as { agencies: Record<string, { painPoints?: string[]; priorities?: string[] }> };
const ag = doc.agencies;

let removed = 0, moved = 0, skipped = 0;
const log: string[] = [];

for (const r of REPAIRS) {
  const list = ag[r.bucket]?.painPoints;
  if (!list) { log.push(`SKIP  bucket missing: ${r.bucket}`); skipped++; continue; }
  const idx = list.findIndex((p) => p.includes(r.frag));
  if (idx === -1) { log.push(`SKIP  not found in ${r.bucket}: ${r.frag.slice(0, 46)}`); skipped++; continue; }

  const [entry] = list.splice(idx, 1);

  if (r.action === 'move') {
    const dest = ag[r.to!];
    if (!dest) { log.push(`SKIP  destination missing: ${r.to}`); list.splice(idx, 0, entry); skipped++; continue; }
    dest.painPoints = dest.painPoints ?? [];
    if (!dest.painPoints.some((p) => p.includes(r.frag))) dest.painPoints.push(entry);
    log.push(`MOVE  ${r.bucket} -> ${r.to}: ${r.frag.slice(0, 44)}`);
    moved++;
  } else {
    log.push(`RM    ${r.bucket}: ${r.frag.slice(0, 50)}`);
    removed++;
  }
}

console.log(log.join('\n'));
console.log(`\n${GO ? 'APPLIED' : 'DRY RUN'} — removed ${removed}, moved ${moved}, skipped ${skipped}`);

if (GO) {
  writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n');
  console.log(`wrote ${FILE}`);
} else {
  console.log('re-run with --go to write');
}
