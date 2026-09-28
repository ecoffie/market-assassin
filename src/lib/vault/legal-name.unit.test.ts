/**
 * P0-I — company legal-name provenance rules (Eric decision 2026-09-28, option B).
 * Canonical store: user_identity_profile.legal_name + legal_name_source.
 */
import { describe, it, expect } from 'vitest';
import { decideLegalNameWrite, applyLegalName, type CurrentLegalName, type LegalNameWriter } from './legal-name';

const cur = (legal_name: string | null, legal_name_source: CurrentLegalName['legal_name_source']): CurrentLegalName => ({ legal_name, legal_name_source });

describe('the ruling, row by row', () => {
  it('empty legal_name + onboarding typed name → stored as user_entered', () => {
    expect(decideLegalNameWrite(null, 'Acme LLC', 'onboarding')).toMatchObject({ action: 'write', legal_name: 'Acme LLC', legal_name_source: 'user_entered' });
    expect(decideLegalNameWrite(cur('', null), '  Acme   LLC ', 'onboarding')).toMatchObject({ action: 'write', legal_name: 'Acme LLC', legal_name_source: 'user_entered' });
  });
  it('existing user_entered → the user may update it', () => {
    expect(decideLegalNameWrite(cur('Acme', 'user_entered'), 'Acme Federal', 'onboarding')).toMatchObject({ action: 'write', legal_name: 'Acme Federal', legal_name_source: 'user_entered' });
  });
  it('existing sam → onboarding must not overwrite it', () => {
    expect(decideLegalNameWrite(cur('ACME FEDERAL SERVICES LLC', 'sam'), 'Acme', 'onboarding')).toEqual({ action: 'keep', reason: 'protected_sam' });
  });
  it('a later grounded SAM identity supersedes user_entered', () => {
    expect(decideLegalNameWrite(cur('Acme', 'user_entered'), 'ACME FEDERAL SERVICES LLC', 'sam')).toMatchObject({ action: 'write', legal_name_source: 'sam' });
  });
  it('admin writes keep explicit admin provenance, and nothing but admin replaces them', () => {
    expect(decideLegalNameWrite(cur('Acme', 'sam'), 'Acme Restored', 'admin')).toMatchObject({ action: 'write', legal_name_source: 'admin' });
    for (const w of ['onboarding', 'sam', 'vault_edit', 'unverified'] as LegalNameWriter[]) {
      expect(decideLegalNameWrite(cur('Acme Restored', 'admin'), 'Other', w)).toEqual({ action: 'keep', reason: 'protected_admin' });
    }
  });
  it('lookup failure / absence stays unknown — never stamped sam', () => {
    expect(decideLegalNameWrite(null, 'Acme', 'unverified')).toMatchObject({ action: 'write', legal_name_source: null });
  });
});

describe('never infer, never downgrade', () => {
  it('a typed name is never stamped sam', () => {
    for (const w of ['onboarding', 'vault_edit'] as LegalNameWriter[]) {
      const d = decideLegalNameWrite(null, 'Acme', w);
      expect(d.action === 'write' && d.legal_name_source).toBe('user_entered');
    }
  });
  it('onboarding does not overwrite a pre-migration name of unknown provenance (it may be SAM)', () => {
    expect(decideLegalNameWrite(cur('ACME FEDERAL SERVICES LLC', null), 'Acme', 'onboarding')).toEqual({ action: 'keep', reason: 'protected_unknown' });
  });
  it('re-saving the same value keeps its provenance (a SAM name stays sam)', () => {
    expect(decideLegalNameWrite(cur('ACME LLC', 'sam'), 'ACME LLC', 'vault_edit')).toEqual({ action: 'keep', reason: 'unchanged' });
    expect(decideLegalNameWrite(cur('ACME LLC', 'sam'), 'ACME LLC', 'onboarding')).toEqual({ action: 'keep', reason: 'unchanged' });
  });
  it('SAM confirming an identical user_entered value upgrades it to sam', () => {
    expect(decideLegalNameWrite(cur('ACME LLC', 'user_entered'), 'ACME LLC', 'sam')).toMatchObject({ action: 'write', legal_name_source: 'sam' });
  });
  it("a SAM legal name is not overwritten by the user's own Vault / display edit (rule change 2026-09-28)", () => {
    expect(decideLegalNameWrite(cur('ACME LLC', 'sam'), 'Acme Holdings', 'vault_edit')).toEqual({ action: 'keep', reason: 'protected_sam' });
  });
  it("the owner's explicit Vault edit replaces user_entered and unknown names as user_entered", () => {
    expect(decideLegalNameWrite(cur('Acme', 'user_entered'), 'Acme Holdings', 'vault_edit')).toMatchObject({ action: 'write', legal_name_source: 'user_entered' });
    expect(decideLegalNameWrite(cur('Acme', null), 'Acme Holdings', 'vault_edit')).toMatchObject({ action: 'write', legal_name_source: 'user_entered' });
  });
  it('an empty submission never clears a stored name', () => {
    expect(decideLegalNameWrite(cur('ACME', 'sam'), '   ', 'vault_edit')).toEqual({ action: 'keep', reason: 'empty_input' });
  });
});

