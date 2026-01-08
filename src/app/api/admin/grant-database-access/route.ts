import { NextRequest, NextResponse } from 'next/server';
import { createDatabaseToken } from '@/lib/access-codes';
import { sendDatabaseAccessEmail } from '@/lib/send-email';

// Admin password - set this in your environment variables
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'govcon-admin-2024';

export async function POST(request: NextRequest) {
  try {
    const { email, name, adminPassword } = await request.json();

    // Validate admin password
    if (adminPassword !== ADMIN_PASSWORD) {
      return NextResponse.json(
        { error: 'Invalid admin password' },
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
