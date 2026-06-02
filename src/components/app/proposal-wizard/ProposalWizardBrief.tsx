'use client';

/**
 * Proposal Wizard — Stage 1 (RFP Brief)
 *
 * Hydrates on mount: GET /api/app/proposal/wizard?stage=brief returns
 * the cached artifact if one exists, else null. User can tap
 * "Generate brief" to run the LLM; the result persists to
 * user_generated_archive so the next visit is instant.
 *
 * Stage 2-4 will be additional component files in this folder and
 * the wizard shell that strings them together lands later. For now,
 * Stage 1 is a self-contained card the user gets dropped onto from
 * the Pipeline's Draft Proposal button.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, AlertCircle, ArrowRight, FileText, Calendar, Target, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface BriefArtifact {
  stage: 'brief';
  generated_at: string;
  ai_model: string;
  pursuit_id: string;
  summary: string;
  what_they_want: string[];
  hard_parts: string[];
  required: string[];
  deadlines: string[];
  next_action: string;
}

interface PursuitSummary {
  id: string;
  title: string;
  agency: string | null;
  notice_id: string | null;
  naics_code: string | null;
  set_aside: string | null;
  response_deadline: string | null;
  docs_status: string | null;
  docs_count: number | null;
}

interface Props {
  email: string;
  pursuitId: string;
  /** Short SAM notice-type label ("Sources Sought", "Solicitation / RFP",
   *  "RFQ", …) derived from the pursuit. Shown as a badge so the user knows
   *  the notice type up front — even when there's no attachment to parse —
   *  and can check the matching briefing. null hides the badge. */
  noticeType?: string | null;
  /** Called when user taps "Continue to Compliance Matrix". Future
   *  stage 2 lives here; for now the parent can show a placeholder
   *  message or scroll back to the legacy Proposal Assist surface. */
  onContinue?: () => void;
  /** Auth header builder shared with the rest of /app. Returns either
   *  a Headers instance or a plain object — both fetch() understand. */
  authHeaders: () => Headers | Record<string, string>;
}

function mergeHeaders(extra: Headers | Record<string, string>, base?: Record<string, string>): HeadersInit {
  // Normalize the shared getAuthHeaders() output back into a plain
  // record so we can spread the JSON Content-Type alongside it.
  const out: Record<string, string> = base ? { ...base } : {};
  if (extra instanceof Headers) {
    extra.forEach((value, key) => { out[key] = value; });
  } else {
    Object.assign(out, extra);
  }
  return out;
}

type Phase = 'hydrating' | 'idle' | 'generating' | 'ready' | 'error';

