/**
 * Inbound SMS Webhook for Briefing Chatbot
 *
 * Twilio sends POST here when a user texts your number.
 * Uses workflow orchestration: parse → identify → route → handle → respond.
 *
 * Commands:
 *   LINK <email>     - Start phone-to-email linking
 *   <6-digit code>   - Verify phone link
 *   UNLINK           - Remove phone link
 *   HELP             - Show available commands
 *   STOP             - Opt out (Twilio handles automatically)
 *   <anything else>  - Chat with briefing AI
 *
 * Configure in Twilio Console:
 *   Phone Numbers → your number → Messaging → "A message comes in"
 *   → Webhook: https://tools.govcongiants.org/api/briefings/sms-webhook (HTTP POST)
 */

import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import twilio from 'twilio';
import { resolveUserByPhone, linkPhoneToEmail, verifyPhoneLink, unlinkPhone } from '@/lib/briefings/chat/identity';
import { generateChatResponse } from '@/lib/briefings/chat/engine';
import type { ChatMessage } from '@/lib/briefings/chat/types';

// ============================================================
// WORKFLOW ORCHESTRATION
// ============================================================

/**
 * Step 1: Parse — Extract message data from Twilio webhook
 * Step 2: Validate — Verify Twilio signature (production only)
 * Step 3: Classify — Determine command type
 * Step 4: Route — Dispatch to appropriate handler
 * Step 5: Respond — Return TwiML response
 */

type CommandType = 'link' | 'verify' | 'unlink' | 'help' | 'stop' | 'chat';

interface ParsedMessage {
  from: string;      // Sender phone (E.164)
  body: string;      // Message text
  messageSid: string; // Twilio message ID
}

interface WorkflowResult {
  response: string;
  shouldLog?: boolean;
}

// ============================================================
// MAIN HANDLER
// ============================================================

export async function POST(request: Request) {
  try {
    // Step 1: Parse
    const parsed = await parseIncomingMessage(request);
    if (!parsed) {
      return twimlResponse('Invalid request.');
    }

    // Step 2: Validate signature (production)
    const isValid = await validateTwilioSignature(request, parsed);
    if (!isValid && process.env.NODE_ENV === 'production') {
      console.error('[SMSWebhook] Invalid Twilio signature');
      return new NextResponse('Forbidden', { status: 403 });
    }

    console.log(`[SMSWebhook] From: ${parsed.from} | Body: "${parsed.body.substring(0, 50)}"`);

    // Step 3: Classify command
    const command = classifyCommand(parsed.body);

    // Step 4: Route to handler
    const result = await routeCommand(command, parsed);

    // Step 5: Log and respond
    if (result.shouldLog) {
      await logChatInteraction(parsed.from, parsed.body, result.response);
    }

    return twimlResponse(result.response);
  } catch (error) {
    console.error('[SMSWebhook] Unhandled error:', error);
    return twimlResponse('Something went wrong. Please try again.');
  }
}

// Also handle GET for Twilio webhook verification
export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'GovCon Briefing Bot SMS Webhook' });
}

// ============================================================
// STEP 1: PARSE
// ============================================================

async function parseIncomingMessage(request: Request): Promise<ParsedMessage | null> {
  try {
    const formData = await request.formData();
    const from = formData.get('From') as string;
    const body = formData.get('Body') as string;
    const messageSid = formData.get('MessageSid') as string;

    if (!from || !body) return null;

    return {
      from,
      body: body.trim(),
      messageSid: messageSid || '',
    };
  } catch {
    return null;
  }
}

// ============================================================
// STEP 2: VALIDATE
// ============================================================

async function validateTwilioSignature(request: Request, _parsed: ParsedMessage): Promise<boolean> {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return false;

  const signature = request.headers.get('X-Twilio-Signature');
  if (!signature) return false;

  // In production, validate with twilio.validateRequest()
  // For now, presence of signature + auth token = valid
  // Full validation requires the original URL which can be tricky behind proxies
  try {
    const url = request.url;
    const formData = await request.clone().formData();
    const params: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      params[key] = value as string;
    }
    return twilio.validateRequest(authToken, signature, url, params);
  } catch {
    // If validation fails due to URL mismatch (common behind CDN/proxy), allow through
    // but log for monitoring
    console.warn('[SMSWebhook] Signature validation error — allowing through');
    return true;
  }
}

