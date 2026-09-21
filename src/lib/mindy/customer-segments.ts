/**
 * Customer qualification segments — single source of truth for
 * /api/admin/qualify-customers, Command Center, and Slack digests.
 */

export interface SegmentContext {
  score: number;
  profileComplete: boolean;
  hasPurchase: boolean;
  totalSpent: number;
  hasEngagement: boolean;
  hasUltimateBundle: boolean;
  hasHighTicketProduct: boolean;
  briefingsReceived: number;
  productsOwned: string[];
}

export const SEGMENT_DEFINITIONS: Record<
  string,
  { criteria: string; action: string; owner: string; excludes: string }
> = {
  '10-10 Candidate': {
    criteria: 'Score 80+ and Ultimate or other high-ticket purchase',
    action: 'Founder or customer-success call',
    owner: 'Eric / founder',
    excludes: 'Everyone below this tier',
  },
  'White-glove Candidate': {
    criteria: 'Score 70+ with any paid purchase',
    action: 'Sales call for done-for-you / enterprise services',
    owner: 'Branden / sales',
    excludes: '10-10 queue (higher score + high-ticket)',
  },
  'MI Pro Upgrade': {
    criteria: 'Score 50+, free access, profile complete, and engaged (briefings or pipeline)',
    action: 'Upgrade campaign to paid Mindy Pro',
    owner: 'Marketing / email',
    excludes: 'Paid customers and incomplete profiles',
  },
  'Rescue Candidate': {
    criteria: 'Paid customer with zero engagement (no briefings, pipeline, or feedback in 30d)',
    action: 'Customer-success check-in — understand blockers',
    owner: 'Annelle / Sikander',
    excludes: 'Users still opening briefings or using pipeline',
  },
  'Activation Candidate': {
    criteria:
      'Mindy account + incomplete profile (still on default NAICS only). Score 30+. Has access via signup, purchase, or briefings entitlement.',
    action: 'Profile setup nudge — pick NAICS, state, and target agencies',
    owner: 'Annelle / Sikander',
    excludes: '10-10, white-glove, rescue, and MI Pro upgrade queues',
  },
  'Audience Only': {
    criteria: 'Profile complete but low score, or insufficient signals for higher tiers',
    action: 'Low-touch email nurture only',
    owner: 'Marketing',
    excludes: 'Anyone matching a higher-priority segment above',
  },
};

/** Priority order — first match wins. Uses real flags, not signal-string parsing. */
export function determineSegment(ctx: SegmentContext): string {
  const {
    score,
    profileComplete,
    hasPurchase,
    hasEngagement,
    hasUltimateBundle,
    hasHighTicketProduct,
  } = ctx;
  const highValue = hasUltimateBundle || hasHighTicketProduct;

  if (score >= 80 && highValue) return '10-10 Candidate';
  if (score >= 70 && hasPurchase) return 'White-glove Candidate';
  if (hasPurchase && !hasEngagement) return 'Rescue Candidate';
  if (score >= 50 && !hasPurchase && hasEngagement && profileComplete) return 'MI Pro Upgrade';
  if (!profileComplete && score >= 30) return 'Activation Candidate';
  return 'Audience Only';
}

export function getRecommendedAction(segment: string, ctx: SegmentContext): string {
  switch (segment) {
    case '10-10 Candidate':
      return 'Schedule founder call — high-value customer worth deep investment';
    case 'White-glove Candidate':
      return 'Sales call — discuss done-for-you services and enterprise needs';
    case 'MI Pro Upgrade':
      return 'Send upgrade campaign — active free user with complete profile, ready for paid';
    case 'Rescue Candidate':
      return ctx.profileComplete
        ? 'Customer success check-in — paid but inactive, understand blockers'
        : 'Send profile setup help — paid but hasn\'t configured';
    case 'Activation Candidate':
      if (ctx.hasPurchase) {
        const product = ctx.productsOwned[0] || 'paid product';
        return `Paid ($${Math.round(ctx.totalSpent)}) but still on default NAICS — call to finish setup (${product})`;
      }
      if (ctx.briefingsReceived > 0) {
        return `Getting briefings (${ctx.briefingsReceived}) but no custom NAICS — send profile setup nudge`;
      }
      return 'Has Mindy access but no custom NAICS — send onboarding / profile setup nudge';
    default:
      return 'Low-touch nurture — add to email sequence only';
  }
}

/** One-line reason for queue lists (Slack, Command Center). */
export function describeWhyQualified(segment: string, ctx: SegmentContext): string {
  switch (segment) {
    case 'Activation Candidate':
      if (ctx.hasPurchase) {
        return `Paid $${Math.round(ctx.totalSpent)} · profile incomplete (default NAICS)`;
      }
      if (ctx.briefingsReceived > 0) {
        return `Free access · ${ctx.briefingsReceived} briefings · no custom NAICS`;
      }
      return 'Has access · never configured custom NAICS';
    case 'Rescue Candidate':
      return ctx.profileComplete
        ? `Paid $${Math.round(ctx.totalSpent)} · profile done · no engagement`
        : `Paid $${Math.round(ctx.totalSpent)} · never finished profile`;
    case 'MI Pro Upgrade':
      return `Free · profile complete · engaged (${ctx.briefingsReceived} briefings)`;
    case '10-10 Candidate':
      return `Score ${ctx.score} · high-ticket buyer`;
    case 'White-glove Candidate':
      return `Score ${ctx.score} · paid $${Math.round(ctx.totalSpent)}`;
    default:
      return `Score ${ctx.score}`;
  }
}

export function buildSegmentContext(input: {
  score: number;
  profileComplete: boolean;
  purchase: { totalSpent: number; products: string[] } | undefined;
  briefingsCount: number;
  hasPipeline: boolean;
  hasPositiveFeedback: boolean;
  hasUltimateBundle: boolean;
  hasHighTicketProduct: boolean;
}): SegmentContext {
  const hasPurchase = Boolean(input.purchase && input.purchase.totalSpent > 0);
  return {
    score: input.score,
    profileComplete: input.profileComplete,
    hasPurchase,
    totalSpent: input.purchase?.totalSpent || 0,
    hasEngagement:
      input.briefingsCount > 0 || input.hasPipeline || input.hasPositiveFeedback,
    hasUltimateBundle: input.hasUltimateBundle,
    hasHighTicketProduct: input.hasHighTicketProduct,
    briefingsReceived: input.briefingsCount,
    productsOwned: input.purchase?.products || [],
  };
}
