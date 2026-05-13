/**
 * MI Growth Daily Brief Generator
 *
 * Transforms raw dashboard metrics into actionable daily brief
 * answering the 10 key questions from MI Operating System.
 *
 * GET /api/admin/generate-daily-brief?password=xxx
 * GET /api/admin/generate-daily-brief?password=xxx&format=slack (Slack-ready markdown)
 */

import { NextRequest, NextResponse } from 'next/server';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

interface DashboardData {
  timestamp: string;
  displayDate: string;
  emailOperations: {
    alerts: { sent: number; failed: number; skipped: number; successRate: string };
    briefings: { sent: number; failed: number; skipped: number; successRate: string; byType?: { daily: number; weekly: number; pursuit: number } };
  };
  userHealth: {
    totalUsers: number;
    naicsConfigured: number;
    naicsPercent: string;
    defaultNaicsOnly?: number;
    noNaics?: number;
    alertsEnabledTotal: number;
    briefingsEnabled: number;
    briefingsEntitled: number;
    briefingsCronEligible: number;
    briefingsProfileIncomplete: number;
  };
  betaHealth: {
    weeklyActiveUsers: number;
    dailyActiveUsers: number;
    dauWauRatio: string;
    activationRate7d: string;
    profileCompletionRate: string;
  };
  providerEmailHealth: {
    sends7d: number;
    delivered7d: number;
    opened7d: number;
    clicked7d: number;
    deliveryRate: string;
    clickRate: string;
    topLinks: Array<{ label: string; count: number }>;
  };
  miGrowth?: {
    acquisition: { signups: { current: number; previous: number; change: string } };
    audience: { totalUsers: number; activeAlerts: number; customProfiles: number; profileCompletionRate: string };
    app: { activeUsers: { current: number }; topAreas: Array<{ area: string; minutes: number; users: number }> };
  };
  outcomeMetrics?: {
    findContracts: { opportunityClicks: number; savedOpportunities: number; pursuitBriefsSent: number };
    winContracts: { pipelineItemsCreated: number; pursuing: number; bidding: number; submitted: number; won: number };
    experience: { helpfulRate: string; helpful: number; notHelpful: number };
  };
  matchingQuality: {
    helpfulRate: string;
    last7Days: { helpfulRate: string };
    usersNeedingAttention: number;
    repeatNegative: Array<{ email: string; count: number }>;
  };
  deadLetter: { pending: number; exhausted: number };
  revenue?: { available: boolean; thirtyDay?: { total: number; count: number } };
}

interface DecisionLever {
  priority: 'critical' | 'high' | 'medium' | 'low';
  signal: string;
  action: string;
  owner: string;
  metric?: string;
}

