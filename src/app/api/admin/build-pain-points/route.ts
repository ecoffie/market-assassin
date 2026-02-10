import { NextRequest, NextResponse } from 'next/server';
import { buildComprehensiveAgencyList, KNOWN_SUB_AGENCIES, AgencyListEntry } from '@/lib/utils/agency-list-builder';
import { getOversightContextForAgency } from '@/lib/utils/federal-oversight-data';
import { generatePainPointsForAgency } from '@/lib/utils/pain-point-generator';
import agencyPainPointsData from '@/data/agency-pain-points.json';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

interface PainPointsDatabase {
  agencies: Record<string, { painPoints: string[] }>;
}

const existingDB = agencyPainPointsData as PainPointsDatabase;

/**
 * GET /api/admin/build-pain-points?mode=preview
 *
 * Preview mode: shows which agencies need pain points generated
 * No API calls to Grok — just identifies gaps
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const mode = searchParams.get('mode') || 'preview';

    if (mode !== 'preview') {
      return NextResponse.json({ error: 'GET only supports mode=preview. Use POST to generate.' }, { status: 400 });
    }

    // Build the full agency list
    const includeSubAgencies = searchParams.get('subs') !== 'false';
    const agencies = await buildComprehensiveAgencyList(includeSubAgencies);

    // Add known sub-agencies that USASpending might not return
    const agencyNames = new Set(agencies.map(a => a.name.toLowerCase()));
    const knownToAdd: AgencyListEntry[] = [];

    for (const known of KNOWN_SUB_AGENCIES) {
      if (!agencyNames.has(known.name.toLowerCase())) {
        knownToAdd.push({
          name: known.name,
          toptierCode: '',
          abbreviation: known.abbreviation,
          budget: 0,
          isSubAgency: true,
          parentAgency: known.parentAgency,
        });
      }
    }

    const allAgencies = [...agencies, ...knownToAdd];

    // Categorize agencies
    const existing = Object.keys(existingDB.agencies);
    const existingSet = new Set(existing.map(n => n.toLowerCase()));

    const needsGeneration: Array<{ name: string; reason: string; currentCount: number }> = [];
    const alreadyGood: Array<{ name: string; count: number }> = [];
    const thinCoverage: Array<{ name: string; count: number }> = [];

    for (const agency of allAgencies) {
      const match = findExistingMatch(agency.name, existingDB.agencies);
      if (match) {
        const count = match.painPoints.length;
        if (count >= 10) {
          alreadyGood.push({ name: agency.name, count });
        } else {
          thinCoverage.push({ name: agency.name, count });
          needsGeneration.push({
            name: agency.name,
            reason: `Only ${count} pain points (need 10+)`,
            currentCount: count,
          });
        }
      } else {
        needsGeneration.push({
          name: agency.name,
          reason: 'No pain points at all',
          currentCount: 0,
        });
      }
    }

    return NextResponse.json({
      summary: {
        totalAgenciesDiscovered: allAgencies.length,
        fromUSASpending: agencies.length,
        fromKnownList: knownToAdd.length,
        existingInDatabase: existing.length,
        alreadyGood: alreadyGood.length,
        thinCoverage: thinCoverage.length,
        needsGeneration: needsGeneration.length,
        estimatedGrokCalls: needsGeneration.length,
      },
      needsGeneration: needsGeneration.sort((a, b) => a.currentCount - b.currentCount),
      alreadyGood: alreadyGood.sort((a, b) => b.count - a.count),
      thinCoverage: thinCoverage.sort((a, b) => a.count - b.count),
      allAgencies: allAgencies.map(a => ({
        name: a.name,
        abbreviation: a.abbreviation,
        budget: a.budget,
        isSubAgency: a.isSubAgency,
        parentAgency: a.parentAgency,
      })),
    });
  } catch (error: any) {
    console.error('[build-pain-points] Preview error:', error);
    return NextResponse.json({
      error: 'Preview failed',
      message: error.message,
    }, { status: 500 });
  }
}

/**
 * POST /api/admin/build-pain-points
 *
 * Generate pain points for agencies that need them
 *
 * Query params:
 * - agency: Generate for a single agency (e.g., ?agency=Department+of+Justice)
 * - limit: Only process first N agencies (e.g., ?limit=10)
 * - force: Regenerate even for agencies with 10+ pain points
 * - target: Target number of pain points per agency (default: 12)
 */
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');

  if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const singleAgency = searchParams.get('agency');
  const limit = parseInt(searchParams.get('limit') || '0') || 0;
  const force = searchParams.get('force') === 'true';
  const targetCount = parseInt(searchParams.get('target') || '12') || 12;

  try {
    // Start with existing data
    const outputDB: Record<string, { painPoints: string[] }> = {
      ...JSON.parse(JSON.stringify(existingDB.agencies)),
    };

    let agenciesToProcess: Array<{ name: string; budget: number }>;

    if (singleAgency) {
      // Single agency mode
      agenciesToProcess = [{ name: singleAgency, budget: 0 }];
    } else {
      // Full build mode
      const allAgencies = await buildComprehensiveAgencyList(true);

      // Add known sub-agencies
      const agencyNames = new Set(allAgencies.map(a => a.name.toLowerCase()));
      for (const known of KNOWN_SUB_AGENCIES) {
        if (!agencyNames.has(known.name.toLowerCase())) {
          allAgencies.push({
            name: known.name,
            toptierCode: '',
            abbreviation: known.abbreviation,
            budget: 0,
            isSubAgency: true,
            parentAgency: known.parentAgency,
          });
        }
      }

      // Filter to agencies that need generation
      agenciesToProcess = allAgencies
        .filter(agency => {
          if (force) return true;
          const match = findExistingMatch(agency.name, existingDB.agencies);
          return !match || match.painPoints.length < targetCount;
        })
        .map(a => ({ name: a.name, budget: a.budget }));

      // Apply limit
      if (limit > 0) {
        agenciesToProcess = agenciesToProcess.slice(0, limit);
      }
    }

    console.log(`[build-pain-points] Processing ${agenciesToProcess.length} agencies (target: ${targetCount} pain points each)`);

    const results: Array<{
      agency: string;
      painPointCount: number;
      source: string;
      newPainPoints: string[];
    }> = [];

    let generated = 0;
    let skipped = 0;
    let errors = 0;

    for (const agency of agenciesToProcess) {
      try {
        const existing = findExistingMatch(agency.name, outputDB);
        const existingPainPoints = existing?.painPoints || [];

        // Skip if already at target and not forcing
        if (!force && existingPainPoints.length >= targetCount) {
          skipped++;
          results.push({
            agency: agency.name,
            painPointCount: existingPainPoints.length,
            source: 'skipped',
            newPainPoints: [],
          });
          continue;
        }

        const context = getOversightContextForAgency(agency.name, agency.budget);

        const result = await generatePainPointsForAgency(
          agency.name,
          context,
          existingPainPoints,
          targetCount
        );

        // Update the output database
        outputDB[agency.name] = { painPoints: result.painPoints };

        const newCount = result.painPoints.length - existingPainPoints.length;
        generated++;

        results.push({
          agency: agency.name,
          painPointCount: result.painPoints.length,
          source: result.source,
          newPainPoints: result.painPoints.slice(existingPainPoints.length),
        });

        console.log(`[build-pain-points] ${agency.name}: ${existingPainPoints.length} existing + ${newCount} new = ${result.painPoints.length} total`);

        // Rate limit between Grok API calls (2 seconds)
        if (result.source !== 'existing' && agenciesToProcess.indexOf(agency) < agenciesToProcess.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error: any) {
        errors++;
        console.error(`[build-pain-points] Error for ${agency.name}:`, error.message);
        results.push({
          agency: agency.name,
          painPointCount: 0,
          source: 'error',
          newPainPoints: [],
        });
      }
    }

    // Build the final output JSON structure
    const finalOutput = {
      agencies: outputDB,
    };

    // Count totals
    const totalAgencies = Object.keys(outputDB).length;
    const totalPainPoints = Object.values(outputDB).reduce((sum, a) => sum + a.painPoints.length, 0);

    return NextResponse.json({
      summary: {
        agenciesProcessed: agenciesToProcess.length,
        generated,
        skipped,
        errors,
        totalAgenciesInDatabase: totalAgencies,
        totalPainPoints,
        averagePainPointsPerAgency: (totalPainPoints / totalAgencies).toFixed(1),
      },
      results,
      // The complete updated database — copy this to agency-pain-points.json
      database: finalOutput,
    });
  } catch (error: any) {
    console.error('[build-pain-points] Build error:', error);
    return NextResponse.json({
      error: 'Build failed',
      message: error.message,
    }, { status: 500 });
  }
}

/**
 * Find an existing match for an agency name in the database
 * Handles exact match and partial matching
 */
function findExistingMatch(
  agencyName: string,
  db: Record<string, { painPoints: string[] }>
): { painPoints: string[] } | null {
  // Exact match
  if (db[agencyName]) {
    return db[agencyName];
  }

  // Case-insensitive match
  const lower = agencyName.toLowerCase();
  for (const [key, value] of Object.entries(db)) {
    if (key.toLowerCase() === lower) {
      return value;
    }
  }

  // Partial match (e.g., "Department of Defense" in "Department of Defense - Army")
  for (const [key, value] of Object.entries(db)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
      return value;
    }
  }

  return null;
}
