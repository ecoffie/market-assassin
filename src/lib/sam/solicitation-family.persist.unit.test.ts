/**
 * Solicitation Family v1 — persist blockers:
 * concurrent lazy-create ON CONFLICT, alias theft → IDENTITY_CONFLICT.
 * In-memory unique store. Does not touch production.
 */
import { describe, expect, it } from 'vitest';
import {
  attachPursuitToFamily,
  ensureFamilyPersisted,
  type FamilyIdentifier,
  type SolicitationFamilyView,
} from '@/lib/sam/solicitation-family';

type Row = Record<string, unknown>;

class FamilyPersistDb {
  families = new Map<string, Row>();
  versions = new Map<string, Row>();
  identifiers = new Map<string, Row>();
  insertAttempts = 0;
  uniqueViolations = 0;
  familyLock: Promise<unknown> = Promise.resolve();

  from(table: string) {
    return new FamilyQuery(this, table);
  }
}

class FamilyQuery {
  private op = 'select';
  private payload: Row | Row[] | undefined;
  private conflict?: string;
  private ignoreDuplicates = false;
  private filters: Array<{ kind: 'eq' | 'in'; col: string; val: unknown }> = [];

  constructor(private db: FamilyPersistDb, private table: string) {}

  select(_cols?: string) { return this; }
  eq(col: string, val: unknown) {
    this.filters.push({ kind: 'eq', col, val });
    return this;
  }
  in(col: string, val: unknown) {
    this.filters.push({ kind: 'in', col, val });
    return this;
  }
  insert(payload: Row | Row[]) {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }
  update(payload: Row) {
    this.op = 'update';
    this.payload = payload;
    return this;
  }
  upsert(payload: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.op = 'upsert';
    this.payload = payload;
    this.conflict = opts?.onConflict;
    this.ignoreDuplicates = Boolean(opts?.ignoreDuplicates);
    return this;
  }
  maybeSingle() { return this.run('maybeSingle'); }
  single() { return this.run('single'); }
  then(
    resolve: (v: { data: unknown; error: unknown }) => unknown,
    reject?: (e: unknown) => unknown,
  ) {
    return this.run('many').then(resolve, reject);
  }

  private run(mode: 'single' | 'maybeSingle' | 'many') {
    return Promise.resolve().then(async () => {
      if (this.table === 'solicitation_family' && (this.op === 'upsert' || this.op === 'insert')) {
        const exec = this.op === 'insert' ? () => this.insertFamily() : () => this.upsertFamily();
        const next = this.db.familyLock.then(exec, exec);
        this.db.familyLock = next.then(() => undefined, () => undefined);
        return next;
      }
      return this.dispatch(mode);
    });
  }

  private async upsertFamily() {
    await sleep(8);
    const payload = asRow(this.payload);
    const key = String(payload.identity_key);
    const existing = this.db.families.get(key);
    if (existing) {
      Object.assign(existing, payload);
      return { data: { family_id: existing.family_id }, error: null };
    }
    const family_id = `fam-${this.db.families.size + 1}`;
    this.db.families.set(key, { ...payload, family_id });
    return { data: { family_id }, error: null };
  }

  private async insertFamily() {
    this.db.insertAttempts += 1;
    await sleep(8);
    const payload = asRow(this.payload);
    const key = String(payload.identity_key);
    if (this.db.families.has(key)) {
      this.db.uniqueViolations += 1;
      return { data: null, error: { code: '23505', message: 'duplicate identity_key' } };
    }
    const family_id = `fam-ins-${this.db.insertAttempts}`;
    this.db.families.set(key, { ...payload, family_id });
    return { data: { family_id }, error: null };
  }

  private dispatch(mode: 'single' | 'maybeSingle' | 'many') {
    if (this.table === 'solicitation_family' && this.op === 'select') {
      const key = String(this.filters.find((f) => f.col === 'identity_key')?.val || '');
      const row = this.db.families.get(key) || null;
      if (mode === 'maybeSingle' || mode === 'single') {
        return { data: row ? { family_id: row.family_id } : null, error: null };
      }
      return { data: row ? [row] : [], error: null };
    }
    if (this.table === 'solicitation_family_versions' && this.op === 'upsert') {
      for (const row of asRows(this.payload)) {
        this.db.versions.set(`${row.family_id}|${row.notice_id}`, row);
      }
      return { data: null, error: null };
    }
    if (this.table === 'solicitation_identifiers' && this.op === 'upsert') {
      for (const row of asRows(this.payload)) {
        const k = `${row.identifier_norm}|${row.identifier_type}`;
        if (this.db.identifiers.has(k)) {
          if (!this.ignoreDuplicates) {
            this.db.identifiers.set(k, row);
          }
          continue;
        }
        this.db.identifiers.set(k, row);
      }
      return { data: null, error: null };
    }
    if (this.table === 'solicitation_identifiers' && this.op === 'select') {
      const inFilter = this.filters.find((f) => f.kind === 'in' && f.col === 'identifier_norm');
      const norms = new Set((inFilter?.val as string[] | undefined) || []);
      const data = [...this.db.identifiers.values()].filter((row) =>
        norms.has(String(row.identifier_norm)),
      );
      return { data, error: null };
    }
    return { data: mode === 'many' ? [] : null, error: null };
  }
}

