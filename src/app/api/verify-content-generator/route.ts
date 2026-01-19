import { NextRequest, NextResponse } from 'next/server';
import { hasContentGeneratorAccess, getContentGeneratorAccess, CONTENT_GENERATOR_TIER_FEATURES } from '@/lib/access-codes';

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Handle OPTIONS preflight request
export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

// Public endpoint to verify Content Generator access by email
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: 'Email required' },
        { status: 400, headers: corsHeaders }
      );
    }

    const hasAccess = await hasContentGeneratorAccess(email);

    if (!hasAccess) {
      return NextResponse.json({
        hasAccess: false,
        message: 'No access found for this email',
      }, { headers: corsHeaders });
    }

    const accessDetails = await getContentGeneratorAccess(email);
    const tier = accessDetails?.tier || 'content-engine';
    const tierInfo = CONTENT_GENERATOR_TIER_FEATURES[tier];

    return NextResponse.json({
      hasAccess: true,
      email: accessDetails?.email,
      customerName: accessDetails?.customerName,
      tier: tier,
      tierName: tierInfo?.name || 'Content Engine',
      features: tierInfo?.features || [],
      createdAt: accessDetails?.createdAt,
      upgradedAt: accessDetails?.upgradedAt,
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('Error verifying Content Generator access:', error);
    return NextResponse.json(
      { error: 'Failed to verify access' },
      { status: 500, headers: corsHeaders }
    );
  }
}
