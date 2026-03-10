/**
 * Slack Events API Webhook
 *
 * Handles:
 * - URL verification challenge
 * - app_mention events (when users @mention the bot)
 * - message events (DMs to the bot)
 */

import { NextResponse } from 'next/server';

// Slack event types
interface SlackEvent {
  type: string;
  user?: string;
  text?: string;
  channel?: string;
  ts?: string;
  event_ts?: string;
}

interface SlackEventPayload {
  type: string;
  challenge?: string;
  token?: string;
  team_id?: string;
  event?: SlackEvent;
}

export async function POST(request: Request) {
  const body: SlackEventPayload = await request.json();

  // Handle URL verification challenge from Slack
  if (body.type === 'url_verification') {
    console.log('[Slack] URL verification challenge received');
    return NextResponse.json({ challenge: body.challenge });
  }

  // Handle events
  if (body.type === 'event_callback' && body.event) {
    const event = body.event;

    console.log(`[Slack] Event received: ${event.type}`, {
      user: event.user,
      channel: event.channel,
      text: event.text?.substring(0, 100),
    });

    // Handle app mentions (@GovCon Giants)
    if (event.type === 'app_mention') {
      await handleMention(event);
    }

    // Handle direct messages
    if (event.type === 'message' && !event.text?.includes('subtype')) {
      // Ignore bot's own messages
      if (event.user) {
        await handleDirectMessage(event);
      }
    }
  }

  // Always respond quickly to Slack (they have a 3-second timeout)
  return NextResponse.json({ ok: true });
}

/**
 * Handle @mentions of the bot
 */
async function handleMention(event: SlackEvent) {
  const { channel, text, user } = event;

  if (!channel || !text) return;

  // Remove the bot mention from the text
  const query = text.replace(/<@[A-Z0-9]+>/g, '').trim();

  if (!query) {
    await sendSlackMessage(channel, "Hi! I'm your GovCon intelligence assistant. Ask me anything about federal contracting opportunities, your briefings, or market insights.");
    return;
  }

  // Generate AI response
  const response = await generateBriefingResponse(query, user);
  await sendSlackMessage(channel, response);
}

/**
 * Handle direct messages to the bot
 */
async function handleDirectMessage(event: SlackEvent) {
  const { channel, text, user } = event;

  if (!channel || !text || !user) return;

  // Generate AI response
  const response = await generateBriefingResponse(text, user);
  await sendSlackMessage(channel, response);
}

/**
 * Send a message to a Slack channel
 */
async function sendSlackMessage(channel: string, text: string) {
  const token = process.env.SLACK_BOT_TOKEN;

  if (!token) {
    console.error('[Slack] SLACK_BOT_TOKEN not configured');
    return;
  }

  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel,
        text,
        mrkdwn: true,
      }),
    });

    const result = await response.json();

    if (!result.ok) {
      console.error('[Slack] Error sending message:', result.error);
    }
  } catch (error) {
    console.error('[Slack] Error sending message:', error);
  }
}

/**
 * Generate AI response for briefing-related questions
 */
async function generateBriefingResponse(query: string, userId?: string): Promise<string> {
  const groqKey = process.env.GROQ_API_KEY;

  if (!groqKey) {
    return "I'm having trouble connecting to my AI backend. Please try again later or contact support.";
  }

  try {
    const systemPrompt = `You are the GovCon Giants AI assistant, helping federal contractors with government contracting intelligence.

You help users with:
- Understanding their daily briefings
- Finding federal contract opportunities
- Analyzing agencies and spending patterns
- Identifying recompete opportunities
- Teaming and subcontracting strategies
- NAICS codes and set-aside programs

Be concise, actionable, and specific. Use bullet points for clarity. If you don't know something, say so and suggest where to find the information.

Keep responses under 300 words for Slack readability.`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query },
        ],
        temperature: 0.7,
        max_tokens: 500,
      }),
    });

    const result = await response.json();

    if (result.choices?.[0]?.message?.content) {
      return result.choices[0].message.content;
    }

    return "I couldn't generate a response. Please try rephrasing your question.";
  } catch (error) {
    console.error('[Slack] Error generating AI response:', error);
    return "I encountered an error processing your request. Please try again.";
  }
}
