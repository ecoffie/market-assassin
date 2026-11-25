import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSamGreenBriefing, generateSamGreenEmailHtml } from './sam-green-email-template';

/**
 * REGRESSION (2026-11-23): a customer who cancelled and asked to stop emails kept getting the daily
 * "Active Solicitations" briefing. The briefing is gated by briefings_enabled, the one-click
 * unsubscribe only cleared alerts_enabled, and the briefing email had no unsubscribe link at all.
 */
describe('briefing one-click unsubscribe', () => {
  it('the briefing email carries an Unsubscribe link for the recipient (HTML and text)', () => {
    const briefing = buildSamGreenBriefing([]);
    const { htmlBody, textBody } = generateSamGreenEmailHtml(briefing as never, 'a+b@x.com');
    const link = '/api/alerts/unsubscribe?email=a%2Bb%40x.com';
    expect(htmlBody).toContain(link);
    expect(htmlBody).toContain('>Unsubscribe</a>');
    expect(textBody).toContain(link);
  });

  it('the unsubscribe route turns off briefings as well as alerts (GET and POST)', () => {
    const route = readFileSync(join(__dirname, '..', '..', '..', 'app', 'api', 'alerts', 'unsubscribe', 'route.ts'), 'utf8');
    const updates = route.match(/\.update\(\{[\s\S]*?\}, \{ count: 'exact' \}\)/g) || [];
    expect(updates.length).toBe(2);
    for (const u of updates) {
      expect(u).toContain('alerts_enabled: false');
      expect(u).toContain('briefings_enabled: false');
    }
  });
});
