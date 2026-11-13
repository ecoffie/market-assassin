import { describe, it, expect, afterEach } from 'vitest';
import { redactToolArgs } from './redact-args';

afterEach(() => { delete process.env.LOG_DIGEST_KEY; });

const isRedacted = (v: unknown) => typeof v === 'object' && v !== null && (v as { redacted?: boolean }).redacted === true;
const leaks = (out: unknown, secret: string) => JSON.stringify(out).toLowerCase().includes(secret.toLowerCase());

describe('redactToolArgs — strict allowlist', () => {
  it('keeps validated structured filters verbatim', () => {
    const args = {
      naics: '561320', naics_codes: ['561311', '5613'], psc: 'R706', state: 'TN', states: ['MS', 'AR'],
      agency: 'Department of Veterans Affairs', uei: 'NZ7CS4E6R7K6', piid: 'W912EQ24P0035', notice_id: 'abc123def456',
      date_from: '2019-01-01', months_window: 18, limit: 50, include_idv: true, search_type: 'task', fiscal_year: '2026',
    };
    expect(redactToolArgs(args)).toEqual(args);
  });

  it('accepts comma lists of valid codes', () => {
    expect(redactToolArgs({ naics: '561320, 561311', state: 'TN,MS,AR' })).toEqual({ naics: '561320, 561311', state: 'TN,MS,AR' });
  });

  it('never stores free text, documents, narratives, contacts or credentials', () => {
    const rfp = 'SECTION L: offerors shall describe their staffing approach';
    const args = {
      description: 'Superb Staffing Solutions, a Memphis light industrial staffing firm',
      draft_text: 'Our team will deliver', rfp_text: rfp, text: 'vault narrative', draft: 'proposal draft',
      past_performance: ['Managed 40 temp staff for VA Memphis'], capabilities: ['forklift certified crews'],
      requirement: 'L.3.2 page limit', requirements: [{ requirement: 'L.3.2' }], cai: { what: 'drones' },
      client_name: 'Acme Holdings', query: 'our secret pricing strategy', keyword: 'superb staffing', q: 'free text',
      first_name: 'Geoff', last_name: 'Haas', email: 'a@b.com', phone: '901-555-0100',
      contacts: [{ first_name: 'Ambreen', email: 'x@y.com', phone: '555' }], company: 'Concord Professional Services',
      api_key: 'sk-live-123', token: 'pit-abc',
    };
    const out = redactToolArgs(args);
    for (const [k, v] of Object.entries(out)) expect(isRedacted(v), k).toBe(true);
    for (const s of ['Superb', 'Memphis', 'SECTION L', 'vault narrative', 'forklift', 'Geoff', 'Haas', 'a@b.com', '901-555', 'Ambreen', 'sk-live', 'pit-abc', 'Acme', 'secret pricing', 'Concord']) {
      expect(leaks(out, s), s).toBe(false);
    }
    expect(out.description).toMatchObject({ type: 'string', len: args.description.length });
    expect(out.contacts).toMatchObject({ type: 'array', count: 1 });
    expect(out.cai).toMatchObject({ type: 'object' });
  });

  it('redacts an allowlisted field whose value is not a valid code or id (no smuggling)', () => {
    const out = redactToolArgs({ naics: 'we are a staffing firm in Memphis', notice_id: 'contact Geoff at 901', agency: 'x'.repeat(150), uei: 'short' });
    for (const k of ['naics', 'notice_id', 'agency', 'uei']) expect(out[k], k).toMatchObject({ redacted: true, invalid: true });
    expect(leaks(out, 'Memphis')).toBe(false);
    expect(leaks(out, 'Geoff')).toBe(false);
  });

  it('recurses only into structured containers and applies the same allowlist there', () => {
    const out = redactToolArgs({ filters: { naics: ['561320'], state: 'TN', q: 'secret phrase', advanced: { x: 1 } }, bbox: { n: 36.1, s: 35.0, e: -89.7, w: -90.1 } });
    expect(out.filters).toMatchObject({ naics: ['561320'], state: 'TN' });
    expect((out.filters as Record<string, unknown>).q).toMatchObject({ redacted: true });
    expect((out.filters as Record<string, unknown>).advanced).toMatchObject({ redacted: true, type: 'object' });
    expect(out.bbox).toEqual({ n: 36.1, s: 35.0, e: -89.7, w: -90.1 });
    expect(leaks(out, 'secret phrase')).toBe(false);
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
    const b = redactToolArgs({ query: 'same text' }).query as { digest: string };
    expect(a.digest).toMatch(/^[0-9a-f]{16}$/);
    expect(a.digest).toBe(b.digest);
    process.env.LOG_DIGEST_KEY = 'k2';
    expect((redactToolArgs({ query: 'same text' }).query as { digest: string }).digest).not.toBe(a.digest);
  });
});
