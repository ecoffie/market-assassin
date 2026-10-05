import { describe, expect, it } from 'vitest';
import {
  ALL_CAPABILITIES, CAPABILITY_POLICY, canonicalDecision, capabilitiesFor, capabilitiesGrantedBy,
  entitlementStateFor, type EntitlementSource,
} from './policy';
import { attributeSources, type SourceFacts } from './sources';

const NOW = Date.parse('2026-10-04T12:00:00Z');
const facts = (over: Partial<SourceFacts> = {}): SourceFacts => ({
  kvBriefings: false, profile: null, notifTrialEndsAt: null, classification: null,
  latestAdminGrant: null, legacy: {}, mcpBalance: null, observations: [], isStaff: false, isAdvocate: false,
  trialProgramOpen: true, now: NOW, ...over,
});

describe('policy — the rulings', () => {
  it('Free = discovery: a signed-in user with no source holds every discover/remember capability and no paid one', () => {
    const caps = capabilitiesFor('LOGGED_IN', []);
    for (const c of ALL_CAPABILITIES) {
      const { category } = CAPABILITY_POLICY[c];
      const free = category === 'discover' || category === 'remember' || c === 'mcp.tools';
      expect(caps.has(c), c).toBe(free);
    }
  });

  it('logged in is not paid', () => {
    expect(entitlementStateFor('LOGGED_IN', [])).toBe('FREE');
    expect(canonicalDecision('target_list.manage', 'LOGGED_IN', []).allow).toBe(false);
  });

  it('logged out holds only public discovery', () => {
    expect(canonicalDecision('map.browse', 'LOGGED_OUT', []).allow).toBe(true);
    expect(canonicalDecision('players.view', 'LOGGED_OUT', []).reason).toBe('sign_in_required');
    expect(canonicalDecision('save.bookmark', 'LOGGED_OUT', ['stripe_pro']).allow).toBe(false);
  });

  it('Team ⊇ Pro: Team never needs "Upgrade to Pro"', () => {
    for (const c of capabilitiesGrantedBy('stripe_pro')) {
      expect(canonicalDecision(c, 'LOGGED_IN', ['stripe_team']).allow, c).toBe(true);
    }
    expect(canonicalDecision('workspace.share', 'LOGGED_IN', ['stripe_pro']).allow).toBe(false);
    expect(canonicalDecision('workspace.share', 'LOGGED_IN', ['stripe_team']).allow).toBe(true);
  });

  it('legacy products grant no Mindy capability (Correction 1)', () => {
    const legacy: EntitlementSource[] = [
      'legacy:market_assassin_premium', 'legacy:market_assassin_standard', 'legacy:content_reaper',
      'legacy:opportunity_hunter_pro', 'legacy:recompete_tracker', 'legacy:contractor_database',
    ];
    for (const s of legacy) expect(capabilitiesGrantedBy(s)).toEqual([]);
    expect(entitlementStateFor('LOGGED_IN', legacy)).toBe('FREE');
  });

  it('MCP credits are a meter, not an entitlement', () => {
    expect(capabilitiesGrantedBy('mcp_credit_balance')).toEqual([]);
    expect(canonicalDecision('mcp.playbook', 'LOGGED_IN', ['mcp_credit_balance']).allow).toBe(false);
  });

  it('union: removing one source never removes a capability another still grants', () => {
    const both: EntitlementSource[] = ['stripe_team', 'stripe_pro'];
    const d = canonicalDecision('bid_decision.ai', 'LOGGED_IN', both);
    expect(d.grantedBy).toEqual(['stripe_team', 'stripe_pro']);
    expect(canonicalDecision('bid_decision.ai', 'LOGGED_IN', ['stripe_team']).allow).toBe(true);
  });

  it('Pursuit Briefs are retired — no capability exists for them', () => {
    expect(ALL_CAPABILITIES.some((c) => c.startsWith('pursuit_brief'))).toBe(false);
  });

  it('every non-Free capability is reachable by some paid source (no orphan gates)', () => {
    const paid = new Set([...capabilitiesGrantedBy('stripe_pro'), ...capabilitiesGrantedBy('stripe_team')]);
    for (const c of ALL_CAPABILITIES) {
      if (CAPABILITY_POLICY[c].minState === 'PRO' || CAPABILITY_POLICY[c].minState === 'TEAM') {
        expect(paid.has(c), c).toBe(true);
      }
    }
  });
});

