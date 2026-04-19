/**
 * Sample Opportunities Picker API
 *
 * This API helps users calibrate their profile by showing them REAL opportunities
 * from our cached database, letting them pick relevant ones, and extracting
 * patterns (NAICS, PSC, keywords, agencies) from their selections.
 *
 * POST /api/sample-opportunities
 * - description: User's business description (used for initial search)
 * - Returns: 30 diverse sample opportunities
 *
 * POST /api/sample-opportunities { action: 'extract', selectedIds: [...] }
 * - selectedIds: Array of notice_ids the user picked as relevant
 * - Returns: Extracted NAICS codes, PSC codes, keywords, agencies
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface SampleOpportunity {
  notice_id: string;
  title: string;
  department: string;
  naics_code: string;
  psc_code: string;
  set_aside_description: string | null;
  notice_type: string;
  response_deadline: string | null;
  ui_link: string;
}

interface ExtractedProfile {
  naicsCodes: Array<{ code: string; name: string; count: number }>;
  pscCodes: Array<{ code: string; count: number }>;
  keywords: string[];
  agencies: Array<{ name: string; count: number }>;
  setAsides: Array<{ code: string; description: string; count: number }>;
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json();

  // Check if this is an extraction request
  if (body.action === 'extract') {
    return handleExtraction(body.selectedIds || []);
  }

  // Otherwise, it's a sample request
  return handleSampleSearch(body.description || '');
}

async function handleSampleSearch(description: string): Promise<NextResponse> {
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

  try {
    // Extract potential keywords from description
    const keywords = description
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 3 && !STOP_WORDS.has(word))
      .slice(0, 5);

    // Strategy: Get diverse samples from different angles
    const samples: SampleOpportunity[] = [];
    const seenIds = new Set<string>();

    // 1. If user provided description, search by keywords in title
    if (keywords.length > 0) {
      for (const keyword of keywords.slice(0, 3)) {
        const { data } = await supabase
          .from('sam_opportunities')
          .select('notice_id, title, department, naics_code, psc_code, set_aside_description, notice_type, response_deadline, ui_link')
          .ilike('title', `%${keyword}%`)
          .eq('active', true)
          .order('posted_date', { ascending: false })
          .limit(10);

        if (data) {
          for (const opp of data) {
            if (!seenIds.has(opp.notice_id)) {
              seenIds.add(opp.notice_id);
              samples.push(opp);
            }
          }
        }
      }
    }

    // 2. Get recent active opportunities across different industries
    // IT/Tech
    const { data: techOpps } = await supabase
      .from('sam_opportunities')
      .select('notice_id, title, department, naics_code, psc_code, set_aside_description, notice_type, response_deadline, ui_link')
      .in('naics_code', ['541512', '541511', '541519', '518210'])
      .eq('active', true)
      .order('posted_date', { ascending: false })
      .limit(8);

    if (techOpps) {
      for (const opp of techOpps) {
        if (!seenIds.has(opp.notice_id)) {
          seenIds.add(opp.notice_id);
          samples.push(opp);
        }
      }
    }

    // Construction
    const { data: constOpps } = await supabase
      .from('sam_opportunities')
      .select('notice_id, title, department, naics_code, psc_code, set_aside_description, notice_type, response_deadline, ui_link')
      .like('naics_code', '23%')
      .eq('active', true)
      .order('posted_date', { ascending: false })
      .limit(8);

    if (constOpps) {
      for (const opp of constOpps) {
        if (!seenIds.has(opp.notice_id)) {
          seenIds.add(opp.notice_id);
          samples.push(opp);
        }
      }
    }

    // Professional Services
    const { data: profOpps } = await supabase
      .from('sam_opportunities')
      .select('notice_id, title, department, naics_code, psc_code, set_aside_description, notice_type, response_deadline, ui_link')
      .in('naics_code', ['541611', '541612', '541618', '541690'])
      .eq('active', true)
      .order('posted_date', { ascending: false })
      .limit(8);

    if (profOpps) {
      for (const opp of profOpps) {
        if (!seenIds.has(opp.notice_id)) {
          seenIds.add(opp.notice_id);
          samples.push(opp);
        }
      }
    }

    // Engineering
    const { data: engOpps } = await supabase
      .from('sam_opportunities')
      .select('notice_id, title, department, naics_code, psc_code, set_aside_description, notice_type, response_deadline, ui_link')
      .in('naics_code', ['541330', '541310', '541712'])
      .eq('active', true)
      .order('posted_date', { ascending: false })
      .limit(8);

    if (engOpps) {
      for (const opp of engOpps) {
        if (!seenIds.has(opp.notice_id)) {
          seenIds.add(opp.notice_id);
          samples.push(opp);
        }
      }
    }

    // Facilities/Maintenance
    const { data: facOpps } = await supabase
      .from('sam_opportunities')
      .select('notice_id, title, department, naics_code, psc_code, set_aside_description, notice_type, response_deadline, ui_link')
      .in('naics_code', ['561720', '561210', '561730'])
      .eq('active', true)
      .order('posted_date', { ascending: false })
      .limit(8);

    if (facOpps) {
      for (const opp of facOpps) {
        if (!seenIds.has(opp.notice_id)) {
          seenIds.add(opp.notice_id);
          samples.push(opp);
        }
      }
    }

    // 3. If we still need more, get random recent ones
    if (samples.length < 30) {
      const { data: recentOpps } = await supabase
        .from('sam_opportunities')
        .select('notice_id, title, department, naics_code, psc_code, set_aside_description, notice_type, response_deadline, ui_link')
        .eq('active', true)
        .order('posted_date', { ascending: false })
        .limit(50);

      if (recentOpps) {
        // Shuffle and take what we need
        const shuffled = recentOpps.sort(() => Math.random() - 0.5);
        for (const opp of shuffled) {
          if (!seenIds.has(opp.notice_id) && samples.length < 30) {
            seenIds.add(opp.notice_id);
            samples.push(opp);
          }
        }
      }
    }

    // Shuffle final results for variety
    const shuffledSamples = samples.sort(() => Math.random() - 0.5).slice(0, 30);

    return NextResponse.json({
      success: true,
      count: shuffledSamples.length,
      message: 'Select the opportunities that look relevant to your business. We\'ll use your selections to calibrate your profile.',
      opportunities: shuffledSamples,
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

async function handleExtraction(selectedIds: string[]): Promise<NextResponse> {
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
    const setAsideCount: Record<string, { code: string; description: string; count: number }> = {};
    const allTitles: string[] = [];

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

      // Count set-asides
      if (opp.set_aside_code) {
        if (!setAsideCount[opp.set_aside_code]) {
          setAsideCount[opp.set_aside_code] = {
            code: opp.set_aside_code,
            description: opp.set_aside_description || opp.set_aside_code,
            count: 0,
          };
        }
        setAsideCount[opp.set_aside_code].count++;
      }

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

    const setAsides = Object.values(setAsideCount)
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
      setAsides,
    };

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

  if (profile.setAsides.length > 0) {
    const topSetAside = profile.setAsides[0].description;
    parts.push(`Most common set-aside: ${topSetAside}`);
  }

  return parts.join('. ') + '.';
}

// GET endpoint to fetch sample without description
export async function GET(): Promise<NextResponse> {
  // Just return diverse samples
  return handleSampleSearch('');
}
