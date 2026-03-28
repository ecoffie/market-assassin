import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/send-email';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

function getAdminClient() {
  if (!supabaseUrl || !supabaseServiceKey) return null;
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });
}

/**
 * POST /api/admin/send-alert-invite
 *
 * Send invitation email to existing users to set up their daily alerts.
 *
 * Options:
 * - mode=preview (default) - show who would receive
 * - mode=execute - actually send emails
 * - email=xxx - send to specific user only (for testing)
 */
export async function POST(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');
  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mode = request.nextUrl.searchParams.get('mode') || 'preview';
  const specificEmail = request.nextUrl.searchParams.get('email');
  const batchSize = parseInt(request.nextUrl.searchParams.get('batch') || '50', 10);
  const offset = parseInt(request.nextUrl.searchParams.get('offset') || '0', 10);

  const supabase = getAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  try {
    // Get users who have alert settings but no NAICS codes
    // OR users in profiles who don't have alert settings
    let usersToInvite: { email: string; company_name?: string }[] = [];

    if (specificEmail) {
      usersToInvite = [{ email: specificEmail }];
    } else {
      // Get ALL users with alert settings who have NO NAICS codes
      // This includes both Tier 1 (profiles) and Tier 2 (leads) who were backfilled
      const { data: alertSettings } = await supabase
        .from('user_notification_settings')
        .select('user_email, naics_codes');

      // Find users with no NAICS codes (they need to set them up)
      usersToInvite = (alertSettings || [])
        .filter(s => {
          if (!s.user_email) return false;
          // Skip healthcheck/test emails
          const email = s.user_email.toLowerCase();
          if (email.includes('healthcheck') || email.includes('@test.')) return false;
          if (email.startsWith('test') && email.includes('@gmail.com')) return false;
          // Only invite if no NAICS codes
          return !s.naics_codes || s.naics_codes.length === 0;
        })
        .map(s => ({ email: s.user_email }));
    }

    if (mode === 'preview') {
      return NextResponse.json({
        success: true,
        mode: 'preview',
        toInvite: usersToInvite.length,
        users: usersToInvite.slice(0, 50), // Show first 50
        batching: {
          total: usersToInvite.length,
          batchSize,
          batchesNeeded: Math.ceil(usersToInvite.length / batchSize)
        },
        message: 'Use mode=execute with batch=50 and offset=0,50,100,etc to send in batches'
      });
    }

    // Execute mode - send emails in batches
    const batch = usersToInvite.slice(offset, offset + batchSize);
    const results = {
      sent: 0,
      failed: 0,
      errors: [] as string[],
      batchInfo: {
        offset,
        batchSize,
        processedInBatch: batch.length,
        totalRemaining: usersToInvite.length - offset - batch.length,
        nextOffset: offset + batchSize < usersToInvite.length ? offset + batchSize : null
      }
    };

    for (const user of batch) {
      try {
        await sendEmail({
          to: user.email,
          subject: '🎁 FREE Daily Federal Contract Alerts - Set Up Now',
          html: generateInviteEmail('GovCon Professional'),
        });
        results.sent++;
      } catch (error) {
        results.failed++;
        if (results.errors.length < 10) {
          results.errors.push(`${user.email}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    return NextResponse.json({
      success: true,
      mode: 'execute',
      results,
      message: `Sent ${results.sent} invitation emails (batch starting at ${offset}). ${results.failed} failed.`,
      nextBatch: results.batchInfo.nextOffset !== null
        ? `?password=xxx&mode=execute&batch=${batchSize}&offset=${results.batchInfo.nextOffset}`
        : 'All batches complete!'
    });

  } catch (error) {
    console.error('[Send Alert Invite] Error:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

function generateInviteEmail(name: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background: white;">
    <!-- Header -->
    <tr>
      <td style="background: linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%); padding: 30px 20px; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">🎁 FREE Daily Alerts</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Federal Contract Opportunities Delivered Daily</p>
      </td>
    </tr>

    <!-- Body -->
    <tr>
      <td style="padding: 30px 20px;">
        <p style="font-size: 16px; color: #333; margin: 0 0 20px 0;">
          Hi ${name},
        </p>

        <p style="font-size: 16px; color: #333; margin: 0 0 20px 0;">
          As a valued GovCon Giants member, you now have access to <strong>FREE daily federal contract alerts</strong>.
        </p>

        <div style="background: #f0fdf4; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0;">
          <p style="margin: 0; color: #166534; font-weight: 600;">What You'll Get:</p>
          <ul style="margin: 10px 0 0 0; padding-left: 20px; color: #166534;">
            <li>Daily emails with matching SAM.gov opportunities</li>
            <li>Filtered by YOUR NAICS codes</li>
            <li>Keyword matching for your specialties</li>
            <li>Set-aside filters (8(a), SDVOSB, WOSB, etc.)</li>
          </ul>
        </div>

        <p style="font-size: 16px; color: #333; margin: 20px 0;">
          <strong>It takes 60 seconds to set up:</strong>
        </p>

        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center" style="padding: 20px 0;">
              <a href="https://tools.govcongiants.org/alerts/preferences"
                 style="display: inline-block; background: linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%); color: white; text-decoration: none; padding: 15px 40px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                Set Up My Alerts →
              </a>
            </td>
          </tr>
        </table>

        <p style="font-size: 14px; color: #666; margin: 20px 0 0 0;">
          Just enter your email and NAICS codes, and you'll start receiving alerts tomorrow morning.
        </p>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="background: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="margin: 0; color: #64748b; font-size: 14px;">
          GovCon Giants | Federal Contract Intelligence
        </p>
        <p style="margin: 10px 0 0 0; color: #94a3b8; font-size: 12px;">
          Questions? Reply to this email or contact service@govcongiants.com
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    message: 'Alert Invite Endpoint',
    usage: {
      preview: 'POST ?password=xxx&mode=preview',
      execute: 'POST ?password=xxx&mode=execute',
      testOne: 'POST ?password=xxx&mode=execute&email=test@example.com'
    }
  });
}
