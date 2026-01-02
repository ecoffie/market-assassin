import { NextRequest, NextResponse } from 'next/server';
import {
  createAccessCode,
  validateAccessCode,
  markCodeAsUsed,
  getAllAccessCodes,
  deleteAccessCode,
} from '@/lib/access-codes';

// Admin password for generating codes
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'govcongiants2024';

// GET - Validate a code or list all codes (admin)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const admin = searchParams.get('admin');
  const password = searchParams.get('password');

  // Admin: List all codes
  if (admin === 'true') {
    if (password !== ADMIN_PASSWORD) {
      return NextResponse.json({ success: false, error: 'Invalid admin password' }, { status: 401 });
    }
    const codes = await getAllAccessCodes();
    return NextResponse.json({ success: true, codes });
  }

  // Validate a specific code
  if (code) {
    const result = await validateAccessCode(code);
    return NextResponse.json({
      success: result.valid,
      error: result.error,
      accessCode: result.valid ? {
        email: result.accessCode?.email,
        companyName: result.accessCode?.companyName,
        used: result.accessCode?.used,
      } : undefined,
    });
  }

  return NextResponse.json({ success: false, error: 'Code parameter required' }, { status: 400 });
}

// POST - Create a new access code (admin) or mark code as used
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action, password, email, companyName, code } = body;

  // Admin: Create new code
  if (action === 'create') {
    if (password !== ADMIN_PASSWORD) {
      return NextResponse.json({ success: false, error: 'Invalid admin password' }, { status: 401 });
    }

    if (!email) {
      return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
    }

    const accessCode = await createAccessCode(email, companyName);
    return NextResponse.json({
      success: true,
      accessCode,
      accessLink: `https://tools.govcongiants.org/access/${accessCode.code}`,
    });
  }

  // Mark code as used
  if (action === 'use') {
    if (!code) {
      return NextResponse.json({ success: false, error: 'Code is required' }, { status: 400 });
    }

    const validation = await validateAccessCode(code);
    if (!validation.valid) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
    }

    const marked = await markCodeAsUsed(code);
    return NextResponse.json({ success: marked });
  }

  return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
}

// DELETE - Delete an access code (admin)
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const password = searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: 'Invalid admin password' }, { status: 401 });
  }

  if (!code) {
    return NextResponse.json({ success: false, error: 'Code is required' }, { status: 400 });
  }

  const deleted = await deleteAccessCode(code);
  return NextResponse.json({ success: deleted });
}
