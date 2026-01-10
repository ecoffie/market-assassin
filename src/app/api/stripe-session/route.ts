import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { grantOpportunityScoutProAccess, hasOpportunityScoutProAccess } from '@/lib/access-codes';

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

    // If this is Opportunity Scout Pro, grant access immediately
    if (product === 'opportunity-scout-pro') {
      const alreadyHasAccess = await hasOpportunityScoutProAccess(email);

      if (!alreadyHasAccess) {
        await grantOpportunityScoutProAccess(email, session.customer_details?.name || undefined);
      }

      return NextResponse.json({
        success: true,
        email: email.toLowerCase(),
        product: 'opportunity-scout-pro',
        hasAccess: true,
        customerName: session.customer_details?.name || null,
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
