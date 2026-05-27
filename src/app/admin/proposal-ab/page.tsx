'use client';

/**
 * Proposal Assist A/B viewer.
 *
 * Paste an RFP text + pick a section type, see v1 vs v2 drafts side-
 * by-side. Use this to judge whether v2's added layers (agency context,
 * lenses, humanization, section voices) produce visibly better drafts
 * before we flip production to the new pipeline.
 */

import { useState } from 'react';
import Link from 'next/link';

type SectionType =
  | 'exec_summary' | 'technical' | 'management' | 'past_performance' | 'pricing'
  | 'company_overview' | 'cap_past_performance' | 'capabilities' | 'differentiators' | 'poc';

const SECTION_OPTIONS: { value: SectionType; label: string; group: 'RFP' | 'Cap Statement' }[] = [
  { value: 'exec_summary', label: 'Executive Summary', group: 'RFP' },
  { value: 'technical', label: 'Technical Approach', group: 'RFP' },
  { value: 'management', label: 'Management Plan', group: 'RFP' },
  { value: 'past_performance', label: 'Past Performance', group: 'RFP' },
  { value: 'pricing', label: 'Pricing Narrative', group: 'RFP' },
  { value: 'company_overview', label: 'Company Overview', group: 'Cap Statement' },
  { value: 'cap_past_performance', label: 'Relevant Past Performance', group: 'Cap Statement' },
  { value: 'capabilities', label: 'Capabilities', group: 'Cap Statement' },
  { value: 'differentiators', label: 'Differentiators', group: 'Cap Statement' },
  { value: 'poc', label: 'Point of Contact', group: 'Cap Statement' },
];

interface VersionResult {
  draft?: string;
  wordCount?: number;
  meta?: {
    pipeline: 'v1' | 'v2';
    agencyDetected?: string | null;
    painPointsUsed?: number;
    lensId?: string | null;
    ragChunksUsed?: number;
    vaultGrounded?: boolean;
    vaultCounts?: { past_performance: number; capabilities: number; team: number };
    humanized?: boolean;
  };
  prompt?: { system: string; user: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context?: any;
  error?: string;
}

interface AbResponse {
  success: boolean;
  sectionType?: SectionType;
  elapsedMs?: number;
  v1?: VersionResult;
  v2?: VersionResult;
  error?: string;
}

export default function ProposalAbPage() {
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);

  const [email, setEmail] = useState('evankoffdev@gmail.com');
  const [sectionType, setSectionType] = useState<SectionType>('past_performance');
  const [rfpAgency, setRfpAgency] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AbResponse | null>(null);
  const [showPrompts, setShowPrompts] = useState(false);

