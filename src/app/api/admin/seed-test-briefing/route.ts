/**
 * Admin: Seed test briefing data for a user
 *
 * GET /api/admin/seed-test-briefing?password=...&email=user@example.com
 *
 * Creates:
 * 1. User briefing profile with default watchlist
 * 2. Mock briefing_snapshots for all tools
 * 3. Triggers briefing generation and saves to briefing_log
 *
 * This bypasses the cron pipeline and lets you test end-to-end immediately.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateBriefing } from '@/lib/briefings/delivery';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const email = searchParams.get('email')?.toLowerCase().trim();

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!email) {
    return NextResponse.json({ error: 'Email required (?email=...)' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const today = new Date().toISOString().split('T')[0];
  const results: Record<string, unknown> = {};

  try {
    // 1. Create/update briefing profile with aggregated_profile
    const defaultProfile = {
      naics_codes: ['541512', '541511', '541519', '541513', '541330'],
      agencies: [
        'Department of Defense',
        'Department of Homeland Security',
        'Department of Veterans Affairs',
        'General Services Administration',
        'Department of Health and Human Services',
      ],
      keywords: ['cybersecurity', 'IT modernization', 'cloud', 'data analytics', 'small business'],
      zip_codes: [],
      watched_companies: ['Booz Allen Hamilton', 'Leidos', 'CACI'],
      watched_contracts: [],
    };

    const { error: profileError } = await supabase
      .from('user_briefing_profile')
      .upsert({
        user_email: email,
        aggregated_profile: defaultProfile,
        naics_codes: defaultProfile.naics_codes,
        agencies: defaultProfile.agencies,
        keywords: defaultProfile.keywords,
        watched_companies: defaultProfile.watched_companies,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_email' });

    results.profile = profileError ? { error: profileError.message } : { success: true };

    // 2. Seed mock snapshot data for each tool
    const mockOpportunities = [
      {
        noticeId: 'TEST-OPP-001',
        title: 'Cybersecurity Operations and Maintenance Support Services',
        solicitationNumber: 'W91234-24-R-0001',
        naicsCode: '541512',
        classificationCode: 'D302',
        description: 'The Army seeks cybersecurity support services including SOC operations, vulnerability management, and incident response capabilities.',
        department: 'Department of Defense',
        subTier: 'Army',
        office: 'ACC-APG',
        postedDate: new Date(Date.now() - 86400000).toISOString(),
        responseDeadline: new Date(Date.now() + 14 * 86400000).toISOString(),
        archiveDate: new Date(Date.now() + 30 * 86400000).toISOString(),
        setAside: '8(a)',
        setAsideDescription: '8(a) Set-Aside',
        noticeType: 'Solicitation',
        active: true,
        placeOfPerformance: { state: 'MD', city: 'Aberdeen' },
        uiLink: 'https://sam.gov/opp/test-001',
        lastModifiedDate: new Date().toISOString(),
      },
      {
        noticeId: 'TEST-OPP-002',
        title: 'Cloud Migration and IT Modernization Services',
        solicitationNumber: 'HSHQDC-24-R-0002',
        naicsCode: '541519',
        classificationCode: 'D399',
        description: 'CISA requires cloud migration services to modernize legacy systems and implement zero trust architecture.',
        department: 'Department of Homeland Security',
        subTier: 'CISA',
        office: 'Acquisition Division',
        postedDate: new Date(Date.now() - 172800000).toISOString(),
        responseDeadline: new Date(Date.now() + 7 * 86400000).toISOString(),
        archiveDate: new Date(Date.now() + 21 * 86400000).toISOString(),
        setAside: 'Small Business',
        setAsideDescription: 'Total Small Business Set-Aside',
        noticeType: 'Combined Synopsis/Solicitation',
        active: true,
        placeOfPerformance: { state: 'DC', city: 'Washington' },
        uiLink: 'https://sam.gov/opp/test-002',
        lastModifiedDate: new Date().toISOString(),
      },
      {
        noticeId: 'TEST-OPP-003',
        title: 'Data Analytics Platform Development',
        solicitationNumber: 'VA-24-R-0003',
        naicsCode: '541511',
        classificationCode: 'D308',
        description: 'VA OIT seeks development of advanced data analytics platform to improve veteran healthcare outcomes.',
        department: 'Department of Veterans Affairs',
        subTier: 'OIT',
        office: 'Technology Acquisition Center',
        postedDate: new Date().toISOString(),
        responseDeadline: new Date(Date.now() + 21 * 86400000).toISOString(),
        archiveDate: new Date(Date.now() + 60 * 86400000).toISOString(),
        setAside: 'SDVOSB',
        setAsideDescription: 'Service-Disabled Veteran-Owned Small Business Set-Aside',
        noticeType: 'Presolicitation',
        active: true,
        placeOfPerformance: { state: 'VA', city: 'Arlington' },
        uiLink: 'https://sam.gov/opp/test-003',
        lastModifiedDate: new Date().toISOString(),
      },
    ];

    const mockRecompetes = [
      {
        contractNumber: 'W91CRB-20-D-0001',
        orderNumber: null,
        piid: 'W91CRB-20-D-0001',
        incumbentName: 'Booz Allen Hamilton',
        incumbentDuns: null,
        incumbentCage: null,
        obligatedAmount: 45000000,
        baseAndAllOptionsValue: 55000000,
        naicsCode: '541512',
        naicsDescription: 'Computer Systems Design Services',
        psc: 'D302',
        contractingOffice: 'W91CRB',
        contractingOfficeName: 'ACC-APG',
        agency: 'Department of Defense',
        department: 'Department of Defense',
        signedDate: new Date(Date.now() - 365 * 86400000).toISOString(),
        effectiveDate: new Date(Date.now() - 365 * 86400000).toISOString(),
        currentCompletionDate: new Date(Date.now() + 90 * 86400000).toISOString(),
        ultimateCompletionDate: new Date(Date.now() + 180 * 86400000).toISOString(),
        setAsideType: 'SBA',
        isSmallBusiness: true,
        isWomenOwned: false,
        isVeteranOwned: false,
        isServiceDisabledVeteranOwned: false,
        is8aProgram: false,
        isHubZone: false,
        placeOfPerformanceState: 'MD',
        daysUntilExpiration: 90,
        expirationRisk: 'high' as const,
      },
      {
        contractNumber: 'GS-35F-0001X',
        orderNumber: null,
        piid: 'GS-35F-0001X',
        incumbentName: 'Leidos',
        incumbentDuns: null,
        incumbentCage: null,
        obligatedAmount: 28000000,
        baseAndAllOptionsValue: 35000000,
        naicsCode: '541519',
        naicsDescription: 'Other Computer Related Services',
        psc: 'D399',
        contractingOffice: 'GSAM',
        contractingOfficeName: 'GSA FAS',
        agency: 'General Services Administration',
        department: 'General Services Administration',
        signedDate: new Date(Date.now() - 300 * 86400000).toISOString(),
        effectiveDate: new Date(Date.now() - 300 * 86400000).toISOString(),
        currentCompletionDate: new Date(Date.now() + 45 * 86400000).toISOString(),
        ultimateCompletionDate: new Date(Date.now() + 120 * 86400000).toISOString(),
        setAsideType: 'Small Business',
        isSmallBusiness: true,
        isWomenOwned: false,
        isVeteranOwned: false,
        isServiceDisabledVeteranOwned: false,
        is8aProgram: false,
        isHubZone: false,
        placeOfPerformanceState: 'DC',
        daysUntilExpiration: 45,
        expirationRisk: 'critical' as const,
      },
    ];

    const mockAwards = [
      {
        awardId: 'TEST-AWARD-001',
        piid: 'TEST-AWARD-001',
        recipientName: 'CACI International Inc',
        recipientUei: null,
        awardAmount: 12500000,
        totalObligatedAmount: 12500000,
        naicsCode: '541512',
        naicsDescription: 'Computer Systems Design Services',
        psc: 'D302',
        pscDescription: 'IT and Telecom - Systems Development',
        awardingAgency: 'Department of Homeland Security',
        awardingSubAgency: 'CISA',
        awardingOffice: 'Acquisition Division',
        fundingAgency: 'Department of Homeland Security',
        startDate: new Date(Date.now() - 86400000).toISOString(),
        endDate: new Date(Date.now() + 365 * 86400000).toISOString(),
        lastModifiedDate: new Date().toISOString(),
        periodOfPerformanceCurrent: new Date(Date.now() + 365 * 86400000).toISOString(),
        awardType: 'Definitive Contract',
        isIdv: false,
        baseOrOption: 'Base',
        setAsideType: 'Small Business',
        placeOfPerformanceState: 'DC',
        placeOfPerformanceCity: 'Washington',
        extentCompeted: 'Full and Open Competition',
        numberOfOffers: 5,
        isNewAward: true,
        isModification: false,
        modificationReason: null,
      },
      {
        awardId: 'TEST-AWARD-002',
        piid: 'TEST-AWARD-002',
        recipientName: 'Booz Allen Hamilton Inc',
        recipientUei: null,
        awardAmount: 8750000,
        totalObligatedAmount: 8750000,
        naicsCode: '541511',
        naicsDescription: 'Custom Computer Programming Services',
        psc: 'D308',
        pscDescription: 'IT and Telecom - Programming',
        awardingAgency: 'Department of Veterans Affairs',
        awardingSubAgency: 'OIT',
        awardingOffice: 'Technology Acquisition Center',
        fundingAgency: 'Department of Veterans Affairs',
        startDate: new Date(Date.now() - 172800000).toISOString(),
        endDate: new Date(Date.now() + 365 * 86400000).toISOString(),
        lastModifiedDate: new Date().toISOString(),
        periodOfPerformanceCurrent: new Date(Date.now() + 365 * 86400000).toISOString(),
        awardType: 'Definitive Contract',
        isIdv: false,
        baseOrOption: 'Base',
        setAsideType: 'SDVOSB',
        placeOfPerformanceState: 'VA',
        placeOfPerformanceCity: 'Arlington',
        extentCompeted: 'Full and Open Competition',
        numberOfOffers: 4,
        isNewAward: true,
        isModification: false,
        modificationReason: null,
      },
    ];

    const mockWebSignals = [
      {
        id: 'web-signal-001',
        signal_type: 'AWARD_NEWS',
        headline: 'DOD Awards $50M Cybersecurity Contract',
        agency: 'Department of Defense',
        companies_mentioned: ['Leidos'],
        naics_relevance: ['541512'],
        detail: 'The Department of Defense has awarded a $50 million contract for next-generation cybersecurity services.',
        competitive_implication: 'Indicates strong DOD investment in cyber capabilities - potential teaming opportunity.',
        source_url: 'https://govconwire.com/test-article',
        source_name: 'GovConWire',
        published_date: new Date().toISOString(),
        relevance_score: 85,
        urgency: 'this_week',
      },
      {
        id: 'web-signal-002',
        signal_type: 'AGENCY_ANNOUNCEMENT',
        headline: 'DHS Announces Cloud-First Initiative',
        agency: 'Department of Homeland Security',
        companies_mentioned: [],
        naics_relevance: ['541519'],
        detail: 'DHS plans to migrate 80% of systems to cloud by end of FY2026.',
        competitive_implication: 'Major cloud contracting opportunities ahead for DHS-focused contractors.',
        source_url: 'https://fcw.com/test-article',
        source_name: 'Federal Computer Week',
        published_date: new Date().toISOString(),
        relevance_score: 78,
        urgency: 'this_month',
      },
    ];

    // Insert mock snapshots
    const snapshots = [
      { tool: 'opportunity_hunter', data: { items: mockOpportunities, totalRecords: 3, fetchedAt: new Date().toISOString() } },
      { tool: 'recompete', data: { items: mockRecompetes, totalRecords: 2, fetchedAt: new Date().toISOString() } },
      { tool: 'usaspending', data: { items: mockAwards, totalRecords: 2, fetchedAt: new Date().toISOString() } },
      { tool: 'web_intelligence', data: { signals: mockWebSignals, fetchedAt: new Date().toISOString() } },
    ];

    for (const snap of snapshots) {
      const { error } = await supabase
        .from('briefing_snapshots')
        .upsert({
          user_email: email,
          snapshot_date: today,
          tool: snap.tool,
          raw_data: snap.data,
          snapshot_data: snap.data, // Write to both columns for compatibility
          created_at: new Date().toISOString(),
        }, { onConflict: 'user_email,snapshot_date,tool' });

      results[snap.tool] = error ? { error: error.message } : { success: true };
    }

    // 3. Debug: read back what we just wrote
    const { data: readSnapshots, error: readError } = await supabase
      .from('briefing_snapshots')
      .select('tool, raw_data, snapshot_date')
      .eq('user_email', email)
      .eq('snapshot_date', today);

    const debugInfo = {
      snapshotsFound: readSnapshots?.length || 0,
      snapshotTools: readSnapshots?.map(s => s.tool) || [],
      rawDataSample: readSnapshots?.[0]?.raw_data ? 'present' : 'null',
      readError: readError?.message,
    };

    // 4. Now generate the briefing
    console.log(`[SeedTestBriefing] Generating briefing for ${email}...`);
    const briefing = await generateBriefing(email, {
      includeWebIntel: true,
      maxItems: 15,
    });

    if (!briefing || briefing.totalItems === 0) {
      return NextResponse.json({
        success: false,
        message: 'Snapshots seeded but briefing generation returned 0 items. Check generator logic.',
        email,
        seedResults: results,
        debug: debugInfo,
      });
    }

    // 4. Save to briefing_log
    const { error: logError } = await supabase.from('briefing_log').upsert({
      user_email: email,
      briefing_date: briefing.briefingDate,
      briefing_content: briefing,
      items_count: briefing.totalItems,
      tools_included: briefing.sourcesIncluded,
      delivery_status: 'sent',
      created_at: new Date().toISOString(),
    }, { onConflict: 'user_email,briefing_date' });

    results.briefing_log = logError ? { error: logError.message } : { success: true };

    return NextResponse.json({
      success: true,
      email,
      briefing_date: briefing.briefingDate,
      total_items: briefing.totalItems,
      sources: briefing.sourcesIncluded,
      headline: briefing.summary.headline,
      seedResults: results,
      briefing,
    });

  } catch (err) {
    console.error('[SeedTestBriefing] Error:', err);
    return NextResponse.json({
      success: false,
      error: String(err),
      email,
      seedResults: results,
    }, { status: 500 });
  }
}
