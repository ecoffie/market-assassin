import { describe, it, expect } from 'vitest';
import { redactToolArgs } from './redact-args';

describe('redactToolArgs', () => {
  it('keeps ordinary filters verbatim', () => {
    expect(redactToolArgs({ naics: '561320', state: 'TN', months_window: 18, include_idv: true })).toEqual({
      naics: '561320', state: 'TN', months_window: 18, include_idv: true,
    });
  });

  it('masks secrets and contact fields', () => {
    const r = redactToolArgs({ api_key: 'sk-123', token: 'abc', email: 'a@b.com', phone: '555', ghl_token: 'pit-1' });
    expect(r).toEqual({ api_key: '[secret]', token: '[secret]', email: '[contact]', phone: '[contact]', ghl_token: '[secret]' });
  });

  it('replaces document text and long strings with length + hash, never the text', () => {
    const rfp = 'SECTION L INSTRUCTIONS '.repeat(400);
    const r = redactToolArgs({ rfp_text: rfp, description: 'short but document-named', note: 'x'.repeat(600) });
    for (const k of ['rfp_text', 'description', 'note']) {
      expect(r[k]).toMatchObject({ redacted: true });
      expect(JSON.stringify(r[k])).not.toContain('SECTION');
    }
    expect((r.rfp_text as { len: number }).len).toBe(rfp.length);
  });

  it('identical text hashes identically (calls stay comparable)', () => {
    const a = redactToolArgs({ text: 'y'.repeat(800) });
    const b = redactToolArgs({ text: 'y'.repeat(800) });
    expect(a).toEqual(b);
  });

  it('recurses into nested objects and bounds arrays', () => {
    const r = redactToolArgs({ contacts: [{ name: 'A', email: 'a@b.com' }], codes: Array.from({ length: 60 }, (_, i) => String(i)) });
    expect((r.contacts as Array<Record<string, unknown>>)[0]).toEqual({ name: 'A', email: '[contact]' });
    expect((r.codes as string[]).length).toBe(51);
  });

  it('handles empty input', () => {
    expect(redactToolArgs(undefined)).toEqual({});
    expect(redactToolArgs(null)).toEqual({});
  });
});
