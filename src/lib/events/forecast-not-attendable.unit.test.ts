import { describe, it, expect } from 'vitest';
import { ATTENDABLE_TYPES, isAttendableType } from './query';
import { classifyEvent } from './classify';

// Real titles from sam_events, read 2026-11-09.
const TODAY = new Date('2026-11-09T12:00:00Z');

describe('forecast notices are not attendable events (search + map share ATTENDABLE_TYPES)', () => {
  it('forecast and rfi are notices; industry days, webinars and conferences are events', () => {
    expect(ATTENDABLE_TYPES).toEqual(['industry_day', 'webinar', 'conference']);
    expect(isAttendableType('forecast')).toBe(false);
    expect(isAttendableType('rfi')).toBe(false);
    expect(isAttendableType(null)).toBe(false);
    for (const t of ['industry_day', 'webinar', 'conference']) expect(isAttendableType(t)).toBe(true);
  });

  it('procurement forecasts and projection lists classify as forecast, so they list as notices', () => {
    for (const title of ['DCSA FY27 Procurement Forecast', 'FY2027 Projections', 'DLA Distribution Business Opportunities Forecast']) {
      const c = classifyEvent(title, null, TODAY);
      expect(c?.type, title).toBe('forecast');
      expect(isAttendableType(c?.type), title).toBe(false);
    }
  });

  it('a weather "Forecast Office" notice is never shown as an event', () => {
    const c = classifyEvent('NWS Forecast Office Pittsburgh, PA Window Film, Interior Painting', null, TODAY);
    expect(isAttendableType(c?.type)).toBe(false);
  });

  it('the genuine event once typed forecast is still an event', () => {
    const c = classifyEvent('Small Business Event - Acquisition Executive Small Business Forum', 'Join the forecast briefing.', TODAY);
    expect(c).toEqual({ type: 'industry_day', evidence: 'title' });
  });

  it('genuine industry days and RFIs keep their classes', () => {
    expect(classifyEvent('V225--VA AIR AMBULANCE BROKER VIRTUAL INDUSTRY DAY NOTICE', null, TODAY)?.type).toBe('industry_day');
    expect(classifyEvent('Chemical Toilets', 'CHEMICAL TOILET SERVICES INDUSTRY DAY &ndash; NOVEMBER 17, 2026', TODAY)?.type).toBe('industry_day');
    expect(classifyEvent('S218--RFI New Snow & Ice Removal - CI', 'This is a Request for Information.', TODAY)?.type).toBe('rfi');
    expect(classifyEvent('Regional Small Business Matchmaking', null, TODAY)?.type).toBe('industry_day');
  });
});
