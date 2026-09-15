import { describe, it, expect } from 'vitest';
import {
  MCP_CONNECTOR_INSTRUCTIONS,
  SCHEDULE_DISCOVERY_PHRASES,
  SCHEDULE_MARKET_SEARCH_DESCRIPTION,
  SCHEDULE_MARKET_SEARCH_TITLE,
} from './schedule-discovery';
import { listMcpTools } from './tool-registry';
import { mcpRegistrationList } from './tool-schemas';

describe('MCP schedule discovery', () => {
  it('tool description includes every natural-language discovery phrase', () => {
    for (const phrase of SCHEDULE_DISCOVERY_PHRASES) {
      expect(SCHEDULE_MARKET_SEARCH_DESCRIPTION.toLowerCase()).toContain(phrase.toLowerCase());
    }
  });

  it('registry + hosted registration advertise the shared description and title', () => {
    const tools = listMcpTools();
    const def = tools.find((t) => t.function.name === 'schedule_market_search');
    expect(def).toBeTruthy();
    expect(def!.function.description).toBe(SCHEDULE_MARKET_SEARCH_DESCRIPTION);

    const reg = mcpRegistrationList().find((t) => t.name === 'schedule_market_search');
    expect(reg).toBeTruthy();
    expect(reg!.description).toBe(SCHEDULE_MARKET_SEARCH_DESCRIPTION);
    expect(reg!.title).toBe(SCHEDULE_MARKET_SEARCH_TITLE);
  });

  it('connector instructions route monitor/schedule/watch language to schedule_market_search', () => {
    expect(MCP_CONNECTOR_INSTRUCTIONS).toContain('schedule_market_search');
    expect(MCP_CONNECTOR_INSTRUCTIONS.toLowerCase()).toContain('monitor');
    expect(MCP_CONNECTOR_INSTRUCTIONS.toLowerCase()).toContain('create a watch');
    expect(MCP_CONNECTOR_INSTRUCTIONS.toLowerCase()).toContain('keep them updated');
    expect(MCP_CONNECTOR_INSTRUCTIONS).toMatch(/inspect the available tool list/i);
    expect(MCP_CONNECTOR_INSTRUCTIONS).toMatch(/Never drop unsupported/i);
    expect(MCP_CONNECTOR_INSTRUCTIONS).toMatch(/daily, weekly, or paused/i);
  });

  it('connector instructions include CAI language guardrails', () => {
    expect(MCP_CONNECTOR_INSTRUCTIONS).toContain('get_current_acquisition_intelligence');
    expect(MCP_CONNECTOR_INSTRUCTIONS).toMatch(/unavailable horizon/i);
    expect(MCP_CONNECTOR_INSTRUCTIONS).toMatch(/record evidence only/i);
    expect(MCP_CONNECTOR_INSTRUCTIONS).toMatch(/competition already happened/i);
    expect(MCP_CONNECTOR_INSTRUCTIONS).toMatch(/invent nothing/i);
  });

  it('maps each customer phrase to schedule_market_search (routing contract)', () => {
    // Discovery surface: if the phrase appears in the tool description OR instructions,
    // a connected client has the signal to call schedule_market_search without "alerts."
    const haystack = `${SCHEDULE_MARKET_SEARCH_DESCRIPTION}\n${MCP_CONNECTOR_INSTRUCTIONS}`.toLowerCase();
    for (const phrase of SCHEDULE_DISCOVERY_PHRASES) {
      const tokens = phrase.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const hit =
        haystack.includes(phrase.toLowerCase()) ||
        tokens.every((t) => haystack.includes(t));
      expect(hit, `phrase not discoverable: ${phrase}`).toBe(true);
    }
  });
});
