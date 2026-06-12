import { NextRequest, NextResponse } from 'next/server';
import { MAGIC_LINK_SUCCESS_MESSAGE, sendMagicLinkSignIn } from '@/lib/mindy/magic-link-signin';

function normalizeEmail(email: unknown): string {
  return typeof email === 'string' ? email.toLowerCase().trim() : '';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body.email);

    if (!email || !email.includes('@')) {
      return NextResponse.json({ success: false, error: 'Valid email is required' }, { status: 400 });
    }

    const result = await sendMagicLinkSignIn(email);

    if (!result.entitled) {
      return NextResponse.json({
        success: true,
        entitled: false,
        message: "We couldn't find Mindy access for that email. Create a free account to get started.",
      });
    }

    return NextResponse.json({
      success: true,
      entitled: true,
      message: MAGIC_LINK_SUCCESS_MESSAGE,
    });
  } catch (error) {
    console.error('[MI Magic Link] Failed to send sign-in link:', error);
    return NextResponse.json(
      { success: false, error: 'Unable to send sign-in link right now. Please try again.' },
      { status: 502 },
    );
  }
}
