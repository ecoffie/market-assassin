/**
 * Send Briefings (Fast) - Uses Pre-computed Templates
 *
 * ENTERPRISE ARCHITECTURE: Instead of generating briefings per-user,
 * this cron matches users to pre-computed templates and sends emails.
 *
 * Processing time per user: ~100ms (vs 52 seconds with generation)
 * Capacity: 500+ users per cron run (vs ~1 user)
 *
 * Schedule: 7 AM UTC daily (after precompute-briefings completes)
 *
 * Process:
 * 1. Get all users with briefings_enabled=true
 * 2. Match each user to their pre-computed template (by NAICS hash)
 * 3. Personalize and send email
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateAIEmailTemplate } from '@/lib/briefings/delivery/ai-email-template';
import { generateBidTargetEmail, BidTargetOpportunity, BidTargetEmailData } from '@/lib/briefings/delivery/bid-target-email-template';
import { AIGeneratedBriefing } from '@/lib/briefings/delivery/ai-briefing-generator';
import {
  recordBriefingProgramDelivery,
  resolveBriefingAudience,
} from '@/lib/briefings/delivery/rollout';
import { sendEmail } from '@/lib/send-email';
import { hasBriefingAccess } from '@/lib/access-codes';
import { calculateBidScore, generateWinReasons, generateActionSteps } from '@/lib/briefings/win-probability';
import crypto from 'crypto';

// Process up to 100 users per cron run (~100ms each = 10 seconds total)
const BATCH_SIZE = 100;

/**
 * Queue a failed briefing for automatic retry (dead letter queue)
 */
async function queueForRetry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userEmail: string,
  naicsCodes: string[],
  failureReason: string,
  briefingDate: string
): Promise<void> {
  try {
    await supabase.rpc('queue_briefing_retry', {
      p_user_email: userEmail,
      p_briefing_type: 'daily',
      p_briefing_date: briefingDate,
      p_naics_codes: JSON.stringify(naicsCodes),
      p_failure_reason: failureReason,
    });
  } catch (err) {
    // Don't fail the main process if retry queue fails
    console.error(`[SendBriefingsFast] Failed to queue retry for ${userEmail}:`, err);
  }
}

function hashNaicsProfile(naicsCodes: string[]): string {
  const sorted = [...naicsCodes].sort();
  return crypto.createHash('md5').update(JSON.stringify(sorted)).digest('hex');
}

/**
 * Extract NAICS prefixes for fallback matching.
 * Supports 3-digit industry prefixes (e.g., "236" from "236220")
 */
function extractNaicsPrefixes(naicsCodes: string[]): string[] {
  const prefixes = new Set<string>();
  for (const code of naicsCodes) {
    const clean = code.replace(/\D/g, '');
    if (clean.length >= 3) {
      prefixes.add(clean.slice(0, 3));
    }
  }
  return Array.from(prefixes);
}

/**
 * Build a prefix-to-template map for fallback matching.
 * Maps 3-digit NAICS prefixes to their best-matching template.
 */
function buildPrefixMap(templates: Array<{ naics_profile: string; naics_profile_hash: string; [key: string]: unknown }>) {
  const prefixMap = new Map<string, typeof templates[0]>();

  for (const template of templates) {
    try {
      const naicsCodes = JSON.parse(template.naics_profile) as string[];
      const prefixes = extractNaicsPrefixes(naicsCodes);

      for (const prefix of prefixes) {
        // Only set if not already present (prioritize first/larger templates)
        if (!prefixMap.has(prefix)) {
          prefixMap.set(prefix, template);
        }
      }
    } catch {
      // Skip malformed profiles
    }
  }

  return prefixMap;
}

