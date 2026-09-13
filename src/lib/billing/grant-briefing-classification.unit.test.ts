import { describe, it, expect } from 'vitest';
import { briefingGrantForPurchase } from '../briefings/product-entitlement';
import { nextBriefingsAccess } from './grant-briefing-classification';

describe('nextBriefingsAccess — Path A must write the send-path gate', () => {
  const mindyAi = briefingGrantForPurchase('Mindy Ai', 14900);

  it('upgrades insert-only beta_preview after a $149 Mindy Ai checkout (Adam)', () => {
    const d = nextBriefingsAccess({ existingAccess: 'beta_preview', grant: mindyAi });
    expect(d.write).toBe(true);
    if (d.write) expect(d.access).toBe('subscription');
  });

  it('upgrades a missing classification row', () => {
    const d = nextBriefingsAccess({ existingAccess: null, grant: mindyAi });
    expect(d.write).toBe(true);
    if (d.write) expect(d.access).toBe('subscription');
  });

  it('never overwrites excluded', () => {
    expect(nextBriefingsAccess({ existingAccess: 'excluded', grant: mindyAi })).toEqual({
      write: false,
      reason: 'excluded wins',
    });
  });

  it('never downgrades lifetime', () => {
    expect(nextBriefingsAccess({ existingAccess: 'lifetime', grant: mindyAi })).toEqual({
      write: false,
      reason: 'already lifetime',
    });
  });

  it('is idempotent on an already-subscription row', () => {
    const d = nextBriefingsAccess({ existingAccess: 'subscription', grant: mindyAi });
    expect(d.write).toBe(true);
    if (d.write) expect(d.access).toBe('subscription');
  });

  it('does not revoke when the product does not earn briefings', () => {
    const mcp = briefingGrantForPurchase('Mindy MCP — Entry', 99000);
    const d = nextBriefingsAccess({ existingAccess: 'beta_preview', grant: mcp });
    expect(d.write).toBe(false);
  });
});
