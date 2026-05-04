import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { expandNAICSCodes, parseNAICSInput } from '@/lib/utils/naics-expansion';
import { getNAICSForPSC } from '@/lib/utils/psc-crosswalk';
import { grantBriefingsAccess } from '@/lib/briefings/access';
import { sendEmail } from '@/lib/send-email';
import { fetchSamOpportunitiesFromCache } from '@/lib/briefings/pipelines/sam-gov';

// Lazy initialization to avoid build-time errors
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface AlertProfileRequest {
  email: string;
  naicsCodes: string[];       // Can be full codes or prefixes (e.g., ["541511", "236"])
  naicsInput?: string;        // Alternative: comma-separated string (e.g., "541511, 236, 238320")
  pscCode?: string;           // If provided, will expand to related NAICS codes
  businessType: string;
  targetAgencies?: string[];
  locationState?: string;
  locationStates?: string[];
  locationZip?: string;
  alertFrequency?: 'daily' | 'weekly';
  source?: string;            // e.g., "opportunity-hunter-free", "free-signup", "paid_existing"
  inviteToken?: string;       // Magic link token for paid subscriber activation
  stripeCustomerId?: string;  // Stripe customer ID from invitation verification
  businessDescription?: string | null;
}

/**
 * POST /api/alerts/save-profile
 * Save or update a daily alert profile.
 */
