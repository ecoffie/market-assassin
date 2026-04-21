/**
 * Feedback Dashboard API
 *
 * View user feedback on briefings with stats and patterns
 * GET /api/admin/feedback?password=xxx
 * POST /api/admin/feedback - Send outreach email to user
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/send-email';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

interface ProfileIssue {
  type: 'too_many_naics' | 'no_keywords' | 'no_agencies' | 'no_location' | 'generic_business_type';
  message: string;
  severity: 'high' | 'medium' | 'low';
}

interface UserProfile {
  email: string;
  naicsCount: number;
  keywordsCount: number;
  agenciesCount: number;
  hasLocation: boolean;
  businessType: string | null;
  issues: ProfileIssue[];
  needsAttention: boolean;
}

function analyzeProfile(profile: {
  naics_codes: string[] | null;
  keywords: string[] | null;
  agencies: string[] | null;
  location_state: string | null;
  location_states: string[] | null;
  business_type: string | null;
}): { issues: ProfileIssue[]; needsAttention: boolean } {
  const issues: ProfileIssue[] = [];

  const naicsCount = profile.naics_codes?.length || 0;
  const keywordsCount = profile.keywords?.length || 0;
  const agenciesCount = profile.agencies?.length || 0;
  const hasLocation = !!(profile.location_state || (profile.location_states && profile.location_states.length > 0));

  // Too many NAICS codes (over 10 is probably too broad)
  if (naicsCount > 20) {
    issues.push({
      type: 'too_many_naics',
      message: `${naicsCount} NAICS codes - profile too broad`,
      severity: 'high',
    });
  } else if (naicsCount > 10) {
    issues.push({
      type: 'too_many_naics',
      message: `${naicsCount} NAICS codes - consider narrowing`,
      severity: 'medium',
    });
  }

  // No keywords
  if (keywordsCount === 0) {
    issues.push({
      type: 'no_keywords',
      message: 'No keywords set',
      severity: 'medium',
    });
  }

  // No agencies
  if (agenciesCount === 0) {
    issues.push({
      type: 'no_agencies',
      message: 'No agencies selected',
      severity: 'low',
    });
  }

  // No location
  if (!hasLocation) {
    issues.push({
      type: 'no_location',
      message: 'No location/state set',
      severity: 'low',
    });
  }

  // Generic business type
  if (!profile.business_type || profile.business_type === 'small-business') {
    issues.push({
      type: 'generic_business_type',
      message: 'Generic business type - missing set-aside eligibility',
      severity: 'low',
    });
  }

  const needsAttention = issues.some(i => i.severity === 'high') || issues.length >= 3;

  return { issues, needsAttention };
}

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Get all feedback
  const { data: feedback, error } = await supabase
    .from('briefing_feedback')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Calculate stats - exclude outreach_sent from satisfaction metrics
  // outreach_sent is an admin action, not user feedback
  const userFeedback = feedback?.filter(f => f.rating !== 'outreach_sent') || [];
  const totalFeedback = userFeedback.length;
  const helpful = userFeedback.filter(f => f.rating === 'helpful').length;
  const notHelpful = userFeedback.filter(f => f.rating === 'not_helpful').length;
  const helpfulRate = totalFeedback > 0 ? Math.round((helpful / totalFeedback) * 100) : 0;

  // Get feedback by type - only count actual user ratings (helpful/not_helpful)
  const byType = {
    daily: { helpful: 0, notHelpful: 0 },
    weekly: { helpful: 0, notHelpful: 0 },
    pursuit: { helpful: 0, notHelpful: 0 },
  };

  for (const f of userFeedback) {
    const type = f.briefing_type as keyof typeof byType;
    if (byType[type]) {
      if (f.rating === 'helpful') {
        byType[type].helpful++;
      } else if (f.rating === 'not_helpful') {
        byType[type].notHelpful++;
      }
      // Skip any other ratings (shouldn't happen but defensive)
    }
  }

  // Find repeat negative feedback (users who marked not helpful 2+ times)
  const negativeByUser: Record<string, number> = {};
  for (const f of userFeedback) {
    if (f.rating === 'not_helpful') {
      negativeByUser[f.user_email] = (negativeByUser[f.user_email] || 0) + 1;
    }
  }

  const repeatNegativeEmails = Object.entries(negativeByUser)
    .filter(([, count]) => count >= 2)
    .map(([email]) => email);

  // Fetch profiles for repeat negative users
  const usersNeedingAttention: UserProfile[] = [];

  if (repeatNegativeEmails.length > 0) {
    const { data: profiles } = await supabase
      .from('user_notification_settings')
      .select('user_email, naics_codes, keywords, agencies, location_state, location_states, business_type')
      .in('user_email', repeatNegativeEmails);

    for (const profile of profiles || []) {
      const { issues, needsAttention } = analyzeProfile(profile);
      usersNeedingAttention.push({
        email: profile.user_email,
        naicsCount: profile.naics_codes?.length || 0,
        keywordsCount: profile.keywords?.length || 0,
        agenciesCount: profile.agencies?.length || 0,
        hasLocation: !!(profile.location_state || (profile.location_states && profile.location_states.length > 0)),
        businessType: profile.business_type,
        issues,
        needsAttention,
      });
    }
  }

  // Sort by negative count
  const repeatNegative = Object.entries(negativeByUser)
    .filter(([, count]) => count >= 2)
    .map(([email, count]) => {
      const userProfile = usersNeedingAttention.find(u => u.email === email);
      return {
        email,
        count,
        profile: userProfile || null,
      };
    })
    .sort((a, b) => b.count - a.count);

  // Get last 7 days stats - exclude outreach_sent
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const last7Days = userFeedback.filter(f => f.created_at >= sevenDaysAgo);
  const last7DaysHelpful = last7Days.filter(f => f.rating === 'helpful').length;
  const last7DaysNotHelpful = last7Days.filter(f => f.rating === 'not_helpful').length;

  return NextResponse.json({
    feedback: feedback?.slice(0, 100) || [],
    stats: {
      total: totalFeedback,
      helpful,
      notHelpful,
      helpfulRate,
      last7Days: {
        total: last7Days.length,
        helpful: last7DaysHelpful,
        notHelpful: last7DaysNotHelpful,
      },
      byType,
      repeatNegative,
      usersNeedingAttention: usersNeedingAttention.filter(u => u.needsAttention).length,
    },
  });
}

// POST - Send outreach email to user asking them to refine profile
export async function POST(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { email, action } = body;

  if (action !== 'send_outreach') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  if (!email) {
    return NextResponse.json({ error: 'Email required' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Get user profile
  const { data: profile } = await supabase
    .from('user_notification_settings')
    .select('*')
    .eq('user_email', email)
    .single();

  if (!profile) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const naicsCount = profile.naics_codes?.length || 0;

  // Send personalized outreach email
  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f5;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); padding: 30px; text-align: center;">
                  <h1 style="color: white; margin: 0; font-size: 24px;">Let's Make Your Briefings Better</h1>
                </td>
              </tr>

              <!-- Content -->
              <tr>
                <td style="padding: 30px;">
                  <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
                    Hi there,
                  </p>

                  <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
                    We noticed you've marked some recent briefings as "not helpful" - and we want to fix that. Your feedback matters to us.
                  </p>

                  ${naicsCount > 10 ? `
                  <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px;">
                    <p style="color: #92400e; margin: 0; font-size: 14px;">
                      <strong>Quick tip:</strong> Your profile has ${naicsCount} NAICS codes selected. This might be making your briefings too broad. Consider narrowing to your top 3-5 codes for more focused intel.
                    </p>
                  </div>
                  ` : ''}

                  <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
                    <strong>Take 2 minutes to refine your profile:</strong>
                  </p>

                  <ul style="color: #374151; font-size: 16px; line-height: 1.8; margin: 0 0 25px; padding-left: 20px;">
                    <li>Focus on your top 3-5 NAICS codes</li>
                    <li>Add specific keywords (e.g., "cybersecurity", "cloud migration")</li>
                    <li>Select agencies you want to target</li>
                    <li>Set your state/region preference</li>
                  </ul>

                  <div style="text-align: center; margin: 30px 0;">
                    <a href="https://tools.govcongiants.org/briefings" style="display: inline-block; background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                      Update My Preferences
                    </a>
                  </div>

                  <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 20px 0 0;">
                    Questions? Just reply to this email - we read everything.
                  </p>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="background-color: #f9fafb; padding: 20px 30px; text-align: center; border-top: 1px solid #e5e7eb;">
                  <p style="color: #6b7280; font-size: 12px; margin: 0;">
                    GovCon Giants AI • Making government contracting easier
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  try {
    await sendEmail({
      to: email,
      subject: "Let's improve your GovCon briefings",
      html: emailHtml,
    });

    // Log the outreach
    await supabase.from('briefing_feedback').insert({
      user_email: email,
      briefing_date: new Date().toISOString().split('T')[0],
      briefing_type: 'daily',
      rating: 'outreach_sent',
      comment: 'Admin sent profile refinement outreach email',
    });

    return NextResponse.json({ success: true, message: `Outreach email sent to ${email}` });
  } catch (err) {
    return NextResponse.json({ error: `Failed to send email: ${err}` }, { status: 500 });
  }
}
