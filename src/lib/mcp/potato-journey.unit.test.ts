/**
 * Potato v1 orchestration — no new MCP tools, no new datasets.
 */
import { describe, it, expect } from 'vitest';
import {
  composeActFromPathwayFit,
  HOST_RULES_ACT,
  HOST_RULES_MONITOR,
  HOST_RULES_POSITION,
  HOST_RULES_TALENT_THIN,
  positionSectionTitles,
  POTATO_JOURNEY_INSTRUCTIONS,
} from './potato-journey';
import { MCP_CONNECTOR_INSTRUCTIONS } from './schedule-discovery';

describe('Potato v1 journey copy', () => {
  it('is wired into connector instructions', () => {
    expect(MCP_CONNECTOR_INSTRUCTIONS).toContain(POTATO_JOURNEY_INSTRUCTIONS);
    expect(MCP_CONNECTOR_INSTRUCTIONS).toContain(HOST_RULES_TALENT_THIN[0]);
    expect(MCP_CONNECTOR_INSTRUCTIONS).toContain(HOST_RULES_POSITION[0]);
    expect(MCP_CONNECTOR_INSTRUCTIONS).toContain(HOST_RULES_ACT[0]);
    expect(MCP_CONNECTOR_INSTRUCTIONS).toContain(HOST_RULES_MONITOR[0]);
  });

  it('does not require GovCon vocabulary to start', () => {
    expect(POTATO_JOURNEY_INSTRUCTIONS).toMatch(/they will not say SAM/i);
    expect(POTATO_JOURNEY_INSTRUCTIONS).toMatch(/help me/i);
  });

  it('keeps owner-asserted from becoming public-verified', () => {
    expect(HOST_RULES_TALENT_THIN.join('\n')).toMatch(/OWNER_ASSERTED/);
    expect(HOST_RULES_TALENT_THIN.join('\n')).toMatch(/Never relabel them PUBLIC_VERIFIED/);
    expect(HOST_RULES_POSITION.join('\n')).toMatch(/Owner-asserted/);
  });

  it('monitor waits for confirmation and discloses coverage', () => {
    const blob = HOST_RULES_MONITOR.join('\n');
    expect(blob).toMatch(/wait for confirmation/i);
    expect(blob).toMatch(/Coming back/);
    expect(blob).toMatch(/not emailed/);
  });

  it('act is one grounded action, not a checklist', () => {
    expect(HOST_RULES_ACT.join('\n')).toMatch(/ONE primary/);
    expect(HOST_RULES_ACT.join('\n')).toMatch(/generic GovCon checklist/i);
  });
});

describe('composeActFromPathwayFit', () => {
  it('honest miss with no proof question → stop, do not invent a pursuit', () => {
    const act = composeActFromPathwayFit({ no_proven_door: true, next_prompt: null, top_safe_next_action: null });
    expect(act.source).toBe('honest_miss_stop');
    expect(act.primary.toLowerCase()).toMatch(/cannot responsibly recommend/);
  });

  it('positive door uses the top safe next action', () => {
    const act = composeActFromPathwayFit({
      no_proven_door: false,
      next_prompt: 'Do you have a working capability you can demonstrate today?',
      top_safe_next_action: 'Treat as a pitch/demo candidate only after confirming a working capability you can show.',
    });
    expect(act.source).toBe('safe_next_action');
    expect(act.primary).toMatch(/pitch\/demo/i);
  });

  it('missing-proof question becomes the gather-proof action when no safe next exists', () => {
    const act = composeActFromPathwayFit({
      no_proven_door: false,
      next_prompt: 'Are you currently on this vehicle, or do you have a teaming relationship with a holder?',
      top_safe_next_action: null,
    });
    expect(act.source).toBe('missing_proof');
    expect(act.primary).toMatch(/teaming/i);
  });
});

describe('positionSectionTitles', () => {
  it('capability statement has the seven Potato v1 slots', () => {
    expect(positionSectionTitles('capability_statement')).toHaveLength(7);
    expect(positionSectionTitles('capability_statement')).toContain('language/claims to avoid');
  });

  it('response keeps UNDERSTAND provenance split', () => {
    expect(positionSectionTitles('response')[0]).toBe('THE OPPORTUNITY SAYS');
    expect(positionSectionTitles('response')).toContain('BROADER CUSTOMER RESEARCH SHOWS');
  });

  it('meeting includes one recommended objective', () => {
    expect(positionSectionTitles('meeting')).toContain('one recommended objective for the meeting');
  });
});