export async function GET(request: NextRequest) {
  const testEmail = request.nextUrl.searchParams.get('email');
  const isTest = request.nextUrl.searchParams.get('test') === 'true';

  // Verify cron secret
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasCronSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isVercelCron && !hasCronSecret && !(testEmail && isTest)) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({
        message: 'Send Briefings (Fast) - Uses Pre-computed Templates',
        description: 'Matches users to templates, sends in ~100ms per user',
        schedule: '7 AM UTC daily',
        capacity: '500+ users per run (vs ~1 with generation)',
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: any = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _supabase;
}

  const startTime = Date.now();
  const today = new Date().toISOString().split('T')[0];
  let briefingsSent = 0;
  let briefingsSkipped = 0;
  let briefingsFailed = 0;
  let noTemplateCount = 0;
  const errors: string[] = [];

  console.log('[SendBriefingsFast] Starting fast template-based delivery...');

  try {
    // Step 1: Get all pre-computed templates for today
    const { data: templates, error: templatesError } = await getSupabase()
      .from('briefing_templates')
      .select('*')
      .eq('template_date', today)
      .eq('briefing_type', 'daily');

    if (templatesError) {
      throw new Error(`Failed to fetch templates: ${templatesError.message}`);
    }

    if (!templates || templates.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No templates found for today. Run precompute-briefings first.',
        elapsed: Date.now() - startTime,
      });
    }

    // Build template lookup maps (exact hash + prefix fallback)
    type BriefingTemplate = { naics_profile_hash: string; naics_profile: string; [key: string]: unknown };
    const templateMap = new Map<string, BriefingTemplate>();
    templates.forEach((t: BriefingTemplate) => templateMap.set(t.naics_profile_hash, t));

    // Build prefix fallback map for custom profiles
    const prefixMap = buildPrefixMap(templates);

    console.log(`[SendBriefingsFast] Loaded ${templates.length} templates, ${prefixMap.size} prefix mappings`);

    // Step 2: Get users to process
    const audienceResolution = await resolveBriefingAudience(getSupabase());
    let usersToProcess = audienceResolution.users;

    // Filter to test email if specified
    if (testEmail) {
      usersToProcess = usersToProcess.filter(u => u.email === testEmail.toLowerCase());
      if (usersToProcess.length === 0) {
        return NextResponse.json({
          success: false,
          error: `No user found with email: ${testEmail}`,
        });
      }
    }

    // Check for already sent today
    const { data: sentToday } = await getSupabase()
      .from('briefing_log')
      .select('user_email')
      .eq('briefing_date', today)
      .eq('delivery_status', 'sent');

    const sentEmails = new Set((sentToday || []).map((s: { user_email: string }) => s.user_email));

    // Filter out already sent and limit batch
    usersToProcess = usersToProcess
      .filter(u => !sentEmails.has(u.email))
      .slice(0, BATCH_SIZE);

    console.log(`[SendBriefingsFast] Processing ${usersToProcess.length} users (${sentEmails.size} already sent today)`);

    // Step 3: Match users to templates and send
    let prefixMatchCount = 0;

    for (const user of usersToProcess) {
      try {
        const userNaics = user.naics_codes || [];
        const naicsHash = hashNaicsProfile(userNaics);
        let template = templateMap.get(naicsHash);
        let matchType = 'exact';

        // Prefix fallback: if no exact match, try matching on primary NAICS prefix
        if (!template && userNaics.length > 0) {
          const userPrefixes = extractNaicsPrefixes(userNaics);
          for (const prefix of userPrefixes) {
            const prefixTemplate = prefixMap.get(prefix);
            if (prefixTemplate) {
              template = prefixTemplate;
              matchType = 'prefix';
              prefixMatchCount++;
              console.log(`[SendBriefingsFast] Prefix match for ${user.email}: ${prefix} → template ${prefixTemplate.naics_profile_hash.slice(0, 8)}`);
              break;
            }
          }
        }

        if (!template) {
          noTemplateCount++;
          console.log(`[SendBriefingsFast] No template for ${user.email} (hash: ${naicsHash.slice(0, 8)}, prefixes: ${extractNaicsPrefixes(userNaics).join(',')})`);
          // Queue for retry - watchdog will regenerate or find fallback
          await queueForRetry(getSupabase(), user.email, userNaics, 'No matching template (exact or prefix)', today);
          continue;
        }

        const briefing = template.briefing_content as AIGeneratedBriefing;

        if (!briefing || !briefing.opportunities || briefing.opportunities.length === 0) {
          briefingsSkipped++;
          continue;
        }

        // Log briefing attempt (record match type for analytics)
        await getSupabase().from('briefing_log').upsert({
          user_email: user.email,
          briefing_date: today,
          briefing_content: briefing,
          items_count: briefing.opportunities.length + briefing.teamingPlays.length,
          tools_included: [matchType === 'exact' ? 'pre_computed_template' : 'prefix_fallback_template'],
          delivery_status: 'pending',
          retry_count: 0,
          created_at: new Date().toISOString(),
        }, { onConflict: 'user_email,briefing_date' });

        // Check if user has paid briefings access (Bid Target tier)
        const hasPaidAccess = await hasBriefingAccess(user.email);

        let emailSubject: string;
        let emailHtml: string;
        let emailText: string;
        let emailType: 'bid_target' | 'daily_alerts';

        if (hasPaidAccess && briefing.opportunities.length > 0) {
          // PAID USER: Send Bid Target email (THE ONE + win scoring)
          emailType = 'bid_target';

          // Get user profile for scoring
          const { data: userProfile } = await getSupabase()
            .from('user_notification_settings')
            .select('*')
            .eq('user_email', user.email)
            .single();

          // Build a complete BriefingUserProfile for scoring
          const profile = userProfile ? {
            email: user.email,
            naicsCodes: userProfile.naics_codes || [],
            topNaics: [],
            certifications: userProfile.certifications || [],
            targetAgencies: userProfile.target_agencies || [],
            topAgencies: [],
            watchedCompanies: [],
            topCompanies: [],
            keywords: userProfile.keywords || [],
            capabilityKeywords: [],
            state: userProfile.state || null,
            zipCode: userProfile.zip_code || null,
            geographicPreference: 'national' as const,
            setAsidePreferences: [],
            companySize: userProfile.company_size || 'small',
            maxContractSize: userProfile.max_contract_size || null,
            minContractValue: 0,
            mutedAgencies: [],
            mutedNaics: [],
            engagementScore: 50,
          } : null;

          // Convert AIBriefingOpportunity to BidTargetOpportunity format
          // Note: AIBriefingOpportunity has: rank, contractName, agency, incumbent, value, window, displacementAngle
          const scoredOpps = briefing.opportunities.map((opp, index) => {
            // Parse value to extract amount (e.g., "$2.5M" -> 2500000)
            const valueStr = opp.value || '0';
            const valueMatch = valueStr.match(/\$?([\d.]+)\s*(M|K|B)?/i);
            let amount = 0;
            if (valueMatch) {
              amount = parseFloat(valueMatch[1]);
              const multiplier = valueMatch[2]?.toUpperCase();
              if (multiplier === 'K') amount *= 1000;
              else if (multiplier === 'M') amount *= 1_000_000;
              else if (multiplier === 'B') amount *= 1_000_000_000;
            }

            // Parse window for deadline hints (e.g., "RFP expected Q2 2026")
            const windowText = opp.window || '';
            let daysLeft = 30; // Default
            if (windowText.toLowerCase().includes('urgent') || windowText.toLowerCase().includes('immediate')) {
              daysLeft = 7;
            } else if (windowText.toLowerCase().includes('week')) {
              daysLeft = 14;
            } else if (windowText.toLowerCase().includes('month')) {
              daysLeft = 30;
            } else if (windowText.toLowerCase().includes('q1') || windowText.toLowerCase().includes('q2')) {
              daysLeft = 60;
            }

            // Use NAICS from user profile if available (opportunity doesn't have it)
            const userNaics = profile?.naicsCodes?.[0] || '';

            const bidOppData = {
              naicsCode: userNaics,
              setAside: '', // Not available in AI briefing format
              amount,
              responseDeadline: new Date(Date.now() + daysLeft * 24 * 60 * 60 * 1000),
              title: opp.contractName,
            };

            const bidScore = calculateBidScore(bidOppData, profile);

            // Use displacementAngle as primary win reason, add generic ones
            const winReasons = [
              opp.displacementAngle, // Strategic insight from AI
              ...(bidScore.factors.filter(f => f.isPositive && f.points >= f.maxPoints * 0.5).map(f => f.description)),
            ].filter(Boolean).slice(0, 5);

            const actionSteps = generateActionSteps({
              ...bidOppData,
              agency: opp.agency,
              samLink: `https://sam.gov/search/?q=${encodeURIComponent(opp.contractName)}`,
            }, profile);

            // Calculate close date
            const closeDate = new Date(Date.now() + daysLeft * 24 * 60 * 60 * 1000);

            return {
              title: opp.contractName,
              agency: opp.agency || '',
              value: opp.value || 'TBD',
              daysLeft,
              closeDate: closeDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
              naicsCode: userNaics,
              setAside: 'TBD',
              noticeType: windowText.includes('RFI') ? 'Sources Sought' : windowText.includes('RFP') ? 'Solicitation' : 'Pre-Solicitation',
              samLink: `https://sam.gov/search/?q=${encodeURIComponent(opp.contractName)}`,
              bidScore: Math.max(50, 100 - (opp.rank * 5)), // Score based on AI ranking (rank 1 = 95, rank 2 = 90, etc.)
              winReasons,
              actionSteps,
            } as BidTargetOpportunity;
          }).sort((a, b) => b.bidScore - a.bidScore);

          // THE ONE is the highest scored opportunity
          const bidTarget = scoredOpps[0];
          const alsoOnRadar = scoredOpps.slice(1, 4); // Next 3 as "also on radar"

          // Extract a name from email if possible (e.g., "john.doe@email.com" -> "John")
          const emailPrefix = user.email.split('@')[0].split(/[._]/)[0];
          const derivedName = emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1);

          const bidTargetData: BidTargetEmailData = {
            userName: derivedName || '',
            userEmail: user.email,
            briefingDate: today,
            bidTarget,
            alsoOnRadar,
          };

          const bidTargetEmail = generateBidTargetEmail(bidTargetData);
          emailSubject = bidTargetEmail.subject;
          emailHtml = bidTargetEmail.htmlBody;
          emailText = bidTargetEmail.textBody;

        } else {
          // FREE USER: Send Daily Alerts email (existing template)
          emailType = 'daily_alerts';
          const emailTemplate = generateAIEmailTemplate(briefing);
          emailSubject = emailTemplate.subject;
          emailHtml = emailTemplate.htmlBody;
          emailText = emailTemplate.textBody;
        }

        // Send email
        await sendEmail({
          to: user.email,
          subject: emailSubject,
          html: emailHtml,
          text: emailText,
        });

        briefingsSent++;

        // Update log with email type
        await getSupabase().from('briefing_log').update({
          delivery_status: 'sent',
          email_sent_at: new Date().toISOString(),
          tools_included: [matchType === 'exact' ? 'pre_computed_template' : 'prefix_fallback_template', emailType],
        }).eq('user_email', user.email).eq('briefing_date', today);

        // Record delivery
        if (!isTest) {
          await recordBriefingProgramDelivery(null, user.email, 'daily_brief');
        }

        console.log(`[SendBriefingsFast] ✅ Sent to ${user.email} (${briefing.opportunities.length} opps)`);

      } catch (err) {
        briefingsFailed++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        errors.push(`${user.email}: ${errorMsg}`);
        console.error(`[SendBriefingsFast] ❌ Failed for ${user.email}:`, err);

        // Update log with failure
        await getSupabase().from('briefing_log').update({
          delivery_status: 'failed',
          error_message: errorMsg,
        }).eq('user_email', user.email).eq('briefing_date', today);

        // Queue for automatic retry
        const userNaics = user.naics_codes || [];
        await queueForRetry(getSupabase(), user.email, userNaics, errorMsg, today);
      }
    }

    const elapsed = Date.now() - startTime;
    const avgTimePerUser = usersToProcess.length > 0 ? Math.round(elapsed / usersToProcess.length) : 0;

    console.log(`[SendBriefingsFast] Complete: ${briefingsSent} sent (${prefixMatchCount} prefix), ${briefingsSkipped} skipped, ${briefingsFailed} failed, ${noTemplateCount} no template`);

    return NextResponse.json({
      success: true,
      briefingsSent,
      briefingsSkipped,
      briefingsFailed,
      noTemplateCount,
      prefixMatchCount,
      templatesAvailable: templates.length,
      prefixMappings: prefixMap.size,
      totalUsersProcessed: usersToProcess.length,
      avgTimePerUserMs: avgTimePerUser,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      elapsed,
    });

  } catch (error) {
    console.error('[SendBriefingsFast] Fatal error:', error);
    return NextResponse.json({
      success: false,
      error: String(error),
      briefingsSent,
      briefingsFailed,
      elapsed: Date.now() - startTime,
    }, { status: 500 });
  }
}
