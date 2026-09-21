import { describe, it, expect } from 'vitest';
import { generateSamGreenEmailHtml } from './delivery/sam-green-email-template';
import { generateTrackingPixel } from '@/lib/engagement';

/**
 * Guards the wiring, not the template. The template ALWAYS knew how to render a
 * pixel; the daily cron just never handed it a token, so 55,506 briefings went
 * out untracked while email_opened_at stayed NULL on every row. These assert the
 * token actually reaches the HTML — a regression here is invisible in prod until
 * someone asks "why is our open rate zero?" months later.
 */
const briefing = {
  date: '2026-08-15',
  opportunities: [],
  deadlinesThisWeek: [],
  actionTips: [],
  noticeSummary: { totalMatched: 0, rfp: 0, rfq: 0, sourcesSought: 0, preSol: 0, combined: 0, other: 0 },
} as never;

describe('briefing email tracking wiring', () => {
  it('renders the 1x1 tracking pixel when given a token', () => {
    const { htmlBody } = generateSamGreenEmailHtml(briefing, 'user@example.com', 'TESTTOKEN123');
    expect(htmlBody).toContain('/api/track?t=TESTTOKEN123');
    expect(htmlBody).toContain(generateTrackingPixel('TESTTOKEN123'));
    // Must sit inside the document so clients actually fetch it.
    expect(htmlBody.indexOf('TESTTOKEN123')).toBeLessThan(htmlBody.indexOf('</body>'));
  });

  it('renders NO tracking markup when no token is passed (the old, silent state)', () => {
    const { htmlBody } = generateSamGreenEmailHtml(briefing, 'user@example.com');
    expect(htmlBody).not.toContain('/api/track');
  });

  it('routes links through the click tracker when tracked', () => {
    const { htmlBody } = generateSamGreenEmailHtml(briefing, 'user@example.com', 'TOK9');
    expect(htmlBody).toContain('a=click');
  });
});