// Minimal in-memory user_identity_profile with the filters applyLegalName uses.
function fakeDb(initial: Record<string, unknown>[] = [], hooks: { beforeUpdate?: (rows: Record<string, unknown>[]) => void } = {}) {
  const rows = initial.map((r) => ({ ...r }));
  const from = () => {
    let op: 'select' | 'upsert' | 'update' = 'select';
    let payload: Record<string, unknown> = {};
    let opts: { ignoreDuplicates?: boolean } = {};
    const f: Array<(r: Record<string, unknown>) => boolean> = [];
    const run = () => {
      if (op === 'select') return { data: rows.find((r) => f.every((x) => x(r))) ?? null, error: null };
      if (op === 'upsert') {
        if (rows.some((r) => r.user_email === payload.user_email)) return { count: opts.ignoreDuplicates ? 0 : 1, error: null };
        rows.push({ ...payload }); return { count: 1, error: null };
      }
      hooks.beforeUpdate?.(rows); hooks.beforeUpdate = undefined;
      const hit = rows.filter((r) => f.every((x) => x(r)));
      hit.forEach((r) => Object.assign(r, payload));
      return { count: hit.length, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      upsert: (p: Record<string, unknown>, o: typeof opts) => { op = 'upsert'; payload = p; opts = o; return q; },
      update: (p: Record<string, unknown>) => { op = 'update'; payload = p; return q; },
      eq: (c: string, v: unknown) => { f.push((r) => r[c] === v); return q; },
      is: (c: string, v: unknown) => { f.push((r) => (r[c] ?? null) === v); return q; },
      maybeSingle: () => Promise.resolve(run()),
      then: (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res),
    };
    return q;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { rows, sb: { from } as any };
}

describe('applyLegalName — guarded, counted write', () => {
  it('creates the Vault row when the user has none', async () => {
    const { rows, sb } = fakeDb();
    expect(await applyLegalName(sb, 'A@Example.com', 'Acme', 'onboarding')).toMatchObject({ outcome: 'written', source: 'user_entered' });
    expect(rows).toEqual([expect.objectContaining({ user_email: 'a@example.com', legal_name: 'Acme', legal_name_source: 'user_entered' })]);
  });
  it('touches only legal_name/source on an existing row', async () => {
    const { rows, sb } = fakeDb([{ user_email: 'a@example.com', legal_name: 'Old', legal_name_source: 'user_entered', uei: 'UEI123456789' }]);
    await applyLegalName(sb, 'a@example.com', 'New', 'onboarding');
    expect(rows[0]).toMatchObject({ legal_name: 'New', legal_name_source: 'user_entered', uei: 'UEI123456789' });
  });
  it('a SAM name that lands between the read and the write is NOT overwritten by a stale onboarding decision', async () => {
    const { rows, sb } = fakeDb([{ user_email: 'a@example.com', legal_name: 'Acme', legal_name_source: 'user_entered' }], {
      beforeUpdate: (r) => { r[0].legal_name = 'ACME FEDERAL SERVICES LLC'; r[0].legal_name_source = 'sam'; },
    });
    expect(await applyLegalName(sb, 'a@example.com', 'Acme Typed', 'onboarding')).toEqual({ outcome: 'kept', reason: 'protected_sam' });
    expect(rows[0]).toMatchObject({ legal_name: 'ACME FEDERAL SERVICES LLC', legal_name_source: 'sam' });
  });
  it('a SAM-protected name is kept and reported, never claimed as written', async () => {
    const { rows, sb } = fakeDb([{ user_email: 'a@example.com', legal_name: 'ACME LLC', legal_name_source: 'sam' }]);
    expect(await applyLegalName(sb, 'a@example.com', 'Acme', 'onboarding')).toEqual({ outcome: 'kept', reason: 'protected_sam' });
    expect(rows[0].legal_name).toBe('ACME LLC');
  });
});