function asRow(payload: Row | Row[] | undefined): Row {
  if (!payload) return {};
  return Array.isArray(payload) ? (payload[0] || {}) : payload;
}

function asRows(payload: Row | Row[] | undefined): Row[] {
  if (!payload) return [];
  return Array.isArray(payload) ? payload : [payload];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function identifier(
  type: FamilyIdentifier['identifier_type'],
  value: string,
  source: FamilyIdentifier['source'] = 'sam_column',
): FamilyIdentifier {
  return {
    identifier_type: type,
    identifier_value: value,
    identifier_norm: value.trim().toUpperCase(),
    source,
    evidence_grade: 'CONFIRMED_IDENTITY',
  };
}

function view(partial: Partial<SolicitationFamilyView> & Pick<SolicitationFamilyView, 'identity_key' | 'current_notice_id'>): SolicitationFamilyView {
  return {
    family_id: null,
    canonical_solicitation_number: 'N0017425RFPREQIHDMDept0002',
    current_status: 'archived',
    current_deadline: '2026-08-27T19:00:00+00:00',
    current_amendment: 'Amendment 0003',
    current_set_aside: 'Partial Small Business Set-Aside (FAR 19.5)',
    canonical_title: 'MASA',
    primary_dodaac: 'N00174',
    department: 'DEPT OF DEFENSE',
    sub_tier: 'DEPT OF THE NAVY',
    office: 'NSWC INDIAN HEAD DIVISION',
    current_contact: null,
    identifiers: [
      identifier('solicitation_number', 'N0017425RFPREQIHDMDept0002'),
      identifier('customer_rfp', 'N0017426R1003', 'description'),
      identifier('notice_id', partial.current_notice_id),
    ],
    versions: [
      {
        notice_id: 'ce85c48dc296497eb902a0a73ac45680',
        posted_date: '2026-06-17',
        response_deadline: '2026-07-21',
        amendment: null,
        active: false,
        title: 'MASA',
      },
      {
        notice_id: 'd85b93617ae54e8e9b05b7e7a23ffe61',
        posted_date: '2026-07-14',
        response_deadline: '2026-08-04',
        amendment: 'Amendment 0001',
        active: false,
        title: 'MASA',
      },
      {
        notice_id: '8ca5ef19cc974f288722a8d5913cda5c',
        posted_date: '2026-07-22',
        response_deadline: '2026-08-04',
        amendment: 'Amendment 0002',
        active: false,
        title: 'MASA',
      },
      {
        notice_id: 'f1aa309fa39040a4929d90a7d88fd091',
        posted_date: '2026-07-29',
        response_deadline: '2026-08-27',
        amendment: 'Amendment 0003',
        active: false,
        title: 'MASA',
      },
    ],
    documents: {
      current: {
        notice_id: 'f1aa309fa39040a4929d90a7d88fd091',
        amendment: 'Amendment 0003',
        posted_date: '2026-07-29',
        attachments: [{ filename: 'current.pdf' }],
      },
      historical: [{
        notice_id: 'ce85c48dc296497eb902a0a73ac45680',
        amendment: null,
        posted_date: '2026-06-17',
        attachments: [{ filename: 'N0017426R1003.pdf' }],
      }],
    },
    rejected_unrelated_notice_ids: [],
    ambiguous: false,
    ...partial,
  };
}

const MASA = view({
  identity_key: 'sol:N0017425RFPREQIHDMDEPT0002',
  current_notice_id: 'f1aa309fa39040a4929d90a7d88fd091',
});

describe('solicitation family persist — concurrent lazy create', () => {
  it('8 concurrent first-creates yield one family_id and no 23505', async () => {
    const db = new FamilyPersistDb();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => ensureFamilyPersisted(MASA, { client: db as never })),
    );
    const ids = [...new Set(results.map((r) => r.view.family_id))];
    expect(results).toHaveLength(8);
    expect(results.every((r) => r.view.family_id)).toBe(true);
    expect(ids).toEqual(['fam-1']);
    expect(db.families.size).toBe(1);
    expect(db.insertAttempts).toBe(0);
    expect(db.uniqueViolations).toBe(0);
    expect(db.versions.size).toBe(4);
    expect(db.identifiers.size).toBe(3);
    expect(results.every((r) => r.identity_conflicts.length === 0)).toBe(true);
    const attached = results.map((r) => attachPursuitToFamily('ce85c48dc296497eb902a0a73ac45680', r.view));
    expect(attached.every((a) => a.family_id === 'fam-1')).toBe(true);
    expect(attached.every((a) => a.worked_from_notice_id === 'ce85c48dc296497eb902a0a73ac45680')).toBe(true);
  });

  it('same-family retry is idempotent', async () => {
    const db = new FamilyPersistDb();
    const first = await ensureFamilyPersisted(MASA, { client: db as never });
    const second = await ensureFamilyPersisted(MASA, { client: db as never });
    expect(second.view.family_id).toBe(first.view.family_id);
    expect(second.identity_conflicts).toEqual([]);
    expect(db.families.size).toBe(1);
    expect(db.versions.size).toBe(4);
    expect(db.identifiers.size).toBe(3);
  });
});