describe('attributeSources — names every source, collapses none', () => {
  it('a bare KV briefings grant with no record is pro_unattributed, not invented as Stripe', () => {
    expect(attributeSources(facts({ kvBriefings: true }))).toEqual(['pro_unattributed']);
  });

  it('classification attributes a LIVE grant and never creates one (it is a stale snapshot)', () => {
    expect(attributeSources(facts({ kvBriefings: true, classification: { briefings_access: 'subscription' } }))).toEqual(['stripe_pro']);
    expect(attributeSources(facts({ kvBriefings: true, classification: { briefings_access: 'lifetime', products_purchased: ['Mindy Founders Lifetime'] } }))).toEqual(['founder']);
    expect(attributeSources(facts({ kvBriefings: true, classification: { briefings_access: 'lifetime', products_purchased: ['Mindy Teams'] } }))).toEqual(['lifetime_mindy']);
    expect(attributeSources(facts({ classification: { briefings_access: 'subscription', has_active_subscription: true } }))).toEqual([]);
    expect(attributeSources(facts({ classification: { briefings_access: 'lifetime' } }))).toEqual([]);
  });

  it('beta_preview / none classifications grant nothing', () => {
    expect(attributeSources(facts({ kvBriefings: true, classification: { briefings_access: 'beta_preview' } }))).toEqual(['pro_unattributed']);
  });

  it('membership comes from the stripe_member reconciler grant, not from a product-name guess', () => {
    expect(attributeSources(facts({ kvBriefings: true, latestAdminGrant: { action: 'grant', grant_source: 'stripe_member' } }))).toEqual(['membership']);
    expect(attributeSources(facts({ classification: { has_active_subscription: true, products_purchased: ['Pro Member Plan - Monthly'] } }))).toEqual([]);
  });

  it('overlapping sources are all kept (Team + Pro + legacy + credits)', () => {
    const s = attributeSources(facts({
      kvBriefings: true, profile: { access_team: true }, classification: { briefings_access: '1_year' },
      legacy: { contractor_database: true }, mcpBalance: 40,
    }));
    expect(s.sort()).toEqual(['legacy:contractor_database', 'mcp_credit_balance', 'stripe_pro', 'stripe_team']);
  });

  it('expired grants and trials do not count; a closed trial program grants nothing', () => {
    expect(attributeSources(facts({ profile: { access_briefings: true, briefings_expires_at: '2026-01-01T00:00:00Z' } }))).toEqual([]);
    expect(attributeSources(facts({ profile: { trial_ends_at: '2026-10-01T00:00:00Z' } }))).toEqual([]);
    expect(attributeSources(facts({ notifTrialEndsAt: '2026-11-01T00:00:00Z' }))).toEqual(['trial']);
    expect(attributeSources(facts({ notifTrialEndsAt: '2026-11-01T00:00:00Z', trialProgramOpen: false }))).toEqual([]);
  });

  it('an admin grant attributes a live grant; a revoke does not', () => {
    expect(attributeSources(facts({ kvBriefings: true, latestAdminGrant: { action: 'grant', grant_source: 'comp' } }))).toEqual(['manual_grant']);
    expect(attributeSources(facts({ kvBriefings: true, latestAdminGrant: { action: 'revoke' } }))).toEqual(['pro_unattributed']);
  });

  it('staff and advocate are explicit sources', () => {
    expect(attributeSources(facts({ isStaff: true, isAdvocate: true }))).toEqual(['staff', 'advocate']);
  });
});
