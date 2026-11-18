/**
 * Data Core PR 3 — SBLO refresh importer.
 *
 * Pins the approved rules (Eric, 2026-11-17):
 *   1. --csv <path> is required; there is no hardcoded June path.
 *   2. Diff mode (the default) writes nothing.
 *   3. Field-level provenance (status / verifiedAt / sourceUrl).
 *   4. A blank never overwrites a populated field; not_named/unreachable keep the value and mark it
 *      stale; `changed` needs a sourceUrl and pushes the old value into history.
 *   5. A verified ROLE mailbox is preferred over a personal email; the personal one is kept internally.
 */
import { describe, it, expect } from 'vitest';
import {
  runSbloImport, mergeSbloContact, parseSbloCsv, diffRoster, type ImporterIO, type RosterContact, type CsvRow,
} from './sblo-refresh';
import { classifyEmailKind } from './sblo-provenance';

const HEADER = [
  'company', 'title', 'source', 'email_kind',
  'sbloName', 'sbloName_status', 'sbloName_verifiedAt', 'sbloName_sourceUrl',
  'email', 'email_status', 'email_verifiedAt', 'email_sourceUrl',
  'phone', 'phone_status', 'phone_verifiedAt', 'phone_sourceUrl',
  'portal', 'portal_status', 'portal_verifiedAt', 'portal_sourceUrl',
].join(',');

type F = { v?: string; s?: string; d?: string; u?: string };
function csvLine(company: string, o: { title?: string; source?: string; kind?: string; sbloName?: F; email?: F; phone?: F; portal?: F }): string {
  const f = (x?: F) => [x?.v ?? '', x?.s ?? '', x?.d ?? '', x?.u ?? ''];
  return [company, o.title ?? '', o.source ?? '', o.kind ?? '', ...f(o.sbloName), ...f(o.email), ...f(o.phone), ...f(o.portal)]
    .map((c) => (c.includes(',') ? `"${c}"` : c)).join(',');
}
function row(company: string, o: Parameters<typeof csvLine>[1]): CsvRow {
  return parseSbloCsv(`${HEADER}\n${csvLine(company, o)}`)[0];
}

const CACI: RosterContact = {
  company: 'CACI INTERNATIONAL INC',
  sbloName: 'Yadira Beltre',
  title: 'Small Business Liaison Officer',
  email: 'yadira.beltre@caci.com',
  phone: '(703) 555-0100',
  supplierPortal: 'https://www.caci.com/small-business-advocacy-office',
  source: 'Jun 2026 research',
};
const NG: RosterContact = {
  company: 'NORTHROP GRUMMAN SYSTEMS CORPORATION',
  sbloName: 'Carla Undurraga',
  title: 'Sector Manager / SBLO',
  email: 'carla.undurraga@ngc.com',
  phone: null,
  supplierPortal: 'https://www.northropgrumman.com/suppliers/osbp',
  source: 'Jun 2026 research',
};

