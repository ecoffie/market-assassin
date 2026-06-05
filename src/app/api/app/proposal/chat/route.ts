/**
 * Proposal Assist — Manual Drive chat (PRD-proposal-manual-mode.md, v1).
 *
 * A Perplexity-style proposal LLM: the user uploads project files + has a Vault,
 * then types what they want ("draft the technical approach using our NAVSEA past
 * performance", "what does the RFP require for past performance?"). This streams
 * a response GROUNDED IN THE USER'S OWN DOCS (the uploaded RFP text + their
 * Vault) — NOT the global knowledge base (a proposal must not cite random
 * training content).
 *
 * Reuses the Mindy Chat SSE/Groq engine; the difference is the CONTEXT source.
 *
 * Body: { email, message, rfpText?, rfpFileName?, history? }
 * SSE: { type:'token', content } … { type:'done' }
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireMIAuthSession } from '@/lib/two-factor-session';
import { loadBidderProfile, formatProfileForPrompt, loadVaultContext } from '@/lib/proposal/loaders';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GROQ_MODEL = 'llama-3.1-8b-instant';
const TEMPERATURE = 0.4;        // a touch more deterministic for proposal copy
const MAX_TOKENS = 1400;
const HISTORY_LIMIT = 6;
const RFP_MAX_CHARS = 8000;     // cap the RFP text we stuff into the prompt

const SYSTEM_PROMPT = `You are Mindy, a senior federal proposal writer helping a small-business contractor draft a response. You are in MANUAL mode — the user drives; do exactly what they ask.

Rules:
- Ground EVERYTHING in the provided RFP TEXT and the user's VAULT (their real past performance, capabilities, identity). Do NOT invent contract numbers, agencies, dollar values, or experience the user doesn't have.
- When a fact isn't in the RFP or Vault, write a clearly-marked [bracketed placeholder] for the user to fill — never fabricate.
- Write in the user's voice: concrete, specific, no marketing fluff, no "we are pleased to".
- When asked to draft a section, return clean prose ready to paste into the proposal. When asked a question about the RFP, answer directly and cite the relevant requirement.
- If the RFP text or Vault is missing what's needed, say so plainly and tell the user what to upload or add.
- Never say "as an AI" — you're Mindy.`;

function sseEvent(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim();
  const message = String(body.message || '').trim();
  if (!email || !message) {
    return NextResponse.json({ success: false, error: 'email and message are required' }, { status: 400 });
  }
  const auth = requireMIAuthSession(request, email);
  if (!auth.ok) return auth.response;

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return NextResponse.json({ success: false, error: 'GROQ_API_KEY not configured' }, { status: 500 });
  }

  const rfpText = String(body.rfpText || '').slice(0, RFP_MAX_CHARS);
  const rfpFileName = String(body.rfpFileName || '');

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (obj: unknown) => controller.enqueue(encoder.encode(sseEvent(obj)));
      try {
        // Context = the user's OWN docs: bidder profile + full Vault + the RFP.
        const [profile, vault] = await Promise.all([
          loadBidderProfile(email),
          // 'exec_summary' pulls identity + past performance + capabilities.
          loadVaultContext(email, 'exec_summary'),
        ]);

        const profileBlock = formatProfileForPrompt(profile);
        const vaultBlock = formatVaultForPrompt(vault);
        const sources: string[] = [];
        if (rfpText) sources.push(rfpFileName || 'Uploaded RFP');
        if (vault.has_any) sources.push('Your Vault (profile, past performance, capabilities)');
        send({ type: 'sources', sources });

        const contextParts = [
          profileBlock ? `COMPANY PROFILE:\n${profileBlock}` : '',
          vaultBlock ? `VAULT:\n${vaultBlock}` : '',
          rfpText ? `RFP / SOLICITATION TEXT${rfpFileName ? ` (${rfpFileName})` : ''}:\n${rfpText}` : '',
        ].filter(Boolean).join('\n\n---\n\n');

        const messages: Array<{ role: string; content: string }> = [
          { role: 'system', content: SYSTEM_PROMPT },
        ];
        const history = Array.isArray(body.history) ? body.history.slice(-HISTORY_LIMIT) : [];
        for (const h of history) {
          if (h.role === 'user' || h.role === 'assistant') {
            messages.push({ role: h.role, content: String(h.content || '').slice(0, 2000) });
          }
        }
        const userTurn = contextParts
          ? `${message}\n\n---\nUSE ONLY THIS CONTEXT (the user's own docs):\n${contextParts}`
          : `${message}\n\n(No RFP uploaded and Vault is empty — tell the user what to add.)`;
        messages.push({ role: 'user', content: userTurn });

        const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: GROQ_MODEL, messages, temperature: TEMPERATURE, max_tokens: MAX_TOKENS, stream: true }),
        });
        if (!groqRes.ok || !groqRes.body) {
          const errText = await groqRes.text().catch(() => '(no body)');
          send({ type: 'error', message: `Groq ${groqRes.status}: ${errText.slice(0, 200)}` });
          send({ type: 'done' });
          controller.close();
          return;
        }

        const reader = groqRes.body.getReader();
        const decoder = new TextDecoder();
        let leftover = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunkStr = leftover + decoder.decode(value, { stream: true });
          const lines = chunkStr.split('\n');
          leftover = lines.pop() || '';
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
              const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
              if (typeof delta === 'string' && delta.length > 0) send({ type: 'token', content: delta });
            } catch { /* keep-alive line */ }
          }
        }
        send({ type: 'done' });
        controller.close();
      } catch (e) {
        send({ type: 'error', message: (e as Error).message });
        send({ type: 'done' });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
}

// Compact the Vault context into a prompt block.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatVaultForPrompt(vault: any): string {
  const out: string[] = [];
  if (vault?.identity) {
    const i = vault.identity;
    const id = [i.legal_name && `Legal name: ${i.legal_name}`, i.uei && `UEI: ${i.uei}`, i.cage_code && `CAGE: ${i.cage_code}`, Array.isArray(i.certifications) && i.certifications.length && `Certs: ${i.certifications.join(', ')}`, i.primary_naics && `NAICS: ${Array.isArray(i.primary_naics) ? i.primary_naics.join(', ') : i.primary_naics}`].filter(Boolean).join(' | ');
    if (id) out.push(`Identity: ${id}`);
    if (i.one_liner) out.push(`One-liner: ${i.one_liner}`);
  }
  if (vault?.past_performance?.length) {
    out.push('Past performance:');
    for (const p of vault.past_performance.slice(0, 6)) {
      out.push(`- ${p.contract_title || 'Contract'} (${p.agency || '—'}${p.contract_value ? `, $${Number(p.contract_value).toLocaleString()}` : ''}): ${String(p.scope_description || '').slice(0, 240)}`);
    }
  }
  if (vault?.capabilities?.length) {
    out.push('Capabilities:');
    for (const c of vault.capabilities.slice(0, 8)) {
      out.push(`- ${c.capability_name}: ${String(c.description || '').slice(0, 160)}`);
    }
  }
  return out.join('\n');
}
