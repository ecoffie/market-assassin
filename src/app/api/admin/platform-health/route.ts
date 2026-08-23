/**
 * GET /api/admin/platform-health?password=…
 *
 * The Observatory's self-measurement. See `src/lib/analytics/platform-health.ts` for the rule this
 * enforces: never report a status we did not measure — `unknown` + `blockedBy` is a first-class
 * outcome, and a check that throws surfaces as `unknown`, never as green.
 */
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPlatformHealth } from '@/lib/analytics/platform-health';
import { getMeasurementIntegrity } from '@/lib/analytics/measurement-integrity';

/**
 * OBSERVABLE DEBT — known truncation-risk findings.
 *
 * Eric, 2026-08-22: "the important part isn't that the gate exists. It's that you now have a
 * known debt inventory instead of an unknown correctness risk... That turns technical debt into
 * observable debt."
 *
 * Read straight from the gate's own baseline so this number CANNOT drift from what CI enforces —
 * a hand-maintained copy would be the same class of bug this whole exercise is about.
 *
 * ⚠️ Going DOWN is only good if a route became provably bounded, paginated, or exact. Eric:
 * "don't celebrate getting it to zero by suppressing findings." A drop that coincides with new
 * `truncation-ok:` waivers is not progress — it is the number lying about itself.
 */
function truncationDebt(): { known: number; measured: boolean; note: string } {
  try {
    const raw = readFileSync(join(process.cwd(), 'tests/fixtures/api-truncation-baseline.json'), 'utf8');
    const known = (JSON.parse(raw).violations || []).length;
    return {
      known,
      measured: true,
      note: 'Unpaginated reads under src/app/api whose result feeds a count, cohort, percentage or eligibility. Internal signal, not a customer metric. Down is only good when a route became bounded/paginated/exact — never when a finding was suppressed.',
    };
  } catch {
    // Never guess. An unreadable baseline is 'unknown', consistent with this route's own rule.
    return { known: -1, measured: false, note: 'baseline unreadable — not measured' };
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

export async function GET(request: NextRequest) {
  const pw = request.nextUrl.searchParams.get('password');
  if (!ADMIN_PASSWORD || pw !== ADMIN_PASSWORD) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const health = await getPlatformHealth();
    return NextResponse.json({
      ok: true,
      ...health,
      truncationDebt: truncationDebt(),
      // THE NUMBER THAT MATTERS BEFORE A PRODUCT CALL (Eric, 2026-08-22): "131 -> 129 tells
      // you code debt is shrinking. But 1/30 verified tells you how much of the product's
      // decision-making instrumentation you can currently trust." Kept SEPARATE from the
      // operational risks so the trust problem is not overstated.
      measurementIntegrity: getMeasurementIntegrity(),
      note:
        'Platform Health measures the measurement system. A status is only reported when it was ' +
        'actually checked; anything we could not verify appears under `unmeasured` with its blocker ' +
        'rather than being guessed at.',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
