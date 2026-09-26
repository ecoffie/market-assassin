/**
 * /api/sbir — RETIRED 2026-09-26 (Mindy's dedicated SBIR/STTR search; Grants.gov search is separate and kept).
 *
 * This endpoint served the in-app SBIR/STTR panel from NIH RePORTER (funded awards) plus the
 * `aggregated_opportunities` sbir_sttr slice (42/42 NIH project pages) — award history presented as
 * SBIR "opportunities", with no working open-topic source behind it. See src/lib/sbir/retired.ts and
 * tasks/sbir-reed-investigation-2026-09-26.md.
 *
 * Every method now answers 410 Gone with the shared retirement notice. Nothing is read or written.
 * The previous implementation is in git history; the shared libraries and stored data are untouched.
 */
import { NextResponse } from 'next/server';
import { sbirSearchRetiredBody } from '@/lib/sbir/retired';

function retired() {
  return NextResponse.json(sbirSearchRetiredBody(), {
    status: 410,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export const GET = retired;
export const POST = retired;
