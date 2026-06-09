/**
 * /api/app/profile-from-text (#64) — POST { text } → the full extracted profile
 * (industry, NAICS, PSC, keywords, states, set-asides, top agencies) for the
 * Auto-onboarding CONFIRM screen. The user reviews before it's committed. Powered
 * by the shared buildProfileFromText engine (LLM industry label + real-data facts).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { buildProfileFromText } from '@/lib/market/profile-from-text';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email : null;
  // Auth is light here — this is read-only extraction during onboarding/add-client.
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const text = String(body.text || '').trim();
  if (text.length < 4) {
    return NextResponse.json({ success: false, error: 'Tell us a bit about what you do (e.g. "janitorial in Florida").' }, { status: 400 });
  }

  const profile = await buildProfileFromText(text);
  if (!profile || !profile.naics.length) {
    return NextResponse.json({ success: false, error: `Couldn't find a federal market from that. Try naming the service + where you work (e.g. "IT staffing in Texas").` }, { status: 422 });
  }

  return NextResponse.json({ success: true, profile });
}
