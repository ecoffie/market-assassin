import { NextRequest, NextResponse } from 'next/server';
import { createDatabaseToken } from '@/lib/access-codes';
import { sendDatabaseAccessEmail } from '@/lib/send-email';
import { verifyAdminPassword } from '@/lib/admin-auth';
import { checkAdminRateLimit, getClientIP, rateLimitResponse } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIP(request);
    const rl = await checkAdminRateLimit(ip);
    if (!rl.allowed) return rateLimitResponse(rl);

    const { email, name, adminPassword } = await request.json();

    if (!verifyAdminPassword(adminPassword)) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Validate email
    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Valid email is required' },
        { status: 400 }
      );
    }

    // Create database access token
    const dbToken = await createDatabaseToken(email, name || undefined);
    const accessLink = `https://tools.govcongiants.org/api/database-access/${dbToken.token}`;

    console.log(`🔑 Admin granted database access to ${email}, token: ${dbToken.token}`);

    // Optionally send email to the customer
    const emailSent = await sendDatabaseAccessEmail({
      to: email,
      customerName: name || undefined,
      accessLink,
    });

    if (emailSent) {
      console.log(`✅ Database access email sent to ${email}`);
    } else {
      console.log(`⚠️ Could not send email to ${email}, but access was granted`);
    }

    return NextResponse.json({
      success: true,
      message: `Access granted to ${email}`,
      token: dbToken.token,
      accessLink,
      emailSent,
    });
  } catch (error) {
    console.error('❌ Error granting database access:', error);
    return NextResponse.json(
      { error: 'Failed to grant access' },
      { status: 500 }
    );
  }
}