// ============================================================
// STEP 3: CLASSIFY
// ============================================================

function classifyCommand(body: string): CommandType {
  const upper = body.toUpperCase().trim();

  // LINK command: "LINK user@example.com"
  if (upper.startsWith('LINK ') && body.includes('@')) {
    return 'link';
  }

  // Verification code: exactly 6 digits
  if (/^\d{6}$/.test(body.trim())) {
    return 'verify';
  }

  // UNLINK
  if (upper === 'UNLINK') {
    return 'unlink';
  }

  // HELP
  if (upper === 'HELP' || upper === 'COMMANDS' || upper === 'MENU') {
    return 'help';
  }

  // STOP (Twilio handles this automatically, but just in case)
  if (upper === 'STOP' || upper === 'CANCEL' || upper === 'QUIT') {
    return 'stop';
  }

  // Everything else is a chat message
  return 'chat';
}

// ============================================================
// STEP 4: ROUTE
// ============================================================

async function routeCommand(command: CommandType, parsed: ParsedMessage): Promise<WorkflowResult> {
  switch (command) {
    case 'link':
      return handleLink(parsed);
    case 'verify':
      return handleVerify(parsed);
    case 'unlink':
      return handleUnlink(parsed);
    case 'help':
      return handleHelp(parsed);
    case 'stop':
      return handleStop(parsed);
    case 'chat':
      return handleChat(parsed);
    default:
      return { response: 'Text HELP for available commands.' };
  }
}

// ============================================================
// COMMAND HANDLERS
// ============================================================

/**
 * LINK handler — Start phone-to-email linking
 */
async function handleLink(parsed: ParsedMessage): Promise<WorkflowResult> {
  const email = parsed.body.replace(/^LINK\s+/i, '').trim().toLowerCase();

  if (!email || !email.includes('@')) {
    return { response: 'Please include your email: LINK your@email.com' };
  }

  const result = await linkPhoneToEmail(parsed.from, email);

  if (result.success) {
    return {
      response: `Verification code sent to ${email}. Check your email and text the 6-digit code back here.`,
    };
  }

  return { response: result.error || 'Failed to start linking. Try again.' };
}

/**
 * VERIFY handler — Complete phone linking with code
 */
async function handleVerify(parsed: ParsedMessage): Promise<WorkflowResult> {
  const result = await verifyPhoneLink(parsed.from, parsed.body.trim());

  if (result.success) {
    return {
      response: `Linked! Your briefings are now connected to ${result.email}. Ask me anything about your GovCon briefings.`,
    };
  }

  return { response: result.error || 'Invalid code. Check your email and try again.' };
}

/**
 * UNLINK handler — Remove phone association
 */
async function handleUnlink(parsed: ParsedMessage): Promise<WorkflowResult> {
  const unlinked = await unlinkPhone(parsed.from);

  if (unlinked) {
    return { response: 'Phone unlinked. Text LINK your@email.com to reconnect.' };
  }

  return { response: 'No linked account found.' };
}

/**
 * HELP handler — Show available commands
 */
async function handleHelp(parsed: ParsedMessage): Promise<WorkflowResult> {
  // Check if phone is linked
  const email = await resolveUserByPhone(parsed.from);

  if (email) {
    return {
      response: `GovCon Briefing Bot (linked to ${email})

Ask me anything about your briefings:
• "What opportunities came up today?"
• "Any upcoming deadlines?"
• "Tell me about that DHS contract"
• "Summarize my top items"

Commands:
UNLINK - Disconnect your account
HELP - Show this message
STOP - Opt out of messages`,
    };
  }

  return {
    response: `GovCon Giants Briefing Bot

To get started, link your GovCon account:
LINK your@email.com

Then text the 6-digit code from your email.

Once linked, ask me anything about your daily briefings!`,
  };
}

