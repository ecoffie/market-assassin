/** Join a public channel by ID (requires channels:join scope). */
async function joinSlackChannel(token: string, channel: string): Promise<boolean> {
  try {
    const res = await fetch('https://slack.com/api/conversations.join', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel }),
    });
    const result = (await res.json()) as { ok: boolean; error?: string };
    // already_in_channel is fine
    return result.ok || result.error === 'already_in_channel';
  } catch {
    return false;
  }
}

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

  async function send() {
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
    return (await res.json()) as { ok: boolean; error?: string; ts?: string };
  }

  let result = await send();
  if (!result.ok && result.error === 'not_in_channel') {
    const joined = await joinSlackChannel(token, opts.channel);
    if (joined) result = await send();
  }
  return result;
}
