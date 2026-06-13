/**
 * POST /api/admin/push-qualification-slack?password=xxx&segment=activation
 *
 * Posts a qualification queue digest to Slack (activation, founder, sales, rescue).
 * Uses SLACK_BOT_TOKEN + QUALIFICATION_SLACK_CHANNEL (default #sales-outreach).
 */
import { NextRequest, NextResponse } from 'next/server';
import { postSlackMessage } from '@/lib/slack/post-message';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

type SegmentKey = 'activation' | 'founder' | 'sales' | 'rescue';

const SEGMENT_CONFIG: Record<SegmentKey, { listKey: string; title: string; emoji: string }> = {
  activation: { listKey: 'activationCandidates', title: 'Activation Candidates', emoji: '🟢' },
  founder: { listKey: 'founderCalls', title: 'Founder Call Queue', emoji: '🎯' },
  sales: { listKey: 'salesOutreach', title: 'Sales Outreach Queue', emoji: '💼' },
  rescue: { listKey: 'rescueCandidates', title: 'Rescue Queue', emoji: '🚨' },
};

function internalBaseUrl(request: NextRequest): string {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  return host ? `${proto}://${host}` : 'https://getmindy.ai';
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const segment = (searchParams.get('segment') || 'activation') as SegmentKey;
  const limit = Math.min(parseInt(searchParams.get('limit') || '25', 10), 50);

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!SEGMENT_CONFIG[segment]) {
    return NextResponse.json({ error: 'Invalid segment. Use activation, founder, sales, or rescue.' }, { status: 400 });
  }

  const channel = process.env.QUALIFICATION_SLACK_CHANNEL || process.env.OUTREACH_SLACK_CHANNEL || '#sales-outreach';

  try {
    const baseUrl = internalBaseUrl(request);
    const qualRes = await fetch(
      `${baseUrl}/api/admin/qualify-customers?password=${encodeURIComponent(password)}`,
      { cache: 'no-store' },
    );
    const qualData = await qualRes.json();

    if (!qualRes.ok || !qualData.success) {
      return NextResponse.json({ error: qualData.error || 'Failed to load qualification data' }, { status: 500 });
    }

    const cfg = SEGMENT_CONFIG[segment];
    const list = (qualData.lists?.[cfg.listKey] || []) as Array<{
      email: string;
      score?: number;
      why?: string;
      action?: string;
      segment?: string;
    }>;

    const summaryKey =
      segment === 'activation' ? 'Activation Candidate'
      : segment === 'founder' ? '10-10 Candidate'
      : segment === 'rescue' ? 'Rescue Candidate'
      : null;
    const totalInSegment = summaryKey
      ? (qualData.summary?.bySegment?.[summaryKey] as number) || list.length
      : list.length;

    const top = list.slice(0, limit);
    const lines = top.map((c, i) => {
      const score = c.score != null ? ` *${c.score}*` : '';
      const why = c.why ? ` — ${c.why}` : '';
      return `${i + 1}. \`${c.email}\`${score}${why}`;
    });

    const text = `${cfg.emoji} *${cfg.title}* — ${totalInSegment} total, showing top ${top.length}\n${lines.join('\n')}\n<https://getmindy.ai/command-center|Open Command Center>`;

    const blocks = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${cfg.title} (${totalInSegment})`, emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: top.length
            ? top.map((c, i) => `*${i + 1}.* \`${c.email}\`${c.score != null ? ` · score ${c.score}` : ''}\n${c.why || c.action || ''}`).join('\n\n')
            : '_No candidates in this queue._',
        },
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `<https://getmindy.ai/command-center|Command Center> · Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC` },
        ],
      },
    ];

    const slack = await postSlackMessage({ channel, text, blocks });

    if (!slack.ok) {
      return NextResponse.json({ error: slack.error || 'Slack post failed', channel }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      segment,
      channel,
      posted: top.length,
      totalInSegment,
      slackTs: slack.ts,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[push-qualification-slack]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
