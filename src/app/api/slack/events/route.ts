/**
 * Slack Events API Webhook
 *
 * Handles:
 * - URL verification challenge
 * - app_mention events (when users @mention the bot)
 * - message events (DMs to the bot)
 */

import { NextResponse } from 'next/server';

// Simple in-memory cache to prevent duplicate event processing
const processedEvents = new Map<string, number>();
const EVENT_TTL = 60000; // 1 minute

function isDuplicateEvent(eventId: string): boolean {
  const now = Date.now();

  // Clean old entries
  for (const [key, timestamp] of processedEvents.entries()) {
    if (now - timestamp > EVENT_TTL) {
      processedEvents.delete(key);
    }
  }

  if (processedEvents.has(eventId)) {
    return true;
  }

  processedEvents.set(eventId, now);
  return false;
}

// Slack event types
interface SlackEvent {
  type: string;
  user?: string;
  text?: string;
  channel?: string;
  ts?: string;
  event_ts?: string;
  bot_id?: string;
  subtype?: string;
}

interface SlackEventPayload {
  type: string;
  challenge?: string;
  token?: string;
  team_id?: string;
  event_id?: string;
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
    const eventId = body.event_id || `${event.channel}-${event.ts}`;

    // Skip duplicate events
    if (isDuplicateEvent(eventId)) {
      console.log(`[Slack] Skipping duplicate event: ${eventId}`);
      return NextResponse.json({ ok: true });
    }

    // Skip bot messages and message subtypes (edits, deletes, etc.)
    if (event.bot_id || event.subtype) {
      return NextResponse.json({ ok: true });
    }

    console.log(`[Slack] Event received: ${event.type}`, {
      user: event.user,
      channel: event.channel,
      text: event.text?.substring(0, 100),
    });

    // Handle app mentions (@GovCon Giants)
    if (event.type === 'app_mention') {
      // Don't await - respond to Slack immediately
      handleMention(event).catch(console.error);
    }

    // Handle direct messages
    if (event.type === 'message' && event.user) {
      // Don't await - respond to Slack immediately
      handleDirectMessage(event).catch(console.error);
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
 * Generate AI response using shared chat engine
 * TODO: Resolve Slack userId to email for personalized briefing context.
 * For now, falls back to generic GovCon advice (no user-specific briefing data).
 */
async function generateBriefingResponse(query: string, _userId?: string): Promise<string> {
  // TODO: Look up Slack user → email mapping for personalized responses
  // For now, use a generic email placeholder so the engine returns general advice
  try {
    const { generateChatResponse } = await import('@/lib/briefings/chat/engine');
    const result = await generateChatResponse(query, 'slack-user@unknown');
    return result.message;
  } catch (error) {
    console.error('[Slack] Error generating AI response:', error);
    return "I encountered an error processing your request. Please try again.";
  }
}
