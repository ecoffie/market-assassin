import { NextRequest, NextResponse } from 'next/server';
import { canGenerateReport, incrementReportUsage } from '@/lib/access-codes';
import { verifyUserOwnsEmail } from '@/lib/api-auth';

// GET - Check user's current usage
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    // SECURITY: Verify user owns this email
    const auth = await verifyUserOwnsEmail(request, email);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    const usageInfo = await canGenerateReport(auth.email!);

    return NextResponse.json({
      success: true,
      ...usageInfo,
    });
  } catch (error) {
    console.error('Error checking usage:', error);
    return NextResponse.json(
      { error: 'Failed to check usage' },
      { status: 500 }
    );
  }
}

// POST - Increment usage (called after successful report generation)
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    // SECURITY: Verify user owns this email
    const auth = await verifyUserOwnsEmail(request, email);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error || 'Unauthorized' },
        { status: 401 }
      );
    }

    // First check if they can generate
    const canGenerate = await canGenerateReport(auth.email!);

    if (!canGenerate.allowed) {
      return NextResponse.json(
        {
          error: 'Monthly report limit reached',
          currentUsage: canGenerate.currentUsage,
          limit: canGenerate.limit,
          tier: canGenerate.tier,
        },
        { status: 403 }
      );
    }

    // Increment usage
    const usage = await incrementReportUsage(auth.email!);

    return NextResponse.json({
      success: true,
      usage,
      remaining: canGenerate.limit - usage.reportCount,
    });
  } catch (error) {
    console.error('Error incrementing usage:', error);
    return NextResponse.json(
      { error: 'Failed to increment usage' },
      { status: 500 }
    );
  }
}
