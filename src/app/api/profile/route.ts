/**
 * Smart Profile API
 *
 * GET /api/profile?email=user@example.com
 * - Get user profile with completeness breakdown
 *
 * POST /api/profile
 * - Update user profile
 *
 * Body: { email: string, ...ProfileUpdatePayload }
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getOrCreateProfile,
  updateProfile,
  calculateProfileCompleteness,
  ProfileUpdatePayload,
} from '@/lib/smart-profile';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');

  if (!email) {
    return NextResponse.json({ error: 'Email parameter required' }, { status: 400 });
  }

  try {
    const profile = await getOrCreateProfile(email);
    const completeness = await calculateProfileCompleteness(email);

    return NextResponse.json({
      success: true,
      profile,
      completeness,
    });
  } catch (error) {
    console.error('[ProfileAPI] Error getting profile:', error);
    return NextResponse.json({ error: 'Failed to get profile' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, ...updates } = body as { email: string } & ProfileUpdatePayload;

    if (!email) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }

    // Validate arrays
    if (updates.naicsCodes && !Array.isArray(updates.naicsCodes)) {
      return NextResponse.json({ error: 'naicsCodes must be an array' }, { status: 400 });
    }
    if (updates.targetAgencies && !Array.isArray(updates.targetAgencies)) {
      return NextResponse.json({ error: 'targetAgencies must be an array' }, { status: 400 });
    }
    if (updates.certifications && !Array.isArray(updates.certifications)) {
      return NextResponse.json({ error: 'certifications must be an array' }, { status: 400 });
    }

    const profile = await updateProfile(email, updates);

    if (!profile) {
      return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
    }

    const completeness = await calculateProfileCompleteness(email);

    return NextResponse.json({
      success: true,
      profile,
      completeness,
    });
  } catch (error) {
    console.error('[ProfileAPI] Error updating profile:', error);
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }
}
