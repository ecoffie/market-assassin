/**
 * #1: the "How this buyer buys" SB-fit badge on Target List cards, computed in the batched
 * target-enrichment route (dedup by agency, one computeBuyerBehavior per distinct agency) and
 * rendered on the card — matching the map exactly (tone friendly/mixed/gated → 🟢/🔒/🟡).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routeSrc = readFileSync(join(__dirname, 'route.ts'), 'utf8');
const panelSrc = readFileSync(join(__dirname, '../../../../components/app/panels/MyTargetListPanel.tsx'), 'utf8');

describe('target-enrichment computes buyer-behavior once per DISTINCT agency', () => {
  it('dedupes agencies (not one call per target) and calls computeBuyerBehavior', () => {
    expect(routeSrc).toContain('computeBuyerBehavior');
    expect(routeSrc).toContain('distinctAgencies');
    expect(routeSrc).toContain('[...new Set(rows.map(agencyKeyFor)');
  });
  it('attaches buyer_behavior to each enrichment entry, null when not grounded', () => {
    expect(routeSrc).toContain('buyer_behavior:');
    expect(routeSrc).toContain('bh.grounded ?');
  });
  it('is fail-soft — a behavior error never blocks enrichment', () => {
    expect(routeSrc).toContain('behaviorByAgency.set(agency, null)');
  });
});

describe('target card renders the badge matching the map tones', () => {
  it('maps tone → the same emoji as the map (friendly 🟢 / gated 🔒 / mixed 🟡)', () => {
    expect(panelSrc).toContain("behavior.tone === 'friendly'");
    expect(panelSrc).toContain("emoji: '🟢'");
    expect(panelSrc).toContain("emoji: '🔒'");
    expect(panelSrc).toContain("emoji: '🟡'");
  });
  it('only renders the pill when grounded (behavior present)', () => {
    expect(panelSrc).toContain('behavior && behaviorStyle &&');
  });
});
