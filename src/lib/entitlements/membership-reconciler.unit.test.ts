import { describe, expect, it } from 'vitest';
import { classifyMembershipSubs, planReconcile, type ObservedSub } from './membership-reconciler';
import { selectGrandfatherCohort } from './grandfather-cohort';
import { GRANDFATHER_EXCLUDED, canonicalDecision, capabilitiesGrantedBy } from './policy';
import { attributeSources } from './sources';

const sub = (o: Partial<ObservedSub>): ObservedSub => ({
  subscriptionId: 'sub_1', productId: 'prod_TaiXlKb350EIQs', stripeStatus: 'active', email: 'm@x.co', ...o,
});

describe('membership reconciler — reflects ACTIVE qualifying membership only', () => {
  it('active/trialing qualifying → membership:active; past_due/unpaid → past_due; canceled → not observed', () => {
    const { observations } = classifyMembershipSubs([
      sub({ subscriptionId: 'a' }),
      sub({ subscriptionId: 'b', productId: 'prod_TMUmxKTtooTx6C', stripeStatus: 'trialing' }),
      sub({ subscriptionId: 'c', stripeStatus: 'past_due' }),
      sub({ subscriptionId: 'd', stripeStatus: 'canceled' }),
      sub({ subscriptionId: 'e', stripeStatus: 'incomplete_expired' }),
    ]);
    expect(observations.map((o) => [o.evidence_key, o.source, o.status])).toEqual([
      ['a', 'membership', 'active'], ['b', 'membership', 'active'], ['c', 'membership', 'past_due'],
    ]);
  });

  it('annual / coaching are observed as unruled; other "PRO Member" products are ignored', () => {
    const { observations } = classifyMembershipSubs([
      sub({ subscriptionId: 'y', productId: 'prod_TaiXme4nmh2QLc' }),
      sub({ subscriptionId: 'c', productId: 'prod_TEEWMTb5ngGx0f' }),
      sub({ subscriptionId: 'l', productId: 'prod_Ta76NP9cAMuNMG' }), // lifetime installments
    ]);
    expect(observations.map((o) => o.source)).toEqual(['membership_unruled', 'membership_unruled']);
  });

  it('counts subscriptions without an email instead of guessing one', () => {
    const r = classifyMembershipSubs([sub({ email: null }), sub({ subscriptionId: 'z', email: ' M@X.co ' })]);
    expect(r.missingEmail).toBe(1);
    expect(r.observations[0].email).toBe('m@x.co');
  });

  it('ends only previously-open membership rows the sweep no longer sees; never touches the D1 cohort', () => {
    const { observations } = classifyMembershipSubs([sub({ subscriptionId: 'keep' })]);
    const plan = planReconcile(observations, [
      { source: 'membership', evidence_key: 'keep' },
      { source: 'membership', evidence_key: 'gone' },
      { source: 'legacy_mindy_grandfather', evidence_key: 'd1-legacy-2026-10-04:a@b.co' },
    ], 0);
    expect(plan.end).toEqual([{ source: 'membership', evidence_key: 'gone' }]);
  });

  it('only an ACTIVE membership observation grants Pro', () => {
    const base = {
      kvBriefings: false, profile: null, notifTrialEndsAt: null, classification: null, latestAdminGrant: null,
      legacy: {}, mcpBalance: null, isStaff: false, isAdvocate: false, trialProgramOpen: true, now: Date.now(),
    };
    expect(attributeSources({ ...base, observations: [{ source: 'membership', status: 'active' }] })).toEqual(['membership']);
    expect(attributeSources({ ...base, observations: [{ source: 'membership', status: 'past_due' }] })).toEqual(['membership_past_due']);
    expect(attributeSources({ ...base, observations: [{ source: 'membership', status: 'ended' }] })).toEqual([]);
    expect(canonicalDecision('chat.ask', 'LOGGED_IN', ['membership']).allow).toBe(true);
    expect(canonicalDecision('chat.ask', 'LOGGED_IN', ['membership_past_due']).allow).toBe(false);
    expect(canonicalDecision('chat.ask', 'LOGGED_IN', ['membership_unruled']).allow).toBe(false);
  });
});

describe('D1 frozen grandfather', () => {
  it('selects legacy-only "pro" accounts and nothing that already has a Mindy source', () => {
    expect(selectGrandfatherCohort([
      { email: 'Legacy@x.co', verifyTier: 'pro', sources: ['legacy:contractor_database', 'mcp_credit_balance'] },
      { email: 'paid@x.co', verifyTier: 'pro', sources: ['legacy:content_reaper', 'stripe_pro'] },
      { email: 'staff@x.co', verifyTier: 'pro', sources: ['legacy:content_reaper', 'staff'] },
      { email: 'free@x.co', verifyTier: 'free', sources: [] },
      { email: 'credits@x.co', verifyTier: 'free', sources: ['mcp_credit_balance'] },
    ])).toEqual(['legacy@x.co']);
  });

  it('keeps exactly today: every verifyMIAccess/ungated Pro capability, none of the resolveAccess-denied ones, no Team', () => {
    const caps = capabilitiesGrantedBy('legacy_mindy_grandfather');
    for (const c of ['target_list.manage', 'outreach.log', 'pricing_intel.view', 'competitor.analyze',
      'market_narrative.generate', 'market_report.generate', 'bid_decision.ai', 'market_research.full',
      'pipeline.manage', 'proposal.build'] as const) expect(caps, c).toContain(c);
    for (const c of GRANDFATHER_EXCLUDED) expect(caps).not.toContain(c);
    expect(caps).not.toContain('workspace.share');
  });
});
