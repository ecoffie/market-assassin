import { describe, expect, it } from 'vitest';
import { mapBqTaskOrderRow, sanitizeTaskOrderKeyword } from './task-orders-bq';

describe('sanitizeTaskOrderKeyword', () => {
  it('keeps a lowercase phrase and drops punctuation', () => {
    expect(sanitizeTaskOrderKeyword('Window-Washing!')).toBe('window washing');
  });

  it('rejects short or empty input so the query cannot fan out', () => {
    expect(sanitizeTaskOrderKeyword('')).toBeNull();
    expect(sanitizeTaskOrderKeyword('abc')).toBeNull();
    expect(sanitizeTaskOrderKeyword('!!!')).toBeNull();
  });
});

describe('mapBqTaskOrderRow', () => {
  it('maps a warehouse task order onto a beginner search item', () => {
    const item = mapBqTaskOrderRow({
      award_id: 'CONT_AWD_47PE5226F0047_4732_47PM0725D0002_4732',
      piid: '47PE5226F0047',
      parent_piid: '47PM0725D0002',
      recipient_name: 'ACME JANITORIAL LLC',
      awarding_agency: 'GENERAL SERVICES ADMINISTRATION',
      naics_code: '561720',
      naics_description: 'Janitorial Services',
      description: 'TASK ORDER FOR WINDOW WASHING AT THE FEDERAL BUILDING',
      obligation_amount: 18420.5,
      action_date: '2026-03-11',
      pop_state: 'SD',
      pop_city: 'SIOUX FALLS',
    });
    expect(item.type).toBe('Task Order');
    expect(item.title).toMatch(/WINDOW WASHING/i);
    expect(item.solicitation).toBe('47PE5226F0047');
    expect(item.agency).toBe('GENERAL SERVICES ADMINISTRATION');
    expect(item.amount).toBe(18420.5);
    expect(item.link).toBe(
      'https://www.usaspending.gov/award/CONT_AWD_47PE5226F0047_4732_47PM0725D0002_4732',
    );
    expect(item.deadline).toBe('2026-03-11');
    expect(item.location?.pop_state).toBe('SD');
  });

  it('omits a fabricated amount when obligation_amount is missing', () => {
    const item = mapBqTaskOrderRow({
      award_id: 'CONT_AWD_X',
      piid: 'X',
      parent_piid: 'Y',
      recipient_name: null,
      awarding_agency: null,
      naics_code: null,
      naics_description: null,
      description: 'lidar survey task order',
      obligation_amount: null,
      action_date: null,
      pop_state: null,
      pop_city: null,
    });
    expect(item.amount).toBeUndefined();
    expect(item.deadline).toBeNull();
  });
});
