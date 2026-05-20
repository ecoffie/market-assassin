'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppTier } from '../UnifiedSidebar';
import { getMIApiHeaders } from '../authHeaders';

interface ProposalsPanelProps {
  email: string | null;
  tier: AppTier;
}

interface PipelineOpportunity {
  id: string;
  title: string;
  agency?: string;
  notice_id?: string;
  external_url?: string;
  response_deadline?: string;
  naics_code?: string;
  set_aside?: string;
  priority?: string;
  stage?: string;
  notes?: string;
  next_action?: string;
  win_probability?: number;
}

const QUESTION_PROMPTS = [
  'What evaluation factors matter most, and are any more important than price?',
  'Are there incumbent performance issues or delivery risks we should address directly?',
  'Which past performance examples best match the scope, size, and customer environment?',
  'What partners, certifications, or contract vehicles reduce buyer risk?',
  'What assumptions need customer clarification before we commit bid resources?',
];

interface UploadedRfp {
  fileName: string;
  fileSize: number;
  charCount: number;
  pageCount?: number;
  text: string;
}

export default function ProposalsPanel({ email, tier }: ProposalsPanelProps) {
  const [opportunities, setOpportunities] = useState<PipelineOpportunity[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedRfp, setUploadedRfp] = useState<UploadedRfp | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const getAuthHeaders = useCallback((init?: HeadersInit) => getMIApiHeaders(email, init), [email]);

  const handleRfpFile = useCallback(async (file: File) => {
    if (!email) {
      setUploadError('Sign in required.');
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(`/api/app/proposal/upload?email=${encodeURIComponent(email)}`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setUploadError(data.error || 'Could not parse the file.');
        return;
      }
      setUploadedRfp({
        fileName: data.file?.name || file.name,
        fileSize: data.file?.size ?? file.size,
        charCount: data.charCount || 0,
        pageCount: data.pageCount,
        text: data.text || '',
      });
    } catch (err) {
      console.error('RFP upload failed:', err);
      setUploadError('Upload failed. Try again.');
    } finally {
      setUploading(false);
    }
  }, [email, getAuthHeaders]);

  const onFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleRfpFile(file);
    e.target.value = '';
  }, [handleRfpFile]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file) handleRfpFile(file);
  }, [handleRfpFile]);

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  const clearRfp = useCallback(() => {
    setUploadedRfp(null);
    setUploadError(null);
  }, []);

  const selectedOpportunity = useMemo(
    () => opportunities.find(opp => opp.id === selectedId) || opportunities[0] || null,
    [opportunities, selectedId]
  );

  const loadPipeline = useCallback(async () => {
    if (!email || tier === 'free') return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/pipeline?email=${encodeURIComponent(email)}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to load pursuits');
        return;
      }

      const active = (data.opportunities || []).filter((opp: PipelineOpportunity) => (
        !['won', 'lost', 'archived'].includes(opp.stage || '')
      ));
      setOpportunities(active);
      setSelectedId(current => current || active[0]?.id || '');
    } catch (err) {
      console.error('Failed to load proposal pursuits:', err);
      setError('Failed to load pursuits');
    } finally {
      setLoading(false);
    }
  }, [email, getAuthHeaders, tier]);

  useEffect(() => {
    loadPipeline();
  }, [loadPipeline]);

  if (tier === 'free') {
    return (
      <div className="p-6">
        <div className="border border-purple-500/30 bg-purple-950/20 p-8 text-center">
          <div className="text-4xl mb-4">📝</div>
          <h1 className="text-2xl font-bold text-white mb-3">Proposal Assist</h1>
          <p className="text-slate-400 mb-6 max-w-md mx-auto">
            Upgrade to turn saved pursuits into bid/no-bid risks, win themes, compliance prompts, and a first proposal outline.
          </p>
          <a
            href="/market-intelligence"
            className="inline-block px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors"
          >
            Upgrade to Pro
          </a>
        </div>
      </div>
    );
  }

  const pack = selectedOpportunity ? buildPrepPack(selectedOpportunity) : null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Proposal Assist</h1>
          <p className="text-slate-400 mt-1">Turn a saved pursuit into the first capture/proposal workspace.</p>
        </div>
        <button
          onClick={loadPipeline}
          disabled={loading}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 text-sm rounded-lg transition-colors"
        >
          {loading ? 'Refreshing...' : 'Refresh Pursuits'}
        </button>
      </div>

      {/* RFP Upload */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-purple-300 mb-1">Step 1 · Source Document</p>
            <h2 className="text-lg font-semibold text-white">Upload an RFP / Sources Sought / Solicitation</h2>
            <p className="text-sm text-slate-400 mt-1">
              PDF, DOCX, or TXT, up to 10 MB. Mindy extracts the text so future steps can pull compliance requirements and draft sections.
            </p>
          </div>
        </div>

        {!uploadedRfp ? (
          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            className="border border-dashed border-slate-700 rounded-lg p-8 text-center hover:border-purple-500/60 transition-colors"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              onChange={onFileInputChange}
              className="hidden"
            />
            <p className="text-slate-300">
              Drop a file here, or{' '}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="text-purple-300 hover:text-purple-200 underline disabled:opacity-50"
              >
                browse
              </button>
            </p>
            <p className="text-xs text-slate-500 mt-2">PDF · DOCX · TXT · max 10 MB</p>
            {uploading && (
              <p className="text-xs text-purple-300 mt-3 flex items-center justify-center gap-2">
                <span className="inline-block w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                Extracting text…
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950/50 border border-slate-800 rounded-lg p-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-2xl">📄</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{uploadedRfp.fileName}</p>
                  <p className="text-xs text-slate-500">
                    {(uploadedRfp.fileSize / 1024).toFixed(1)} KB · {uploadedRfp.charCount.toLocaleString()} chars
                    {uploadedRfp.pageCount ? ` · ${uploadedRfp.pageCount} page${uploadedRfp.pageCount === 1 ? '' : 's'}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-50"
                >
                  Replace
                </button>
                <button
                  type="button"
                  onClick={clearRfp}
                  disabled={uploading}
                  className="px-3 py-1.5 text-xs rounded-lg bg-slate-800 text-slate-400 hover:text-red-300 hover:bg-slate-700 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </div>

            <details className="bg-slate-950/40 border border-slate-800 rounded-lg">
              <summary className="cursor-pointer px-3 py-2 text-sm text-slate-300 hover:text-white">
                Preview extracted text ({uploadedRfp.text.length.toLocaleString()} chars)
              </summary>
              <pre className="px-3 pb-3 pt-1 text-xs text-slate-400 whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
                {uploadedRfp.text.slice(0, 5000)}
                {uploadedRfp.text.length > 5000 ? '\n\n…' : ''}
              </pre>
            </details>

            <p className="text-xs text-slate-500">
              Compliance matrix and section drafting coming next — for now this text is held in your session.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              onChange={onFileInputChange}
              className="hidden"
            />
          </div>
        )}

        {uploadError && (
          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {uploadError}
          </div>
        )}
      </section>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-300">
          {error}
        </div>
      )}

      {opportunities.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <h2 className="text-xl font-semibold text-white mb-2">Save a pursuit first</h2>
          <p className="text-slate-400">
            Use Today&apos;s Intel, Source Feed, Market Research, or Upcoming Buys to track an opportunity. Then Mindy can build a prep pack from it.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-6">
          <aside className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-wider text-slate-500 mb-2">
                Saved Pursuit
              </label>
              <select
                value={selectedOpportunity?.id || ''}
                onChange={(event) => setSelectedId(event.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white outline-none focus:border-purple-500"
              >
                {opportunities.map(opp => (
                  <option key={opp.id} value={opp.id}>{opp.title}</option>
                ))}
              </select>
            </div>

            {selectedOpportunity && (
              <div className="space-y-3 text-sm">
                <Meta label="Agency" value={selectedOpportunity.agency || 'Unknown'} />
                <Meta label="Due" value={formatDate(selectedOpportunity.response_deadline)} />
                <Meta label="NAICS" value={selectedOpportunity.naics_code || '-'} />
                <Meta label="Set-aside" value={selectedOpportunity.set_aside || '-'} />
                <Meta label="Stage" value={selectedOpportunity.stage || 'tracking'} />
              </div>
            )}
          </aside>

          {pack && (
            <main className="space-y-5">
              <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-purple-300 mb-2">Proposal Prep Pack V1</p>
                    <h2 className="text-xl font-semibold text-white">{pack.title}</h2>
                    <p className="text-slate-400 mt-2">{pack.summary}</p>
                  </div>
                  {selectedOpportunity?.external_url && (
                    <a
                      href={selectedOpportunity.external_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg"
                    >
                      View Source
                    </a>
                  )}
                </div>
              </section>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <PrepSection title="Bid / No-Bid Risks" items={pack.risks} tone="amber" />
                <PrepSection title="Win Themes" items={pack.winThemes} tone="emerald" />
                <PrepSection title="Compliance Checklist" items={pack.checklist} tone="purple" />
                <PrepSection title="Questions To Ask" items={pack.questions} tone="blue" />
              </div>

              <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <h3 className="font-semibold text-white mb-3">Draft Outline</h3>
                <ol className="space-y-2">
                  {pack.outline.map(item => (
                    <li key={item} className="text-sm text-slate-300">
                      <span className="text-slate-500 mr-2">-</span>{item}
                    </li>
                  ))}
                </ol>
              </section>
            </main>
          )}
        </div>
      )}
    </div>
  );
}

function buildPrepPack(opp: PipelineOpportunity) {
  const agency = opp.agency || 'the target agency';
  const setAside = opp.set_aside || 'the stated solicitation terms';
  const due = formatDate(opp.response_deadline);
  const naics = opp.naics_code || 'the opportunity NAICS';

  return {
    title: opp.title,
    summary: `${opp.title} is currently in ${opp.stage || 'tracking'} for ${agency}. Use this pack to decide bid fit, prepare customer questions, and start a compliant response outline before deeper proposal drafting.`,
    risks: [
      due !== 'No date set' ? `Deadline pressure: response is due ${due}. Confirm enough time for review, pricing, and signatures.` : 'Deadline is missing. Confirm solicitation timeline before committing resources.',
      `Scope fit: validate that ${naics} matches your strongest past performance and not just your broad capability set.`,
      `Competitive posture: identify incumbent, known primes, or likely low-price competitors before spending proposal hours.`,
      `Set-aside fit: confirm ${setAside} requirements and required certifications.`,
    ],
    winThemes: [
      `Lower buyer risk for ${agency} by tying your approach to measurable delivery outcomes.`,
      'Use relevant past performance first, then technical approach, then price story.',
      'Show how your team can start fast without adding contract administration burden.',
      opp.win_probability ? `Anchor the capture story around the ${opp.win_probability}% current win probability drivers.` : 'Document the top three reasons you should win before drafting.',
    ],
    checklist: [
      'Confirm solicitation number, due date, submission portal, and amendment status.',
      'List every required volume, attachment, certification, representation, and signature.',
      'Map each evaluation factor to an owner and evidence source.',
      'Create a compliance matrix before writing narrative sections.',
      'Schedule red-team review before final pricing and submission.',
    ],
    questions: QUESTION_PROMPTS,
    outline: [
      'Executive summary and understanding of the agency mission',
      'Technical approach mapped to each requirement',
      'Management plan, staffing, and quality controls',
      'Relevant past performance and proof points',
      'Risk mitigation and transition/startup plan',
      'Price/value narrative and required attachments',
    ],
  };
}

function PrepSection({ title, items, tone }: { title: string; items: string[]; tone: 'amber' | 'emerald' | 'purple' | 'blue' }) {
  const colors = {
    amber: 'border-amber-500/30 text-amber-300',
    emerald: 'border-emerald-500/30 text-emerald-300',
    purple: 'border-purple-500/30 text-purple-300',
    blue: 'border-blue-500/30 text-blue-300',
  };

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <h3 className={`font-semibold mb-3 ${colors[tone]}`}>{title}</h3>
      <ul className="space-y-2">
        {items.map(item => (
          <li key={item} className="text-sm leading-relaxed text-slate-300">
            <span className="text-slate-500 mr-2">-</span>{item}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-800/70 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-slate-200 mt-1">{value}</div>
    </div>
  );
}

function formatDate(value?: string) {
  if (!value) return 'No date set';
  try {
    return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return value;
  }
}
