import { describe, it, expect } from 'vitest';
import { getClassifyV2PrivateInputs, CLASSIFY_V2_LIST_ENV, CLASSIFY_V2_ROLLBACK_PATH_ENV } from './classify-v2-private-inputs';

const at = '@';
const full = {
  [CLASSIFY_V2_LIST_ENV.expectedInnerCircle]: `A${at}example.com, b${at}example.com`,
  [CLASSIFY_V2_LIST_ENV.internalTeam]: `t${at}example.com`,
  [CLASSIFY_V2_LIST_ENV.compTestimonial]: `c${at}example.com`,
  [CLASSIFY_V2_LIST_ENV.spotChecks]: `s${at}example.com`,
};

describe('classify-customers-v2 private inputs', () => {
  it('refuses when any list is missing (never runs with empty lists)', () => {
    const r = getClassifyV2PrivateInputs({ ...full, [CLASSIFY_V2_LIST_ENV.internalTeam]: '' }, 'preview', '/srv/app');
    expect(r).toEqual({ ok: false, missing: [CLASSIFY_V2_LIST_ENV.internalTeam] });
  });
  it('preview needs no rollback path; lists are normalised', () => {
    const r = getClassifyV2PrivateInputs(full, 'preview', '/srv/app');
    expect(r.ok && r.lists.expectedInnerCircle).toEqual([`a${at}example.com`, `b${at}example.com`]);
    expect(r.ok && r.rollbackPath).toBeNull();
  });
  it('execute requires an absolute rollback path outside the repository', () => {
    expect(getClassifyV2PrivateInputs(full, 'execute', '/srv/app')).toEqual({ ok: false, missing: [CLASSIFY_V2_ROLLBACK_PATH_ENV] });
    expect(getClassifyV2PrivateInputs({ ...full, [CLASSIFY_V2_ROLLBACK_PATH_ENV]: '/srv/app/scripts/r.sql' }, 'execute', '/srv/app').ok).toBe(false);
    expect(getClassifyV2PrivateInputs({ ...full, [CLASSIFY_V2_ROLLBACK_PATH_ENV]: 'scripts/r.sql' }, 'execute', '/srv/app').ok).toBe(false);
    const r = getClassifyV2PrivateInputs({ ...full, [CLASSIFY_V2_ROLLBACK_PATH_ENV]: '/private/r.sql' }, 'execute', '/srv/app');
    expect(r.ok && r.rollbackPath).toBe('/private/r.sql');
  });
});
