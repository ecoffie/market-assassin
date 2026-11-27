import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSamGreenBriefing, generateSamGreenEmailHtml } from './sam-green-email-template';
import { UNSUBSCRIBE_URL_PLACEHOLDER } from '@/lib/email/unsubscribe';

/**
 * REGRESSION (2026-11-23): a customer who cancelled and asked to stop emails kept getting the daily
 * "Active Solicitations" briefing. The briefing is gated by briefings_enabled, the one-click
 * unsubscribe only cleared alerts_enabled, and the briefing email had no unsubscribe link at all.
 */
describe('briefing one-click unsubscribe', () => {
  it('the briefing email carries an Unsubscribe link for the recipient (HTML and text)', () => {
    const briefing = buildSamGreenBriefing([]);
    const { htmlBody, textBody } = generateSamGreenEmailHtml(briefing as never, 'a+b@x.com');
    // 2026-11-27: the footer carries the shared placeholder; sendEmail() fills the recipient's SIGNED one-click link
    // (src/lib/email/unsubscribe.ts). The old ?email= link let anyone unsubscribe anyone.
    expect(htmlBody).toContain(`href="${UNSUBSCRIBE_URL_PLACEHOLDER}">Unsubscribe</a>`);
    expect(textBody).toContain(`Unsubscribe: ${UNSUBSCRIBE_URL_PLACEHOLDER}`);
    expect(htmlBody).not.toContain('?email=');
  });

  it('every unsubscribe path turns off briefings as well as alerts (shared applyUnsubscribe)', () => {
    const apply = readFileSync(join(__dirname, '..', '..', 'email', 'unsubscribe-apply.ts'), 'utf8');
    const update = apply.match(/\.update\(\{[^}]*\}/)![0];
    expect(update).toContain('alerts_enabled: false');
    expect(update).toContain('briefings_enabled: false');
    for (const route of [['app', 'api', 'unsubscribe', 'route.ts'], ['app', 'api', 'alerts', 'unsubscribe', 'route.ts']]) {
      expect(readFileSync(join(__dirname, '..', '..', '..', ...route), 'utf8')).toContain('applyUnsubscribe(');
    }
  });
});
