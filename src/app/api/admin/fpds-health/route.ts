// FPDS Health Check Admin Endpoint
// GET: Check current FPDS health status
// POST: Reset FPDS health status (force re-check)

import { NextRequest, NextResponse } from 'next/server';
import { getFPDSHealthStatus, resetFPDSHealth, fetchFPDSByNaics } from '@/lib/utils/fpds-api';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const status = getFPDSHealthStatus();
  const testMode = searchParams.get('test') === 'true';

  // If test mode, actually try to fetch from FPDS
  let testResult = null;
  if (testMode) {
    try {
      const start = Date.now();
      const result = await fetchFPDSByNaics('541512', { maxRecords: 5 });
      const duration = Date.now() - start;

      testResult = {
        success: result.awards.length > 0,
        recordCount: result.awards.length,
        officeCount: result.offices.size,
        durationMs: duration,
      };
    } catch (error) {
      testResult = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  return NextResponse.json({
    fpdsStatus: {
      healthy: status.healthy,
      consecutiveFailures: status.consecutiveFailures,
      lastCheckAt: status.lastCheck ? new Date(status.lastCheck).toISOString() : null,
      lastCheckAgo: status.lastCheck ? `${Math.round((Date.now() - status.lastCheck) / 1000)}s ago` : 'never',
    },
    samFallback: {
      enabled: !status.healthy,
      samApiKeyConfigured: !!process.env.SAM_API_KEY,
    },
    ...(testResult && { testResult }),
    timestamp: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const action = searchParams.get('action');

  if (action === 'reset') {
    resetFPDSHealth();
    return NextResponse.json({
      success: true,
      message: 'FPDS health status reset - will re-check on next request',
      timestamp: new Date().toISOString(),
    });
  }

  if (action === 'test') {
    try {
      const start = Date.now();
      const result = await fetchFPDSByNaics('541512', { maxRecords: 10 });
      const duration = Date.now() - start;

      return NextResponse.json({
        success: true,
        fpds: {
          recordCount: result.awards.length,
          officeCount: result.offices.size,
          durationMs: duration,
          sampleOffices: Array.from(result.offices.values()).slice(0, 3).map(o => ({
            name: o.officeName,
            id: o.officeId,
            spending: o.obligatedAmount,
          })),
        },
        status: getFPDSHealthStatus(),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return NextResponse.json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        status: getFPDSHealthStatus(),
        timestamp: new Date().toISOString(),
      });
    }
  }

  return NextResponse.json({
    error: 'Invalid action. Use ?action=reset or ?action=test',
    availableActions: ['reset', 'test'],
  }, { status: 400 });
}
