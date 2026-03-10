/**
 * Briefing Chat Engine
 *
 * Core AI chat engine that generates personalized responses
 * using the user's briefing data and profile as context.
 * Reusable across all channels (SMS, Slack, future).
 */

import { createClient } from '@supabase/supabase-js';
import type { ChatMessage, ChatContext, ChatResponse, BriefingSnapshot, BriefingItemSummary } from './types';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const CHAT_MODEL = 'llama-3.1-70b-versatile';
const MAX_CONTEXT_DAYS = 7;
const MAX_ITEMS_IN_CONTEXT = 30;

/**
 * Generate a chat response with full briefing context
 */
export async function generateChatResponse(
  userMessage: string,
  userEmail: string,
  conversationHistory: ChatMessage[] = []
): Promise<ChatResponse> {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return { message: "I'm having trouble connecting right now. Please try again later." };
  }

  // Fetch user context from Supabase
  const context = await fetchUserContext(userEmail);

  // Build system prompt with personalized context
  const systemPrompt = buildSystemPrompt(context);

  // Assemble messages: system + history + current
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.slice(-6), // Keep last 3 exchanges for SMS context
    { role: 'user', content: userMessage },
  ];

  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 400, // SMS-friendly length
      }),
    });

    const result = await response.json();

    if (result.choices?.[0]?.message?.content) {
      return {
        message: result.choices[0].message.content,
        tokensUsed: result.usage?.total_tokens,
        model: CHAT_MODEL,
      };
    }

    return { message: "I couldn't process that. Try rephrasing your question." };
  } catch (error) {
    console.error('[ChatEngine] Groq API error:', error);
    return { message: "Something went wrong. Please try again in a moment." };
  }
}

/**
 * Fetch user's briefing context from Supabase
 */
async function fetchUserContext(email: string): Promise<ChatContext> {
  const context: ChatContext = {
    userEmail: email,
    naicsCodes: [],
    agencies: [],
    keywords: [],
    watchedCompanies: [],
    recentBriefings: [],
  };

  const supabase = getSupabase();
  if (!supabase) return context;

  // Fetch profile and recent briefings in parallel
  const [profileResult, briefingsResult] = await Promise.all([
    supabase
      .from('user_briefing_profiles')
      .select('naics_codes, agencies, keywords, watched_companies, aggregated_profile')
      .eq('user_email', email)
      .single(),
    supabase
      .from('briefing_log')
      .select('briefing_date, briefing_content, items_count')
      .eq('user_email', email)
      .order('briefing_date', { ascending: false })
      .limit(MAX_CONTEXT_DAYS),
  ]);

  // Parse profile
  if (profileResult.data) {
    const p = profileResult.data;
    context.naicsCodes = p.naics_codes || [];
    context.agencies = p.agencies || [];
    context.keywords = p.keywords || [];
    context.watchedCompanies = p.watched_companies || [];
  }

  // Parse recent briefings
  if (briefingsResult.data) {
    context.recentBriefings = briefingsResult.data.map((row) => {
      const content = row.briefing_content as Record<string, unknown> | null;
      const items = extractBriefingItems(content);
      return {
        date: row.briefing_date,
        itemCount: row.items_count || items.length,
        urgentCount: items.filter((i) => i.urgency === 'urgent').length,
        items: items.slice(0, MAX_ITEMS_IN_CONTEXT),
      } satisfies BriefingSnapshot;
    });
  }

  return context;
}

/**
 * Extract briefing items from JSONB content
 */
function extractBriefingItems(content: Record<string, unknown> | null): BriefingItemSummary[] {
  if (!content) return [];

  const items: BriefingItemSummary[] = [];

  // Handle categorizedItems structure from GeneratedBriefing
  const categorized = content.categorizedItems as Record<string, { items?: Array<Record<string, string>> }> | undefined;
  if (categorized) {
    for (const [category, section] of Object.entries(categorized)) {
      if (section?.items) {
        for (const item of section.items) {
          items.push({
            category,
            title: item.title || '',
            description: item.description || item.subtitle || '',
            amount: item.amount,
            deadline: item.deadline,
            agency: item.agency,
            urgency: item.urgencyBadge,
          });
        }
      }
    }
  }

  // Handle topItems structure
  const topItems = content.topItems as Array<{ items?: Array<Record<string, string>> }> | undefined;
  if (topItems && items.length === 0) {
    for (const section of topItems) {
      if (section?.items) {
        for (const item of section.items) {
          items.push({
            category: 'top',
            title: item.title || '',
            description: item.description || item.subtitle || '',
            amount: item.amount,
            deadline: item.deadline,
            urgency: item.urgencyBadge,
          });
        }
      }
    }
  }

  return items;
}

/**
 * Build the system prompt with user's personalized context
 */
function buildSystemPrompt(context: ChatContext): string {
  let prompt = `You are the GovCon Giants Briefing Assistant — a personalized AI that helps federal contractors understand their daily intelligence briefings.

CRITICAL: You answer questions about THIS USER's specific briefing data. You are NOT a generic chatbot. Every response should reference their actual data when relevant.

USER PROFILE:
- Email: ${context.userEmail}`;

  if (context.naicsCodes.length > 0) {
    prompt += `\n- NAICS Codes: ${context.naicsCodes.slice(0, 10).join(', ')}`;
  }
  if (context.agencies.length > 0) {
    prompt += `\n- Target Agencies: ${context.agencies.slice(0, 10).join(', ')}`;
  }
  if (context.watchedCompanies.length > 0) {
    prompt += `\n- Watched Companies: ${context.watchedCompanies.slice(0, 10).join(', ')}`;
  }
  if (context.keywords.length > 0) {
    prompt += `\n- Keywords: ${context.keywords.slice(0, 10).join(', ')}`;
  }

  // Add recent briefing data
  if (context.recentBriefings.length > 0) {
    prompt += `\n\nRECENT BRIEFING DATA (Last ${context.recentBriefings.length} days):`;

    for (const briefing of context.recentBriefings) {
      prompt += `\n\n--- ${briefing.date} (${briefing.itemCount} items, ${briefing.urgentCount} urgent) ---`;

      for (const item of briefing.items) {
        prompt += `\n• [${item.category}] ${item.title}`;
        if (item.amount) prompt += ` | ${item.amount}`;
        if (item.deadline) prompt += ` | Due: ${item.deadline}`;
        if (item.agency) prompt += ` | ${item.agency}`;
        if (item.urgency) prompt += ` ⚠️`;
        if (item.description) prompt += `\n  ${item.description.substring(0, 120)}`;
      }
    }
  } else {
    prompt += `\n\nNO BRIEFING DATA YET: This user hasn't received any briefings. Provide general GovCon guidance and let them know briefing data will appear once their profile is built from their tool usage.`;
  }

  prompt += `

RESPONSE RULES:
- Keep responses SHORT (under 300 chars for SMS). Use bullet points.
- Reference specific items from their briefing data when answering.
- If asked about something not in the data, say so honestly.
- Explain WHY items were included (matches their NAICS/agencies).
- For GovCon terms (SAT, recompete, set-aside), explain briefly in context.
- End with a specific actionable next step when possible.
- Do NOT use markdown formatting — plain text only (this goes over SMS).
- Do NOT use emojis except sparingly for urgency (⚠️).`;

  return prompt;
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}
