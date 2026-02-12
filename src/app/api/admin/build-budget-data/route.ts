import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { checkAdminRateLimit, getClientIP, rateLimitResponse } from '@/lib/rate-limit';
import {
  fetchAllToptierBudgets,
  fetchAgencyBudget,
  classifyAgencyTrend,
  type AgencyBudgetSnapshot,
  type BudgetTrend,
} from '@/lib/utils/budget-authority';

interface CachedAgencyEntry {
  toptierCode: string;
  fy2025: AgencyBudgetSnapshot;
  fy2026: AgencyBudgetSnapshot;
  change: { amount: number; percent: number; trend: BudgetTrend };
}

/**
 * GET /api/admin/build-budget-data?password=...
 *
 * Fetches budget authority data from USASpending API for FY2025 and FY2026,
 * computes year-over-year changes, and returns the data for caching.
 *
 * Query params:
 * - password: admin password (required)
 * - mode: 'preview' (default) just fetches current year, 'build' does full FY2025+FY2026 comparison
 * - limit: max agencies to process (default: all)
 */
export async function GET(request: NextRequest) {
  const ip = getClientIP(request);
  const rl = await checkAdminRateLimit(ip);
  if (!rl.allowed) return rateLimitResponse(rl);

  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (!verifyAdminPassword(password)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mode = searchParams.get('mode') || 'preview';
  const limit = parseInt(searchParams.get('limit') || '0') || 0;

  try {
    if (mode === 'preview') {
      // Preview: just fetch current toptier agencies
      const agencies = await fetchAllToptierBudgets();
      const limited = limit > 0 ? agencies.slice(0, limit) : agencies;

      return NextResponse.json({
        summary: {
          totalAgencies: limited.length,
          mode: 'preview',
          message: 'Use mode=build to fetch FY2025 vs FY2026 comparison data',
        },
        agencies: limited.map(a => ({
          name: a.agencyName,
          toptierCode: a.toptierCode,
          abbreviation: a.abbreviation,
          currentBudgetAuthority: a.budgetAuthority,
        })),
      });
    }

    // Build mode: fetch FY2025 + FY2026 per-agency data
    console.log('[build-budget-data] Fetching toptier agencies list...');
    const toptierAgencies = await fetchAllToptierBudgets();
    const agenciesToProcess = limit > 0 ? toptierAgencies.slice(0, limit) : toptierAgencies;

    console.log(`[build-budget-data] Processing ${agenciesToProcess.length} agencies...`);

    const results: Record<string, CachedAgencyEntry> = {};
    let processed = 0;
    let errors = 0;
    const errorDetails: Array<{ agency: string; error: string }> = [];

    for (const agency of agenciesToProcess) {
      try {
        // Fetch FY2025 and FY2026 budget data for this agency
        const [fy2025, fy2026] = await Promise.all([
          fetchAgencyBudget(agency.toptierCode, 2025),
          fetchAgencyBudget(agency.toptierCode, 2026),
        ]);

        const amount = fy2026.budgetAuthority - fy2025.budgetAuthority;
        const percent = fy2025.budgetAuthority > 0
          ? fy2026.budgetAuthority / fy2025.budgetAuthority
          : 1;
        const trend = classifyAgencyTrend(percent);

        results[agency.agencyName] = {
          toptierCode: agency.toptierCode,
          fy2025,
          fy2026,
          change: { amount, percent, trend },
        };

        processed++;
        console.log(
          `[build-budget-data] ${agency.agencyName}: FY25 $${(fy2025.budgetAuthority / 1e9).toFixed(1)}B → FY26 $${(fy2026.budgetAuthority / 1e9).toFixed(1)}B (${trend})`
        );

        // Rate limit between API calls (250ms per agency = 2 calls * 125ms)
        await new Promise(resolve => setTimeout(resolve, 250));
      } catch (error: any) {
        errors++;
        errorDetails.push({ agency: agency.agencyName, error: error.message });
        console.warn(`[build-budget-data] Error for ${agency.agencyName}: ${error.message}`);
      }
    }

    // Build the final cached JSON
    const outputDatabase = {
      lastUpdated: new Date().toISOString(),
      fiscalYears: [2025, 2026],
      agencies: results,
    };

    // Compute summary stats
    const allEntries = Object.entries(results);
    const growing = allEntries.filter(([, e]) => e.change.percent > 1).length;
    const declining = allEntries.filter(([, e]) => e.change.percent < 1).length;
    const stable = allEntries.filter(([, e]) => e.change.percent === 1).length;

    const sortedByChange = allEntries.sort(([, a], [, b]) => b.change.percent - a.change.percent);
    const biggestWinner = sortedByChange[0]?.[0] || 'N/A';
    const biggestLoser = sortedByChange[sortedByChange.length - 1]?.[0] || 'N/A';

    return NextResponse.json({
      summary: {
        mode: 'build',
        agenciesProcessed: processed,
        errors,
        totalInDatabase: allEntries.length,
        growing,
        declining,
        stable,
        biggestWinner,
        biggestLoser,
      },
      errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
      database: outputDatabase,
    });
  } catch (error: any) {
    console.error('[build-budget-data] Build error:', error);
    return NextResponse.json({
      error: 'Build failed',
      message: error.message,
    }, { status: 500 });
  }
}