  async function handleRun() {
    if (!sourceText.trim()) {
      alert('Paste an RFP / source text first.');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`/api/admin/proposal-ab?password=${encodeURIComponent(password)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sectionType,
          sourceText,
          email,
          rfpAgency: rfpAgency || null,
          fileName: 'a-b-test.txt',
        }),
      });
      const data: AbResponse = await res.json();
      setResult(data);
    } catch (err) {
      setResult({ success: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }

  if (!authed) {
    return (
      <main className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <form
          onSubmit={(e) => { e.preventDefault(); if (password) setAuthed(true); }}
          className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4"
        >
          <h1 className="text-xl font-semibold text-white">Proposal A/B</h1>
          <p className="text-sm text-slate-400">Admin password to compare v1 vs v2 Proposal Assist outputs.</p>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Admin password"
            className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white"
            autoFocus
          />
          <button type="submit" className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded">
            Enter
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-200">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Proposal Assist · v1 vs v2</h1>
          <p className="text-sm text-slate-400">
            Compare current production prompt to the layered v2 architecture (agency pain points + lenses + section voices + humanization).
          </p>
        </div>
        <Link href="/admin" className="text-sm text-slate-400 hover:text-white">← Admin</Link>
      </header>

      <div className="p-6 grid grid-cols-1 xl:grid-cols-[1fr_2fr] gap-6">
        {/* Inputs */}
        <section className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">User email (for vault context)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white text-sm"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">Section to draft</label>
            <select
              value={sectionType}
              onChange={(e) => setSectionType(e.target.value as SectionType)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white text-sm"
            >
              <optgroup label="RFP">
                {SECTION_OPTIONS.filter(s => s.group === 'RFP').map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </optgroup>
              <optgroup label="Capability Statement">
                {SECTION_OPTIONS.filter(s => s.group === 'Cap Statement').map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </optgroup>
            </select>
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">RFP agency (optional — overrides detection)</label>
            <input
              type="text"
              value={rfpAgency}
              onChange={(e) => setRfpAgency(e.target.value)}
              placeholder='e.g. "Department of the Navy" (leave blank to auto-detect)'
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white text-sm"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">Source RFP text</label>
            <textarea
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder="Paste RFP, Sources Sought, or any solicitation text here..."
              rows={20}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white text-xs font-mono"
            />
            <p className="text-xs text-slate-500 mt-1">{sourceText.length.toLocaleString()} chars</p>
          </div>

          <button
            onClick={handleRun}
            disabled={loading || !sourceText.trim()}
            className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium rounded"
          >
            {loading ? 'Running both pipelines…' : 'Compare v1 vs v2'}
          </button>

          {result?.elapsedMs && (
            <p className="text-xs text-slate-500 text-center">Total time: {result.elapsedMs.toLocaleString()}ms</p>
          )}
        </section>

        {/* Output */}
        <section>
          {!result && (
            <div className="text-center text-slate-500 py-20 border-2 border-dashed border-slate-800 rounded-xl">
              Paste an RFP + click Compare. Both pipelines run in parallel.
            </div>
          )}

          {result && !result.success && (
            <div className="text-rose-300 bg-rose-950/40 border border-rose-900 rounded p-4">
              Error: {result.error}
            </div>
          )}

          {result?.success && (
            <div className="space-y-4">
              {/* Compare meta side-by-side */}
              <div className="grid grid-cols-2 gap-4">
                <MetaPanel label="v1 (current production)" data={result.v1} accent="rose" />
                <MetaPanel label="v2 (new architecture)" data={result.v2} accent="emerald" />
              </div>

              {/* Drafts side-by-side */}
              <div className="grid grid-cols-2 gap-4">
                <DraftPanel label="v1 draft" data={result.v1} accent="rose" />
                <DraftPanel label="v2 draft" data={result.v2} accent="emerald" />
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowPrompts(s => !s)}
                  className="text-sm text-slate-400 hover:text-white"
                >
                  {showPrompts ? 'Hide' : 'Show'} system + user prompts
                </button>
              </div>

              {showPrompts && (
                <div className="grid grid-cols-2 gap-4">
                  <PromptPanel label="v1 prompt" data={result.v1} />
                  <PromptPanel label="v2 prompt" data={result.v2} />
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function MetaPanel({ label, data, accent }: { label: string; data?: VersionResult; accent: 'rose' | 'emerald' }) {
  const borderColor = accent === 'rose' ? 'border-rose-900' : 'border-emerald-900';
  if (!data || data.error) {
    return (
      <div className={`border ${borderColor} rounded-lg p-3 bg-slate-900`}>
        <p className="text-xs uppercase tracking-wider text-slate-400 mb-2">{label}</p>
        <p className="text-rose-300 text-sm">Error: {data?.error || 'No result'}</p>
      </div>
    );
  }
  const m = data.meta || { pipeline: 'v1' as const };
  return (
    <div className={`border ${borderColor} rounded-lg p-3 bg-slate-900 text-xs space-y-1`}>
      <p className="text-xs uppercase tracking-wider text-slate-400 mb-2">{label}</p>
      <Stat k="Pipeline" v={m.pipeline} />
      <Stat k="Words" v={String(data.wordCount || 0)} />
      <Stat k="Agency detected" v={m.agencyDetected || '—'} />
      <Stat k="Pain points used" v={String(m.painPointsUsed ?? 0)} />
      <Stat k="Lens" v={m.lensId || '—'} />
      <Stat k="RAG chunks" v={String(m.ragChunksUsed ?? 0)} />
      <Stat k="Vault grounded" v={m.vaultGrounded ? 'yes' : 'no'} />
      <Stat k="Humanized" v={m.humanized ? 'yes' : 'no'} />
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-slate-500">{k}</span>
      <span className="text-slate-200 truncate">{v}</span>
    </div>
  );
}

function DraftPanel({ label, data, accent }: { label: string; data?: VersionResult; accent: 'rose' | 'emerald' }) {
  const borderColor = accent === 'rose' ? 'border-rose-900' : 'border-emerald-900';
  if (!data || data.error || !data.draft) {
    return (
      <div className={`border ${borderColor} rounded-lg p-4 bg-slate-900`}>
        <p className="text-xs uppercase tracking-wider text-slate-400 mb-2">{label}</p>
        <p className="text-slate-500 text-sm">{data?.error || 'No draft'}</p>
      </div>
    );
  }
  return (
    <div className={`border ${borderColor} rounded-lg p-4 bg-slate-900 max-h-[600px] overflow-y-auto`}>
      <p className="text-xs uppercase tracking-wider text-slate-400 mb-3">{label}</p>
      <div className="prose prose-sm prose-invert whitespace-pre-wrap text-slate-200 text-sm">{data.draft}</div>
    </div>
  );
}

function PromptPanel({ label, data }: { label: string; data?: VersionResult }) {
  if (!data?.prompt) {
    return (
      <div className="border border-slate-800 rounded-lg p-3 bg-slate-950">
        <p className="text-xs uppercase tracking-wider text-slate-400 mb-2">{label}</p>
        <p className="text-slate-500 text-sm">No prompt available</p>
      </div>
    );
  }
  return (
    <div className="border border-slate-800 rounded-lg p-3 bg-slate-950 max-h-[400px] overflow-y-auto">
      <p className="text-xs uppercase tracking-wider text-slate-400 mb-2">{label}</p>
      <details className="mb-2">
        <summary className="text-xs text-slate-400 cursor-pointer hover:text-white">System prompt</summary>
        <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap mt-2">{data.prompt.system}</pre>
      </details>
      <details>
        <summary className="text-xs text-slate-400 cursor-pointer hover:text-white">User prompt</summary>
        <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap mt-2">{data.prompt.user}</pre>
      </details>
    </div>
  );
}