describe('solicitation family persist — alias theft', () => {
  it('cross-family customer-RFP does not steal ownership', async () => {
    const db = new FamilyPersistDb();
    const familyA = view({
      identity_key: 'sol:70B03C26R00000030',
      canonical_solicitation_number: '70B03C26R00000030',
      current_notice_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      identifiers: [
        identifier('solicitation_number', '70B03C26R00000030'),
        identifier('customer_rfp', '70B03C26R00000030', 'description'),
        identifier('notice_id', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
      ],
      versions: [{
        notice_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        posted_date: '2026-01-01',
        response_deadline: null,
        amendment: null,
        active: true,
        title: 'MEMS R',
      }],
    });
    const familyB = view({
      identity_key: 'sol:70B03C26D00000029',
      canonical_solicitation_number: '70B03C26D00000029',
      current_notice_id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      identifiers: [
        identifier('solicitation_number', '70B03C26D00000029'),
        identifier('customer_rfp', '70B03C26R00000030', 'description'),
        identifier('notice_id', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'),
      ],
      versions: [{
        notice_id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        posted_date: '2026-02-01',
        response_deadline: null,
        amendment: null,
        active: true,
        title: 'MEMS D',
      }],
    });

    const a = await ensureFamilyPersisted(familyA, { client: db as never });
    const b = await ensureFamilyPersisted(familyB, { client: db as never });

    expect(a.view.family_id).toBeTruthy();
    expect(b.view.family_id).toBeTruthy();
    expect(b.view.family_id).not.toBe(a.view.family_id);
    expect(db.families.size).toBe(2);

    const rfp = db.identifiers.get('70B03C26R00000030|customer_rfp');
    expect(rfp?.family_id).toBe(a.view.family_id);
    expect(b.identity_conflicts).toEqual([
      {
        kind: 'IDENTITY_CONFLICT',
        identifier_norm: '70B03C26R00000030',
        identifier_type: 'customer_rfp',
        existing_family_id: a.view.family_id,
        attempted_family_id: b.view.family_id,
      },
    ]);
    expect(a.identity_conflicts).toEqual([]);
    expect(db.identifiers.get('70B03C26D00000029|solicitation_number')?.family_id).toBe(b.view.family_id);
  });

  it('HVAC hyphenated RFP alias is not stolen', async () => {
    const db = new FamilyPersistDb();
    const a = await ensureFamilyPersisted(view({
      identity_key: 'sol:W912C326RA009',
      canonical_solicitation_number: 'W912C326RA009',
      current_notice_id: 'cccccccccccccccccccccccccccccccc',
      identifiers: [
        identifier('solicitation_number', 'W912C326RA009'),
        identifier('customer_rfp', 'W912C3-26-R-A009', 'description'),
        identifier('notice_id', 'cccccccccccccccccccccccccccccccc'),
      ],
      versions: [{
        notice_id: 'cccccccccccccccccccccccccccccccc',
        posted_date: '2026-01-01',
        response_deadline: null,
        amendment: null,
        active: true,
        title: 'HVAC R',
      }],
    }), { client: db as never });
    const b = await ensureFamilyPersisted(view({
      identity_key: 'sol:W912C326QA011',
      canonical_solicitation_number: 'W912C326QA011',
      current_notice_id: 'dddddddddddddddddddddddddddddddd',
      identifiers: [
        identifier('solicitation_number', 'W912C326QA011'),
        identifier('customer_rfp', 'W912C3-26-R-A009', 'description'),
        identifier('notice_id', 'dddddddddddddddddddddddddddddddd'),
      ],
      versions: [{
        notice_id: 'dddddddddddddddddddddddddddddddd',
        posted_date: '2026-02-01',
        response_deadline: null,
        amendment: null,
        active: true,
        title: 'HVAC Q',
      }],
    }), { client: db as never });

    expect(a.view.family_id).not.toBe(b.view.family_id);
    expect(db.identifiers.get('W912C3-26-R-A009|customer_rfp')?.family_id).toBe(a.view.family_id);
    expect(b.identity_conflicts.some((c) => c.kind === 'IDENTITY_CONFLICT' && c.identifier_norm === 'W912C3-26-R-A009')).toBe(true);
  });
});
