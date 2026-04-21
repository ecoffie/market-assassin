/**
 * Pre-compute Pursuit Briefs
 *
 * ENTERPRISE ARCHITECTURE: Instead of generating pursuit briefs per-user,
 * we pre-compute briefs for TOP opportunities per NAICS profile.
 *
 * Schedule: Sunday 8 PM UTC (before Monday 7 AM send)
 *
 * Process:
 * 1. Find all unique NAICS profiles
 * 2. For each profile, find TOP opportunities from recent alerts
 * 3. Generate pursuit brief for each top opportunity
 * 4. Store in briefing_templates table
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchSamOpportunityNoticeSummaryFromCache, SAMNoticeSummary } from '@/lib/briefings/pipelines/sam-gov';
import { generatePursuitBriefFromProfileInput } from '@/lib/briefings/delivery/pursuit-brief-generator';
import crypto from 'crypto';

const PROFILES_PER_RUN = 25; // Increased from 10 to ensure 125 profiles covered across 5 cron windows
const DELAY_BETWEEN_PROFILES_MS = 1000;

interface NaicsProfile {
  naics_profile: string;
  naics_profile_hash: string;
  user_count: number;
  naics_codes: string[];
  aggregated_agencies: string[];
  aggregated_keywords: string[];
  primary_industry: string | null;
}

interface PursuitBrief {
  contractName: string;
  agency: string;
  value: string;
  opportunityScore: number;
  whyWorthPursuing: string;
  workingHypothesis: string;
  priorityIntel: string[];
  outreachTargets: { priority: number; name: string; role: string; company?: string; approach: string }[];
  actionPlan: { day: number; action: string; owner: string }[];
  risks: { risk: string; likelihood: string; impact: string; mitigation: string }[];
  immediateNextMove: { action: string; owner: string; deadline: string };
  relatedMarketSignals: { headline: string; source: string; implication: string; actionRequired: boolean }[];
  processingTimeMs: number;
  sourceNoticeId?: string;
}

function extractOpportunityKeywords(title: string | undefined): string[] {
  if (!title) return [];
  const stopWords = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'support', 'services', 'contract', 'opportunity']);
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= 5 && !stopWords.has(word))
    .slice(0, 4);
}

function buildPursuitMarketSignals(
  summary: SAMNoticeSummary,
  opportunity: { agency?: string; title?: string; naics?: string }
): Array<{ headline: string; source: string; implication: string; actionRequired: boolean }> {
  if (summary.totalMatched === 0) return [];

  const targetLabel = opportunity.agency || opportunity.naics || 'this lane';
  const signals: Array<{ headline: string; source: string; implication: string; actionRequired: boolean }> = [
    {
      headline: `${summary.totalMatched} matched active SAM notices around ${targetLabel}`,
      source: 'SAM.gov Cache',
      implication: 'This pursuit sits inside a broader active market. Calibrate your bid/no-bid against nearby demand and timing.',
      actionRequired: false,
    },
  ];

  if (summary.sourcesSought > 0) {
    signals.push({
      headline: `${summary.sourcesSought} related Sources Sought / RFI notices remain open`,
      source: 'SAM.gov Cache',
      implication: 'There may still be a requirements-shaping window nearby. Capture should check for response or briefing opportunities immediately.',
      actionRequired: true,
    });
  }

  if (summary.preSol > 0) {
    signals.push({
      headline: `${summary.preSol} presolicitation notices suggest follow-on activity`,
      source: 'SAM.gov Cache',
      implication: 'Use presol activity to map likely follow-ons, teaming posture, and agency buying sequence before final solicitation.',
      actionRequired: true,
    });
  }

  if (summary.rfp + summary.rfq + summary.combined > 0) {
    signals.push({
      headline: `${summary.rfp + summary.rfq + summary.combined} adjacent solicitation-stage notices are already active`,
      source: 'SAM.gov Cache',
      implication: 'Competitors may already be mobilized in this market. Positioning speed and outreach urgency matter more now.',
      actionRequired: summary.rfp + summary.rfq + summary.combined >= 3,
    });
  }

  return signals.slice(0, 4);
}

function hashNaicsProfile(naicsCodes: string[]): string {
  const sorted = [...naicsCodes].sort();
  return crypto.createHash('md5').update(JSON.stringify(sorted)).digest('hex');
}

function getMondayDate(): string {
  const monday = new Date();
  const day = monday.getDay();
  const diff = day === 0 ? 1 : (8 - day);
  monday.setDate(monday.getDate() + diff);
  return monday.toISOString().split('T')[0];
}

export async function GET(request: NextRequest) {
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  const authHeader = request.headers.get('authorization');
  const hasCronSecret = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isTest = request.nextUrl.searchParams.get('test') === 'true';

  if (!isVercelCron && !hasCronSecret && !isTest) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({
        message: 'Pre-compute Pursuit Briefs',
        description: 'Generates pursuit templates by NAICS profile (enterprise architecture)',
        schedule: 'Sunday 8 PM UTC',
        benefit: '95% reduction in LLM calls (928 users → 49 templates)',
      });
    }
  }

  // DAY-OF-WEEK GUARD: Pursuit precompute only runs on Sunday (UTC)
  const today = new Date();
  const dayOfWeek = today.getUTCDay(); // 0 = Sunday

  if (dayOfWeek !== 0 && !isTest) {
    console.log(`[PrecomputePursuit] Skipped - not Sunday (day ${dayOfWeek})`);
    return NextResponse.json({
      success: true,
      message: `Pursuit precompute only runs on Sunday. Today is day ${dayOfWeek}.`,
      skipped: true,
      dayOfWeek,
    });
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
  const mondayDate = getMondayDate();
  let templatesGenerated = 0;
  let templatesFailed = 0;
  const errors: string[] = [];

  console.log('[PrecomputePursuit] Starting pursuit brief template generation...');

  try {
    // Step 1: Get all unique NAICS profiles
    const { data: users, error: usersError } = await getSupabase()
      .from('user_notification_settings')
      .select('user_email, naics_codes, agencies, keywords, primary_industry')
      .eq('briefings_enabled', true);

    if (usersError) {
      throw new Error(`Failed to fetch users: ${usersError.message}`);
    }

    // Group users by NAICS profile
    const profileMap = new Map<string, NaicsProfile>();
    for (const user of users || []) {
      const naicsCodes = user.naics_codes || [];
      if (naicsCodes.length === 0) continue;

      const hash = hashNaicsProfile(naicsCodes);
      const key = JSON.stringify([...naicsCodes].sort());

      if (profileMap.has(hash)) {
        const existing = profileMap.get(hash)!;
        existing.user_count++;
        for (const agency of user.agencies || []) {
          if (!existing.aggregated_agencies.includes(agency)) {
            existing.aggregated_agencies.push(agency);
          }
        }
        for (const keyword of user.keywords || []) {
          if (!existing.aggregated_keywords.includes(keyword)) {
            existing.aggregated_keywords.push(keyword);
          }
        }
        if (!existing.primary_industry && user.primary_industry) {
          existing.primary_industry = user.primary_industry;
        }
      } else {
        profileMap.set(hash, {
          naics_profile: key,
          naics_profile_hash: hash,
          user_count: 1,
          naics_codes: naicsCodes,
          aggregated_agencies: [...(user.agencies || [])],
          aggregated_keywords: [...(user.keywords || [])],
          primary_industry: user.primary_industry || null,
        });
      }
    }

    const allProfiles = Array.from(profileMap.values());
    console.log(`[PrecomputePursuit] Found ${allProfiles.length} unique NAICS profiles`);

    // Step 2: Check which profiles already have pursuit templates
    const { data: existingTemplates } = await getSupabase()
      .from('briefing_templates')
      .select('naics_profile_hash')
      .eq('template_date', mondayDate)
      .eq('briefing_type', 'pursuit');

    const existingHashes = new Set((existingTemplates || []).map((t: { naics_profile_hash: string }) => t.naics_profile_hash));

    const profilesToProcess = allProfiles
      .filter(p => !existingHashes.has(p.naics_profile_hash))
      .sort((a, b) => b.user_count - a.user_count)
      .slice(0, PROFILES_PER_RUN);

    console.log(`[PrecomputePursuit] Processing ${profilesToProcess.length} profiles (${existingHashes.size} already done)`);

    if (profilesToProcess.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All pursuit templates already generated',
        totalProfiles: allProfiles.length,
        templatesExisting: existingHashes.size,
        elapsed: Date.now() - startTime,
      });
    }

    // Step 3: For each profile, find top opportunity and generate pursuit brief
    for (const profile of profilesToProcess) {
      const profileStartTime = Date.now();

      try {
        console.log(`[PrecomputePursuit] Generating template for ${profile.user_count} users...`);

        // Get recent alerts for users in this NAICS profile
        type UserRow = {
          naics_codes: string[];
          user_email: string;
          agencies?: string[] | null;
          keywords?: string[] | null;
          primary_industry?: string | null;
        };
        const usersWithProfile = (users || []).filter((u: UserRow) => {
          const hash = hashNaicsProfile(u.naics_codes || []);
          return hash === profile.naics_profile_hash;
        });

        const aggregatedAgencies = [...profile.aggregated_agencies];
        const aggregatedKeywords = [...profile.aggregated_keywords];
        let primaryIndustry = profile.primary_industry;

        for (const userWithProfile of usersWithProfile) {
          for (const agency of userWithProfile.agencies || []) {
            if (!aggregatedAgencies.includes(agency)) {
              aggregatedAgencies.push(agency);
            }
          }
          for (const keyword of userWithProfile.keywords || []) {
            if (!aggregatedKeywords.includes(keyword)) {
              aggregatedKeywords.push(keyword);
            }
          }
          if (!primaryIndustry && userWithProfile.primary_industry) {
            primaryIndustry = userWithProfile.primary_industry;
          }
        }

        const userEmails = usersWithProfile.map((u: UserRow) => u.user_email).slice(0, 50);

        // Get recent opportunities from alerts
        const { data: recentAlerts } = await getSupabase()
          .from('alert_log')
          .select('opportunities_data')
          .in('user_email', userEmails)
          .eq('delivery_status', 'sent')
          .order('alert_date', { ascending: false })
          .limit(10);

        // Collect all opportunities and find the top one
        const allOpportunities: Array<{
          noticeId: string;
          title: string;
          agency?: string;
          naics?: string;
          deadline?: string;
          score?: number;
        }> = [];

        for (const alert of recentAlerts || []) {
          const opps = alert.opportunities_data as Array<{
            noticeId: string;
            title: string;
            agency?: string;
            naics?: string;
            deadline?: string;
            score?: number;
          }>;
          if (opps) {
            allOpportunities.push(...opps);
          }
        }

        // If no opportunities from alerts, create from NAICS data
        let topOpp = allOpportunities.sort((a, b) => (b.score || 0) - (a.score || 0))[0];

        if (!topOpp) {
          // Create synthetic opportunity from NAICS codes
          topOpp = {
            noticeId: `synth-${profile.naics_profile_hash.slice(0, 8)}`,
            title: `Federal Contract Opportunity - NAICS ${profile.naics_codes[0]}`,
            agency: 'Department of Defense',
            naics: profile.naics_codes[0],
            deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            score: 70,
          };
        }

        const marketKeywords = extractOpportunityKeywords(topOpp.title);
        const noticeSummary = await fetchSamOpportunityNoticeSummaryFromCache({
          naicsCodes: profile.naics_codes,
          keywords: marketKeywords.length > 0 ? marketKeywords : undefined,
        });

        // Generate pursuit brief with AI
        const brief = await generatePursuitBriefFromProfileInput(
          profile.naics_profile_hash,
          {
            naics_codes: profile.naics_codes,
            agencies: aggregatedAgencies.slice(0, 10),
            keywords: aggregatedKeywords.slice(0, 10),
            watched_companies: [],
            primary_industry: primaryIndustry,
          },
          {
            contractNumber: typeof topOpp.noticeId === 'string' ? topOpp.noticeId : undefined,
            contractName: typeof topOpp.title === 'string' ? topOpp.title : undefined,
            agency: typeof topOpp.agency === 'string' ? topOpp.agency : undefined,
            naicsCode: typeof topOpp.naics === 'string' ? topOpp.naics : undefined,
            deadline: typeof topOpp.deadline === 'string' ? topOpp.deadline : undefined,
            value: undefined,
            description: undefined,
            rawData: topOpp,
          },
          buildPursuitMarketSignals(noticeSummary, topOpp)
        );
        if (!brief) {
          throw new Error('Shared pursuit generator returned null');
        }
        brief.processingTimeMs = Date.now() - profileStartTime;
        brief.sourceNoticeId = topOpp.noticeId;

        // Store template
        const { error: insertError } = await getSupabase().from('briefing_templates').upsert({
          naics_profile: profile.naics_profile,
          naics_profile_hash: profile.naics_profile_hash,
          template_date: mondayDate,
          briefing_type: 'pursuit',
          briefing_content: brief,
          opportunities_count: 1,
          teaming_plays_count: brief.outreachTargets.length,
          processing_time_ms: brief.processingTimeMs,
          llm_provider: brief.llmProvider || 'unknown',
          llm_model: brief.llmModel || 'unknown',
          generated_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        }, { onConflict: 'naics_profile_hash,template_date,briefing_type' });

        if (insertError) {
          throw new Error(`Failed to store template: ${insertError.message}`);
        }

        templatesGenerated++;
        console.log(`[PrecomputePursuit] ✅ Template generated (score: ${brief.opportunityScore})`);

      } catch (err) {
        templatesFailed++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        errors.push(`Profile ${profile.naics_profile_hash.slice(0, 8)}: ${errorMsg}`);
        console.error(`[PrecomputePursuit] ❌ Failed:`, err);
      }

      await new Promise(r => setTimeout(r, DELAY_BETWEEN_PROFILES_MS));
    }

    const elapsed = Date.now() - startTime;
    const remaining = allProfiles.length - existingHashes.size - templatesGenerated;

    console.log(`[PrecomputePursuit] Complete: ${templatesGenerated} generated, ${templatesFailed} failed, ${remaining} remaining`);

    return NextResponse.json({
      success: true,
      templatesGenerated,
      templatesFailed,
      totalProfiles: allProfiles.length,
      templatesExisting: existingHashes.size,
      templatesRemaining: remaining,
      totalUsers: users?.length,
      errors: errors.length > 0 ? errors : undefined,
      elapsed,
    });

  } catch (error) {
    console.error('[PrecomputePursuit] Fatal error:', error);
    return NextResponse.json({
      success: false,
      error: String(error),
      templatesGenerated,
      templatesFailed,
      elapsed: Date.now() - startTime,
    }, { status: 500 });
  }
}
