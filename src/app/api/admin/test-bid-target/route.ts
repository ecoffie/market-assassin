/**
 * Admin: Send a test Bid Target email
 *
 * GET /api/admin/test-bid-target?password=...&email=user@example.com
 *
 * Fetches opportunities from SAM.gov, scores them, generates a Bid Target email,
 * and sends it to the specified email address.
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateBidTargetEmail, BidTargetEmailData, BidTargetOpportunity } from '@/lib/briefings/delivery/bid-target-email-template';
import { calculateBidScore, generateWinReasons, generateActionSteps } from '@/lib/briefings/win-probability';
import { sendEmail } from '@/lib/send-email';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';
const SAM_API_KEY = process.env.SAM_API_KEY;

interface SamOpportunity {
  noticeId: string;
  title: string;
  fullParentPathName?: string;
  naicsCode?: string;
  type?: {
    value: string;
  };
  typeOfSetAsideDescription?: string;
  award?: {
    amount?: number;
  };
  responseDeadLine?: string;
  postedDate?: string;
  uiLink?: string;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const email = searchParams.get('email')?.toLowerCase().trim();
  const naics = searchParams.get('naics') || '541512';

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!email) {
    return NextResponse.json({ error: 'Email required (?email=...)' }, { status: 400 });
  }

  if (!SAM_API_KEY) {
    return NextResponse.json({ error: 'SAM_API_KEY not configured' }, { status: 500 });
  }

  try {
    // Fetch opportunities from SAM.gov
    const today = new Date();
    const postedFrom = new Date(today);
    postedFrom.setDate(postedFrom.getDate() - 30);

    const formatDate = (d: Date) => {
      return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
    };

    const samUrl = `https://api.sam.gov/opportunities/v2/search?api_key=${SAM_API_KEY}&limit=20&postedFrom=${formatDate(postedFrom)}&postedTo=${formatDate(today)}&ncode=${naics}&ptype=p,r,k,o,s`;

    console.log(`[TestBidTarget] Fetching from SAM.gov for NAICS ${naics}...`);

    const samResponse = await fetch(samUrl, {
      headers: { 'Accept': 'application/json' },
    });

    if (!samResponse.ok) {
      return NextResponse.json({
        error: 'SAM.gov API error',
        status: samResponse.status,
        statusText: samResponse.statusText
      }, { status: 500 });
    }

    const samData = await samResponse.json();
    const opportunities: SamOpportunity[] = samData.opportunitiesData || [];

    if (opportunities.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'No opportunities found for this NAICS code',
        naics,
        hint: 'Try a different NAICS code like 541611 or 541330'
      });
    }

    // Mock user profile for generating win reasons
    const mockProfile = {
      naicsCodes: [naics],
      setAsides: ['8(a)', 'SDVOSB', 'WOSB'],
      maxContractSize: 5000000,
    };

    // Convert SAM opportunities to BidTargetOpportunity format and score them
    const scoredOpps: (BidTargetOpportunity & { rawScore: number })[] = opportunities.map((opp) => {
      const closeDate = opp.responseDeadLine ? new Date(opp.responseDeadLine) : new Date();
      const daysLeft = Math.max(1, Math.ceil((closeDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));

      // Estimate value from award amount or set a default
      const value = opp.award?.amount
        ? `$${(opp.award.amount / 1000000).toFixed(1)}M`
        : '$250K - $1M';

      const bidScore = calculateBidScore({
        naicsCode: opp.naicsCode || '',
        setAside: opp.typeOfSetAsideDescription || '',
        amount: opp.award?.amount || 500000,
        responseDeadline: closeDate,
        title: opp.title || '',
      }, null);

      // Pass null for profile - will return generic message
      const winReasons = generateWinReasons({
        naicsCode: opp.naicsCode || '',
        setAside: opp.typeOfSetAsideDescription || '',
        amount: opp.award?.amount || 500000,
        responseDeadline: closeDate,
        title: opp.title || '',
      }, null, bidScore);

      const actionSteps = generateActionSteps({
        naicsCode: opp.naicsCode || '',
        setAside: opp.typeOfSetAsideDescription || '',
        amount: opp.award?.amount || 500000,
        responseDeadline: closeDate,
        title: opp.title || '',
        agency: opp.fullParentPathName || '',
        samLink: opp.uiLink || `https://sam.gov/opp/${opp.noticeId}`,
      }, null);

      return {
        title: opp.title || 'Untitled Opportunity',
        agency: opp.fullParentPathName || 'Federal Agency',
        value,
        daysLeft,
        closeDate: closeDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        naicsCode: opp.naicsCode || naics,
        setAside: opp.typeOfSetAsideDescription || 'Full & Open',
        noticeType: opp.type?.value || 'Combined Synopsis/Solicitation',
        samLink: opp.uiLink || `https://sam.gov/opp/${opp.noticeId}`,
        bidScore: bidScore.score,
        winReasons,
        actionSteps,
        rawScore: bidScore.score,
      };
    });

    // Sort by score and pick top ones
    scoredOpps.sort((a, b) => b.rawScore - a.rawScore);

    const bidTarget = scoredOpps[0];
    const alsoOnRadar = scoredOpps.slice(1, 4);

    // Extract first name from email
    const emailPrefix = email.split('@')[0].replace(/[._-]/g, ' ').split(' ')[0];
    const userName = emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1);

    // Generate email
    const bidTargetData: BidTargetEmailData = {
      userName,
      userEmail: email,
      briefingDate: today.toISOString().split('T')[0],
      bidTarget,
      alsoOnRadar,
    };

    const emailContent = generateBidTargetEmail(bidTargetData);

    // Send email
    console.log(`[TestBidTarget] Sending email to ${email}...`);

    const sendResult = await sendEmail({
      to: email,
      subject: emailContent.subject,
      html: emailContent.htmlBody,
      text: emailContent.textBody,
    });

    return NextResponse.json({
      success: true,
      email,
      subject: emailContent.subject,
      bidTarget: {
        title: bidTarget.title,
        agency: bidTarget.agency,
        score: bidTarget.bidScore,
        daysLeft: bidTarget.daysLeft,
        winReasons: bidTarget.winReasons,
      },
      alsoOnRadar: alsoOnRadar.map(o => ({
        title: o.title,
        score: o.bidScore,
      })),
      totalOpportunities: opportunities.length,
      sendResult,
      message: 'Bid Target email sent! Check your inbox.',
    });

  } catch (err) {
    console.error('[TestBidTarget] Error:', err);
    return NextResponse.json({
      success: false,
      error: String(err),
      email,
    }, { status: 500 });
  }
}
