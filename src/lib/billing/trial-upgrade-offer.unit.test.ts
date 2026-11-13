import { describe, it, expect } from 'vitest';
import {
  canOfferTrialUpgrade, formatPlanPrice, trialUpgradeChargeNote, TRIAL_UPGRADE_SUCCESS_TEXT, TRIAL_UPGRADE_TITLE,
} from './trial-upgrade-offer';
import { trialOfferForCard } from '@/components/public-site/pricing/SimplePricing';

describe('trial upgrade copy', () => {
  it('states the charge, that the trial ends now, and no refunds', () => {
    expect(trialUpgradeChargeNote(149, 'month')).toBe('Your card is charged today ($149/mo) and your trial ends now. No refunds.');
    expect(trialUpgradeChargeNote(4027, 'year')).toBe('Your card is charged today ($4,027/yr) and your trial ends now. No refunds.');
    expect(trialUpgradeChargeNote(null, null)).toBe('Your card is charged today and your trial ends now. No refunds.');
    expect(formatPlanPrice(335.58, 'month')).toBe('$335.58/mo');
  });

  it('title and success text name the 500 credits', () => {
    expect(TRIAL_UPGRADE_TITLE).toBe('Upgrade now and get 500 bonus credits');
    expect(TRIAL_UPGRADE_SUCCESS_TEXT).toBe('Upgraded — 500 bonus credits will be added once payment clears.');
  });
});

describe('canOfferTrialUpgrade', () => {
  const row = { kind: 'app' as const, status: 'trialing', cancelAtPeriodEnd: false, trialUpgradeEligible: true };
  it('only for an eligible, live, non-cancelling app trial', () => {
    expect(canOfferTrialUpgrade(row)).toBe(true);
    expect(canOfferTrialUpgrade({ ...row, status: 'active' })).toBe(false);
    expect(canOfferTrialUpgrade({ ...row, cancelAtPeriodEnd: true })).toBe(false);
    expect(canOfferTrialUpgrade({ ...row, kind: 'mcp' })).toBe(false);
    expect(canOfferTrialUpgrade({ ...row, trialUpgradeEligible: undefined })).toBe(false);
  });
});

describe('trialOfferForCard (/pricing)', () => {
  const offer = { subscriptionId: 'sub_1', tier: 'pro' as const, planName: 'Mindy Pro', amount: 149, interval: 'month', trialEnd: null, billedTo: 'a@x.com' };
  it('shows the offer only on the current plan\'s card', () => {
    expect(trialOfferForCard('Pro', 'pro', [offer])).toBe(offer);
    expect(trialOfferForCard('Team', 'pro', [offer])).toBeNull();
    expect(trialOfferForCard('Pro', 'team', [offer])).toBeNull();
  });
  it('no offers (partner no-card trial, signed out, lookup failed) → nothing', () => {
    expect(trialOfferForCard('Pro', 'pro', [])).toBeNull();
    expect(trialOfferForCard('Pro', 'pro', null)).toBeNull();
    expect(trialOfferForCard('Pro', null, [offer])).toBeNull();
  });
});
