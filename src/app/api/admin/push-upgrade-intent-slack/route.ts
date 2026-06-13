/**
 * POST /api/admin/push-upgrade-intent-slack?password=xxx&level=hot&limit=25
 *
 * Posts upgrade clickers (Go Pro CTA) to #sales-mindy for immediate sales follow-up.
 */
import { NextRequest, NextResponse } from 'next/server';
import { postSlackMessage } from '@/lib/slack/post-message';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'galata-assassin-2026';

function internalBaseUrl(request: NextRequest): string {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  return host ? `${proto}://${host}` : 'https://getmindy.ai';
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const password = searchParams.get('password');
  const level = searchParams.get('level') || 'hot';
  const days = Math.min(parseInt(searchParams.get('days') || '30', 10), 90);
  const limit = Math.min(parseInt(searchParams.get('limit') || '25', 10), 50);

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const channel = process.env.QUALIFICATION_SLACK_CHANNEL || process.env.OUTREACH_SLACK_CHANNEL || 'C08DMRLNCCF';

  try {
    const baseUrl = internalBaseUrl(request);
    const intentRes = await fetch(
      `${baseUrl}/api/admin/upgrade-intent?password=${encodeURIComponent(password)}&days=${days}&level=${level}&limit=${limit}`,
      { cache: 'no-store' },
    );
    const intentData = await intentRes.json();

    if (!intentRes.ok || !intentData.success) {
      return NextResponse.json({ error: intentData.error || 'Failed to load upgrade intent' }, { status: 500 });
    }

    const callable = (intentData.candidates || []).filter(
      (c: { isProSubscriber?: boolean }) => !c.isProSubscriber,
    ) as Array<{
      email: string;
      level: string;
      ctaClicks: number;
      topFeature: string;
      lastCtaAt: string | null;
      profileComplete: boolean;
      recommendedAction: string;
    }>;

    const totalCallable = intentData.summary?.callableNow ?? callable.length;
    const definition =
      'Free users who clicked Go Pro in the upgrade modal — call within 24h. Tracked in user_engagement.';

    const lineFor = (c: (typeof callable)[0], i: number) => {
      const date = c.lastCtaAt ? c.lastCtaAt.slice(0, 10) : 'recent';
      const profile = c.profileComplete ? 'profile done' : 'needs NAICS';
      return `*${i + 1}.* \`${c.email}\` · ${c.ctaClicks}× click · *${c.topFeature}* · ${date} · ${profile}\n${c.recommendedAction.slice(0, 100)}`;
    };

    const title = level === 'warm' ? 'Upgrade Warm Leads' : 'Upgrade Clickers — Call Now';
    const emoji = level === 'warm' ? '🟡' : '🔥';

    const text = `${emoji} *${title}* — ${totalCallable} callable, showing ${callable.length}\n_${definition}_\n\n${callable.length ? callable.map(lineFor).join('\n\n') : '_No callable upgrade clickers in this window._'}\n\n<https://getmindy.ai/command-center|Open Command Center>`;

    const blocks: Array<Record<string, unknown>> = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${title} (${totalCallable})`, emoji: true },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: definition }],
      },
    ];

    if (callable.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '_No callable upgrade clickers in the last ' + days + ' days._' },
      });
    } else {
      const CHUNK = 6;
      for (let i = 0; i < callable.length; i += CHUNK) {
        const chunk = callable.slice(i, i + CHUNK);
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
        {
          type: 'mrkdwn',
          text: `<https://getmindy.ai/command-center|Command Center> · last ${days}d · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
        },
      ],
    });

    let slack = await postSlackMessage({ channel, text, blocks });
    if (!slack.ok && slack.error === 'invalid_blocks') {
      slack = await postSlackMessage({ channel, text });
    }

    if (!slack.ok) {
      return NextResponse.json({ error: slack.error || 'Slack post failed', channel }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      channel,
      posted: callable.length,
      totalCallable,
      level,
      slackTs: slack.ts,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[push-upgrade-intent-slack]', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
