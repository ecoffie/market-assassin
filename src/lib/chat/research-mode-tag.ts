/**
 * The "Research · Beta" tag on an Ask Mindy answer (Eric's rollout: research mode for everyone, labelled BETA).
 *
 * Live: a research turn's stream carries {type:'mode', mode:'research', beta:true, label} once, before the first
 * token. Reopen: the saved assistant row's trace has engine:'research_mode', beta:true, label; the sessions route
 * projects ONLY { label } from it (never the rest of the trace). Standard turns carry neither, so they get no tag.
 *
 * The label is server text shown as plain text: bounded, control characters stripped, and replaced by the default
 * when it is missing or not a short string.
 */
export const RESEARCH_BETA_LABEL_DEFAULT = 'Research · Beta';
const MAX_LABEL = 40;

export function cleanResearchLabel(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  return s && s.length <= MAX_LABEL ? s : RESEARCH_BETA_LABEL_DEFAULT;
}

/** From a live stream event: the tag label, or null for anything that is not a research-beta mode event. */
export function researchTagFromEvent(evt: unknown): string | null {
  if (!evt || typeof evt !== 'object') return null;
  const e = evt as { type?: unknown; mode?: unknown; beta?: unknown; label?: unknown };
  if (e.type !== 'mode' || e.mode !== 'research' || e.beta !== true) return null;
  return cleanResearchLabel(e.label);
}

/** From a saved trace (sessions route): { label } for a research-beta answer, else null. */
export function researchTagFromTrace(trace: unknown): { label: string } | null {
  if (!trace || typeof trace !== 'object') return null;
  const t = trace as { engine?: unknown; beta?: unknown; label?: unknown };
  if (t.engine !== 'research_mode' || t.beta !== true) return null;
  return { label: cleanResearchLabel(t.label) };
}
