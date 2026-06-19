/**
 * POST /api/admin/push-qualification-slack?password=xxx&segment=activation
 *
 * Posts a qualification queue digest to Slack (activation, founder, sales, rescue).
 * Uses SLACK_BOT_TOKEN + QUALIFICATION_SLACK_CHANNEL (default C08DMRLNCCF).
 */
import { NextRequest, NextResponse } from 'next/server';
import { postSlackMessage } from '@/lib/slack/post-message';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

type SegmentKey = 'activation' | 'founder' | 'sales' | 'rescue';

const SEGMENT_CONFIG: Record<SegmentKey, { listKey: string; title: string; emoji: string; definition?: string }> = {
  activation: {
    listKey: 'activationCandidates',
    title: 'Activation Candidates',
    emoji: '🟢',
    definition: 'Mindy access + incomplete profile (default NAICS only). Score 30+. Setup nudges — not sales or rescue.',
  },
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

  const channel = process.env.QUALIFICATION_SLACK_CHANNEL || process.env.OUTREACH_SLACK_CHANNEL || 'C08DMRLNCCF';

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
    const lineFor = (c: (typeof top)[0], i: number) => {
      const why = (c.why || c.action || '').slice(0, 120);
      return `*${i + 1}.* \`${c.email}\`${c.score != null ? ` · score ${c.score}` : ''}${why ? `\n${why}` : ''}`;
    };

    const text = `${cfg.emoji} *${cfg.title}* — ${totalInSegment} total, showing top ${top.length}${cfg.definition ? `\n_${cfg.definition}_` : ''}\n\n${top.map(lineFor).join('\n\n')}\n\n<https://getmindy.ai/command-center|Open Command Center>`;

    // Slack section blocks cap at 3000 chars — chunk candidates (~8 per block).
    const blocks: Array<Record<string, unknown>> = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${cfg.title} (${totalInSegment})`, emoji: true },
      },
    ];
    if (cfg.definition) {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: cfg.definition }],
      });
    }
    if (top.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '_No candidates in this queue._' },
      });
    } else {
      const CHUNK = 8;
      for (let i = 0; i < top.length; i += CHUNK) {
        const chunk = top.slice(i, i + CHUNK);
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: chunk.map((c, j) => lineFor(c, i + j)).join('\n\n').slice(0, 2900),
          },
        });
      }
    }
    blocks.push({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: `<https://getmindy.ai/command-center|Command Center> · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC` },
      ],
    });

    let slack = await postSlackMessage({ channel, text, blocks });

    // Fallback: plain text if block layout rejected
    if (!slack.ok && slack.error === 'invalid_blocks') {
      slack = await postSlackMessage({ channel, text });
    }

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
