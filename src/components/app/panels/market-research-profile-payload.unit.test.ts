import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSaveResearchProfilePayload } from './market-research-profile-payload';

const base = {
  email: 'u@example.com',
  naicsCodes: ['238910'],
  pscCodes: ['P500'],
  keyword: ' demolition ',
};

describe('buildSaveResearchProfilePayload — a partial update changes only submitted fields', () => {
  it('omits businessType when the user did not choose one (the defaulted value)', () => {
    const body = buildSaveResearchProfilePayload({ ...base, businessType: 'Small Business', businessTypeChosenByUser: false });
    expect('businessType' in body).toBe(false);
    expect(body).toEqual({ email: 'u@example.com', naicsCodes: ['238910'], pscCodes: ['P500'], keywords: ['demolition'] });
  });

  it('omits businessType normalized from the stored profile (lossy, not a user choice)', () => {
    const body = buildSaveResearchProfilePayload({ ...base, businessType: 'Women Owned', businessTypeChosenByUser: false });
    expect('businessType' in body).toBe(false);
  });

  it('sends businessType when the user explicitly picked it', () => {
    const body = buildSaveResearchProfilePayload({ ...base, businessType: '8(a) Certified', businessTypeChosenByUser: true });
    expect(body.businessType).toBe('8(a) Certified');
  });

  it('never turns an explicit "Any business type" (empty) pick into a clear or a default', () => {
    const body = buildSaveResearchProfilePayload({ ...base, businessType: '', businessTypeChosenByUser: true });
    expect('businessType' in body).toBe(false);
  });

  it('empty keyword → empty keywords array', () => {
    expect(buildSaveResearchProfilePayload({ ...base, keyword: '  ', businessType: '', businessTypeChosenByUser: false }).keywords).toEqual([]);
  });
});

describe('wiring — the panel save and the route honour the invariant', () => {
  const panel = readFileSync(join(__dirname, 'MarketResearchPanel.tsx'), 'utf8');
  const route = readFileSync(join(process.cwd(), 'src/app/api/app/profile/route.ts'), 'utf8');

  it('the save-to-profile call builds its body with the payload builder', () => {
    const start = panel.indexOf('const saveResearchToProfile');
    expect(start).toBeGreaterThan(-1);
    const block = panel.slice(start, panel.indexOf('}, [email', start));
    expect(block).toContain('buildSaveResearchProfilePayload(');
    expect(block).not.toMatch(/businessType:\s*formData\.businessType\s*\|\|\s*'Small Business'/);
  });

  it('only the business-type select marks the field as user-chosen', () => {
    const sets = panel.match(/businessTypeChosenByUserRef\.current = true/g) || [];
    expect(sets.length).toBe(2);
  });

  it('the profile route leaves business_type alone when the field is omitted', () => {
    expect(route).toMatch(/if \(businessType !== undefined\) \{\s*updateData\.business_type/);
  });
});
