/** formatProfileForPrompt feeds Ask Mindy chat, proposal chat and proposal drafting. Set-aside PREFERENCES
 * (user_notification_settings.set_aside_preferences) must never be presented as certifications held. */
import { describe, expect, it } from 'vitest';
import { formatProfileForPrompt } from './loaders';

describe('formatProfileForPrompt', () => {
  it('labels set-aside preferences as targets, never as certifications', () => {
    const out = formatProfileForPrompt({ naicsCodes: ['561320'], setAsides: ['SDVOSB', 'HUBZone'] });
    expect(out).toContain('Target set-asides (preferences, not certifications): SDVOSB, HUBZone');
    expect(out).not.toMatch(/set-aside certs/i);
    expect(out).not.toMatch(/certifications:\s*SDVOSB/i);
  });

  it('leaves the rest of the block unchanged', () => {
    expect(formatProfileForPrompt({ companyName: 'Example Staffing Co', naicsCodes: ['561320'], locationStates: ['TN'] }))
      .toBe('Company: Example Staffing Co\nNAICS: 561320\nLocations: TN');
    expect(formatProfileForPrompt({})).toBe('No saved profile — write generically with [Company name] placeholders.');
  });
});