export async function POST(request: NextRequest) {
  try {
    const body: AlertProfileRequest = await request.json();
    const {
      email,
      naicsCodes,
      naicsInput,
      pscCode,
      businessType,
      targetAgencies,
      locationState,
      locationStates,
      locationZip,
      alertFrequency,
      source,
      inviteToken,
      stripeCustomerId,
      businessDescription,
    } = body;

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      );
    }

    // Free tier sources don't require MA Premium access
    // paid_existing = subscriber activated via magic link invitation
    // free_signup / free-signup = MI Free signup from /alerts/signup
    const isFreeSource = source === 'opportunity-hunter-free' || source === 'free-signup' || source === 'free_signup' || source === 'paid_existing';

    // Collect all NAICS codes from various inputs
    const allNaicsCodes: string[] = [];

    // 1. Direct array of NAICS codes
    if (naicsCodes && naicsCodes.length > 0) {
      allNaicsCodes.push(...naicsCodes);
    }

    // 2. Comma-separated string input
    if (naicsInput) {
      const parsed = parseNAICSInput(naicsInput);
      allNaicsCodes.push(...parsed);
    }

    // 3. PSC code → expand to related NAICS codes
    if (pscCode) {
      const pscMatches = getNAICSForPSC(pscCode, 15); // Top 15 related NAICS
      const pscNaics = pscMatches.map(m => m.naicsCode);
      console.log(`[Alerts] PSC ${pscCode} expanded to ${pscNaics.length} NAICS codes`);
      allNaicsCodes.push(...pscNaics);
    }

    // Free tier can register without NAICS (they'll get general alerts)
    if (allNaicsCodes.length === 0 && !isFreeSource) {
      return NextResponse.json(
        { success: false, error: 'At least one NAICS code or PSC code is required' },
        { status: 400 }
      );
    }

    // Expand prefixes to full 6-digit codes (e.g., "236" → all 236xxx codes)
    const expandedNaics = allNaicsCodes.length > 0 ? expandNAICSCodes(allNaicsCodes) : [];
    if (allNaicsCodes.length > 0) {
      console.log(`[Alerts] Expanded ${allNaicsCodes.length} input codes to ${expandedNaics.length} NAICS codes`);
    }

    // For paid features (Pro), verify MA Premium access
    // Free tier from OH can register without paid access
    if (!isFreeSource) {
      const { data: profile } = await getSupabase()
        .from('user_profiles')
        .select('access_assassin_premium')
        .eq('email', email.toLowerCase())
        .single();

      if (!profile?.access_assassin_premium) {
        return NextResponse.json(
          { success: false, error: 'MA Premium access required for alerts' },
          { status: 403 }
        );
      }
    }

    // Build upsert payload
    const upsertPayload: Record<string, unknown> = {
      user_email: email.toLowerCase(),
      naics_codes: expandedNaics.length > 0 ? expandedNaics : [],
      business_type: businessType || null,
      agencies: targetAgencies || [],
      location_state: locationState || null,
      location_states: Array.isArray(locationStates) ? locationStates : [],
      location_zip: locationZip || null,
      is_active: true,
      alerts_enabled: true,
      alert_frequency: alertFrequency === 'weekly' ? 'weekly' : 'daily',
      updated_at: new Date().toISOString(),
    };

    const cleanBusinessDescription = typeof businessDescription === 'string'
      ? businessDescription.trim()
      : '';

    // Production does not have user_notification_settings.business_description yet.
    // Store the description in user_business_profiles below until the migration is applied.

    // free_signup = MI Free tier signup (alerts only, no AI briefings)
    if (source === 'free_signup') {
      upsertPayload.briefings_enabled = false;
      upsertPayload.treatment_type = 'alerts';
      console.log(`[Alerts] MI Free signup: ${email} - Daily Alerts only, no briefings`);
    }

    // paid_existing = subscriber activated via magic link invitation
    // They get FULL Daily Briefings access ($49/mo value), not just Daily Alerts
    if (source === 'paid_existing') {
      // Enable Daily Briefings (includes Daily Market Intel + Weekly Deep Dive + Pursuit Brief)
      upsertPayload.briefings_enabled = true;

      // Track invitation cohort for 90-day analysis
      if (inviteToken) {
        upsertPayload.invitation_sent_at = new Date().toISOString();
        upsertPayload.invitation_source = 'invitation_campaign';
      }
      if (stripeCustomerId) {
        upsertPayload.stripe_customer_id = stripeCustomerId;
      }

      // Grant KV access for briefings (gates actual tool access)
      try {
        await grantBriefingsAccess(email);
        console.log(`[Alerts] Granted briefings access to paid subscriber: ${email}`);
      } catch (kvError) {
        console.warn(`[Alerts] KV error granting briefings to ${email}:`, kvError);
        // Continue anyway - database flag will work as fallback
      }

      console.log(`[Alerts] Paid subscriber activated: ${email} (Stripe: ${stripeCustomerId || 'unknown'}) - Daily Briefings enabled`);
    }

    // Upsert notification settings (unified table)
    const { data, error } = await getSupabase()
      .from('user_notification_settings')
      .upsert(upsertPayload, {
        onConflict: 'user_email',
      })
      .select()
      .single();

    if (error) {
      console.error('[Alerts] Error saving profile:', error);
      const errorMessage = error.message || 'Failed to save alert profile';
      return NextResponse.json(
        { success: false, error: errorMessage },
        { status: 500 }
      );
    }

    console.log(`[Alerts] Saved alert profile for ${email}: ${expandedNaics.length} NAICS codes, ${targetAgencies?.length || 0} agencies`);

    if (businessDescription !== undefined) {
      try {
        await getSupabase()
          .from('user_business_profiles')
          .upsert({
            user_email: email.toLowerCase().trim(),
            business_description: cleanBusinessDescription || null,
            business_description_updated_at: cleanBusinessDescription ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_email' });
      } catch (businessProfileError) {
        console.warn('[Alerts] Could not mirror business description:', businessProfileError);
      }
    }

    // Send welcome email with opportunity preview (async, don't block response)
    sendWelcomeEmailWithOpportunities(
      email.toLowerCase().trim(),
      expandedNaics,
      targetAgencies || []
    ).catch(err => console.warn('[Alerts] Welcome email failed:', err));

    return NextResponse.json({
      success: true,
      message: 'Alert profile saved. You will receive daily opportunity alerts.',
      data: {
        email: data.user_email,
        naicsCodes: data.naics_codes,
        naicsCount: data.naics_codes?.length || 0,
        inputCodes: allNaicsCodes.length,
        expandedCodes: expandedNaics.length,
        businessDescription: data.business_description || null,
        businessDescriptionStored: cleanBusinessDescription || null,
        businessType: data.business_type,
        targetAgencies: data.agencies,
        frequency: data.alert_frequency,
      },
    });
  } catch (error) {
    console.error('[Alerts] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Send welcome email with initial opportunity report
 * Provides immediate value/gratification after signup
 */
async function sendWelcomeEmailWithOpportunities(
  email: string,
  naicsCodes: string[],
  agencies: string[]
): Promise<void> {
  console.log(`[Alerts] Sending welcome email to ${email} with ${naicsCodes.length} NAICS codes`);

  // Fetch opportunities matching their profile (top 8)
  const { opportunities } = await fetchSamOpportunitiesFromCache({
    naicsCodes: naicsCodes.slice(0, 10), // Use top 10 NAICS codes
    agencies: agencies.length > 0 ? agencies : undefined,
    limit: 8,
  });

  const oppCount = opportunities.length;
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });

  // Generate opportunity rows HTML
  const opportunityRows = opportunities.slice(0, 8).map(opp => {
    const deadline = opp.responseDeadline
      ? new Date(opp.responseDeadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : 'TBD';
    const daysLeft = opp.responseDeadline
      ? Math.ceil((new Date(opp.responseDeadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      : null;
    const urgency = daysLeft !== null && daysLeft <= 7
      ? `<span style="color:#dc2626;font-weight:bold;">🔥 ${daysLeft}d</span>`
      : daysLeft !== null && daysLeft <= 14
      ? `<span style="color:#d97706;">⚡ ${daysLeft}d</span>`
      : '';

    return `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:12px 8px;vertical-align:top;">
          <a href="${opp.uiLink}" style="color:#7c3aed;text-decoration:none;font-weight:600;">
            ${opp.title.slice(0, 80)}${opp.title.length > 80 ? '...' : ''}
          </a>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">
            ${opp.department || 'Federal Agency'} • ${opp.naicsCode || 'N/A'}
            ${opp.setAsideDescription ? ` • <span style="color:#059669;">${opp.setAsideDescription}</span>` : ''}
          </div>
        </td>
        <td style="padding:12px 8px;text-align:right;white-space:nowrap;">
          <div style="font-weight:500;">${deadline}</div>
          ${urgency ? `<div style="font-size:11px;">${urgency}</div>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#7c3aed 0%,#6d28d9 100%);padding:32px 24px;text-align:center;">
      <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">
        🎯 Welcome to Daily Alerts!
      </h1>
      <p style="margin:8px 0 0;color:#e9d5ff;font-size:14px;">
        Your federal contracting opportunities are ready
      </p>
    </div>

    <!-- Main Content -->
    <div style="padding:24px;">
      <p style="margin:0 0 16px;color:#374151;font-size:15px;">
        Great news! We found <strong style="color:#7c3aed;">${oppCount} active opportunities</strong>
        matching your profile. Here's your first preview:
      </p>

      ${oppCount > 0 ? `
      <!-- Opportunities Table -->
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:12px 8px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;">Opportunity</th>
            <th style="padding:12px 8px;text-align:right;font-size:12px;color:#6b7280;text-transform:uppercase;">Deadline</th>
          </tr>
        </thead>
        <tbody>
          ${opportunityRows}
        </tbody>
      </table>
      ` : `
      <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:16px;margin:16px 0;">
        <p style="margin:0;color:#92400e;font-size:14px;">
          We're still indexing opportunities for your NAICS codes. Your first daily alert will arrive tomorrow morning!
        </p>
      </div>
      `}

      <!-- What's Next -->
      <div style="background:#f0fdf4;border:1px solid #10b981;border-radius:8px;padding:16px;margin:24px 0;">
        <h3 style="margin:0 0 8px;color:#065f46;font-size:16px;">📬 What happens next?</h3>
        <ul style="margin:0;padding-left:20px;color:#047857;font-size:14px;">
          <li style="margin-bottom:6px;">You'll receive <strong>daily opportunity alerts</strong> at 7 AM ET</li>
          <li style="margin-bottom:6px;">Each email shows new opportunities matching your NAICS codes</li>
          <li>Deadlines, set-asides, and quick links to SAM.gov</li>
        </ul>
      </div>

      <!-- Upgrade CTA -->
      <div style="background:linear-gradient(135deg,#1e3a8a 0%,#7c3aed 100%);border-radius:12px;padding:24px;margin:24px 0;text-align:center;">
        <h3 style="margin:0 0 8px;color:#ffffff;font-size:18px;">🚀 Want More Intelligence?</h3>
        <p style="margin:0 0 16px;color:#e0e7ff;font-size:14px;">
          Upgrade to <strong>Market Intelligence Pro</strong> for AI briefings, win probability scoring, and weekly deep dives.
        </p>
        <a href="https://tools.govcongiants.org/market-intelligence"
           style="display:inline-block;background:#ffffff;color:#7c3aed;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">
          Learn More →
        </a>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#f9fafb;padding:24px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="margin:0 0 8px;color:#6b7280;font-size:12px;">
        You're receiving this because you signed up for Daily Alerts.
      </p>
      <p style="margin:0;color:#9ca3af;font-size:11px;">
        GovCon Giants AI • <a href="mailto:service@govcongiants.com" style="color:#7c3aed;">service@govcongiants.com</a>
      </p>
    </div>
  </div>
</body>
</html>
  `;

  const sent = await sendEmail({
    to: email,
    subject: `🎯 Welcome! ${oppCount} Opportunities Match Your Profile`,
    html: emailHtml,
    emailType: 'welcome_alerts',
    tags: {
      type: 'welcome_alerts',
      opportunity_count: oppCount,
    },
  });

  if (sent) {
    console.log(`[Alerts] Welcome email sent to ${email} with ${oppCount} opportunities`);
  } else {
    console.warn(`[Alerts] Welcome email failed for ${email}`);
  }
}

/**
 * GET /api/alerts/save-profile?email=xxx
 * Get current alert profile for a user
 */
export async function GET(request: NextRequest) {
  try {
    const email = request.nextUrl.searchParams.get('email');

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      );
    }

    const { data, error } = await getSupabase()
      .from('user_notification_settings')
      .select('*')
      .eq('user_email', email.toLowerCase())
      .single();

    if (error || !data) {
      return NextResponse.json({
        success: true,
        data: null,
        message: 'No alert profile found',
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        email: data.user_email,
        naicsCodes: data.naics_codes,
        businessType: data.business_type,
        targetAgencies: data.agencies,
        locationState: data.location_state,
        locationZip: data.location_zip,
        frequency: data.alert_frequency,
        isActive: data.is_active,
        lastAlertSent: data.last_alert_sent,
        totalAlertsSent: data.total_alerts_sent,
      },
    });
  } catch (error) {
    console.error('[Alerts] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