function fakeIO(files: Record<string, string>) {
  const writes: string[] = [];
  const logs: string[] = [];
  const errors: string[] = [];
  const io: ImporterIO = {
    readFile: (p) => { if (!(p in files)) throw new Error(`ENOENT ${p}`); return files[p]; },
    writeFile: (p, c) => { writes.push(p); files[p] = c; },
    exists: (p) => p in files,
    resolve: (p) => p.replace(/^\.\//, ''),
    log: (l) => logs.push(l),
    error: (l) => errors.push(l),
  };
  return { io, writes, logs, errors, files };
}
const ROSTER = JSON.stringify({ metadata: { verified: '2026-06' }, contacts: [CACI, NG] });

describe('CLI contract', () => {
  it('refuses to run without --csv (no hardcoded June path)', () => {
    const { io, writes, errors } = fakeIO({ 'src/data/sblo-roster-2026-06.json': ROSTER, 'data/imports/sblo-refresh-2026-06.csv': HEADER });
    expect(runSbloImport([], io)).toBe(2);
    expect(runSbloImport(['--write'], io)).toBe(2);
    expect(runSbloImport(['--csv'], io)).toBe(2);
    expect(errors.join('\n')).toContain('--csv <path> is required');
    expect(writes).toEqual([]);
  });

  it('diff mode (default) writes nothing, even with --out and --merge-prime-db', () => {
    const csv = `${HEADER}\n${csvLine('CACI INTERNATIONAL INC', { sbloName: { v: 'Wayne Pizer', s: 'changed', d: '2026-11-17', u: 'https://www.caci.com/small-business-advocacy-office' } })}`;
    const { io, writes, logs } = fakeIO({ 'src/data/sblo-roster-2026-06.json': ROSTER, 'in.csv': csv, 'src/data/prime-contractors-database.json': '{"primes":[]}' });
    expect(runSbloImport(['--csv', 'in.csv', '--out', 'new.json', '--merge-prime-db'], io)).toBe(0);
    expect(writes).toEqual([]);
    const text = logs.join('\n');
    expect(text).toContain('DIFF ONLY');
    expect(text).toContain('Yadira Beltre → Wayne Pizer');
    const json = JSON.parse(text.split('--- JSON report ---')[1]);
    expect(json.mode).toBe('diff');
    expect(json.summary.changed).toBe(1);
  });

  it('--write refuses the base roster as --out, an existing --out, and any rejected field', () => {
    const good = `${HEADER}\n${csvLine('CACI INTERNATIONAL INC', { sbloName: { v: 'Wayne Pizer', s: 'changed', d: '2026-11-17', u: 'https://www.caci.com/sbao' } })}`;
    const bad = `${HEADER}\n${csvLine('CACI INTERNATIONAL INC', { sbloName: { v: 'Wayne Pizer', s: 'changed', d: '2026-11-17' } })}`;
    const base = 'src/data/sblo-roster-2026-06.json';
    let t = fakeIO({ [base]: ROSTER, 'in.csv': good });
    expect(runSbloImport(['--csv', 'in.csv', '--write'], t.io)).toBe(2);
    expect(runSbloImport(['--csv', 'in.csv', '--write', '--out', base], t.io)).toBe(2);
    t = fakeIO({ [base]: ROSTER, 'in.csv': good, 'exists.json': '{}' });
    expect(runSbloImport(['--csv', 'in.csv', '--write', '--out', 'exists.json'], t.io)).toBe(2);
    t = fakeIO({ [base]: ROSTER, 'in.csv': bad });
    expect(runSbloImport(['--csv', 'in.csv', '--write', '--out', 'new.json'], t.io)).toBe(1);
    expect(t.writes).toEqual([]);
    // and the good CSV writes ONLY the new file — the base roster is untouched
    t = fakeIO({ [base]: ROSTER, 'in.csv': good });
    expect(runSbloImport(['--csv', 'in.csv', '--write', '--out', 'new.json'], t.io)).toBe(0);
    expect(t.writes).toEqual(['new.json']);
    expect(t.files[base]).toBe(ROSTER);
    const out = JSON.parse(t.files['new.json']);
    expect(out.contacts[0].sbloName).toBe('Wayne Pizer');
  });
});

describe('merge rules', () => {
  it('a blank cell never overwrites a populated field', () => {
    const { next, changes } = mergeSbloContact(CACI, row('CACI INTERNATIONAL INC', {}));
    expect(next.sbloName).toBe('Yadira Beltre');
    expect(next.email).toBe('yadira.beltre@caci.com');
    expect(changes.every((c) => c.action === 'unchanged')).toBe(true);
  });

  it('changed with a blank value is rejected — use not_named', () => {
    const { next, changes } = mergeSbloContact(CACI, row('x', { email: { s: 'changed', d: '2026-11-17', u: 'https://caci.com' } }));
    expect(next.email).toBe('yadira.beltre@caci.com');
    expect(changes.find((c) => c.field === 'email')!.action).toBe('rejected');
  });

  it('not_named / unreachable keep the value and mark it stale', () => {
    const { next, changes } = mergeSbloContact(CACI, row('x', {
      sbloName: { s: 'not_named', d: '2026-11-17', u: 'https://www.caci.com/sbao' },
      email: { s: 'unreachable', d: '2026-11-17' },
    }));
    expect(next.sbloName).toBe('Yadira Beltre');
    expect(next.email).toBe('yadira.beltre@caci.com');
    expect(next.provenance!.sbloName).toMatchObject({ status: 'not_named', staleSince: '2026-11-17' });
    expect(next.provenance!.email).toMatchObject({ status: 'unreachable', staleSince: '2026-11-17' });
    expect(changes.filter((c) => c.action === 'marked_stale')).toHaveLength(2);
  });

  it('changed WITHOUT a sourceUrl is rejected and leaves the value alone', () => {
    const { next, changes } = mergeSbloContact(CACI, row('x', { sbloName: { v: 'Wayne Pizer', s: 'changed', d: '2026-11-17' } }));
    expect(next.sbloName).toBe('Yadira Beltre');
    const c = changes.find((x) => x.field === 'sbloName')!;
    expect(c.action).toBe('rejected');
    expect(c.reason).toContain('sourceUrl');
  });

  it('a value with no status is rejected, a bad date is rejected, an unknown status is rejected', () => {
    expect(mergeSbloContact(CACI, row('x', { sbloName: { v: 'Wayne Pizer' } })).changes[0].action).toBe('rejected');
    expect(mergeSbloContact(CACI, row('x', { sbloName: { v: 'W', s: 'changed', d: '2026-11', u: 'https://a.b' } })).changes[0].action).toBe('rejected');
    expect(mergeSbloContact(CACI, row('x', { sbloName: { v: 'W', s: 'maybe', d: '2026-11-17', u: 'https://a.b' } })).changes[0].action).toBe('rejected');
  });

  it('confirmed with a different value is rejected (must say changed)', () => {
    const { changes } = mergeSbloContact(CACI, row('x', { sbloName: { v: 'Wayne Pizer', s: 'confirmed', d: '2026-11-17', u: 'https://a.b' } }));
    expect(changes[0].action).toBe('rejected');
  });

  it('changed WITH a sourceUrl replaces the value and preserves the old one in history', () => {
    const url = 'https://www.caci.com/small-business-advocacy-office';
    const first = mergeSbloContact(CACI, row('x', {
      title: 'Director, Small Business Advocacy Office',
      sbloName: { v: 'Wayne Pizer', s: 'changed', d: '2026-11-17', u: url },
    }));
    expect(first.next.sbloName).toBe('Wayne Pizer');
    expect(first.next.provenance!.sbloName).toEqual({ status: 'changed', verifiedAt: '2026-11-17', sourceUrl: url, staleSince: null });
    expect(first.next.history!.sbloName).toEqual([
      { value: 'Yadira Beltre', provenance: null, replacedAt: '2026-11-17', replacedBecause: 'changed' },
    ]);
    // title travels with an accepted name change; its old value is kept too
    expect(first.next.title).toBe('Director, Small Business Advocacy Office');
    expect(first.next.history!.title![0].value).toBe('Small Business Liaison Officer');
    // input not mutated
    expect(CACI.sbloName).toBe('Yadira Beltre');

    // a second change appends — history is never truncated
    const second = mergeSbloContact(first.next, row('x', { sbloName: { v: 'Someone Else', s: 'changed', d: '2027-02-01', u: url } }));
    expect(second.next.history!.sbloName!.map((h) => h.value)).toEqual(['Yadira Beltre', 'Wayne Pizer']);
    expect(second.next.history!.sbloName![1].provenance).toMatchObject({ status: 'changed', verifiedAt: '2026-11-17' });
  });

  it('confirmed bumps verifiedAt and clears staleness without touching the value', () => {
    const stale = mergeSbloContact(CACI, row('x', { phone: { s: 'not_named', d: '2026-11-17' } })).next;
    const { next, changes } = mergeSbloContact(stale, row('x', { phone: { v: '703.555.0100', s: 'confirmed', d: '2027-01-05', u: 'https://caci.com/c' } }));
    expect(next.phone).toBe('(703) 555-0100');
    expect(next.provenance!.phone).toEqual({ status: 'confirmed', verifiedAt: '2027-01-05', sourceUrl: 'https://caci.com/c', staleSince: null });
    expect(changes.find((c) => c.field === 'phone')!.action).toBe('confirmed');
  });
});

describe('role mailbox preferred over personal email', () => {
  it('a verified role mailbox replaces a personal email; the personal one is kept internally as stale', () => {
    const url = 'https://www.northropgrumman.com/suppliers/osbp';
    const { next, changes } = mergeSbloContact(NG, row('x', { email: { v: 'NGDSSmallBusiness@ngc.com', s: 'changed', d: '2026-11-17', u: url } }));
    expect(next.email).toBe('NGDSSmallBusiness@ngc.com');
    expect(next.personalEmail).toBe('carla.undurraga@ngc.com');
    expect(next.personalEmailStatus).toBe('stale');
    expect(next.history!.email![0]).toMatchObject({ value: 'carla.undurraga@ngc.com', replacedBecause: 'role_mailbox_preferred' });
    expect(next.sbloName).toBe('Carla Undurraga'); // the name is a separate field and is kept
    expect(changes.find((c) => c.field === 'email')!.action).toBe('changed');
  });

  it('a personal email never displaces a role mailbox — it is stored internally only', () => {
    const roleHeld: RosterContact = { ...NG, email: 'NGDSSmallBusiness@ngc.com' };
    const { next, changes } = mergeSbloContact(roleHeld, row('x', {
      email: { v: 'carla.undurraga@ngc.com', s: 'changed', d: '2026-11-17', u: 'https://www.northropgrumman.com/x' },
    }));
    expect(next.email).toBe('NGDSSmallBusiness@ngc.com');
    expect(next.personalEmail).toBe('carla.undurraga@ngc.com');
    expect(next.personalEmailStatus).toBe('confirmed');
    expect(changes.find((c) => c.field === 'email')!.action).toBe('kept_role_mailbox');
  });

  it('classifies the live roster shapes', () => {
    expect(classifyEmailKind('NGDSSmallBusiness@ngc.com')).toBe('role');
    expect(classifyEmailKind('GA-ASI-Small-Business@ga-asi.com')).toBe('role');
    expect(classifyEmailKind('sblo@textronsystems.com')).toBe('role');
    expect(classifyEmailKind('supplier_diversity@dxc.com')).toBe('role');
    expect(classifyEmailKind('info@akima.com')).toBe('role');
    expect(classifyEmailKind('yadira.beltre@caci.com', { sbloName: 'Yadira Beltre' })).toBe('personal');
    expect(classifyEmailKind('crossj@abacustech.com', { sbloName: 'Jane Cross' })).toBe('personal');
    expect(classifyEmailKind('ecausey@kpmg.com', { sbloName: 'Eric Causey' })).toBe('personal');
    expect(classifyEmailKind('j.rosales@x.com')).toBe('personal'); // "rosales" is not "sales"
    expect(classifyEmailKind('x@y.com', { explicit: 'role' })).toBe('role');
    expect(classifyEmailKind('')).toBeNull();
  });
});

describe('whole-roster diff', () => {
  it('the Jun-2026 CSV shape (no status columns) against an identical roster is a no-op with zero rejections', () => {
    const legacy = 'company,sbloName,title,email,phone,vendorPortal,source\n'
      + 'CACI INTERNATIONAL INC,Yadira Beltre,Small Business Liaison Officer,yadira.beltre@caci.com,(703) 555-0100,https://www.caci.com/small-business-advocacy-office,Jun 2026 research';
    const { report, merged } = diffRoster([CACI, NG], parseSbloCsv(legacy), { csv: 'a', base: 'b', mode: 'diff' });
    expect(report.summary.rejected).toBe(0);
    expect(report.summary.changed + report.summary.added + report.summary.markedStale).toBe(0);
    expect(report.notInCsv).toEqual(['NORTHROP GRUMMAN SYSTEMS CORPORATION']);
    expect(merged).toEqual([CACI, NG]);
  });

  it('a legacy-shape CSV carrying a DIFFERENT value (no status) is rejected, never applied', () => {
    const legacy = 'company,sbloName,title,email,phone,vendorPortal,source\n'
      + 'CACI INTERNATIONAL INC,Wayne Pizer,,,,,';
    const { report, merged } = diffRoster([CACI], parseSbloCsv(legacy), { csv: 'a', base: 'b', mode: 'diff' });
    expect(report.summary.rejected).toBe(1);
    expect(merged[0].sbloName).toBe('Yadira Beltre');
  });
});
