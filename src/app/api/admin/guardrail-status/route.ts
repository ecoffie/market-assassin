import { NextRequest, NextResponse } from 'next/server';
import { getGuardrailStatus, CircuitBreaker } from '@/lib/intelligence/guardrails';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

/**
 * GET /api/admin/guardrail-status
 *
 * View current guardrail and circuit breaker status.
 *
 * Query params:
 *   - password: Admin password (required)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const status = await getGuardrailStatus();

    // Determine overall health
    let health: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (status.circuitBreakers.length > 0) {
      health = 'critical';
    } else if (status.activeWarnings > 5) {
      health = 'warning';
    }

    return NextResponse.json({
      success: true,
      health,
      circuitBreakers: status.circuitBreakers,
      openBreakersCount: status.circuitBreakers.length,
      activeWarnings24h: status.activeWarnings,
      recentEvents: status.recentEvents.slice(0, 10),
      config: {
        maxConsecutiveFailures: 5,
        maxTotalFailures: 50,
        maxApiErrors: 10,
        maxDurationMinutes: 30,
        failureRateThreshold: '20%',
        cooldownMinutes: 30,
      },
    });
  } catch (error) {
    console.error('[GuardrailStatus] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch guardrail status' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/guardrail-status
 *
 * Reset a circuit breaker manually.
 *
 * Body:
 *   - cronName: Which circuit breaker to reset (e.g., 'daily-alerts')
 *   - action: 'reset'
 *   - adminEmail: Who is resetting (for audit)
 */
export async function POST(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { cronName, action, adminEmail } = body;

    if (action !== 'reset') {
      return NextResponse.json(
        { success: false, error: 'Invalid action. Use "reset".' },
        { status: 400 }
      );
    }

    if (!cronName) {
      return NextResponse.json(
        { success: false, error: 'cronName is required' },
        { status: 400 }
      );
    }

    const circuitBreaker = new CircuitBreaker(cronName);
    await circuitBreaker.manualReset(adminEmail || 'admin');

    return NextResponse.json({
      success: true,
      message: `Circuit breaker for ${cronName} has been reset`,
      resetBy: adminEmail || 'admin',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[GuardrailStatus] Reset error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to reset circuit breaker' },
      { status: 500 }
    );
  }
}
