import { NextRequest, NextResponse } from 'next/server';
import { WORKSPACE_PROTOTYPE_BANNER } from '@/lib/mrr/workspace-constants';
import { interpretMarketQuestion } from '@/lib/mrr/interpret-market';
import { requireMIAuthSession } from '@/lib/two-factor-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const auth = requireMIAuthSession(request);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body', prototypeBanner: WORKSPACE_PROTOTYPE_BANNER },
      { status: 400 },
    );
  }

  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) {
    return NextResponse.json(
      { success: false, error: 'question is required', prototypeBanner: WORKSPACE_PROTOTYPE_BANNER },
      { status: 400 },
    );
  }

  const clarification =
    body.clarification && typeof body.clarification === 'object'
      ? (body.clarification as { dimension?: unknown; value?: unknown })
      : undefined;
  const dimension = clarification?.dimension;
  const value = clarification?.value;

  try {
    const interpreted = await interpretMarketQuestion({
      question,
      ...(typeof dimension === 'string' && typeof value === 'string'
        ? {
            clarification: {
              dimension: dimension as 'office' | 'buyer' | 'requirement' | 'geography',
              value,
            },
          }
        : {}),
    });
    return NextResponse.json({
      success: true,
      prototypeBanner: WORKSPACE_PROTOTYPE_BANNER,
      interpreted,
    });
  } catch (error) {
    console.error('[mrr-workspace] Interpret failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Unable to interpret the market question.',
        prototypeBanner: WORKSPACE_PROTOTYPE_BANNER,
      },
      { status: 500 },
    );
  }
}
