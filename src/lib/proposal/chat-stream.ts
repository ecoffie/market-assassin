/**
 * Client for the proposal chat stream (/api/app/proposal/chat, server-sent `data:` lines with
 * `{type:'token'|'sources'|'error'}`). Shared by Manual Drive's chat and the Word-style editor's
 * Ask Mindy panel so both read the stream the same way.
 */
import { authedFetch } from '@/components/app/authHeaders';

export interface ProposalChatTurn { role: 'user' | 'assistant'; content: string }

export interface StreamProposalChatInput {
  email: string;
  message: string;
  rfpText?: string;
  rfpFileName?: string;
  history?: ProposalChatTurn[];
  pipelineId?: string | null;
  signal?: AbortSignal;
  onToken: (text: string) => void;
  onSources?: (sources: string[]) => void;
}

/** Parse one SSE chunk's complete lines; returns the unfinished remainder. */
export function parseChatLines(
  buffer: string,
  handle: (ev: { type?: string; content?: string; message?: string; sources?: string[] }) => void,
): string {
  const lines = buffer.split('\n');
  const leftover = lines.pop() || '';
  for (const line of lines) {
    const l = line.trim();
    if (!l.startsWith('data:')) continue;
    try { handle(JSON.parse(l.slice(5).trim())); } catch { /* keep-alive / partial */ }
  }
  return leftover;
}

/** Streams an answer; resolves with the full text. Throws with the server's message on error. */
export async function streamProposalChat(input: StreamProposalChatInput): Promise<string> {
  const res = await authedFetch('/api/app/proposal/chat', input.email, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: input.signal,
    body: JSON.stringify({
      email: input.email,
      message: input.message,
      rfpText: input.rfpText || '',
      rfpFileName: input.rfpFileName || '',
      history: (input.history || []).slice(-6),
      pipeline_id: input.pipelineId || undefined,
    }),
  });
  if (!res.ok && !res.body) throw new Error(`Mindy could not answer (${res.status}).`);
  if (!res.body) throw new Error('No response from Mindy.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let leftover = '';
  let full = '';
  let error: string | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    leftover = parseChatLines(leftover + decoder.decode(value, { stream: true }), (ev) => {
      if (ev.type === 'token' && ev.content) { full += ev.content; input.onToken(ev.content); }
      else if (ev.type === 'sources') input.onSources?.(ev.sources || []);
      else if (ev.type === 'error') error = ev.message || 'Mindy could not answer.';
    });
  }
  if (error) throw new Error(error);
  if (!res.ok && !full) throw new Error(`Mindy could not answer (${res.status}).`);
  return full;
}
