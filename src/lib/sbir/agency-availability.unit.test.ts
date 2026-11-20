import { describe, expect, it } from 'vitest';
import { finishedSbirBody, planSbirAgency, sbirPanelFromResponse, unavailableSbirBody } from './agency-availability';

describe('planSbirAgency', () => {
  it('does not send NSF down the NIH path', () => {
    const plan = planSbirAgency({ agency: 'NSF' });
    expect(plan.kind).toBe('unavailable');
    if (plan.kind !== 'unavailable') return;
    expect(plan.source).toBe('nsf');
    expect(plan.reason).toMatch(/403/);
    expect(plan.reason).toMatch(/not a count of zero/);
  });

  it('sends every roster NIH institute to RePORTER, including ones outside the old 11-code list', () => {
    for (const code of ['NCI', 'NIDA', 'NEI', 'NHGRI', 'NIBIB', 'NCATS', 'NLM', 'FIC']) {
      expect(planSbirAgency({ agency: code })).toEqual({ kind: 'search', source: 'nih' });
    }
    expect(planSbirAgency({ agency: '', source: 'nih' })).toEqual({ kind: 'search', source: 'nih' });
  });

  it('does not treat a non-NIH agency on the default source as an NIH search', () => {
    const plan = planSbirAgency({ agency: 'NASA' });
    expect(plan.kind).toBe('unavailable');
    if (plan.kind !== 'unavailable') return;
    expect(plan.source).toBe('nasa');
    expect(plan.reason).toMatch(/not a count of zero NASA/);
  });
});

describe('response envelopes', () => {
  it('an unavailable source is degraded and has no count', () => {
    const body = unavailableSbirBody({
      keyword: '',
      agency: 'NSF',
      phase: 'all',
      limit: 25,
      source: 'nsf',
      reason: 'NSF SBIR is unavailable. api.www.sbir.gov returns HTTP 403.',
    });
    expect(body.count).toBeNull();
    expect(body.opportunities).toEqual([]);
    expect(body.result_state).toBe('unavailable');
    expect(body.source).toBe('nsf');
    expect(body._degraded).toBe(true);
    expect(body.unavailable_reason).toMatch(/403/);
  });

  it('a queried source with no rows is an empty result, not unavailable', () => {
    const body = finishedSbirBody({
      keyword: 'no-such-term',
      agency: 'NCI',
      phase: 'all',
      requestedSource: 'nih',
      answeredSource: 'nih',
      opportunities: [],
      limit: 25,
    });
    expect(body.count).toBe(0);
    expect(body.result_state).toBe('empty');
    expect(body.source).toBe('nih');
    expect(body).not.toHaveProperty('_degraded');
    expect(body.empty_reason).toMatch(/empty result/);
  });

  it('the panel treats an unavailable NSF body as a reason, not an empty list', () => {
    const shown = sbirPanelFromResponse({
      success: true,
      opportunities: [],
      result_state: 'unavailable',
      unavailable_reason: 'NSF SBIR is unavailable. api.www.sbir.gov returns HTTP 403.',
      count: null,
      _degraded: true,
    } as { opportunities: unknown[]; result_state: string; unavailable_reason: string; count: null; _degraded: boolean });
    expect(shown.opportunities).toEqual([]);
    expect(shown.unavailableReason).toMatch(/403/);
    expect(shown.error).toBeNull();
  });
});
