/**
 * MI Beta - Opportunities API
 *
 * Fetches opportunities from SAM.gov cache for the unified MI platform.
 * Uses the same cache as daily alerts (24K+ records).
 *
 * Query params:
 * - email: User email to load their NAICS profile
 * - naics: Comma-separated NAICS codes (if not using email profile)
 * - limit: Max results (default 25)
 * - noticeType: Filter by notice type (solicitation, combined, sources_sought, etc.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { isSearchableKeyword } from '@/lib/market/keyword-sanitize';
import { getMindyFeedbackSignals, scoreOpportunityWithMindyFeedback } from '@/lib/mindy/feedback-scoring';
import { getBuyerAgencyParts } from '@/lib/mindy/agency-display';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

interface SAMOpportunity {
  notice_id: string;
  title: string;
  solicitation_number?: string;
  naics_code?: string;
  classification_code?: string;
  department?: string;
  sub_tier?: string;
  office?: string;
  posted_date?: string;
  response_deadline?: string;
  set_aside?: string;
  set_aside_description?: string;
  notice_type?: string;
  active?: boolean;
  pop_state?: string;
  pop_city?: string;
  pop_zip?: string;
  pop_country?: string;
  ui_link?: string;
  description?: string;
  description_url?: string;
  notice_desc_url?: string;
  // Extra SAM fields surfaced via raw_data extraction. Same shape
  // /api/mi-dashboard already returns; we include them here so the
  // Source Feed Details drawer can render the full record.
  attachments?: unknown[];
  points_of_contact?: unknown[];
  office_address?: Record<string, unknown> | null;
  fair_opportunity?: Record<string, unknown> | null;
  additional_info_link?: string | null;
  additional_info_text?: string | null;
}

interface UserOpportunityProfile {
  naics_codes?: string[] | null;
  business_type?: string | null;
  set_aside_preferences?: string[] | null;
  location_states?: string[] | null;
}

interface SetAsideFit {
  eligible: boolean;
  adjustment: number;
  reason?: string;
}

interface AgencyFit {
  adjustment: number;
  reason?: string;
}

function normalizeText(value: string | null | undefined) {
  return String(value || '').toLowerCase();
}

function isHttpUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function getOpportunitySummary(opp: SAMOpportunity) {
  const description = opp.description?.trim();
  if (!description || isHttpUrl(description)) return null;
  return description;
}

function getOpportunityDescriptionUrl(opp: SAMOpportunity) {
  const candidates = [opp.description_url, opp.notice_desc_url, opp.description];
  return candidates.find(isHttpUrl)?.trim() || null;
}

function getSamOpportunityUrl(opp: SAMOpportunity) {
  if (opp.ui_link && isHttpUrl(opp.ui_link) && !opp.ui_link.includes('api.sam.gov')) {
    return opp.ui_link;
  }
  return `https://sam.gov/workspace/contract/opp/${opp.notice_id}/view`;
}

function normalizeProfileCertifications(profile: UserOpportunityProfile | null): string[] {
  const values = [
    profile?.business_type || '',
    ...(Array.isArray(profile?.set_aside_preferences) ? profile.set_aside_preferences : []),
  ];

  return values.map(normalizeText).filter(Boolean);
}

function isMarketResearchNotice(noticeType?: string | null) {
  const value = normalizeText(noticeType);
  return value.includes('sources sought')
    || value.includes('source sought')
    || value === 'ss'
    || value.includes('request for information')
    || value.includes('rfi')
    || value.includes('special notice');
}

function hasAnyCertification(certifications: string[], patterns: string[]) {
  return certifications.some(cert => patterns.some(pattern => cert.includes(pattern)));
}

function hasSmallBusinessEligibility(certifications: string[]) {
  return hasAnyCertification(certifications, [
    'small',
    'sdvosb',
    'vosb',
    'veteran',
    '8(a)',
    '8a',
    'wosb',
    'edwosb',
    'women-owned',
    'women owned',
    'hubzone',
    'hub zone',
  ]);
}

function hasVeteranEligibility(profile: UserOpportunityProfile | null) {
  return hasAnyCertification(normalizeProfileCertifications(profile), [
    'sdvosb',
    'vosb',
    'veteran',
    'service-disabled',
    'service disabled',
  ]);
}

function isVeteransAffairsAgency(opp: SAMOpportunity) {
  const agencyText = normalizeText(`${opp.department || ''} ${opp.sub_tier || ''} ${opp.office || ''}`);
  return agencyText.includes('veterans affairs')
    || agencyText.includes('department of veterans')
    || agencyText.includes('veterans health administration')
    || agencyText.includes('vha ')
    || agencyText === 'vha';
}

function getAgencyFit(opp: SAMOpportunity, profile: UserOpportunityProfile | null): AgencyFit {
  if (!isVeteransAffairsAgency(opp) || hasVeteranEligibility(profile)) {
    return { adjustment: 0 };
  }

  if (isMarketResearchNotice(opp.notice_type)) {
    return {
      adjustment: -8,
      reason: 'VA research notice, but veteran-owned firms usually fit VA best',
    };
  }

  return {
    adjustment: -60,
    reason: 'VA is veteran-first; rank lower without veteran-owned status',
  };
}

function getSetAsideFit(opp: SAMOpportunity, profile: UserOpportunityProfile | null): SetAsideFit {
  const setAside = `${opp.set_aside || ''} ${opp.set_aside_description || ''}`;
  const normalizedSetAside = normalizeText(setAside);
  const certifications = normalizeProfileCertifications(profile);

  if (isMarketResearchNotice(opp.notice_type)) {
    return { eligible: true, adjustment: 6, reason: 'market research notice' };
  }

  if (!normalizedSetAside.trim()) {
    return {
      eligible: true,
      adjustment: -20,
      reason: 'full-and-open work ranks behind small-business matches',
    };
  }

  if (
    normalizedSetAside.includes('no set aside')
    || normalizedSetAside.includes('no set-aside')
    || normalizedSetAside.includes('unrestricted')
    || normalizedSetAside.includes('full and open')
  ) {
    return {
      eligible: true,
      adjustment: -20,
      reason: 'full-and-open work ranks behind small-business matches',
    };
  }

  const isVeteranSetAside = normalizedSetAside.includes('sdvosb')
    || normalizedSetAside.includes('service-disabled veteran')
    || normalizedSetAside.includes('service disabled veteran')
    || normalizedSetAside.includes('vosb')
    || normalizedSetAside.includes('veteran-owned')
    || normalizedSetAside.includes('veteran owned');
  const is8aSetAside = normalizedSetAside.includes('8(a)') || normalizedSetAside.includes('8a');
  const isWosbSetAside = normalizedSetAside.includes('wosb') || normalizedSetAside.includes('women-owned') || normalizedSetAside.includes('women owned');
  const isHubZoneSetAside = normalizedSetAside.includes('hubzone') || normalizedSetAside.includes('hub zone');
  const isIndianSmallBusinessSetAside = normalizedSetAside.includes('indian small business')
    || normalizedSetAside.includes('isbee')
    || normalizedSetAside.includes('indian economic enterprise')
    || normalizedSetAside.includes('native american');
  const isSmallBusinessSetAside = normalizedSetAside.includes('small business')
    || normalizedSetAside.includes('total small')
    || normalizedSetAside.includes('sba')
    || normalizedSetAside.includes('far 19.5');

  if (isVeteranSetAside && !hasAnyCertification(certifications, ['sdvosb', 'vosb', 'veteran', 'service-disabled', 'service disabled'])) {
    return {
      eligible: false,
      adjustment: -90,
      reason: 'requires veteran-owned status',
    };
  }

  if (is8aSetAside && !hasAnyCertification(certifications, ['8(a)', '8a'])) {
    return {
      eligible: false,
      adjustment: -70,
      reason: 'requires 8(a) certification',
    };
  }

  if (isWosbSetAside && !hasAnyCertification(certifications, ['wosb', 'edwosb', 'women-owned', 'women owned'])) {
    return {
      eligible: false,
      adjustment: -70,
      reason: 'requires women-owned certification',
    };
  }

  if (isHubZoneSetAside && !hasAnyCertification(certifications, ['hubzone', 'hub zone'])) {
    return {
      eligible: false,
      adjustment: -70,
      reason: 'requires HUBZone certification',
    };
  }

  if (isIndianSmallBusinessSetAside && !hasAnyCertification(certifications, ['isbee', 'indian', 'native american', 'native-owned', 'native owned'])) {
    return {
      eligible: false,
      adjustment: -70,
      reason: 'requires Indian Small Business status',
    };
  }

  if (isSmallBusinessSetAside) {
    return hasSmallBusinessEligibility(certifications)
      ? { eligible: true, adjustment: 30, reason: 'small-business set-aside match' }
      : { eligible: false, adjustment: -50, reason: 'requires small-business status' };
  }

  const hasKnownSetAside = isVeteranSetAside || is8aSetAside || isWosbSetAside || isHubZoneSetAside || isIndianSmallBusinessSetAside || isSmallBusinessSetAside;
  if (!hasKnownSetAside) {
    return {
      eligible: false,
      adjustment: -35,
      reason: 'set-aside status is not in your profile',
    };
  }

  return { eligible: true, adjustment: 18, reason: 'matches your set-aside profile' };
}

export async function GET(request: NextRequest) {
  if (!supabase) {
    return NextResponse.json({
      success: false,
      error: 'Database not configured',
    }, { status: 500 });
  }

  const { searchParams } = request.nextUrl;
  const email = searchParams.get('email');
  const naicsParam = searchParams.get('naics');
  const limit = parseInt(searchParams.get('limit') || '25', 10);
  const noticeType = searchParams.get('noticeType');
  // KEYWORD search (#60) — true server-side search across ALL of SAM by
  // title/description, NOT just within the NAICS-loaded set. Fixes "my active
  // opps are NAICS-only / can I keyword search ALL SAM" — both NAICS-only before.
  const keyword = (searchParams.get('keyword') || searchParams.get('q') || '').trim();
  // When true, the keyword REPLACES the NAICS filter (browse-all-SAM mode). When
  // false (default), keyword is OR'd with NAICS so the feed widens, not narrows.
  const keywordOnly = searchParams.get('keywordOnly') === 'true';

  const authSession = requireMIAuthSession(request, email);
  if (!authSession.ok) return authSession.response;

  // Get user's NAICS codes from their profile
  let naicsCodes: string[] = [];
  let userProfile: UserOpportunityProfile | null = null;

  if (email) {
    const { data: profile } = await supabase
      .from('user_notification_settings')
      .select('naics_codes,business_type,set_aside_preferences,location_states')
      .eq('user_email', email)
      .single();

    userProfile = profile || null;

    if (profile?.naics_codes?.length) {
      naicsCodes = profile.naics_codes;
    }
  }

  // Override with explicit NAICS if provided
  if (naicsParam) {
    naicsCodes = naicsParam.split(',').map(n => n.trim());
  }

  // Default NAICS if none specified
  if (naicsCodes.length === 0) {
    naicsCodes = ['541512', '541611', '541330', '541990', '561210'];
  }

  try {
    // Build query for opportunities from cache
    // Cap how much we pull from Supabase for one feed request. 2,000 is
    // well above what any matched-profile user actually has (most have
    // hundreds at most) and keeps memory + sort cost bounded. limit*3
    // gives the dedupe + scoring step room to filter without truncating
    // good results.
    const fetchLimit = Math.min(Math.max(limit * 3, limit), 2000);
    let query = supabase
      .from('sam_opportunities')
      .select('*')
      .eq('active', true)
      .gte('response_deadline', new Date().toISOString().split('T')[0])
      .order('response_deadline', { ascending: true })
      .limit(fetchLimit);

    // Build the match filter. Keyword (#60) searches title + description across
    // ALL SAM. Default: keyword OR NAICS (widens the feed — catches the 72% of a
    // market that lives in non-obvious codes). keywordOnly=true: pure SAM search,
    // ignore the user's NAICS (the "ALL SAM" browse).
    // Escape PostgREST OR special chars in the user keyword.
    let safeKw = keyword.replace(/[(),*]/g, ' ').trim();
    // SANITIZE (#61) — drop short/ambiguous abbreviations that produce noise
    // (Eric: "OTA" → potable/rota/total). A multi-word phrase or a verified
    // abbreviation passes; a bare 3-char term is rejected so we don't return junk.
    if (safeKw && !isSearchableKeyword(safeKw)) {
      safeKw = '';
    }
    const naicsFilters = naicsCodes.map(code => `naics_code.like.${code}%`);
    const keywordFilters = safeKw
      ? [`title.ilike.%${safeKw}%`, `description.ilike.%${safeKw}%`]
      : [];
    if (safeKw && keywordOnly) {
      query = query.or(keywordFilters.join(','));
    } else {
      query = query.or([...naicsFilters, ...keywordFilters].join(','));
    }

    // Filter by user's location states when set. Strict mode — we
    // don't auto-expand to regions, so a user who selected FL sees
    // only FL opps. Region selection happens via the Settings UI by
    // expanding the preset into the underlying state array client-side
    // before saving. If the array is empty/null, no state filter
    // applies (national feed).
    const locationStates = (userProfile?.location_states || [])
      .map((s) => String(s || '').trim().toUpperCase())
      .filter(Boolean);
    if (locationStates.length > 0) {
      query = query.in('pop_state', locationStates);
    }

    // Optional notice type filter
    if (noticeType) {
      query = query.ilike('notice_type', `%${noticeType}%`);
    }

    const { data: opportunities, error } = await query;

    if (error) {
      console.error('[MI Beta Opps] Query error:', error);
      return NextResponse.json({
        success: false,
        error: 'Failed to fetch opportunities',
      }, { status: 500 });
    }

    const feedbackSignals = email ? await getMindyFeedbackSignals(email) : undefined;

    // Transform to consistent format
    const alerts = (opportunities || []).map((opp: SAMOpportunity) => {
      // Calculate days until deadline
      const deadline = opp.response_deadline ? new Date(opp.response_deadline) : null;
      const now = new Date();
      const daysLeft = deadline ? Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;
      const feedbackScore = scoreOpportunityWithMindyFeedback({
        opportunityId: opp.notice_id,
        title: opp.title,
        agency: opp.department || opp.sub_tier || opp.office,
        naicsCode: opp.naics_code,
      }, feedbackSignals);
      const setAsideFit = getSetAsideFit(opp, userProfile);
      const agencyFit = getAgencyFit(opp, userProfile);
      const recommendationScore = feedbackScore.adjustment + setAsideFit.adjustment + agencyFit.adjustment;
      const feedbackReasons = [...feedbackScore.reasons];
      const buyer = getBuyerAgencyParts({
        department: opp.department,
        sub_tier: opp.sub_tier,
        office: opp.office,
      });
      if (setAsideFit.reason && setAsideFit.adjustment > 0) feedbackReasons.push(setAsideFit.reason);
      if (agencyFit.reason) feedbackReasons.push(agencyFit.reason);

      return {
        id: opp.notice_id,
        title: opp.title,
        solicitationNumber: opp.solicitation_number,
        naicsCode: opp.naics_code,
        pscCode: opp.classification_code,
        department: opp.department,
        subTier: opp.sub_tier,
        office: opp.office,
        buyerName: buyer.primary,
        buyerOffice: buyer.secondary,
        parentAgency: buyer.parent,
        buyerDisplay: buyer.full,
        postedDate: opp.posted_date,
        responseDeadline: opp.response_deadline,
        setAside: opp.set_aside,
        setAsideDescription: opp.set_aside_description,
        noticeType: opp.notice_type,
        description: getOpportunitySummary(opp),
        descriptionUrl: getOpportunityDescriptionUrl(opp),
        popState: opp.pop_state,
        popCity: opp.pop_city,
        popZip: opp.pop_zip,
        popCountry: opp.pop_country,
        // Extra SAM record fields so the Source Feed Details drawer
        // can render attachments / POCs / office / additional info
        // without a second API call.
        attachments: Array.isArray(opp.attachments) ? opp.attachments : [],
        pointsOfContact: Array.isArray(opp.points_of_contact) ? opp.points_of_contact : [],
        officeAddress: opp.office_address ?? null,
        fairOpportunity: opp.fair_opportunity ?? null,
        additionalInfoLink: typeof opp.additional_info_link === 'string' ? opp.additional_info_link : null,
        additionalInfoText: typeof opp.additional_info_text === 'string' ? opp.additional_info_text : null,
        url: getSamOpportunityUrl(opp),
        daysLeft,
        isUrgent: daysLeft !== null && daysLeft <= 7 && daysLeft >= 0,
        isClosingSoon: daysLeft !== null && daysLeft <= 14 && daysLeft > 7,
        setAsideEligible: setAsideFit.eligible,
        setAsideMismatchReason: setAsideFit.eligible ? null : setAsideFit.reason,
        eligibilityScoreAdjustment: setAsideFit.adjustment,
        agencyScoreAdjustment: agencyFit.adjustment,
        agencyMismatchReason: agencyFit.reason || null,
        feedbackScoreAdjustment: feedbackScore.adjustment,
        recommendationScore,
        feedbackReasons: Array.from(new Set(feedbackReasons)).slice(0, 3),
      };
    }).sort((a, b) => {
      if (b.recommendationScore !== a.recommendationScore) {
        return b.recommendationScore - a.recommendationScore;
      }
      const aDeadline = a.responseDeadline ? new Date(a.responseDeadline).getTime() : Number.MAX_SAFE_INTEGER;
      const bDeadline = b.responseDeadline ? new Date(b.responseDeadline).getTime() : Number.MAX_SAFE_INTEGER;
      return aDeadline - bDeadline;
    });

    const seenOpportunityKeys = new Set<string>();
    const dedupedAlerts = alerts.filter((alert) => {
      const key = [
        String(alert.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
        String(alert.department || alert.subTier || '').toLowerCase().trim(),
      ].join('|');

      if (seenOpportunityKeys.has(key)) return false;
      seenOpportunityKeys.add(key);
      return true;
    }).slice(0, limit);

    return NextResponse.json({
      success: true,
      count: dedupedAlerts.length,
      opportunities: dedupedAlerts,
      // Mirrors the data shown on the daily-alert email banner so the
      // in-app Source Feed header can render the same "Filters:" line.
      searchCriteria: {
        naicsCodes,
        limit,
        noticeType,
        businessType: userProfile?.business_type ?? null,
        setAsidePreferences: userProfile?.set_aside_preferences ?? [],
        locationStates: locationStates,
      },
    });

  } catch (error) {
    console.error('[MI Beta Opps] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to search opportunities',
    }, { status: 500 });
  }
}
