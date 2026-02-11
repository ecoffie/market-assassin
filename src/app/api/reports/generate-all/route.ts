import { NextRequest, NextResponse } from 'next/server';
import { suggestPrimesForAgencies, getPrimesByNAICS, suggestTier2ForAgencies } from '@/lib/utils/prime-contractors';
import { suggestTribesForAgencies, getTribesByNAICS } from '@/lib/utils/tribal-businesses';
import { getPainPointsForAgency, getPrioritiesForAgency, getSimilarAgencies, generateAgencyNeeds, generateAgencyNeedsWithCommands, getPainPointsForCommand } from '@/lib/utils/pain-points';
import { getOpportunitiesByCoreInputs, getUrgencyLevel, getQuickWinStrategy } from '@/lib/utils/december-spend';
import { getForecastsForSelectedAgencies, getUpcomingForecasts, getForecastStatistics } from '@/lib/utils/agency-forecasts';
import { searchIDVContracts } from '@/lib/idv-search';
import { getEnhancedAgencyInfo, isDoDAgency } from '@/lib/utils/command-info';
import { ComprehensiveReport, CoreInputs, Agency } from '@/types/federal-market-assassin';
import { checkReportRateLimit, checkIPRateLimit, getClientIP, rateLimitResponse } from '@/lib/rate-limit';
import { getEmailFromRequest, verifyMAAccess } from '@/lib/api-auth';
import { validateReportInputs } from '@/lib/validate';
import { trackGeneration } from '@/lib/abuse-detection';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { inputs, selectedAgencies, selectedAgencyData, userEmail }: { inputs: CoreInputs; selectedAgencies: string[]; selectedAgencyData?: Agency[]; userEmail?: string } = body;

    // Input validation
    const validation = validateReportInputs(body);
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.errors.join('; ') },
        { status: 400 }
      );
    }

    // Rate limiting: email-based if available, IP-based fallback
    const email = getEmailFromRequest(request, body);
    if (email) {
      const rl = await checkReportRateLimit(email);
      if (!rl.allowed) return rateLimitResponse(rl);
    } else {
      const ip = getClientIP(request);
      const rl = await checkIPRateLimit(ip);
      if (!rl.allowed) return rateLimitResponse(rl);
    }

    // Server-side access verification
    const auth = await verifyMAAccess(email);
    if (!auth.authenticated) {
      return NextResponse.json(
        { success: false, error: auth.error },
        { status: 403 }
      );
    }

    // Track generation for abuse monitoring
    if (email) {
      trackGeneration(email);
    }

    // Get pain points for selected agencies, using command-level data when available
    const agenciesWithPainPoints = selectedAgencies.map(agencyName => {
      // Find the full agency data if provided (includes command info)
      const agencyData = selectedAgencyData?.find(a => a.name === agencyName || a.contractingOffice === agencyName);

      if (agencyData) {
        // Use enhanced pain points lookup with command hierarchy
        const { painPoints, source } = getPainPointsForCommand(
          agencyData.contractingOffice || agencyName,
          agencyData.subAgency || '',
          agencyData.parentAgency || '',
          agencyData.command
        );
        return {
          name: agencyName,
          painPoints,
          priorities: getPrioritiesForAgency(agencyName, agencyData.command),
          painPointSource: source,
          command: agencyData.command,
        };
      }

      // Fallback to simple lookup
      return {
        name: agencyName,
        painPoints: getPainPointsForAgency(agencyName),
        priorities: getPrioritiesForAgency(agencyName),
      };
    });

    // Generate Tier 2 Subcontracting Report using ONLY Tier 2 contractors (not prime contractors)
    // Supports both NAICS and PSC code searches
    const tier2Contractors = suggestTier2ForAgencies(
      inputs.naicsCode,
      inputs.pscCode
    );

    // Get prime contractors for the Prime Contractor section (separate from Tier 2)
    const primeContractorPrimes = suggestPrimesForAgencies(
      agenciesWithPainPoints,
      inputs.naicsCode,
      inputs.pscCode
    );

    const tier2Subcontracting = {
      suggestedPrimes: tier2Contractors.map(tier2 => ({
        name: tier2.name,
        reason: `Tier 2 subcontractor${tier2.naicsCategories?.length ? (inputs.naicsCode ? ' matching your NAICS code' : inputs.pscCode ? ' matching your PSC category' : '') : ''}`,
        opportunities: tier2.specialties || [],
        relevantAgencies: tier2.agencies?.slice(0, 5) || [],
        contactStrategy: tier2.sbloName && tier2.email
          ? `Contact ${tier2.sbloName} at ${tier2.email}`
          : tier2.email
          ? `Contact at ${tier2.email}`
          : `Contact ${tier2.name} for subcontracting opportunities`,
        // Enhanced contact card data
        sbloName: tier2.sbloName || null,
        email: tier2.email || null,
        phone: tier2.phone || null,
        contractCount: null, // Not available for Tier 2
        totalContractValue: null, // Not available for Tier 2
        hasSubcontractPlan: false, // Not applicable for Tier 2
        supplierPortal: null, // Not applicable for Tier 2
        naicsCategories: tier2.naicsCategories || [],
        tierClassification: tier2.tierClassification || 'Tier 2',
        certifications: tier2.certifications || [],
      })),
      summary: {
        totalPrimes: tier2Contractors.length,
        opportunityCount: tier2Contractors.reduce((sum, t) => sum + (t.specialties?.length || 0), 0),
      },
      recommendations: [
        'Contact Tier 2 subcontractors directly for partnership opportunities',
        'Attend small business networking events to meet these contractors',
        'Review their NAICS codes to ensure capability alignment',
        tier2Contractors.some(t => t.email)
          ? 'Use provided email addresses to reach out directly'
          : 'Search SAM.gov for additional contact information',
      ],
    };

    // Generate Tribal Contracting Report using bootcamp database
    const suggestedTribes = suggestTribesForAgencies(
      agenciesWithPainPoints.map(a => ({ name: a.name })),
      inputs.naicsCode
    );

    const tribalContracting = {
      opportunities: [],
      suggestedTribes: suggestedTribes.slice(0, 10).map(tribe => ({
        name: tribe.name,
        region: tribe.region,
        capabilities: tribe.capabilities || [],
        contactInfo: tribe.contactPersonsEmail
          ? {
              name: tribe.contactPersonsName,
              email: tribe.contactPersonsEmail,
            }
          : undefined,
        certifications: tribe.activeSbaCertifications || [],
        naicsCategories: tribe.naicsCategories || [],
      })),
      recommendedAgencies: selectedAgencies.slice(0, 5),
      summary: {
        totalOpportunities: suggestedTribes.length,
        totalValue: 0, // Could be calculated if we had contract value data
      },
      recommendations: [
        'Partner with 8(a) certified tribal businesses for subcontracting opportunities',
        'Leverage tribal business set-asides and sole-source opportunities',
        'Build teaming relationships with complementary capabilities',
        suggestedTribes.some(t => t.contactPersonsEmail)
          ? 'Contact suggested tribal businesses using provided email addresses'
          : 'Research tribal business contact information for partnership outreach',
      ],
    };

    // Prime Contractor Report uses primeContractorPrimes computed above (non-duplicates of Tier 2)
    // Get similar agencies for "other agencies" suggestions
    const similarAgenciesSet = new Set<string>();
    selectedAgencies.forEach(agencyName => {
      const similar = getSimilarAgencies(agencyName, 5);
      similar.forEach(s => {
        if (!selectedAgencies.includes(s.agency)) {
          similarAgenciesSet.add(s.agency);
        }
      });
    });

    const primeContractor = {
      suggestedPrimes: primeContractorPrimes.slice(0, 10).map(prime => ({
        name: prime.name,
        reason: `Prime contractor in your industry${prime.agencies?.length ? ' working with your target agencies' : ''}`,
        subcontractingOpportunities: prime.specialties || [],
        contractTypes: ['IDIQ', 'BPA', 'GWAC'], // Could be enhanced with actual data
        smallBusinessLevel: prime.smallBusinessLevel || 'medium',
        // Enhanced contact card data
        sbloName: prime.sbloName || null,
        email: prime.email || null,
        phone: prime.phone || null,
        contractCount: prime.contractCount || null,
        totalContractValue: prime.totalContractValue || null,
        hasSubcontractPlan: prime.hasSubcontractPlan || false,
        supplierPortal: prime.supplierPortal || null,
        naicsCategories: prime.naicsCategories || [],
        agencies: prime.agencies?.slice(0, 5) || [],
      })),
      otherAgencies: Array.from(similarAgenciesSet).slice(0, 5).map(agencyName => {
        const painPoints = getPainPointsForAgency(agencyName);
        return {
          name: agencyName,
          reason: 'Similar pain points and needs to your target agencies',
          matchingPainPoints: painPoints.slice(0, 3),
          relevance: 'High - Similar challenges and opportunities',
        };
      }),
      summary: {
        totalPrimes: primeContractorPrimes.length,
        totalOtherAgencies: similarAgenciesSet.size,
      },
      recommendations: [
        'Build relationships with prime contractors in your industry',
        'Attend prime contractor small business events',
        'Consider exploring similar agencies with matching pain points',
      ],
    };

    // Generate Agency Pain Points & Spending Priorities Report (Enhanced)
    const allPainPoints = agenciesWithPainPoints.flatMap(a =>
      a.painPoints.map(pp => ({ agency: a.name, painPoint: pp }))
    );

    const allPriorities = agenciesWithPainPoints.flatMap(a =>
      (a.priorities || []).map(pr => ({ agency: a.name, priority: pr }))
    );

    // NAICS-to-keyword mapping for relevance scoring
    const naicsKeywords: Record<string, string[]> = {
      '54': ['consulting', 'professional', 'engineering', 'technical', 'IT', 'software', 'cyber', 'data', 'analytics', 'AI', 'cloud', 'digital', 'moderniz'],
      '541': ['consulting', 'professional', 'engineering', 'technical', 'IT', 'software', 'cyber', 'data', 'analytics', 'AI', 'cloud', 'digital', 'moderniz'],
      '23': ['construction', 'building', 'infrastructure', 'facility', 'renovation', 'HVAC', 'base infrastructure', 'energy'],
      '236': ['construction', 'building', 'renovation', 'facility'],
      '237': ['heavy construction', 'infrastructure', 'highway', 'bridge', 'utility'],
      '238': ['specialty trade', 'electrical', 'plumbing', 'HVAC', 'mechanical'],
      '56': ['administrative', 'facility support', 'security', 'janitorial', 'maintenance'],
      '561': ['administrative', 'facility support', 'security', 'guard', 'staffing'],
      '81': ['repair', 'maintenance', 'equipment'],
      '811': ['repair', 'maintenance', 'equipment', 'vehicle'],
      '518': ['hosting', 'cloud', 'data processing', 'data center'],
      '336': ['manufacturing', 'aircraft', 'ship', 'vehicle', 'defense'],
      '611': ['training', 'education', 'simulation'],
      '621': ['health', 'medical', 'clinical'],
      '622': ['hospital', 'health care'],
    };

    // Get keywords for user's NAICS
    const userNaics = inputs.naicsCode || '';
    const userKeywords: string[] = [];
    // Check full code, 3-digit prefix, 2-digit sector
    for (const prefix of [userNaics, userNaics.substring(0, 3), userNaics.substring(0, 2)]) {
      if (naicsKeywords[prefix]) {
        userKeywords.push(...naicsKeywords[prefix]);
      }
    }

    // Score priority NAICS relevance
    const scorePriorityRelevance = (priorityText: string): 'high' | 'medium' | 'low' => {
      if (userKeywords.length === 0) return 'medium';
      const lower = priorityText.toLowerCase();
      const matchCount = userKeywords.filter(kw => lower.includes(kw.toLowerCase())).length;
      if (matchCount >= 2) return 'high';
      if (matchCount >= 1) return 'medium';
      return 'low';
    };

    // Cross-reference: find areas where agency has BOTH a pain point AND a spending priority
    const CROSS_REF_AREAS = [
      { area: 'Cybersecurity', keywords: ['cyber', 'security', 'zero trust', 'cmmc', 'authorization'] },
      { area: 'IT Modernization', keywords: ['moderniz', 'legacy system', 'cloud', 'digital', 'software'] },
      { area: 'Infrastructure', keywords: ['infrastructure', 'facility', 'construction', 'building', 'base'] },
      { area: 'Data & Analytics', keywords: ['data', 'analytics', 'AI', 'machine learning', 'artificial intelligence'] },
      { area: 'Workforce', keywords: ['workforce', 'staffing', 'personnel', 'training', 'hiring'] },
      { area: 'Supply Chain', keywords: ['supply chain', 'logistics', 'procurement', 'acquisition'] },
      { area: 'Healthcare', keywords: ['health', 'medical', 'clinical', 'patient', 'EHR'] },
      { area: 'Energy & Climate', keywords: ['energy', 'climate', 'renewable', 'sustainability', 'carbon'] },
      { area: 'Compliance & Audit', keywords: ['compliance', 'audit', 'oversight', 'IG ', 'inspector general'] },
      { area: 'Communications', keywords: ['5G', 'communication', 'network', 'spectrum', 'satellite'] },
    ];

    const highOpportunityMatches: Array<{
      agency: string;
      painPoint: string;
      matchingPriority: string;
      area: string;
      fundingStatus: 'funded' | 'planned';
      naicsRelevant: boolean;
    }> = [];

    for (const agencyData of agenciesWithPainPoints) {
      const agencyPriorities = agencyData.priorities || [];
      if (agencyPriorities.length === 0) continue;

      for (const crossArea of CROSS_REF_AREAS) {
        // Find pain points in this area
        const matchingPainPoints = agencyData.painPoints.filter(pp =>
          crossArea.keywords.some(kw => pp.toLowerCase().includes(kw))
        );
        // Find priorities in this area
        const matchingPriorities = agencyPriorities.filter(pr =>
          crossArea.keywords.some(kw => pr.toLowerCase().includes(kw))
        );

        if (matchingPainPoints.length > 0 && matchingPriorities.length > 0) {
          const priority = matchingPriorities[0];
          const isFunded = /\$[\d.]+[BMK]/i.test(priority);
          const isNaicsRelevant = scorePriorityRelevance(priority) !== 'low';

          highOpportunityMatches.push({
            agency: agencyData.name,
            painPoint: matchingPainPoints[0],
            matchingPriority: priority,
            area: crossArea.area,
            fundingStatus: isFunded ? 'funded' : 'planned',
            naicsRelevant: isNaicsRelevant,
          });
        }
      }
    }

    // Sort: NAICS-relevant funded matches first
    highOpportunityMatches.sort((a, b) => {
      const aScore = (a.naicsRelevant ? 4 : 0) + (a.fundingStatus === 'funded' ? 2 : 0);
      const bScore = (b.naicsRelevant ? 4 : 0) + (b.fundingStatus === 'funded' ? 2 : 0);
      return bScore - aScore;
    });

    const naicsRelevantPriorities = allPriorities.filter(pr =>
      scorePriorityRelevance(pr.priority) !== 'low'
    );

    const agencyPainPoints = {
      painPoints: allPainPoints.slice(0, 20).map(({ agency, painPoint }) => ({
        agency,
        painPoint,
        opportunityMatch: scorePriorityRelevance(painPoint) === 'high'
          ? `Strong NAICS ${userNaics} alignment — directly relevant to your capabilities`
          : scorePriorityRelevance(painPoint) === 'medium'
          ? `Moderate alignment with NAICS ${userNaics} capabilities`
          : 'Your capabilities may address this agency challenge',
        solutionPositioning: `Position your solutions to address: ${painPoint}`,
        priority: painPoint.toLowerCase().includes('ndaa') || painPoint.toLowerCase().includes('critical')
          ? 'high'
          : 'medium',
      })),
      spendingPriorities: allPriorities.slice(0, 20).map(({ agency, priority }) => ({
        agency,
        priority,
        fundingStatus: (/\$[\d.]+[BMK]/i.test(priority) ? 'funded' : 'planned') as 'funded' | 'planned',
        actionItem: scorePriorityRelevance(priority) === 'high'
          ? `High relevance to NAICS ${userNaics} — pursue actively`
          : scorePriorityRelevance(priority) === 'medium'
          ? `Moderate relevance — explore alignment with your capabilities`
          : `Monitor for opportunities as they develop`,
        naicsRelevance: scorePriorityRelevance(priority),
      })),
      highOpportunityMatches: highOpportunityMatches.slice(0, 15),
      summary: {
        totalPainPoints: allPainPoints.length,
        totalSpendingPriorities: allPriorities.length,
        highPriority: allPainPoints.filter(pp =>
          pp.painPoint.toLowerCase().includes('ndaa') ||
          pp.painPoint.toLowerCase().includes('critical')
        ).length,
        fundedPriorities: allPriorities.filter(pr =>
          /\$[\d.]+[BMK]/i.test(pr.priority)
        ).length,
        highOpportunityMatches: highOpportunityMatches.length,
        naicsRelevantPriorities: naicsRelevantPriorities.length,
      },
      recommendations: [
        highOpportunityMatches.length > 0
          ? `${highOpportunityMatches.length} high-opportunity matches found — agencies with BOTH a problem AND a funded priority in the same area`
          : 'Cross-reference pain points with spending priorities to find funded opportunities',
        naicsRelevantPriorities.length > 0
          ? `${naicsRelevantPriorities.length} spending priorities align with your NAICS ${userNaics} capabilities`
          : 'Review spending priorities for alignment with your capabilities',
        'Target funded priorities (marked with $) — these have allocated budgets ready to spend',
        'Reference pain points in capability statements and SBLO conversations',
        'Highlight NDAA-related items for strategic positioning in proposals',
        'Focus on high-opportunity matches first — these represent the strongest pursuit targets',
      ],
    };

    // Generate Government Buyers Report using real USAspending data with enhanced command info
    const governmentBuyersReport = selectedAgencyData && selectedAgencyData.length > 0
      ? (() => {
          const agenciesWithCommandInfo = selectedAgencyData.map((agency) => {
            // Get enhanced command info for all agencies (DoD and Civilian)
            const commandInfo = getEnhancedAgencyInfo(
              agency.contractingOffice || agency.name,
              agency.subAgency || '',
              agency.parentAgency || '',
              agency.command
            );

            // Use OSBP from agency if available (from expanded DOD agencies), otherwise from command lookup
            const osbpContact = agency.osbp || commandInfo?.smallBusinessContact || null;

            // Debug: Log civilian agencies without OSBP
            if (!osbpContact && agency.parentAgency && !agency.parentAgency.includes('Defense')) {
              console.log(`⚠️ No OSBP for civilian agency: "${agency.contractingOffice}" | sub: "${agency.subAgency}" | parent: "${agency.parentAgency}"`);
            }

            return {
              contractingOffice: agency.contractingOffice || agency.name,
              subAgency: agency.subAgency || agency.name,
              parentAgency: agency.parentAgency,
              hasSpecificOffice: agency.hasSpecificOffice ?? false,
              spending: agency.setAsideSpending,
              contractCount: agency.contractCount,
              officeId: agency.officeId || agency.id,
              subAgencyCode: agency.subAgencyCode || '',
              contactStrategy: osbpContact
                ? `Contact ${osbpContact.director} at ${osbpContact.email}`
                : 'Contact the Office of Small Business Programs (OSBP)',
              location: agency.location || 'Unknown',
              // Enhanced command info
              command: agency.command || commandInfo?.command || null,
              website: agency.website || commandInfo?.website || null,
              forecastUrl: agency.forecastUrl || commandInfo?.forecastUrl || null,
              samForecastUrl: agency.samForecastUrl || commandInfo?.samForecastUrl || null,
              osbp: osbpContact,
            };
          });

          // Count how many have command-level data
          const commandEnhancedCount = agenciesWithCommandInfo.filter(a => a.command).length;

          return {
            agencies: agenciesWithCommandInfo,
            summary: {
              totalAgencies: selectedAgencyData.length,
              totalSpending: selectedAgencyData.reduce((sum, a) => sum + a.setAsideSpending, 0),
              totalContracts: selectedAgencyData.reduce((sum, a) => sum + a.contractCount, 0),
              commandEnhancedAgencies: commandEnhancedCount,
            },
            recommendations: [
              commandEnhancedCount > 0
                ? `${commandEnhancedCount} agencies have command-specific OSBP contacts - use these direct lines`
                : 'Contact the Office of Small Business Programs (OSBP) at each agency',
              'Use the provided forecast URLs to monitor upcoming opportunities',
              'Visit command websites for industry day announcements',
              'Attend industry days and networking events',
              'Register in SAM.gov and agency-specific vendor databases',
              'Prepare tailored capability statements for each agency',
            ],
          };
        })()
      : {
          // Fallback to mock data if agency data not provided (backward compatibility)
          agencies: selectedAgencies.map((agencyName, idx) => ({
            contractingOffice: agencyName,
            subAgency: agencyName,
            parentAgency: agencyName.includes('Department') ? agencyName.split(' ')[0] + ' ' + agencyName.split(' ')[1] : agencyName,
            spending: 10000000 + idx * 1000000,
            contractCount: 50 + idx * 10,
            officeId: `OFF${idx + 1}`,
            subAgencyCode: '',
            contactStrategy: 'Contact the Office of Small Business Programs (OSBP)',
            location: 'Washington, DC',
            command: null,
            website: null,
            forecastUrl: null,
            samForecastUrl: null,
            osbp: null,
          })),
          summary: {
            totalAgencies: selectedAgencies.length,
            totalSpending: selectedAgencies.length * 15000000,
            totalContracts: selectedAgencies.length * 75,
            commandEnhancedAgencies: 0,
          },
          recommendations: [
            'Contact the Office of Small Business Programs (OSBP) at each agency to introduce your capabilities',
            'Attend industry days and networking events',
            'Register in SAM.gov and agency-specific vendor databases',
            'Prepare tailored capability statements for each agency',
          ],
        };

    // Generate Forecast List Report using agency forecasts database with command-specific URLs
    const forecastListReport = (() => {
      // Get forecasts for selected agencies, filtered by NAICS and business type
      const allForecasts = getForecastsForSelectedAgencies(
        selectedAgencies,
        inputs.naicsCode,
        inputs.businessType
      );

      // Get upcoming forecasts
      const upcomingForecasts = getUpcomingForecasts(allForecasts, 20);

      // Calculate statistics
      const stats = getForecastStatistics(upcomingForecasts);

      // Generate agency-specific forecast resources from command info
      const agencyForecastResources: Array<{ command: string; forecastUrl: string; samForecastUrl: string }> = [];

      if (selectedAgencyData && selectedAgencyData.length > 0) {
        const seenCommands = new Set<string>();

        selectedAgencyData
          .filter(a => isDoDAgency(a.parentAgency || ''))
          .forEach(a => {
            const info = getEnhancedAgencyInfo(
              a.contractingOffice || a.name,
              a.subAgency || '',
              a.parentAgency || '',
              a.command
            );

            const commandKey = info.command || a.subAgency || a.parentAgency || '';
            if (info.forecastUrl && !seenCommands.has(commandKey)) {
              seenCommands.add(commandKey);
              agencyForecastResources.push({
                command: commandKey,
                forecastUrl: info.forecastUrl,
                samForecastUrl: info.samForecastUrl,
              });
            }
          });
      }

      return {
        forecasts: upcomingForecasts.map(forecast => ({
          agency: forecast.agency,
          quarter: forecast.quarter,
          estimatedValue: forecast.estimatedValue,
          solicitationDate: forecast.solicitationDate,
          description: `${forecast.title} - ${forecast.description.substring(0, 150)}...`,
          naicsCode: forecast.naicsCode,
          contractType: forecast.contractType,
          setAside: forecast.setAside,
        })),
        // Command-specific forecast resources
        forecastResources: agencyForecastResources,
        summary: {
          totalForecasts: stats.totalForecasts,
          totalValue: stats.totalValue,
          forecastSources: agencyForecastResources.length,
        },
        recommendations: [
          agencyForecastResources.length > 0
            ? `${agencyForecastResources.length} command-specific forecast sources available - check these for the latest opportunities`
            : 'Monitor solicitation dates and prepare proposals in advance',
          'Review forecast details for NAICS codes matching your capabilities',
          'Contact agency points of contact for additional information',
          'Check agency forecast websites quarterly for updates and changes',
          'Prepare capability statements tailored to forecasted opportunities',
        ],
      };
    })();

    const report: ComprehensiveReport = {
      governmentBuyers: governmentBuyersReport,
      tier2Subcontracting,
      forecastList: forecastListReport,
      agencyNeeds: (() => {
        // Use command-level data if available, otherwise fall back to basic agency names
        let needs;
        if (selectedAgencyData && selectedAgencyData.length > 0) {
          // Enhanced: Use command-level pain points for more specific matching
          needs = generateAgencyNeedsWithCommands(
            selectedAgencyData.map(a => ({
              name: a.name,
              contractingOffice: a.contractingOffice,
              subAgency: a.subAgency,
              parentAgency: a.parentAgency,
              command: a.command,
            })),
            {
              naicsCode: inputs.naicsCode,
              businessType: inputs.businessType,
              goodsOrServices: inputs.goodsOrServices,
            }
          );
        } else {
          // Fallback: Use basic agency names
          needs = generateAgencyNeeds(selectedAgencies, {
            naicsCode: inputs.naicsCode,
            businessType: inputs.businessType,
            goodsOrServices: inputs.goodsOrServices,
          });
        }

        const totalNeeds = needs.length;
        const matchedNeeds = needs.filter(n =>
          n.capabilityMatch !== 'General capabilities align with agency needs'
        ).length;
        const matchRate = totalNeeds > 0 ? Math.round((matchedNeeds / totalNeeds) * 100) : 0;

        // Count how many have command-level pain points
        const commandLevelNeeds = needs.filter((n: any) => n.painPointSource && n.painPointSource !== n.agency).length;

        return {
          needs: needs.slice(0, 20), // Top 20 needs
          summary: {
            totalNeeds,
            matchRate,
          },
          recommendations: [
            commandLevelNeeds > 0 ? `${commandLevelNeeds} needs matched to specific DoD commands for targeted positioning` : 'Focus on NDAA-related needs for strategic positioning',
            'Prioritize needs with strong capability matches',
            'Develop capability statements addressing specific agency requirements',
            'Reference agency needs in SBLO conversations and proposals',
            'Track agency needs alignment with your solution development roadmap',
          ],
        };
      })(),
      agencyPainPoints,
      decemberSpend: (() => {
        const decemberOpportunities = getOpportunitiesByCoreInputs(inputs, selectedAgencies);
        
        return {
          opportunities: decemberOpportunities.slice(0, 20).map(opp => ({
            agency: opp.agency,
            estimatedQ4Spend: opp.unobligatedBalanceAmount || 0,
            urgencyLevel: getUrgencyLevel(opp),
            quickWinStrategy: getQuickWinStrategy(opp, inputs),
            program: opp.program,
            primeContractor: opp.primeContractor || opp.prime_contractor || '',
            sbloContact: (opp.sbloEmail || opp.sblo_email)
              ? {
                  name: opp.sbloName || opp.sblo_name || '',
                  email: opp.sbloEmail || opp.sblo_email || '',
                  phone: opp.sbloPhone || opp.sblo_phone || null,
                }
              : undefined,
            hotNaics: opp.hotNaics || opp.hot_naics || '',
          })),
          summary: {
            totalQ4Spend: decemberOpportunities.reduce((sum, opp) => 
              sum + (opp.unobligatedBalanceAmount || 0), 0
            ),
            urgentOpportunities: decemberOpportunities.filter(opp => 
              getUrgencyLevel(opp) === 'high'
            ).length,
          },
          recommendations: (() => {
            const month = new Date().toLocaleString('default', { month: 'long' });
            const isQ4 = [7, 8, 9].includes(new Date().getMonth()); // Jul-Sep = fiscal Q4
            const urgencyNote = isQ4
              ? `Contact SBLOs immediately - ${month} is "use it or lose it" season for unspent funds`
              : `Contact SBLOs now - agencies are planning ${month} acquisitions`;
            return [
              urgencyNote,
              'Focus on opportunities with high unobligated balances',
              'Prepare quick-turnaround capability statements',
              'Emphasize your set-aside certifications for fast-track opportunities',
              'Request 15-minute intro calls this week',
              'Monitor SAM.gov daily for new postings',
            ];
          })(),
        };
      })(),
      tribalContracting,
      primeContractor,
      idvContracts: await (async () => {
        try {
          const idvResult = await searchIDVContracts({
            naicsCode: inputs.naicsCode,
            pscCode: inputs.pscCode,  // Pass PSC code for filtering
            minValue: 1000000, // $1M+ for meaningful IDV contracts
            limit: 50
          });

          // Generate search context for recommendations
          const searchContext = inputs.pscCode && inputs.naicsCode
            ? `NAICS ${inputs.naicsCode} and PSC ${inputs.pscCode}`
            : inputs.pscCode
            ? `PSC ${inputs.pscCode}`
            : inputs.naicsCode
            ? `NAICS ${inputs.naicsCode}`
            : 'your industry';

          return {
            contracts: idvResult.contracts,
            summary: {
              totalContracts: idvResult.contracts.length,
              totalValue: idvResult.contracts.reduce((sum, c) => sum + c.awardAmount, 0),
              uniquePrimes: new Set(idvResult.contracts.map(c => c.recipientName)).size,
            },
            recommendations: [
              `These contracts match ${searchContext} - contact primes for subcontracting`,
              'Contact the SBLO (Small Business Liaison Officer) at each prime contractor',
              'Focus on IDVs with 1-2 years remaining - they need to meet subcontracting goals',
              'Register in prime contractor supplier portals (many have them)',
              'Prepare a strong capability statement highlighting your certifications',
              'Large primes are required to subcontract with small businesses - use this leverage',
            ],
          };
        } catch (error) {
          console.error('Error fetching IDV contracts:', error);
          return {
            contracts: [],
            summary: {
              totalContracts: 0,
              totalValue: 0,
              uniquePrimes: 0,
            },
            recommendations: [
              'IDV contract data temporarily unavailable',
              'Try refreshing the report later',
            ],
          };
        }
      })(),
      metadata: {
        generatedAt: new Date().toISOString(),
        inputs,
        selectedAgencies,
        totalAgencies: selectedAgencies.length,
        userEmail: userEmail || undefined,
      },
    };

    return NextResponse.json({
      success: true,
      report,
    });
  } catch (error) {
    console.error('Error generating reports:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate reports' },
      { status: 500 }
    );
  }
}
