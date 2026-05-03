/**
 * Sample Opportunities Picker API
 *
 * This API helps users calibrate their profile by showing them REAL opportunities
 * from our cached database, letting them pick relevant ones, and extracting
 * patterns (NAICS, PSC, keywords, agencies) from their selections.
 *
 * POST /api/sample-opportunities
 * - description: User's business description (used for initial search)
 * - email: User's email (for storing business intelligence)
 * - Returns: 30 diverse sample opportunities
 *
 * POST /api/sample-opportunities { action: 'extract', selectedIds: [...], email: '...' }
 * - selectedIds: Array of notice_ids the user picked as relevant
 * - email: User's email (for storing extracted profile)
 * - Returns: Extracted NAICS codes, PSC codes, keywords, agencies
 *
 * BUSINESS INTELLIGENCE: Stores description and extracted profile to user_business_profiles
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Helper to store business intelligence
async function storeBusinessIntelligence(
  supabase: SupabaseClient,
  email: string,
  data: {
    businessDescription?: string;
    extractedProfile?: ExtractedProfile;
    opportunitiesShown?: number;
    opportunitiesSelected?: number;
    selectedOpportunityIds?: string[];
  }
): Promise<void> {
  if (!email) return;

  try {
    const updates: Record<string, unknown> = {
      user_email: email.toLowerCase().trim(),
      updated_at: new Date().toISOString(),
    };

    if (data.businessDescription) {
      updates.business_description = data.businessDescription;
      updates.business_description_updated_at = new Date().toISOString();
    }

    if (data.extractedProfile) {
      updates.extracted_naics_codes = data.extractedProfile.naicsCodes;
      updates.extracted_psc_codes = data.extractedProfile.pscCodes;
      updates.extracted_keywords = data.extractedProfile.keywords;
      updates.extracted_agencies = data.extractedProfile.agencies;
      // Note: set-asides removed - users select their own SB status
      updates.calibration_completed_at = new Date().toISOString();
    }

    if (data.opportunitiesShown !== undefined) {
      updates.opportunities_shown = data.opportunitiesShown;
    }

    if (data.opportunitiesSelected !== undefined) {
      updates.opportunities_selected = data.opportunitiesSelected;
    }

    if (data.selectedOpportunityIds) {
      updates.selected_opportunity_ids = data.selectedOpportunityIds;
    }

    await supabase
      .from('user_business_profiles')
      .upsert(updates, { onConflict: 'user_email' });

    console.log(`[sample-opportunities] Stored business intel for ${email}`);
  } catch (err) {
    // Don't fail the main flow if storage fails
    console.error('[sample-opportunities] Failed to store business intel:', err);
  }
}

interface SampleOpportunity {
  notice_id: string;
  title: string;
  description?: string | null;
  department: string;
  naics_code: string;
  psc_code: string;
  set_aside_description: string | null;
  notice_type: string;
  response_deadline: string | null;
  ui_link: string;
  pop_state?: string | null;
}

interface ExtractedProfile {
  naicsCodes: Array<{ code: string; name: string; count: number }>;
  pscCodes: Array<{ code: string; count: number }>;
  keywords: string[];
  agencies: Array<{ name: string; count: number }>;
}

// Common words to exclude from keyword extraction
const STOP_WORDS = new Set([
  'the', 'and', 'or', 'for', 'of', 'to', 'in', 'a', 'an', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before',
  'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once',
  'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
  'than', 'too', 'very', 'just', 'also', 'now', 'services', 'service', 'support',
  'based', 'including', 'includes', 'provide', 'provides', 'providing', 'required',
  'requirements', 'requirement', 'contract', 'contractor', 'contractors', 'federal',
  'government', 'agency', 'agencies', 'department', 'office', 'various', 'multiple',
  'per', 'via', 'within', 'without', 'upon', 'about', 'over', 'under', 'any', 'both'
]);

// NAICS code names reference
const NAICS_NAMES: Record<string, string> = {
  '236115': 'New Single-Family Housing Construction',
  '236116': 'New Multifamily Housing Construction',
  '236210': 'Industrial Building Construction',
  '236220': 'Commercial and Institutional Building Construction',
  '237110': 'Water and Sewer Line Construction',
  '237130': 'Power and Communication Line Construction',
  '237310': 'Highway, Street, and Bridge Construction',
  '238210': 'Electrical Contractors',
  '238220': 'Plumbing, Heating, and AC Contractors',
  '238160': 'Roofing Contractors',
  '238910': 'Site Preparation Contractors',
  '541511': 'Custom Computer Programming Services',
  '541512': 'Computer Systems Design Services',
  '541513': 'Computer Facilities Management Services',
  '541519': 'Other Computer Related Services',
  '518210': 'Data Processing, Hosting, and Related Services',
  '517110': 'Wired Telecommunications Carriers',
  '517210': 'Wireless Telecommunications Carriers',
  '541611': 'Administrative Management Consulting',
  '541612': 'Human Resources Consulting',
  '541613': 'Marketing Consulting',
  '541614': 'Process and Logistics Consulting',
  '541618': 'Other Management Consulting',
  '541620': 'Environmental Consulting',
  '541690': 'Other Scientific and Technical Consulting',
  '541990': 'All Other Professional Services',
  '541310': 'Architectural Services',
  '541320': 'Landscape Architectural Services',
  '541330': 'Engineering Services',
  '541340': 'Drafting Services',
  '541350': 'Building Inspection Services',
  '541380': 'Testing Laboratories',
  '541711': 'Biotechnology R&D',
  '541712': 'Physical, Engineering, and Life Sciences R&D',
  '541715': 'Social Sciences and Humanities R&D',
  '561110': 'Office Administrative Services',
  '561210': 'Facilities Support Services',
  '561320': 'Temporary Help Services',
  '561330': 'Professional Employer Organizations',
  '561410': 'Document Preparation Services',
  '561499': 'All Other Business Support Services',
  '561710': 'Exterminating and Pest Control Services',
  '561720': 'Janitorial Services',
  '561730': 'Landscaping Services',
  '561790': 'Other Services to Buildings',
  '621111': 'Offices of Physicians',
  '621210': 'Offices of Dentists',
  '621310': 'Offices of Chiropractors',
  '621399': 'Offices of Misc Health Practitioners',
  '621410': 'Family Planning Centers',
  '621420': 'Outpatient Mental Health Centers',
  '621491': 'HMO Medical Centers',
  '621511': 'Medical Laboratories',
  '621512': 'Diagnostic Imaging Centers',
  '484110': 'General Freight Trucking, Local',
  '484121': 'General Freight Trucking, Long-Distance',
  '484122': 'General Freight Trucking, LTL',
  '493110': 'General Warehousing and Storage',
  '493120': 'Refrigerated Warehousing and Storage',
  '488510': 'Freight Transportation Arrangement',
  '611310': 'Colleges, Universities, Professional Schools',
  '611420': 'Computer Training',
  '611430': 'Professional and Management Training',
  '611519': 'Other Technical and Trade Schools',
  '611710': 'Educational Support Services',
  '332710': 'Machine Shops',
  '332994': 'Small Arms Manufacturing',
  '334111': 'Electronic Computer Manufacturing',
  '334118': 'Computer Peripheral Equipment Manufacturing',
  '334511': 'Navigation and Guidance Systems',
  '334516': 'Analytical Laboratory Instruments',
  '336411': 'Aircraft Manufacturing',
  '336412': 'Aircraft Engine Parts Manufacturing',
  '336414': 'Guided Missile and Space Vehicle Manufacturing',
};

const SAMPLE_SELECT_FIELDS = 'notice_id, title, description, department, naics_code, psc_code, set_aside_description, notice_type, response_deadline, ui_link, pop_state';

const INDUSTRY_HINTS: Array<{
  codes: string[];
  prefixes?: string[];
  patterns: RegExp[];
  terms: string[];
}> = [
  {
    codes: ['238160'],
    prefixes: ['238'],
    patterns: [/\broof(?:er|ers|ing)?\b/i, /\bshingle(?:s)?\b/i, /\bwaterproofing\b/i, /\bgutter(?:s)?\b/i],
    terms: ['roof', 'roofing', 'roofer', 'shingle', 'waterproofing', 'gutter'],
  },
  {
    codes: ['236220'],
    prefixes: ['236', '237', '238'],
    patterns: [/\bconstruction\b/i, /\bcontractor(?:s)?\b/i, /\brenovation\b/i, /\bbuilding\b/i],
    terms: ['construction', 'contractor', 'renovation', 'building'],
  },
  {
    codes: ['541512', '541511', '541519', '518210'],
    patterns: [/\bcyber(?:security)?\b/i, /\bsoftware\b/i, /\bcloud\b/i, /\bit\b/i, /\binformation technology\b/i],
    terms: ['cyber', 'cybersecurity', 'software', 'cloud', 'technology'],
  },
  {
    codes: ['561720', '561210', '561730', '561790'],
    patterns: [/\bjanitorial\b/i, /\bfacilit(?:y|ies)\b/i, /\bmaintenance\b/i, /\blandscap(?:e|ing)\b/i],
    terms: ['janitorial', 'facility', 'facilities', 'maintenance', 'landscaping'],
  },
];

const STATE_HINTS: Record<string, string> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  rhode: 'RI',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  wisconsin: 'WI',
  wyoming: 'WY',
  'washington dc': 'DC',
  dc: 'DC',
};

function inferSearchProfile(description: string) {
  const normalized = description.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const exactCodes = new Set<string>();
  const prefixes = new Set<string>();
  const terms = new Set<string>();

  const explicitCodes = normalized.match(/\b\d{3,6}\b/g) || [];
  for (const code of explicitCodes) {
    exactCodes.add(code);
  }

  for (const hint of INDUSTRY_HINTS) {
    if (hint.patterns.some(pattern => pattern.test(normalized))) {
      hint.codes.forEach(code => exactCodes.add(code));
      hint.prefixes?.forEach(prefix => prefixes.add(prefix));
      hint.terms.forEach(term => terms.add(term));
    }
  }

  const keywords = normalized
    .split(/\s+/)
    .map(word => {
      if (word === 'roofer' || word === 'roofers' || word === 'roofing') return 'roof';
      return word;
    })
    .filter(word => word.length > 3 && !STOP_WORDS.has(word));

  keywords.slice(0, 6).forEach(word => terms.add(word));

  const states = new Set<string>();
  for (const [name, code] of Object.entries(STATE_HINTS)) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(normalized)) {
      states.add(code);
    }
  }

  return {
    exactCodes: Array.from(exactCodes),
    prefixes: Array.from(prefixes),
    terms: Array.from(terms).slice(0, 8),
    states: Array.from(states),
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json();
  const email = body.email || '';

  // Save-only request from onboarding/settings flows.
  // This keeps the free-text business description in the same runtime field used
  // by alerts and briefings matching, without requiring the sample picker flow.
  if (body.action === 'save_profile') {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({
        success: false,
        error: 'Database not configured',
      }, { status: 500 });
    }

    if (!email) {
      return NextResponse.json({
        success: false,
        error: 'Email is required',
      }, { status: 400 });
    }

    const businessDescription = String(body.businessDescription || '').trim();
    const supabase = createClient(supabaseUrl, supabaseKey);
    await storeBusinessIntelligence(supabase, email, {
      businessDescription,
      opportunitiesShown: 0,
      opportunitiesSelected: 0,
    });

    return NextResponse.json({
      success: true,
      businessDescriptionSaved: Boolean(businessDescription),
    });
  }

  // Check if this is an extraction request
  if (body.action === 'extract') {
    return handleExtraction(body.selectedIds || [], email);
  }

  // Otherwise, it's a sample request
  return handleSampleSearch(body.description || '', email);
}

async function handleSampleSearch(description: string, email?: string): Promise<NextResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({
      success: false,
      error: 'Database not configured',
      opportunities: [],
    }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Store the business description if provided
  if (email && description) {
    await storeBusinessIntelligence(supabase, email, {
      businessDescription: description,
    });
  }

  try {
    const searchProfile = inferSearchProfile(description);
    const samples: SampleOpportunity[] = [];
    const seenIds = new Set<string>();

    const addSamples = (items: SampleOpportunity[] | null) => {
      if (!items) return;
      for (const opp of items) {
        if (!seenIds.has(opp.notice_id)) {
          seenIds.add(opp.notice_id);
          samples.push(opp);
        }
      }
    };

    // 1. Pull exact inferred NAICS matches first. For "roofer", this means 238160.
    if (searchProfile.exactCodes.length > 0) {
      let exactQuery = supabase
        .from('sam_opportunities')
        .select(SAMPLE_SELECT_FIELDS)
        .in('naics_code', searchProfile.exactCodes)
        .eq('active', true)
        .order('posted_date', { ascending: false })
        .limit(30);

      if (searchProfile.states.length > 0) {
        exactQuery = exactQuery.in('pop_state', searchProfile.states);
      }

      const { data: exactStateMatches } = await exactQuery;
      addSamples(exactStateMatches as SampleOpportunity[] | null);

      if (samples.length < 12 && searchProfile.states.length > 0) {
        const { data: exactNationwideMatches } = await supabase
          .from('sam_opportunities')
          .select(SAMPLE_SELECT_FIELDS)
          .in('naics_code', searchProfile.exactCodes)
          .eq('active', true)
          .order('posted_date', { ascending: false })
          .limit(30);
        addSamples(exactNationwideMatches as SampleOpportunity[] | null);
      }
    }

    // 2. Search title/description terms so mislabeled SAM records can still surface.
    if (searchProfile.terms.length > 0) {
      for (const term of searchProfile.terms.slice(0, 5)) {
        const { data } = await supabase
          .from('sam_opportunities')
          .select(SAMPLE_SELECT_FIELDS)
          .or(`title.ilike.%${term}%,description.ilike.%${term}%`)
          .eq('active', true)
          .order('posted_date', { ascending: false })
          .limit(12);

        addSamples(data as SampleOpportunity[] | null);
      }
    }

    // 3. Use inferred NAICS prefixes as the next fallback before unrelated industries.
    if (samples.length < 24 && searchProfile.prefixes.length > 0) {
      for (const prefix of searchProfile.prefixes.slice(0, 3)) {
        let prefixQuery = supabase
          .from('sam_opportunities')
          .select(SAMPLE_SELECT_FIELDS)
          .like('naics_code', `${prefix}%`)
          .eq('active', true)
          .order('posted_date', { ascending: false })
          .limit(20);

        if (searchProfile.states.length > 0) {
          prefixQuery = prefixQuery.in('pop_state', searchProfile.states);
        }

        const { data: prefixStateMatches } = await prefixQuery;
        addSamples(prefixStateMatches as SampleOpportunity[] | null);

        if (samples.length >= 24) {
          break;
        }
      }
    }

    // 4. If the user gave no useful clues, provide a balanced starter set.
    if (samples.length < 12 && searchProfile.exactCodes.length === 0 && searchProfile.terms.length === 0) {
      const starterQueries = [
        { codes: ['541512', '541511', '541519', '518210'], limit: 6 },
        { prefix: '23', limit: 6 },
        { codes: ['541611', '541612', '541618', '541690'], limit: 6 },
        { codes: ['561720', '561210', '561730'], limit: 6 },
      ];

      for (const starter of starterQueries) {
        let query = supabase
          .from('sam_opportunities')
          .select(SAMPLE_SELECT_FIELDS)
          .eq('active', true)
          .order('posted_date', { ascending: false })
          .limit(starter.limit);

        if (starter.codes) {
          query = query.in('naics_code', starter.codes);
        } else if (starter.prefix) {
          query = query.like('naics_code', `${starter.prefix}%`);
        }

        const { data } = await query;
        addSamples(data as SampleOpportunity[] | null);
      }
    }

    // 5. Fill remaining space with recent records only after ranked matches.
    if (samples.length < 30) {
      const { data: recentOpps } = await supabase
        .from('sam_opportunities')
        .select(SAMPLE_SELECT_FIELDS)
        .eq('active', true)
        .order('posted_date', { ascending: false })
        .limit(50);

      addSamples(recentOpps as SampleOpportunity[] | null);
    }

    const scoreOpportunity = (opp: SampleOpportunity): number => {
      const text = `${opp.title || ''} ${opp.description || ''}`.toLowerCase();
      let score = 0;

      if (opp.naics_code && searchProfile.exactCodes.includes(opp.naics_code)) {
        score += 100;
      }

      if (opp.naics_code && searchProfile.prefixes.some(prefix => opp.naics_code.startsWith(prefix))) {
        score += 35;
      }

      for (const term of searchProfile.terms) {
        if (text.includes(term)) {
          score += 12;
        }
      }

      if (opp.pop_state && searchProfile.states.includes(opp.pop_state)) {
        score += 10;
      }

      if (opp.response_deadline && new Date(opp.response_deadline).getTime() > Date.now()) {
        score += 2;
      }

      return score;
    };

    const rankedSamples = samples
      .sort((a, b) => {
        const scoreDiff = scoreOpportunity(b) - scoreOpportunity(a);
        if (scoreDiff !== 0) return scoreDiff;
        const aDate = a.response_deadline ? new Date(a.response_deadline).getTime() : 0;
        const bDate = b.response_deadline ? new Date(b.response_deadline).getTime() : 0;
        return bDate - aDate;
      })
      .slice(0, 30);

    if (
      searchProfile.exactCodes.length > 0 &&
      !rankedSamples.some(opp => searchProfile.exactCodes.includes(opp.naics_code))
    ) {
      const code = searchProfile.exactCodes[0];
      rankedSamples.unshift({
        notice_id: `naics-reference-${code}`,
        title: `${NAICS_NAMES[code] || 'Recommended NAICS'} profile match`,
        description: 'No active SAM examples in the local cache matched this exact NAICS today, but this is the best classification for your description.',
        department: 'PROFILE MATCH',
        naics_code: code,
        psc_code: '',
        set_aside_description: null,
        notice_type: 'NAICS reference',
        response_deadline: null,
        ui_link: `https://sam.gov/search/?index=opp&naics=${code}`,
        pop_state: searchProfile.states[0] || null,
      });
      if (rankedSamples.length > 30) {
        rankedSamples.pop();
      }
    }

    // Store opportunities shown count
    if (email) {
      await storeBusinessIntelligence(supabase, email, {
        opportunitiesShown: rankedSamples.length,
      });
    }

    return NextResponse.json({
      success: true,
      count: rankedSamples.length,
      message: 'Select the opportunities that look relevant to your business. We\'ll use your selections to calibrate your profile.',
      inferredNaicsCodes: searchProfile.exactCodes,
      inferredStates: searchProfile.states,
      opportunities: rankedSamples,
    });

  } catch (error) {
    console.error('[sample-opportunities] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch sample opportunities',
      opportunities: [],
    }, { status: 500 });
  }
}

async function handleExtraction(selectedIds: string[], email: string): Promise<NextResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({
      success: false,
      error: 'Database not configured',
    }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    if (!selectedIds || selectedIds.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No opportunities selected',
      }, { status: 400 });
    }

    // Fetch full details of selected opportunities
    const { data: selectedOpps, error } = await supabase
      .from('sam_opportunities')
      .select('notice_id, title, department, naics_code, psc_code, set_aside_code, set_aside_description')
      .in('notice_id', selectedIds);

    if (error || !selectedOpps) {
      return NextResponse.json({
        success: false,
        error: 'Failed to fetch selected opportunities',
      }, { status: 500 });
    }

    // Extract patterns
    const naicsCount: Record<string, number> = {};
    const pscCount: Record<string, number> = {};
    const agencyCount: Record<string, number> = {};
    const allTitles: string[] = [];

    for (const selectedId of selectedIds) {
      const referenceMatch = selectedId.match(/^naics-reference-(\d{3,6})$/);
      if (referenceMatch) {
        const code = referenceMatch[1];
        naicsCount[code] = (naicsCount[code] || 0) + 1;
      }
    }

    for (const opp of selectedOpps) {
      // Count NAICS codes
      if (opp.naics_code) {
        naicsCount[opp.naics_code] = (naicsCount[opp.naics_code] || 0) + 1;
      }

      // Count PSC codes
      if (opp.psc_code) {
        pscCount[opp.psc_code] = (pscCount[opp.psc_code] || 0) + 1;
      }

      // Count agencies (extract first part of department name)
      if (opp.department) {
        const agency = opp.department.split(',')[0].trim();
        agencyCount[agency] = (agencyCount[agency] || 0) + 1;
      }

      // Note: Set-aside extraction removed - users select their own SB status

      // Collect titles for keyword extraction
      if (opp.title) {
        allTitles.push(opp.title);
      }
    }

    // Extract keywords from titles
    const wordCount: Record<string, number> = {};
    for (const title of allTitles) {
      const words = title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 3 && !STOP_WORDS.has(word));

      for (const word of words) {
        wordCount[word] = (wordCount[word] || 0) + 1;
      }
    }

    // Build result
    const naicsCodes = Object.entries(naicsCount)
      .map(([code, count]) => ({
        code,
        name: NAICS_NAMES[code] || 'Unknown',
        count,
      }))
      .sort((a, b) => b.count - a.count);

    const pscCodes = Object.entries(pscCount)
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count);

    const agencies = Object.entries(agencyCount)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // Get top keywords (appearing in at least 2 selections)
    const keywords = Object.entries(wordCount)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);

    const profile: ExtractedProfile = {
      naicsCodes,
      pscCodes,
      keywords,
      agencies,
    };

    // Store the extracted profile for business intelligence
    if (email) {
      await storeBusinessIntelligence(supabase, email, {
        extractedProfile: profile,
        opportunitiesSelected: selectedIds.length,
        selectedOpportunityIds: selectedIds,
      });
    }

    return NextResponse.json({
      success: true,
      selectedCount: selectedIds.length,
      extractedProfile: profile,
      message: 'Profile patterns extracted from your selections.',
      recommendation: buildRecommendation(profile),
    });

  } catch (error) {
    console.error('[sample-opportunities] Extraction error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to extract patterns',
    }, { status: 500 });
  }
}

function buildRecommendation(profile: ExtractedProfile): string {
  const parts: string[] = [];

  if (profile.naicsCodes.length > 0) {
    const topNaics = profile.naicsCodes.slice(0, 3).map(n => n.code).join(', ');
    parts.push(`Based on your selections, your top NAICS codes are: ${topNaics}`);
  }

  if (profile.keywords.length > 0) {
    const topKeywords = profile.keywords.slice(0, 5).join(', ');
    parts.push(`Key terms that appear frequently: ${topKeywords}`);
  }

  if (profile.agencies.length > 0) {
    const topAgencies = profile.agencies.slice(0, 2).map(a => a.name).join(' and ');
    parts.push(`You seem interested in opportunities from ${topAgencies}`);
  }

  return parts.join('. ') + '.';
}

// GET endpoint to fetch sample without description
export async function GET(): Promise<NextResponse> {
  // Just return diverse samples
  return handleSampleSearch('');
}
