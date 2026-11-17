import { describe, it, expect } from 'vitest';
import { abilityOneCaveat, ABILITYONE_CAVEAT_NOTE } from './category-caveats';

describe('abilityOneCaveat: grounded by the category of the work named in this message', () => {
  it.each([
    'I run a small janitorial company in Florida',
    'custodial services at VA hospitals',
    'Who hires janitors in Tampa?',
  ])('janitorial words → the caveat (%s)', (t) => {
    expect(abilityOneCaveat(t)).toBe(ABILITYONE_CAVEAT_NOTE);
  });
  it('the janitorial NAICS code → the caveat', () => {
    expect(abilityOneCaveat('who buys this in FL', ['561720'])).toBe(ABILITYONE_CAVEAT_NOTE);
  });
  it.each(['HVAC services in Texas', 'Who is the small business contact at the top one?', 'roofing'])('other work → none (%s)', (t) => {
    expect(abilityOneCaveat(t, ['238220'])).toBeNull();
  });
  it('states the program rule, after the answer, and never asserts a specific requirement is on the list', () => {
    expect(ABILITYONE_CAVEAT_NOTE).toMatch(/FAR subpart 8\.7/);
    expect(ABILITYONE_CAVEAT_NOTE).toMatch(/after the answer, not before it/);
    expect(ABILITYONE_CAVEAT_NOTE).toMatch(/Never say a specific requirement or office is on the list unless a result shows it/);
    expect(ABILITYONE_CAVEAT_NOTE).toMatch(/do not repeat it/);
  });
});
