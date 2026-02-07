import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import {
  createDatabaseToken,
  grantOpportunityHunterProAccess,
  grantMarketAssassinAccess,
  grantContentGeneratorAccess,
  grantRecompeteAccess,
} from '@/lib/access-codes';

// Pull all completed Stripe checkout sessions and grant KV access
// based on tier/bundle metadata. Run from market-assassin where KV is connected.

// Map tier metadata → KV grants
async function grantByTier(tier: string, email: string, name?: string): Promise<string[]> {
  const grants: string[] = [];

  if (tier === 'hunter_pro') {
    await grantOpportunityHunterProAccess(email, name);
    grants.push('ospro');
  }
  if (tier === 'content_standard') {
    await grantContentGeneratorAccess(email, 'content-engine', name);
    grants.push('contentgen');
  }
  if (tier === 'content_full_fix' || tier === 'content_full_fix_upgrade') {
    await grantContentGeneratorAccess(email, 'full-fix', name);
    grants.push('contentgen:full-fix');
  }
  if (tier === 'assassin_standard') {
    await grantMarketAssassinAccess(email, 'standard', name);
    grants.push('ma:standard');
  }
  if (tier === 'assassin_premium' || tier === 'assassin_premium_upgrade') {
    await grantMarketAssassinAccess(email, 'premium', name);
    grants.push('ma:premium');
  }
  if (tier === 'recompete') {
    await grantRecompeteAccess(email, name);
    grants.push('recompete');
  }
  if (tier === 'contractor_db') {
    await createDatabaseToken(email, name);
    grants.push('database');
  }

  return grants;
}

// Map bundle metadata → KV grants (grant all included products)
async function grantByBundle(bundle: string, email: string, name?: string): Promise<string[]> {
  const grants: string[] = [];

  if (bundle === 'starter' || bundle === 'govcon-starter-bundle') {
    await grantOpportunityHunterProAccess(email, name);
    await grantRecompeteAccess(email, name);
    await createDatabaseToken(email, name);
    grants.push('ospro', 'recompete', 'database');
  } else if (bundle === 'pro' || bundle === 'pro-giant-bundle') {
    await createDatabaseToken(email, name);
    await grantRecompeteAccess(email, name);
    await grantMarketAssassinAccess(email, 'standard', name);
    await grantContentGeneratorAccess(email, 'content-engine', name);
    grants.push('database', 'recompete', 'ma:standard', 'contentgen');
  } else if (bundle === 'ultimate' || bundle === 'ultimate-govcon-bundle' || bundle === 'complete') {
    await grantContentGeneratorAccess(email, 'full-fix', name);
    await createDatabaseToken(email, name);
    await grantRecompeteAccess(email, name);
    await grantMarketAssassinAccess(email, 'premium', name);
    grants.push('contentgen:full-fix', 'database', 'recompete', 'ma:premium');
  }

  return grants;
}

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();

    const expectedPassword = process.env.ADMIN_PASSWORD || 'admin123';
    if (password !== expectedPassword) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use the same Stripe key as govcon-shop (shared account)
    const liveKey = process.env.STRIPE_SECRET_KEY || '';
    if (!liveKey) {
      return NextResponse.json({ error: 'STRIPE_SECRET_KEY not configured' }, { status: 500 });
    }

    const stripe = new Stripe(liveKey);

    const results: Array<{
      email: string;
      tier: string | null;
      bundle: string | null;
      grants: string[];
      status: string;
    }> = [];

    // Paginate through all completed checkout sessions
    let hasMore = true;
    let startingAfter: string | undefined;

    while (hasMore) {
      const params: Stripe.Checkout.SessionListParams = {
        limit: 100,
        status: 'complete',
      };
      if (startingAfter) params.starting_after = startingAfter;

      const sessions = await stripe.checkout.sessions.list(params);

      for (const session of sessions.data) {
        const email = session.customer_email || session.customer_details?.email;
        const name = session.customer_details?.name || undefined;
        const tier = session.metadata?.tier;
        const bundle = session.metadata?.bundle;

        if (!email) continue;
        if (!tier && !bundle) continue; // No metadata = can't determine product

        try {
          let grants: string[] = [];

          if (bundle) {
            grants = await grantByBundle(bundle, email, name);
          } else if (tier) {
            grants = await grantByTier(tier, email, name);
          }

          results.push({
            email,
            tier: tier || null,
            bundle: bundle || null,
            grants,
            status: grants.length > 0 ? 'granted' : 'no-grants',
          });
        } catch (err) {
          results.push({
            email,
            tier: tier || null,
            bundle: bundle || null,
            grants: [],
            status: `error: ${err instanceof Error ? err.message : 'unknown'}`,
          });
        }
      }

      hasMore = sessions.has_more;
      if (sessions.data.length > 0) {
        startingAfter = sessions.data[sessions.data.length - 1].id;
      }
    }

    return NextResponse.json({
      success: true,
      total: results.length,
      granted: results.filter(r => r.status === 'granted').length,
      errors: results.filter(r => r.status.startsWith('error')).length,
      results,
    });

  } catch (error) {
    console.error('KV backfill error:', error);
    return NextResponse.json(
      { error: `Backfill failed: ${error instanceof Error ? error.message : 'unknown'}` },
      { status: 500 }
    );
  }
}
