import { describe, it, expect } from 'vitest';
import { detectDeliverableRequest, deliverableNote } from './deliverable-requests';

describe('deliverable requests (Agent 4 S3: "offer, then nothing")', () => {
  it('a plan asked for as a PDF is a file request with a day count', () => {
    expect(detectDeliverableRequest('Give me a 90-day plan as a PDF')).toEqual({ wantsFile: true, format: 'PDF', dayPlan: 90 });
    expect(detectDeliverableRequest('Can you put together a capability statement in Word?')).toMatchObject({ wantsFile: true, format: 'WORD' });
    expect(detectDeliverableRequest('Turn this into an Excel spreadsheet report')).toMatchObject({ wantsFile: true, format: 'EXCEL' });
    expect(detectDeliverableRequest('Create a checklist for SAM registration')).toEqual({ wantsFile: false, format: null, dayPlan: null });
    expect(detectDeliverableRequest('Make a summary of these as a PDF')).toMatchObject({ wantsFile: true, format: 'PDF' });
    expect(detectDeliverableRequest('Write me a 60-day plan')).toEqual({ wantsFile: false, format: null, dayPlan: 60 });
  });
  it('Agent 4 false triggers are NEVER deliverable requests (uploads, export control, SAM downloads, weak nouns)', () => {
    for (const t of [
      'Can you summarize the attachment I uploaded?',
      'Are there export control compliance contracts?',
      'Find export-controlled items opportunities',
      'Can you download the solicitation documents for W912PL?',
      'check the schedule for the industry day',
      'give me a summary of the Navy market',
      'help with my strategy for DLA',
      'export this to excel',
    ]) expect(detectDeliverableRequest(t), t).toBeNull();
  });
  it('questions ABOUT a deliverable and ordinary questions are not requests', () => {
    expect(detectDeliverableRequest('What is a 90-day plan?')).toBeNull();
    expect(detectDeliverableRequest('Who are the top buyers in Texas?')).toBeNull();
  });
  it('the note says one line about the file, then deliver; never offer-only', () => {
    const n = deliverableNote('Give me a 90-day plan as a PDF', '2026-11-17')!;
    expect(n).toContain('Never offer without delivering');
    expect(n).toMatch(/ONE short line/);
    expect(n).toMatch(/Do NOT stop after saying you can't/);
    expect(n).toMatch(/by title and solicitation number/);
  });
  it('a 90-day plan gets real inclusive dated phases from today', () => {
    const n = deliverableNote('Give me a 90-day plan as a PDF', '2026-11-17')!;
    expect(n).toContain('2026-11-17 to 2026-12-16 (days 1–30)');
    expect(n).toContain('2026-12-17 to 2027-01-15 (days 31–60)');
    expect(n).toContain('2027-01-16 to 2027-02-14 (days 61–90)');
  });
  it('no request → no note', () => {
    expect(deliverableNote('Which agencies buy HVAC in Texas?', '2026-11-17')).toBeNull();
  });
});
