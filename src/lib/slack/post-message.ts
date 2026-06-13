/** Post a message to Slack via bot token (chat.postMessage). */
export async function postSlackMessage(opts: {
  channel: string;
  text: string;
  blocks?: unknown[];
}): Promise<{ ok: boolean; error?: string; ts?: string }> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return { ok: false, error: 'SLACK_BOT_TOKEN not set' };
  }

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: opts.channel,
      text: opts.text,
      blocks: opts.blocks,
      mrkdwn: true,
    }),
  });

  const result = (await res.json()) as { ok: boolean; error?: string; ts?: string };
  return result;
}
