'use client';

/**
 * Proposal Wizard — Stage 2 (Compliance Matrix)
 *
 * Extracts every shall/must/will/required clause from the RFP into a
 * structured checklist a writer or sub can work from directly. Hydrates
 * from cache on mount, generates on demand.
 *
 * UX choices:
 *   - Group items by category so the proposal lead can hand each
 *     section to the right SME.
 *   - Lead with the critical count — the show-stoppers are the answer
 *     to "should we bid at all?"
 *   - Mirror the Stage 1 layout/colors so the wizard feels like one
 *     coherent flow.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, AlertCircle, ArrowRight, ListChecks, ShieldAlert, AlertTriangle, Info } from 'lucide-react';

type ComplianceCategory = 'technical' | 'management' | 'past_performance' | 'pricing' | 'admin' | 'other';
type CompliancePriority = 'critical' | 'important' | 'minor';

interface ComplianceItem {
  source: string;
  requirement: string;
  category: ComplianceCategory;
  priority: CompliancePriority;
  notes: string;
}

interface ComplianceArtifact {
  stage: 'compliance';
  generated_at: string;
  ai_model: string;
  pursuit_id: string;
  items: ComplianceItem[];
  total_count: number;
  critical_count: number;
  generated_from_metadata_only: boolean;
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
  /** Called when user advances past Compliance Matrix. Stage 3 (Win
   *  Themes) is opt-in, so the parent may offer "Skip to Outline". */
  onContinue?: () => void;
  authHeaders: () => Headers | Record<string, string>;
}

