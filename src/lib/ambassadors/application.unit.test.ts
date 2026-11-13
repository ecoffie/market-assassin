import { describe, expect, it } from 'vitest';
import { parseAmbassadorApplication, ambassadorSlackMessage } from './application';

const good = {
  name: 'Sue Kranes',
  email: 'Sue@Example.com ',
  postUrl: 'linkedin.com/in/sue',
  company: 'Kranes Federal LLC',
  uei: 'abc1-2345 6789',
  lastEvent: 'Fort Bragg Small Business Industry Day',
  pursuit: 'Sources sought response to Army MICC for grounds maintenance',
  wantToFind: 'Which offices buy grounds maintenance in my state',
  attested: 'on',
};

describe('parseAmbassadorApplication', () => {
  it('accepts the five things plus name, email and the attestation, and normalizes them', () => {
    const r = parseAmbassadorApplication(good);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.app.email).toBe('sue@example.com');
    expect(r.app.postUrl).toBe('https://linkedin.com/in/sue');
    expect(r.app.uei).toBe('ABC123456789');
    expect(r.app.attested).toBe(true);
  });

  it('requires every field', () => {
    const r = parseAmbassadorApplication({});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.sort()).toEqual(['attested', 'company', 'email', 'lastEvent', 'name', 'postUrl', 'pursuit', 'uei', 'wantToFind']);
  });

  it.each([
    ['too short', 'ABC12345678'],
    ['too long', 'ABC1234567890'],
    ['punctuation', 'ABC12345678!'],
    ['empty', ''],
  ])('rejects a UEI that is %s', (_label, uei) => {
    const r = parseAmbassadorApplication({ ...good, uei });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual(['uei']);
  });

  it('rejects a bad post link and an unticked attestation', () => {
    const r = parseAmbassadorApplication({ ...good, postUrl: 'not a url', attested: false });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.sort()).toEqual(['attested', 'postUrl']);
  });

  it('keeps one-line answers on one line', () => {
    const r = parseAmbassadorApplication({ ...good, pursuit: 'Bid in progress\nfor VA roofing' });
    if (!r.ok) throw new Error('should parse');
    expect(r.app.pursuit).toBe('Bid in progress for VA roofing');
  });

  it('rejects an empty body', () => {
    expect(parseAmbassadorApplication(null).ok).toBe(false);
  });

  it('escapes user text in the Slack message', () => {
    const r = parseAmbassadorApplication({ ...good, wantToFind: '<@channel> please & thanks' });
    if (!r.ok) throw new Error('should parse');
    expect(JSON.stringify(ambassadorSlackMessage(r.app).blocks)).toContain('&lt;@channel&gt; please &amp; thanks');
  });
});
