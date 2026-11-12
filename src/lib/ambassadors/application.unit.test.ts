import { describe, expect, it } from 'vitest';
import { parseAmbassadorApplication, ambassadorSlackMessage } from './application';

const good = {
  name: 'Sue Kranes', email: 'Sue@Example.com ', role: 'APEX advisor', company: 'NCMBC',
  linkedinUrl: 'linkedin.com/in/sue', websiteUrl: '', audienceSize: '2,000–10,000',
  audience: '3,000 small contractors in North Carolina', why: 'My clients ask me for this every week',
  promotePlan: 'Monthly workshop demos and LinkedIn posts',
};

describe('parseAmbassadorApplication', () => {
  it('accepts a complete application and normalizes email and URLs', () => {
    const r = parseAmbassadorApplication(good);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.app.email).toBe('sue@example.com');
    expect(r.app.linkedinUrl).toBe('https://linkedin.com/in/sue');
    expect(r.app.websiteUrl).toBeUndefined();
  });

  it('names every missing or bad field', () => {
    const r = parseAmbassadorApplication({ ...good, email: 'nope', role: '', audienceSize: 'lots', why: 'x', linkedinUrl: 'not a url' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.sort()).toEqual(['audienceSize', 'email', 'linkedinUrl', 'role', 'why']);
  });

  it('rejects an empty body', () => {
    const r = parseAmbassadorApplication(null);
    expect(r.ok).toBe(false);
  });

  it('escapes user text in the Slack message', () => {
    const r = parseAmbassadorApplication({ ...good, why: '<@channel> please & thanks' });
    if (!r.ok) throw new Error('should parse');
    expect(JSON.stringify(ambassadorSlackMessage(r.app).blocks)).toContain('&lt;@channel&gt; please &amp; thanks');
  });
});