function generateBrief(data: DashboardData): {
  date: string;
  generatedAt: string;
  headline: string;
  healthScore: number;
  healthLabel: string;
  answers: Array<{ question: string; answer: string; status: 'good' | 'warning' | 'critical' | 'neutral' }>;
  levers: DecisionLever[];
  topPriority: string;
  slackSummary: string;
} {
  const answers: Array<{ question: string; answer: string; status: 'good' | 'warning' | 'critical' | 'neutral' }> = [];
  const levers: DecisionLever[] = [];

  // 1. How many users joined?
  const signups = data.miGrowth?.acquisition?.signups?.current ?? 0;
  const signupChange = data.miGrowth?.acquisition?.signups?.change ?? 'N/A';
  answers.push({
    question: '1. How many users joined?',
    answer: `${signups} new signups (${signupChange} vs prior period)`,
    status: signups > 10 ? 'good' : signups > 0 ? 'neutral' : 'warning',
  });

  // 2. How many activated?
  const activationRate = data.betaHealth?.activationRate7d ?? '0%';
  const activationNum = parseFloat(activationRate);
  answers.push({
    question: '2. How many activated?',
    answer: `${activationRate} activation rate (7-day)`,
    status: activationNum >= 50 ? 'good' : activationNum >= 30 ? 'neutral' : 'warning',
  });
  if (activationNum < 30) {
    levers.push({
      priority: 'high',
      signal: `Low activation rate: ${activationRate}`,
      action: 'Review onboarding flow, send welcome sequence reminder',
      owner: 'Product',
    });
  }

  // 3. How many completed profiles?
  const profileCompletion = data.betaHealth?.profileCompletionRate ?? data.miGrowth?.audience?.profileCompletionRate ?? '0%';
  const profileNum = parseFloat(profileCompletion);
  const incomplete = data.userHealth?.briefingsProfileIncomplete ?? 0;
  answers.push({
    question: '3. How many completed profiles?',
    answer: `${profileCompletion} profile completion rate (${incomplete} still incomplete)`,
    status: profileNum >= 70 ? 'good' : profileNum >= 50 ? 'neutral' : 'warning',
  });
  if (incomplete > 50) {
    levers.push({
      priority: 'high',
      signal: `${incomplete} users have incomplete profiles`,
      action: 'Run profile reminder batch from Quick Actions',
      owner: 'Ops',
      metric: `${incomplete} incomplete`,
    });
  }

  // 4. How many used MI?
  const dau = data.betaHealth?.dailyActiveUsers ?? 0;
  const wau = data.betaHealth?.weeklyActiveUsers ?? 0;
  const dauWau = data.betaHealth?.dauWauRatio ?? '0%';
  answers.push({
    question: '4. How many used MI?',
    answer: `${dau} daily / ${wau} weekly active users (DAU/WAU: ${dauWau})`,
    status: parseFloat(dauWau) >= 20 ? 'good' : parseFloat(dauWau) >= 10 ? 'neutral' : 'warning',
  });

  // 5. Where did they spend time?
  const topAreas = data.miGrowth?.app?.topAreas ?? [];
  const topArea = topAreas[0];
  answers.push({
    question: '5. Where did they spend time?',
    answer: topArea
      ? `Top area: ${topArea.area} (${topArea.users} users, ${topArea.minutes} min)`
      : 'No app activity data available',
    status: topAreas.length > 0 ? 'neutral' : 'warning',
  });

  // 6. Which emails drove action?
  const topLinks = data.providerEmailHealth?.topLinks ?? [];
  const clickRate = data.providerEmailHealth?.clickRate ?? '0%';
  const topLink = topLinks[0];
  answers.push({
    question: '6. Which emails drove action?',
    answer: topLink
      ? `Top link: "${topLink.label}" (${topLink.count} clicks). Overall click rate: ${clickRate}`
      : `Click rate: ${clickRate}. No link data available.`,
    status: parseFloat(clickRate) >= 5 ? 'good' : parseFloat(clickRate) >= 2 ? 'neutral' : 'warning',
  });
  if (parseFloat(clickRate) < 2) {
    levers.push({
      priority: 'medium',
      signal: `Low email click rate: ${clickRate}`,
      action: 'Review email copy, test subject lines, check delivery',
      owner: 'Marketing',
    });
  }

  // 7. Which users are stuck?
  const needingAttention = data.matchingQuality?.usersNeedingAttention ?? 0;
  const repeatNegative = data.matchingQuality?.repeatNegative ?? [];
  answers.push({
    question: '7. Which users are stuck?',
    answer: needingAttention > 0
      ? `${needingAttention} users need attention. ${repeatNegative.length} have repeated negative feedback.`
      : 'No users flagged as needing attention.',
    status: needingAttention === 0 ? 'good' : needingAttention < 10 ? 'neutral' : 'warning',
  });
  if (repeatNegative.length > 0) {
    levers.push({
      priority: 'high',
      signal: `${repeatNegative.length} users with repeated negative feedback`,
      action: 'Personal outreach to understand pain points',
      owner: 'Customer Success',
      metric: repeatNegative.slice(0, 3).map(u => u.email).join(', '),
    });
  }

  // 8. Which users are high-value?
  const briefingsEntitled = data.userHealth?.briefingsEntitled ?? 0;
  const pipelineUsers = data.outcomeMetrics?.winContracts?.pipelineItemsCreated ?? 0;
  answers.push({
    question: '8. Which users are high-value?',
    answer: `${briefingsEntitled} paid briefings users. ${pipelineUsers} pipeline items created.`,
    status: briefingsEntitled > 50 ? 'good' : briefingsEntitled > 20 ? 'neutral' : 'warning',
  });

  // 9. What should the team do next?
  const pendingDeadLetter = data.deadLetter?.pending ?? 0;
  const alertsFailed = data.emailOperations?.alerts?.failed ?? 0;
  const briefingsFailed = data.emailOperations?.briefings?.failed ?? 0;

  let urgentAction = 'No urgent actions needed.';
  if (pendingDeadLetter > 10) {
    urgentAction = `Process ${pendingDeadLetter} items in dead letter queue.`;
    levers.push({ priority: 'critical', signal: `${pendingDeadLetter} dead letter items`, action: 'Review and retry or clear', owner: 'Ops' });
  } else if (alertsFailed > 50 || briefingsFailed > 50) {
    urgentAction = `Investigate ${alertsFailed + briefingsFailed} failed email sends.`;
    levers.push({ priority: 'critical', signal: `${alertsFailed + briefingsFailed} failed sends`, action: 'Check email provider, review logs', owner: 'Ops' });
  } else if (incomplete > 100) {
    urgentAction = `Send profile reminders to ${incomplete} incomplete users.`;
  }

  answers.push({
    question: '9. What should the team do next?',
    answer: urgentAction,
    status: pendingDeadLetter > 10 || alertsFailed > 50 ? 'critical' : 'neutral',
  });

  // 10. Are users moving closer to winning?
  const saved = data.outcomeMetrics?.findContracts?.savedOpportunities ?? 0;
  const pursuing = data.outcomeMetrics?.winContracts?.pursuing ?? 0;
  const bidding = data.outcomeMetrics?.winContracts?.bidding ?? 0;
  const submitted = data.outcomeMetrics?.winContracts?.submitted ?? 0;
  const won = data.outcomeMetrics?.winContracts?.won ?? 0;
  const helpfulRate = data.matchingQuality?.last7Days?.helpfulRate ?? data.matchingQuality?.helpfulRate ?? 'N/A';

  answers.push({
    question: '10. Are users moving closer to winning?',
    answer: `${saved} saved, ${pursuing} pursuing, ${bidding} bidding, ${submitted} submitted, ${won} won. Matching quality: ${helpfulRate} helpful.`,
    status: won > 0 ? 'good' : pursuing > 0 ? 'neutral' : 'warning',
  });

  // Calculate health score
  const criticalCount = answers.filter(a => a.status === 'critical').length;
  const warningCount = answers.filter(a => a.status === 'warning').length;
  const goodCount = answers.filter(a => a.status === 'good').length;

  let healthScore = 100 - (criticalCount * 30) - (warningCount * 10) + (goodCount * 5);
  healthScore = Math.max(0, Math.min(100, healthScore));

  const healthLabel = healthScore >= 80 ? 'Healthy' : healthScore >= 60 ? 'Needs Attention' : healthScore >= 40 ? 'At Risk' : 'Critical';

  // Sort levers by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  levers.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  // Generate headline
  const topLever = levers[0];
  const headline = topLever
    ? `${healthLabel} (${healthScore}/100) — Top priority: ${topLever.action}`
    : `${healthLabel} (${healthScore}/100) — No urgent actions needed`;

  // Generate Slack summary
  const slackSummary = `*MI Daily Brief — ${data.displayDate}*

*Health: ${healthLabel} (${healthScore}/100)*

📊 *Key Numbers*
• ${signups} new signups | ${activationRate} activation
• ${dau} DAU / ${wau} WAU | ${dauWau} stickiness
• ${profileCompletion} profile completion (${incomplete} incomplete)
• ${clickRate} email click rate

🎯 *Outcomes*
• ${saved} opportunities saved
• ${pursuing} pursuing → ${bidding} bidding → ${submitted} submitted → ${won} won
• ${helpfulRate} matching quality

${levers.length > 0 ? `⚡ *Top Actions*\n${levers.slice(0, 3).map(l => `• [${l.priority.toUpperCase()}] ${l.action} (${l.owner})`).join('\n')}` : '✅ No urgent actions needed'}`;

  return {
    date: data.displayDate,
    generatedAt: new Date().toISOString(),
    headline,
    healthScore,
    healthLabel,
    answers,
    levers,
    topPriority: topLever?.action ?? 'No urgent actions',
    slackSummary,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const format = searchParams.get('format'); // 'slack' for Slack-ready output

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Fetch the dashboard data
    const dashboardUrl = new URL('/api/admin/dashboard', request.url);
    dashboardUrl.searchParams.set('password', password);

    const dashboardRes = await fetch(dashboardUrl.toString(), { cache: 'no-store' });
    if (!dashboardRes.ok) {
      throw new Error(`Dashboard API failed: ${dashboardRes.status}`);
    }

    const dashboardData: DashboardData = await dashboardRes.json();

    // Generate the brief
    const brief = generateBrief(dashboardData);

    // Return based on format
    if (format === 'slack') {
      return new NextResponse(brief.slackSummary, {
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    return NextResponse.json({
      success: true,
      brief,
      rawData: {
        displayDate: dashboardData.displayDate,
        timestamp: dashboardData.timestamp,
      },
    });
  } catch (error) {
    console.error('[generate-daily-brief] Error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate brief',
    }, { status: 500 });
  }
}