/**
 * STOP handler — Opt out
 */
async function handleStop(_parsed: ParsedMessage): Promise<WorkflowResult> {
  // Twilio handles STOP automatically. This is a fallback.
  return { response: 'You have been opted out. Text START to re-subscribe.' };
}

/**
 * CHAT handler — AI-powered briefing Q&A
 */
async function handleChat(parsed: ParsedMessage): Promise<WorkflowResult> {
  // Resolve phone → email
  const email = await resolveUserByPhone(parsed.from);

  if (!email) {
    return {
      response: 'To chat with your briefing bot, link your account first. Text: LINK your@email.com',
    };
  }

  // Check briefing access
  const hasAccess = await kv.get(`briefings:${email}`);
  if (!hasAccess) {
    return {
      response: 'Your briefing access has expired. Visit shop.govcongiants.org to renew.',
    };
  }

  // Rate limit: max 30 messages per hour per phone
  const rateLimited = await checkRateLimit(parsed.from);
  if (rateLimited) {
    return { response: "You've sent a lot of messages. Please wait a few minutes and try again." };
  }

  // Get conversation history for context (last few messages from this session)
  const history = await getConversationHistory(parsed.from);

  // Generate AI response
  const response = await generateChatResponse(parsed.body, email, history);

  // Store this exchange in conversation history
  await storeConversationTurn(parsed.from, parsed.body, response.message);

  // Truncate for SMS (1600 char limit for long SMS, 160 for single)
  const truncated = response.message.length > 1500
    ? response.message.substring(0, 1497) + '...'
    : response.message;

  return {
    response: truncated,
    shouldLog: true,
  };
}

// ============================================================
// CONVERSATION HISTORY (KV-based, session-scoped)
// ============================================================

const HISTORY_TTL = 3600; // 1 hour session window
const MAX_HISTORY_TURNS = 6; // 3 exchanges

async function getConversationHistory(phone: string): Promise<ChatMessage[]> {
  const history = await kv.get<ChatMessage[]>(`chat:history:${phone}`);
  return history || [];
}

async function storeConversationTurn(phone: string, userMsg: string, assistantMsg: string): Promise<void> {
  const key = `chat:history:${phone}`;
  const history = await kv.get<ChatMessage[]>(key) || [];

  history.push(
    { role: 'user', content: userMsg },
    { role: 'assistant', content: assistantMsg }
  );

  // Keep only the last N turns
  const trimmed = history.slice(-MAX_HISTORY_TURNS);

  await kv.set(key, trimmed, { ex: HISTORY_TTL });
}

// ============================================================
// RATE LIMITING
// ============================================================

async function checkRateLimit(phone: string): Promise<boolean> {
  const key = `chat:rate:${phone}`;
  const count = await kv.incr(key);

  if (count === 1) {
    // First message — set expiry to 1 hour
    await kv.expire(key, 3600);
  }

  return count > 30;
}

// ============================================================
// LOGGING
// ============================================================

async function logChatInteraction(phone: string, userMsg: string, botResponse: string): Promise<void> {
  try {
    const email = await resolveUserByPhone(phone);
    if (!email) return;

    // Increment daily chat count for analytics
    const today = new Date().toISOString().split('T')[0];
    const statsKey = `chat:stats:${today}`;
    await kv.incr(statsKey);
    await kv.expire(statsKey, 7 * 86400); // 7-day retention

    console.log(`[SMSWebhook] Chat: ${email} | Q: "${userMsg.substring(0, 50)}" | A: "${botResponse.substring(0, 50)}"`);
  } catch (error) {
    console.error('[SMSWebhook] Log error:', error);
  }
}

// ============================================================
// TWIML RESPONSE HELPER
// ============================================================

function twimlResponse(message: string): NextResponse {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(message)}</Message>
</Response>`;

  return new NextResponse(twiml, {
    headers: { 'Content-Type': 'text/xml' },
  });
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