function relativeTimeSince(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function ProposalWizardBrief({ email, pursuitId, noticeType, onContinue, authHeaders }: Props) {
  const [phase, setPhase] = useState<Phase>('hydrating');
  const [error, setError] = useState<string | null>(null);
  const [pursuit, setPursuit] = useState<PursuitSummary | null>(null);
  const [artifact, setArtifact] = useState<BriefArtifact | null>(null);

  const apiUrl = useMemo(
    () => `/api/app/proposal/wizard?email=${encodeURIComponent(email)}&pipeline_id=${encodeURIComponent(pursuitId)}&stage=brief`,
    [email, pursuitId],
  );

  // Hydrate: read any previously-cached brief without spending tokens.
  useEffect(() => {
    let cancelled = false;
    setPhase('hydrating');
    setError(null);
    fetch(apiUrl, { headers: mergeHeaders(authHeaders()) })
      .then(async res => {
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || `Hydrate failed (${res.status})`);
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setPursuit(data.pursuit || null);
        if (data.artifact) {
          setArtifact(data.artifact as BriefArtifact);
          setPhase('ready');
        } else {
          setPhase('idle');
        }
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setPhase('error');
      });
    return () => { cancelled = true; };
  }, [apiUrl, authHeaders]);

  const generate = useCallback(async (force = false) => {
    setPhase('generating');
    setError(null);
    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: mergeHeaders(authHeaders(), { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `Generate failed (${res.status})`);
      setArtifact(data.artifact as BriefArtifact);
      setPhase('ready');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setError(msg);
      setPhase('error');
    }
  }, [apiUrl, authHeaders]);

  const docsMissing = pursuit?.docs_status === 'none' || (pursuit?.docs_count ?? 0) === 0;

  return (
    <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/80 shadow-lg shadow-purple-900/10">
      {/* Header */}
      <div className="border-b border-slate-800 px-5 py-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-purple-300 font-semibold">
            <span>Step 1 of 3</span>
            <span className="text-slate-700">·</span>
            <span>Proposal Wizard</span>
          </div>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-semibold text-white">RFP Brief</h2>
            {noticeType && (
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                  /sources sought|rfi/i.test(noticeType)
                    ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                    : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                }`}
                title="SAM.gov notice type for this pursuit — check the matching briefing"
              >
                {noticeType}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-400 max-w-xl">
            {noticeType && /sources sought|rfi/i.test(noticeType)
              ? 'This is a pre-solicitation notice — not a biddable RFP yet. Mindy briefs it as a capability-statement opportunity.'
              : 'Mindy reads the RFP and tells you what it actually says — in plain English. 2 minutes here saves an hour of skimming.'}
          </p>
        </div>
        {artifact && (
          <button
            type="button"
            onClick={() => generate(true)}
            disabled={phase === 'generating'}
            className="shrink-0 inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-purple-300 disabled:opacity-40"
            title="Regenerate the brief"
          >
            <RefreshCw className={`w-3 h-3 ${phase === 'generating' ? 'animate-spin' : ''}`} strokeWidth={1.75} />
            Regenerate
          </button>
        )}
      </div>

      {/* Body */}
      <div className="p-5">
        {phase === 'hydrating' && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.75} />
            Loading pursuit…
          </div>
        )}

        {phase === 'error' && error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-200">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={1.75} />
            <div className="min-w-0">
              <div className="font-medium">Couldn&apos;t generate the brief</div>
              <div className="text-xs text-red-300/80 mt-1 break-words">{error}</div>
              <button
                type="button"
                onClick={() => generate()}
                className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-red-800/60 hover:bg-red-700/60 text-red-100"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {phase === 'idle' && pursuit && (
          <div className="space-y-4">
            {docsMissing && (
              <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
                ⓘ No SAM attachments on this pursuit. The brief will work from the metadata only — for the best result, upload the RFP below first.
              </div>
            )}
            <p className="text-sm text-slate-300">
              Ready to generate a brief for <span className="font-semibold text-white">{pursuit.title}</span>{pursuit.agency ? <span className="text-slate-400"> ({pursuit.agency})</span> : null}
              {noticeType ? <span className="text-slate-400"> — this is a <span className="font-semibold text-slate-200">{noticeType}</span> notice.</span> : '.'}
            </p>
            <button
              type="button"
              onClick={() => generate()}
              className="inline-flex items-center gap-2 rounded-md bg-purple-600 hover:bg-purple-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-900/40"
            >
              <FileText className="w-4 h-4" strokeWidth={2} />
              Generate brief
            </button>
            <p className="text-[11px] text-slate-500">Takes ~15-30 seconds. Once generated, the brief is saved — coming back is instant.</p>
          </div>
        )}

        {phase === 'generating' && (
          <div className="flex items-center gap-3 rounded-lg border border-purple-900/40 bg-purple-950/20 p-4 text-sm text-purple-200">
            <Loader2 className="w-5 h-5 animate-spin text-purple-300" strokeWidth={1.75} />
            <div>
              <div className="font-medium">Mindy is reading the RFP…</div>
              <div className="text-[11px] text-purple-300/70 mt-0.5">Extracting scope, requirements, and deadlines.</div>
            </div>
          </div>
        )}

        {phase === 'ready' && artifact && (
          <div className="space-y-5">
            {/* Summary */}
            {artifact.summary && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">In plain English</div>
                <p className="text-sm text-slate-100 leading-relaxed">{artifact.summary}</p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* What they want */}
              <BulletCard
                icon={<Target className="w-4 h-4 text-emerald-300" strokeWidth={1.75} />}
                title="What they want"
                items={artifact.what_they_want}
                emptyText="No scope clearly stated in the source."
                accent="emerald"
              />

              {/* Hard parts */}
              <BulletCard
                icon={<AlertTriangle className="w-4 h-4 text-amber-300" strokeWidth={1.75} />}
                title="Hard parts"
                items={artifact.hard_parts}
                emptyText="Nothing flagged as risky."
                accent="amber"
              />

              {/* Required */}
              <BulletCard
                icon={<CheckCircle2 className="w-4 h-4 text-blue-300" strokeWidth={1.75} />}
                title="Show-stoppers"
                items={artifact.required}
                emptyText="No hard requirements flagged."
                accent="blue"
              />

              {/* Deadlines */}
              <BulletCard
                icon={<Calendar className="w-4 h-4 text-purple-300" strokeWidth={1.75} />}
                title="Deadlines"
                items={artifact.deadlines}
                emptyText="No dates extracted."
                accent="purple"
                mono
              />
            </div>

            {/* Next action */}
            {artifact.next_action && (
              <div className="rounded-lg border border-purple-500/30 bg-purple-950/20 p-3">
                <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold mb-1">Your next action</div>
                <p className="text-sm text-purple-100">{artifact.next_action}</p>
              </div>
            )}

            {/* Footer */}
            <div className="flex flex-col-reverse md:flex-row md:items-center md:justify-between gap-3 pt-2 border-t border-slate-800/60">
              <div className="text-[11px] text-slate-500">
                Generated {relativeTimeSince(artifact.generated_at)} · {artifact.ai_model}
              </div>
              <button
                type="button"
                onClick={onContinue}
                disabled={!onContinue}
                className="inline-flex items-center gap-2 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-400 px-4 py-2 text-sm font-semibold text-white"
                title={onContinue ? 'Continue to Compliance Matrix (Stage 2)' : 'Stage 2 coming next'}
              >
                Continue to Compliance Matrix
                <ArrowRight className="w-4 h-4" strokeWidth={2} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface BulletCardProps {
  icon: React.ReactNode;
  title: string;
  items: string[];
  emptyText: string;
  accent: 'emerald' | 'amber' | 'blue' | 'purple';
  mono?: boolean;
}

function BulletCard({ icon, title, items, emptyText, accent, mono }: BulletCardProps) {
  const borderColor = {
    emerald: 'border-emerald-900/40',
    amber: 'border-amber-900/40',
    blue: 'border-blue-900/40',
    purple: 'border-purple-900/40',
  }[accent];

  return (
    <div className={`rounded-lg border ${borderColor} bg-slate-950/40 p-3`}>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <div className="text-[10px] uppercase tracking-wider text-slate-300 font-semibold">{title}</div>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-slate-500 italic">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <li key={i} className={`text-[13px] text-slate-200 leading-relaxed flex gap-2 ${mono ? 'font-mono text-[12px]' : ''}`}>
              <span className="text-slate-600 shrink-0">·</span>
              <span className="min-w-0">{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