function mergeHeaders(extra: Headers | Record<string, string>, base?: Record<string, string>): HeadersInit {
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

const CATEGORY_LABELS: Record<ComplianceCategory, string> = {
  technical: 'Technical',
  management: 'Management',
  past_performance: 'Past Performance',
  pricing: 'Pricing',
  admin: 'Admin / Submission',
  other: 'Other',
};

const CATEGORY_ORDER: ComplianceCategory[] = [
  'admin', 'technical', 'management', 'past_performance', 'pricing', 'other',
];

const PRIORITY_RANK: Record<CompliancePriority, number> = {
  critical: 0,
  important: 1,
  minor: 2,
};

export default function ProposalWizardCompliance({ email, pursuitId, onContinue, authHeaders }: Props) {
  const [phase, setPhase] = useState<Phase>('hydrating');
  const [error, setError] = useState<string | null>(null);
  const [pursuit, setPursuit] = useState<PursuitSummary | null>(null);
  const [artifact, setArtifact] = useState<ComplianceArtifact | null>(null);
  const [filter, setFilter] = useState<'all' | CompliancePriority>('all');

  const apiUrl = useMemo(
    () => `/api/app/proposal/wizard?email=${encodeURIComponent(email)}&pipeline_id=${encodeURIComponent(pursuitId)}&stage=compliance`,
    [email, pursuitId],
  );

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
          setArtifact(data.artifact as ComplianceArtifact);
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
      setArtifact(data.artifact as ComplianceArtifact);
      setPhase('ready');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setError(msg);
      setPhase('error');
    }
  }, [apiUrl, authHeaders]);

  const docsMissing = pursuit?.docs_status === 'none' || (pursuit?.docs_count ?? 0) === 0;

  const grouped = useMemo(() => {
    if (!artifact) return [] as Array<{ category: ComplianceCategory; items: ComplianceItem[] }>;
    const visible = artifact.items.filter(i => filter === 'all' || i.priority === filter);
    const byCat = new Map<ComplianceCategory, ComplianceItem[]>();
    for (const item of visible) {
      const arr = byCat.get(item.category) || [];
      arr.push(item);
      byCat.set(item.category, arr);
    }
    // Sort within each category by priority
    for (const arr of byCat.values()) {
      arr.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
    }
    return CATEGORY_ORDER
      .filter(c => byCat.has(c))
      .map(c => ({ category: c, items: byCat.get(c)! }));
  }, [artifact, filter]);

  return (
    <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/80 shadow-lg shadow-purple-900/10">
      {/* Header */}
      <div className="border-b border-slate-800 px-5 py-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-purple-300 font-semibold">
            <span>Step 2 of 4</span>
            <span className="text-slate-700">·</span>
            <span>Proposal Wizard</span>
          </div>
          <h2 className="mt-1 text-lg font-semibold text-white">Compliance Matrix</h2>
          <p className="mt-0.5 text-xs text-slate-400 max-w-xl">
            Every &ldquo;shall / must / will&rdquo; clause pulled from the RFP, grouped by where it belongs in your proposal.
          </p>
        </div>
        {artifact && (
          <button
            type="button"
            onClick={() => generate(true)}
            disabled={phase === 'generating'}
            className="shrink-0 inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-purple-300 disabled:opacity-40"
            title="Regenerate the compliance matrix"
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
            Loading compliance matrix…
          </div>
        )}

        {phase === 'error' && error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-200">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" strokeWidth={1.75} />
            <div className="min-w-0">
              <div className="font-medium">Couldn&apos;t build the compliance matrix</div>
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
                ⓘ No SAM attachments on this pursuit — the matrix needs RFP text. Upload the RFP, then come back.
              </div>
            )}
            <p className="text-sm text-slate-300">
              Ready to extract requirements from <span className="font-semibold text-white">{pursuit.title}</span>{pursuit.agency ? <span className="text-slate-400"> ({pursuit.agency})</span> : null}.
            </p>
            <button
              type="button"
              onClick={() => generate()}
              disabled={docsMissing}
              className="inline-flex items-center gap-2 rounded-md bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 disabled:text-slate-400 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-900/40"
            >
              <ListChecks className="w-4 h-4" strokeWidth={2} />
              Build compliance matrix
            </button>
            <p className="text-[11px] text-slate-500">Takes ~20-40 seconds. Saved automatically — coming back is instant.</p>
          </div>
        )}

        {phase === 'generating' && (
          <div className="flex items-center gap-3 rounded-lg border border-purple-900/40 bg-purple-950/20 p-4 text-sm text-purple-200">
            <Loader2 className="w-5 h-5 animate-spin text-purple-300" strokeWidth={1.75} />
            <div>
              <div className="font-medium">Mindy is shredding the RFP…</div>
              <div className="text-[11px] text-purple-300/70 mt-0.5">Pulling every shall, must, and will clause.</div>
            </div>
          </div>
        )}

        {phase === 'ready' && artifact && (
          <div className="space-y-5">
            {/* Summary strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <SummaryStat label="Total requirements" value={artifact.total_count} accent="slate" />
              <SummaryStat label="Critical" value={artifact.critical_count} accent="red" />
              <SummaryStat
                label="Important"
                value={artifact.items.filter(i => i.priority === 'important').length}
                accent="amber"
              />
              <SummaryStat
                label="Categories"
                value={new Set(artifact.items.map(i => i.category)).size}
                accent="purple"
              />
            </div>

            {artifact.generated_from_metadata_only && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" strokeWidth={1.75} />
                <div>
                  No RFP text was available, so this matrix is empty. Upload the RFP and regenerate.
                </div>
              </div>
            )}

            {artifact.items.length > 0 && (
              <>
                {/* Filter row */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mr-1">Filter</span>
                  <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} label={`All (${artifact.total_count})`} />
                  <FilterChip active={filter === 'critical'} onClick={() => setFilter('critical')} label={`Critical (${artifact.critical_count})`} accent="red" />
                  <FilterChip
                    active={filter === 'important'}
                    onClick={() => setFilter('important')}
                    label={`Important (${artifact.items.filter(i => i.priority === 'important').length})`}
                    accent="amber"
                  />
                  <FilterChip
                    active={filter === 'minor'}
                    onClick={() => setFilter('minor')}
                    label={`Minor (${artifact.items.filter(i => i.priority === 'minor').length})`}
                    accent="slate"
                  />
                </div>

                {/* Grouped items */}
                <div className="space-y-4">
                  {grouped.map(g => (
                    <CategoryGroup key={g.category} category={g.category} items={g.items} />
                  ))}
                  {grouped.length === 0 && (
                    <p className="text-xs text-slate-500 italic">No requirements match this filter.</p>
                  )}
                </div>
              </>
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
                title={onContinue ? 'Continue to Win Themes (optional) or Section Outline' : 'Stage 3 coming next'}
              >
                Continue
                <ArrowRight className="w-4 h-4" strokeWidth={2} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface SummaryStatProps {
  label: string;
  value: number;
  accent: 'slate' | 'red' | 'amber' | 'purple';
}

function SummaryStat({ label, value, accent }: SummaryStatProps) {
  const color = {
    slate: 'text-slate-200 border-slate-800',
    red: 'text-red-300 border-red-900/60',
    amber: 'text-amber-300 border-amber-900/60',
    purple: 'text-purple-300 border-purple-900/60',
  }[accent];
  return (
    <div className={`rounded-lg border ${color} bg-slate-950/40 px-3 py-2`}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</div>
      <div className={`text-lg font-semibold mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}

interface FilterChipProps {
  active: boolean;
  onClick: () => void;
  label: string;
  accent?: 'red' | 'amber' | 'slate';
}

function FilterChip({ active, onClick, label, accent = 'slate' }: FilterChipProps) {
  const activeColor = {
    red: 'bg-red-600 text-white',
    amber: 'bg-amber-600 text-white',
    slate: 'bg-purple-600 text-white',
  }[accent];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 text-[11px] rounded-full border transition ${
        active
          ? `${activeColor} border-transparent`
          : 'bg-slate-950/40 border-slate-800 text-slate-300 hover:border-slate-700'
      }`}
    >
      {label}
    </button>
  );
}

interface CategoryGroupProps {
  category: ComplianceCategory;
  items: ComplianceItem[];
}

function CategoryGroup({ category, items }: CategoryGroupProps) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-300 font-semibold mb-2 flex items-center gap-2">
        <span>{CATEGORY_LABELS[category]}</span>
        <span className="text-slate-600">·</span>
        <span className="text-slate-500 normal-case tracking-normal font-normal">{items.length} item{items.length === 1 ? '' : 's'}</span>
      </div>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <ComplianceRow key={`${category}-${i}`} item={item} />
        ))}
      </ul>
    </div>
  );
}

function ComplianceRow({ item }: { item: ComplianceItem }) {
  const priorityColor = {
    critical: 'border-red-900/60 bg-red-950/20',
    important: 'border-amber-900/60 bg-amber-950/10',
    minor: 'border-slate-800 bg-slate-950/40',
  }[item.priority];

  const priorityIcon = item.priority === 'critical'
    ? <ShieldAlert className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" strokeWidth={1.75} />
    : item.priority === 'important'
      ? <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" strokeWidth={1.75} />
      : <Info className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" strokeWidth={1.75} />;

  return (
    <li className={`rounded-lg border ${priorityColor} px-3 py-2.5`}>
      <div className="flex items-start gap-2">
        {priorityIcon}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            {item.source && (
              <span className="text-[10px] font-mono text-slate-400 bg-slate-900/60 rounded px-1.5 py-0.5">{item.source}</span>
            )}
            <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">{item.priority}</span>
          </div>
          <p className="text-[13px] text-slate-100 leading-relaxed mt-1">{item.requirement}</p>
          {item.notes && (
            <p className="text-[11px] text-slate-400 italic mt-1">{item.notes}</p>
          )}
        </div>
      </div>
    </li>
  );
}
