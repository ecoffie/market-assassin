/**
 * Admin A/B harness for Proposal Assist.
 *
 * POST /api/admin/proposal-ab?password=...
 *   body: { sectionType, sourceText, email, rfpAgency? }
 *
 * Returns v1 vs v2 side-by-side with each pipeline's prompt + draft
 * + context meta. Lets Eric judge whether v2 is genuinely better
 * before we flip production to the new pipeline.
 *
 * Runs both pipelines in parallel — same RFP, same email, independent
 * generation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateV1Draft } from '@/lib/proposal/v1';
import { generateV2Draft, buildV2Prompt } from '@/lib/proposal/v2';
import type { SectionType } from '@/lib/proposal/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 90;

function unauthorized() {
  return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
}

export async function POST(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  if (password !== (process.env.ADMIN_PASSWORD)) {
    return unauthorized();
  }

  let body: {
    sectionType?: SectionType;
    sourceText?: string;
    email?: string;
    rfpAgency?: string | null;
    fileName?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const sectionType = body.sectionType;
  const sourceText = (body.sourceText || '').trim();
  const email = (body.email || '').trim();

  if (!sectionType || !sourceText || !email) {
    return NextResponse.json({
      success: false,
      error: 'sectionType, sourceText, and email are required',
    }, { status: 400 });
  }

  const t0 = Date.now();

  const [v1Result, v2Result] = await Promise.allSettled([
    generateV1Draft({ email, sectionType, sourceText, fileName: body.fileName }),
    (async () => {
      const built = await buildV2Prompt({ email, sectionType, sourceText, rfpAgency: body.rfpAgency });
      const result = await generateV2Draft({ email, sectionType, sourceText, fileName: body.fileName, rfpAgency: body.rfpAgency });
      return {
        ...result,
        prompt: { system: built.systemPrompt, user: built.userPrompt },
        context: built.context,
      };
    })(),
  ]);

  return NextResponse.json({
    success: true,
    sectionType,
    elapsedMs: Date.now() - t0,
    v1: v1Result.status === 'fulfilled'
      ? v1Result.value
      : { error: String(v1Result.reason?.message || v1Result.reason) },
    v2: v2Result.status === 'fulfilled'
      ? v2Result.value
      : { error: String(v2Result.reason?.message || v2Result.reason) },
  });
}
