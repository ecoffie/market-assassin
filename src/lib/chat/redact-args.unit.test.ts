import { describe, it, expect, afterEach } from 'vitest';
import { listMcpTools } from '@/lib/mcp/tool-registry';
import { redactToolArgs } from './redact-args';

afterEach(() => { delete process.env.LOG_DIGEST_KEY; });

const isRedacted = (v: unknown) => typeof v === 'object' && v !== null && (v as { redacted?: boolean }).redacted === true;
const leaks = (out: unknown, secret: string) => JSON.stringify(out).toLowerCase().includes(secret.toLowerCase());
const schemaOf = (tool: string) =>
  (listMcpTools().find((d) => (d.function as { name: string }).name === tool)!.function as { parameters: Record<string, unknown> }).parameters;

describe('redactToolArgs — strict allowlist (meaning validated, not just characters)', () => {
  it('keeps validated structured filters verbatim', () => {
    const args = {
      naics: '561320', naics_codes: ['561311', '5613'], psc: 'R706', state: 'TN', states: ['MS', 'AR'],
      agency: 'Department of Veterans Affairs', uei: 'NZ7CS4E6R7K6', piid: 'W912EQ24P0035',
      notice_id: '0a1b2c3d4e5f60718293a4b5c6d7e8f9', schedule_id: '11111111-2222-3333-4444-555555555555',
      date_from: '2019-01-01', months_window: 18, limit: 50, include_idv: true, fiscal_year: '2026',
    };
    expect(redactToolArgs(args)).toEqual(args);
  });

  it('enum fields are kept only when the value is in the tool schema enum', () => {
    const schema = schemaOf('search_idv_contracts');
    expect(redactToolArgs({ search_type: 'task' }, schema)).toEqual({ search_type: 'task' });
    expect(redactToolArgs({ search_type: 'Jane Doe pass Hunter2 x' }, schema).search_type).toMatchObject({ redacted: true, invalid: true });
    // without a schema an enum-like field is not recognized and is redacted (safe default)
    expect(isRedacted(redactToolArgs({ status: 'open' }).status)).toBe(true);
  });

  it('blocks the smuggling vectors found in independent review', () => {
    const out = redactToolArgs({
      agency: 'John Smith 202-555-0199 jsmith at navy.mil',
      office: 'Jane Doe',
      subAgency: 'call me at home',
      filters: { agency: 'John Smith 202-555-0199' },
      vehicle: 'Jane Doe pass Hunter2 x',
      status: 'Jane Doe pass Hunter2 x',
      mode: 'Hunter2',
      id: 'sk-proj-AbCdEf1234567890xyzSECRETKEY',
      job_id: 'pit-1234-abcd',
      document_id: 'SECRETKEY12345',
      schedule_id: 'my password is hunter2',
      notice_ids: 'Jane,Doe,cell,5715550100,password,Hunter2',
      piids: 'Jane,Doe,cell,5715550100',
      contract_ids: Array.from({ length: 30 }, (_, i) => `W912EQ24P00${String(i).padStart(2, '0')}`),
    });
    for (const s of ['John Smith', '202-555', 'jsmith', 'Jane', 'Hunter2', 'sk-proj', 'pit-1234', 'SECRETKEY', 'hunter2', '5715550100', 'call me']) {
      expect(leaks(out, s), s).toBe(false);
    }
    expect(out.contract_ids).toMatchObject({ redacted: true, type: 'array', count: 30 });
  });

  it('never stores free text, documents, narratives, contacts or credentials', () => {
    const args = {
      description: 'Superb Staffing Solutions, a Memphis light industrial staffing firm',
      draft_text: 'Our team will deliver', rfp_text: 'SECTION L: offerors shall', text: 'vault narrative', draft: 'proposal draft',
      past_performance: ['Managed 40 temp staff for VA Memphis'], capabilities: ['forklift certified crews'],
      requirement: 'L.3.2 page limit', requirements: [{ requirement: 'L.3.2' }], cai: { what: 'drones' },
      client_name: 'Acme Holdings', query: 'our secret pricing strategy', keyword: 'superb staffing', q: 'free text',
      first_name: 'Geoff', last_name: 'Haas', email: 'a@b.com', phone: '901-555-0100',
      contacts: [{ first_name: 'Ambreen', email: 'x@y.com' }], company: 'Concord Professional Services',
      api_key: 'sk-live-123', token: 'pit-abc', location: 'Memphis, TN',
    };
    const out = redactToolArgs(args);
    for (const [k, v] of Object.entries(out)) expect(isRedacted(v), k).toBe(true);
    for (const s of ['Superb', 'Memphis', 'SECTION L', 'vault narrative', 'forklift', 'Geoff', 'Haas', 'a@b.com', '901-555', 'Ambreen', 'sk-live', 'pit-abc', 'Acme', 'secret pricing', 'Concord']) {
      expect(leaks(out, s), s).toBe(false);
    }
  });

  it('redacts invalid values in allowlisted fields and unknown agencies', () => {
    const out = redactToolArgs({ naics: 'we are a staffing firm', state: 'ZZ', uei: 'abcdefghijk1', agency: 'Acme Federal Services LLC', piid: 'w912eq24p0035' });
    for (const k of ['naics', 'state', 'uei', 'agency', 'piid']) expect(out[k], k).toMatchObject({ redacted: true, invalid: true });
  });

  it('recurses only into structured containers, using the container schema for enums', () => {
    const out = redactToolArgs({ filters: { naics: ['561320'], state: 'TN', q: 'secret phrase', agency: 'Department of Defense' }, bbox: { n: 36.1, s: 35.0, e: -89.7, w: -90.1 } });
    expect(out.filters).toMatchObject({ naics: ['561320'], state: 'TN', agency: 'Department of Defense' });
    expect((out.filters as Record<string, unknown>).q).toMatchObject({ redacted: true });
    expect(out.bbox).toEqual({ n: 36.1, s: 35.0, e: -89.7, w: -90.1 });
  });

  it('handles malformed input without throwing', () => {
    expect(redactToolArgs(undefined)).toEqual({});
    expect(redactToolArgs(null)).toEqual({});
    expect(redactToolArgs('a raw string of text')).toEqual({ _args: { redacted: true, invalid: true, type: 'string', len: 20 } });
    expect(redactToolArgs(['a', 'b'])).toMatchObject({ _args: { redacted: true, type: 'array', count: 2 } });
    const circular: Record<string, unknown> = { filters: {} };
    (circular.filters as Record<string, unknown>).filters = circular;
    expect(() => redactToolArgs(circular)).not.toThrow();
  });

  it('adds a keyed, non-reversible digest only when LOG_DIGEST_KEY is set', () => {
    expect(redactToolArgs({ query: 'same text' }).query).not.toHaveProperty('digest');
    process.env.LOG_DIGEST_KEY = 'k1';
    const a = redactToolArgs({ query: 'same text' }).query as { digest: string };
    expect(a.digest).toMatch(/^[0-9a-f]{16}$/);
    expect((redactToolArgs({ query: 'same text' }).query as { digest: string }).digest).toBe(a.digest);
    process.env.LOG_DIGEST_KEY = 'k2';
    expect((redactToolArgs({ query: 'same text' }).query as { digest: string }).digest).not.toBe(a.digest);
  });

  it('award-id fields reject phone, SSN, dotted, underscored and key-like values (second re-review)', () => {
    const out = redactToolArgs({
      piid: 'JOHN.SMITH-5715550100',
      parent_id: '571-555-0100',
      contract_ids: 'JANE-DOE-1,SSN-123-45-6789,PASS.HUNTER2',
      piids: ['123-45-6789'],
      solicitation_number: '5715550100',
    });
    for (const k of ['piid', 'parent_id', 'contract_ids', 'piids', 'solicitation_number']) expect(out[k], k).toMatchObject({ redacted: true });
    for (const s of ['JOHN', 'SMITH', '571-555', '5715550100', 'HUNTER2', '123-45-6789']) expect(leaks(out, s), s).toBe(false);
  });

  it('keeps real PIIDs, solicitation numbers and USASpending generated ids', () => {
    const real = {
      piid: 'W912EQ24P0035', solicitation_number: '36C24926Q0001', piids: ['N0018921F3006', 'GS07F0060N'],
      contract_ids: ['CONT_AWD_W912EQ24P0035_9700_-NONE-_-NONE-'], parent_id: 'CONT_IDV_GS07F0060N_4730',
    };
    expect(redactToolArgs(real)).toEqual(real);
  });

  it('bounds numeric values', () => {
    expect(redactToolArgs({ limit: 1e308 }).limit).toMatchObject({ redacted: true, invalid: true });
    expect(redactToolArgs({ limit: 50 }).limit).toBe(50);
  });

  it('award-id fields reject known credential prefixes even in uppercase PIID shape', () => {
    const out = redactToolArgs({ solicitation_number: 'AKIAIOSFODNN7EXAMPLE', piids: ['PIT-ABCD1234-EF56-7890'], piid: 'SK-PROJ1234ABCD' });
    for (const k of ['solicitation_number', 'piids', 'piid']) expect(out[k], k).toMatchObject({ redacted: true, invalid: true });
  });
});

