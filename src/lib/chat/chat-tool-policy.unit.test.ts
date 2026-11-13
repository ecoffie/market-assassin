import { describe, it, expect } from 'vitest';
import { listMcpTools } from '@/lib/mcp/tool-registry';
import { HIDDEN_FROM_PUBLIC_MCP } from '@/lib/mcp/public-catalog-config';
import { toolWriteKind } from '@/lib/mcp/tool-schemas';
import { chatToolPolicy, isChatOfferable, CHAT_OVERRIDE_NAMES, CHAT_PRIVATE_READ_TOOLS } from './chat-tool-policy';

const registered = listMcpTools().map((d) => String((d.function as { name?: string }).name));

describe('Ask Mindy chat tool policy', () => {
  it('blocks every hide_until_fixed tool (defects stay blocked in chat until fixed for MCP)', () => {
    const defects = Object.entries(HIDDEN_FROM_PUBLIC_MCP).filter(([, v]) => v.decision === 'hide_until_fixed').map(([k]) => k);
    expect(defects.length).toBeGreaterThan(0);
    for (const name of defects) {
      const p = chatToolPolicy(name, true);
      expect(p.decision, name).toBe('blocked_defect');
      expect(isChatOfferable(p)).toBe(false);
    }
  });

  it('blocks the four tools named in the safety approval', () => {
    for (const name of ['add_contacts_to_crm', 'one_click_proposal', 'get_agency_budget_trends', 'search_sbir']) {
      expect(isChatOfferable(chatToolPolicy(name, true)), name).toBe(false);
    }
  });

  it('requires confirmation (blocked until Phase 3) for delete and report generation (D1)', () => {
    expect(chatToolPolicy('delete_market_schedule', true).decision).toBe('requires_confirmation');
    expect(chatToolPolicy('generate_market_report', true).decision).toBe('requires_confirmation');
    expect(isChatOfferable(chatToolPolicy('delete_market_schedule', true))).toBe(false);
    expect(isChatOfferable(chatToolPolicy('generate_market_report', true))).toBe(false);
  });

  it('allows the low-risk reversible writes', () => {
    expect(chatToolPolicy('schedule_market_search', true).decision).toBe('allowed_write');
    expect(chatToolPolicy('update_market_schedule', true).decision).toBe('allowed_write');
  });

  it('every registered WRITE tool is either explicitly classified or fails closed', () => {
    for (const name of registered) {
      if (!toolWriteKind(name)) continue;
      const p = chatToolPolicy(name, true);
      const explicit = CHAT_OVERRIDE_NAMES.includes(name) || HIDDEN_FROM_PUBLIC_MCP[name]?.decision === 'hide_until_fixed';
      expect(explicit || p.decision === 'requires_confirmation', name).toBe(true);
      expect(p.decision === 'allowed_read', `${name} is a write tool and must never resolve to allowed_read`).toBe(false);
    }
  });

  it('every registered tool resolves to exactly one known decision', () => {
    const known = new Set(['allowed_read', 'allowed_write', 'requires_confirmation', 'blocked_defect', 'blocked_chat_exception']);
    for (const name of registered) expect(known.has(chatToolPolicy(name, true).decision), name).toBe(true);
  });

  it('an unregistered or invented tool name is refused', () => {
    expect(chatToolPolicy('drop_all_tables', false).decision).toBe('blocked_chat_exception');
    expect(chatToolPolicy('get_expiring_contracts_v2', false).decision).toBe('blocked_chat_exception');
  });

  it('chat-private read tools are allowed and the existing chat exclusions still hold', () => {
    for (const name of CHAT_PRIVATE_READ_TOOLS) expect(chatToolPolicy(name, true).decision).toBe('allowed_read');
    for (const name of ['get_balance', 'get_winning_playbook', 'search_podcast_lessons', 'verify_m_scale', 'export_proposal']) {
      expect(chatToolPolicy(name, true).decision, name).toBe('blocked_chat_exception');
    }
  });

  it('ordinary read tools stay available (no collateral removal)', () => {
    for (const name of ['get_expiring_contracts', 'search_past_contracts', 'search_idv_contracts', 'lookup_sam_entity', 'get_pricing_intel', 'list_market_schedules']) {
      expect(chatToolPolicy(name, true).decision, name).toBe('allowed_read');
    }
  });
});
