import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import {
  grantOpportunityHunterProAccess,
  hasOpportunityHunterProAccess,
  grantMarketAssassinAccess,
  getMarketAssassinAccess,
  MarketAssassinTier,
  grantContentGeneratorAccess,
  getContentGeneratorAccess,
  ContentGeneratorTier,
} from '@/lib/access-codes';
import { sendOpportunityHunterProEmail } from '@/lib/send-email';

// Get Stripe instance
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  return new Stripe(key);
}

// Get customer email from Stripe checkout session and grant access
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('session_id');
    const product = searchParams.get('product');

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    const stripe = getStripe();

    // Retrieve the checkout session
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const email = session.customer_email || session.customer_details?.email;

    if (!email) {
      return NextResponse.json({ error: 'No email found in session' }, { status: 400 });
    }

    // If this is Opportunity Hunter Pro, grant access immediately
    if (product === 'opportunity-scout-pro') {
      const alreadyHasAccess = await hasOpportunityHunterProAccess(email);

      if (!alreadyHasAccess) {
        await grantOpportunityHunterProAccess(email, session.customer_details?.name || undefined);
        // Send confirmation email
        await sendOpportunityHunterProEmail({
          to: email,
          customerName: session.customer_details?.name || undefined,
        });
      }

      return NextResponse.json({
        success: true,
        email: email.toLowerCase(),
        product: 'opportunity-scout-pro',
        hasAccess: true,
        customerName: session.customer_details?.name || null,
      });
    }

    // Handle Market Assassin Standard
    if (product === 'market-assassin-standard') {
      const existingAccess = await getMarketAssassinAccess(email);

      // Only grant if no existing access, or if upgrading from nothing
      if (!existingAccess) {
        await grantMarketAssassinAccess(email, 'standard', session.customer_details?.name || undefined);
        // TODO: Send confirmation email
      }

      return NextResponse.json({
        success: true,
        email: email.toLowerCase(),
        product: 'market-assassin-standard',
        tier: 'standard' as MarketAssassinTier,
        hasAccess: true,
        customerName: session.customer_details?.name || null,
      });
    }

    // Handle Market Assassin Premium
    if (product === 'market-assassin-premium') {
      const existingAccess = await getMarketAssassinAccess(email);

      // Grant premium access (upgrades existing standard if applicable)
      if (!existingAccess || existingAccess.tier !== 'premium') {
        await grantMarketAssassinAccess(email, 'premium', session.customer_details?.name || undefined);
        // TODO: Send confirmation email
      }

      return NextResponse.json({
        success: true,
        email: email.toLowerCase(),
        product: 'market-assassin-premium',
        tier: 'premium' as MarketAssassinTier,
        hasAccess: true,
        customerName: session.customer_details?.name || null,
      });
    }

    // Handle Content Generator - Content Engine ($197)
    if (product === 'content-engine') {
      const existingAccess = await getContentGeneratorAccess(email);

      // Only grant if no existing access
      if (!existingAccess) {
        await grantContentGeneratorAccess(email, 'content-engine', session.customer_details?.name || undefined);
        // TODO: Send confirmation email
      }

      return NextResponse.json({
        success: true,
        email: email.toLowerCase(),
        product: 'content-engine',
        tier: 'content-engine' as ContentGeneratorTier,
        hasAccess: true,
        customerName: session.customer_details?.name || null,
        redirectUrl: '/content-generator',
      });
    }

    // Handle Content Generator - Full Fix ($297)
    if (product === 'full-fix') {
      const existingAccess = await getContentGeneratorAccess(email);

      // Grant full-fix access (upgrades existing content-engine if applicable)
      if (!existingAccess || existingAccess.tier !== 'full-fix') {
        await grantContentGeneratorAccess(email, 'full-fix', session.customer_details?.name || undefined);
        // TODO: Send confirmation email
      }

      return NextResponse.json({
        success: true,
        email: email.toLowerCase(),
        product: 'full-fix',
        tier: 'full-fix' as ContentGeneratorTier,
        hasAccess: true,
        customerName: session.customer_details?.name || null,
        redirectUrl: '/content-generator',
      });
    }

    // For other products, just return the email
    return NextResponse.json({
      success: true,
      email: email.toLowerCase(),
      product,
      customerName: session.customer_details?.name || null,
    });

  } catch (error) {
    console.error('Error retrieving Stripe session:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve session' },
      { status: 500 }
    );
  }
}
