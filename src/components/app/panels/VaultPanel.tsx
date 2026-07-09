'use client';

import { useEffect, useState, useCallback } from 'react';
import { IdCard, Trophy, Wrench, User, FileText, BookOpen, FolderArchive, Zap, Check, PenLine, type LucideIcon } from 'lucide-react';
import type { AppTier } from '../UnifiedSidebar';
import { authedFetch } from '../authHeaders';
import { NaicsPicker } from '@/components/codes/NaicsPicker';
import { NaicsBadgeList } from '@/components/codes/NaicsBadge';
import LibraryPanel from './LibraryPanel';

interface Props {
  email: string | null;
  tier: AppTier;
  /** Open straight to a section (e.g. the old /library deep link → 'generated'). */
  initialSection?: VaultSection;
}

type VaultSection = 'identity' | 'past_performance' | 'capabilities' | 'team' | 'documents' | 'generated';

interface IdentityProfile {
  user_email?: string;
  uei?: string | null;
  cage_code?: string | null;
  duns?: string | null;
  ein?: string | null;
  legal_name?: string | null;
  dba?: string | null;
  year_founded?: number | null;
  employee_count?: number | null;
  annual_revenue?: number | null;
  certifications?: string[];
  primary_naics?: string[];
  one_liner?: string | null;
  elevator_pitch?: string | null;
  hq_state?: string | null;
  hq_city?: string | null;
  service_states?: string[];
  contract_vehicles?: string[];
  // Point of contact + cert-package fields (#41)
  contact_name?: string | null;
  contact_title?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  website?: string | null;
  office_address?: string | null;
  bonding_single?: string | null;
  bonding_aggregate?: string | null;
}

interface PastPerf {
  id: string;
  contract_title: string;
  contract_number?: string | null;
  agency: string;
  sub_agency?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  contract_value?: number | null;
  role?: string | null;
  scope_description?: string | null;
  cpars_rating?: string | null;
  reference_name?: string | null;
  reference_email?: string | null;
  relevance_keywords?: string[];
  naics_codes?: string[];
}

interface Capability {
  id: string;
  capability_name: string;
  description: string;
  related_naics?: string[];
  related_psc?: string[];
  keywords?: string[];
  evidence?: string | null;
  tools_methods?: string[];
}

interface TeamMember {
  id: string;
  full_name: string;
  title: string;
  security_clearance?: string | null;
  certifications?: string[];
  years_experience?: number | null;
  bio_short?: string | null;
  is_key_personnel?: boolean;
  resume_storage_path?: string | null;
  resume_filename?: string | null;
}

interface BoilerplateDoc {
  id: string;
  doc_type: string;
  original_filename: string;
  size_bytes?: number | null;
  page_count?: number | null;
  parse_status: string;
  created_at: string;
}

const SECTIONS: { id: VaultSection; label: string; icon: LucideIcon; blurb: string; proOnly?: boolean }[] = [
  { id: 'identity', label: 'Identity', icon: IdCard, blurb: 'UEI, CAGE, certifications, one-liner' },
  { id: 'past_performance', label: 'Past Performance', icon: Trophy, blurb: 'Real contracts you have won' },
  { id: 'capabilities', label: 'Capabilities', icon: Wrench, blurb: 'What you can do, tagged by NAICS' },
  { id: 'team', label: 'Key Personnel', icon: User, blurb: 'People you put in proposals — bios, clearances' },
  { id: 'documents', label: 'Documents', icon: FileText, blurb: 'Capability statements + boilerplate' },
  // Folded in from the old top-level "My Library" tab (Eric, Jun 25): Mindy's
  // generated outputs (drafts, briefings, capability statements) live with the
  // rest of "your stuff" instead of a separate nav item. Pro+ (as Library was).
  { id: 'generated', label: 'Generated', icon: BookOpen, blurb: 'Everything Mindy has drafted for you', proOnly: true },
];

export default function VaultPanel({ email, tier, initialSection }: Props) {
  const [section, setSection] = useState<VaultSection>(initialSection || 'identity');
  const [identity, setIdentity] = useState<IdentityProfile | null>(null);
  const [pastPerf, setPastPerf] = useState<PastPerf[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [docs, setDocs] = useState<BoilerplateDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Download the user's full vault as a JSON file. Uses an authed fetch (the
  // export route requires strong auth) → blob → triggers a browser download.
  const handleExport = useCallback(async () => {
    if (!email || exporting) return;
    setExporting(true);
    try {
      const res = await authedFetch(`/api/app/vault/export?email=${encodeURIComponent(email)}`, email);
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mindy-vault-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }, [email, exporting]);

  const load = useCallback(async () => {
    if (!email) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authedFetch(`/api/app/vault?email=${encodeURIComponent(email)}`, email);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setIdentity(data.identity || {});
      setPastPerf(data.past_performance || []);
      setCapabilities(data.capabilities || []);
      setTeam(data.team || []);
      setDocs(data.documents || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load vault');
    } finally {
      setLoading(false);
    }
  }, [email]);

  useEffect(() => { load(); }, [load]);

  // Tier guard — vault is available on all tiers; this is the lock-in surface.
  void tier;

  if (!email) {
    return (
      <div className="p-8 text-center text-muted">
        Sign in to access your vault.
      </div>
    );
  }

  const counts = {
    past_performance: pastPerf.length,
    capabilities: capabilities.length,
    team: team.length,
    documents: docs.length,
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-5 border-b border-surface">
        <div className="flex items-center gap-3 mb-1">
          <FolderArchive className="h-6 w-6 shrink-0 text-emerald-300" strokeWidth={1.75} />
          <h1 className="text-xl font-semibold text-white">My Vault</h1>
        </div>
        <p className="text-sm text-muted">
          Everything Mindy uses to make outputs sound like <em>you</em>. The more you store, the more personalized your drafts, briefings, and proposals.
          {' '}This is what Mindy <span className="text-ink-soft">writes into proposals</span> — what it <span className="text-ink-soft">watches for</span> (NAICS, keywords, agencies) lives in <span className="text-ink-soft">Settings</span>.
        </p>
        {/* Trust cue — reassurance at the point of upload, where the anxiety lives. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
          <span className="inline-flex items-center gap-1.5 text-emerald-400/90">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
              <path d="M6 10V8a6 6 0 1112 0v2M5 10h14v9a1 1 0 01-1 1H6a1 1 0 01-1-1v-9z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Only you can see your vault
          </span>
          <span className="text-slate-700">·</span>
          {email && (
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className="underline underline-offset-2 hover:text-ink-soft disabled:opacity-50"
            >
              {exporting ? 'Preparing…' : 'Export'}
            </button>
          )}
          <span className="text-slate-700">·</span>
          <a href="/app/trust" className="underline underline-offset-2 hover:text-ink-soft">
            How your data is protected
          </a>
        </div>
      </div>

      {/* Section tabs */}
      <div data-tour="vault-tabs" className="flex gap-1 px-4 pt-3 border-b border-surface overflow-x-auto">
        {SECTIONS.filter((s) => !s.proOnly || tier !== 'free').map((s) => {
          // 'identity' has no count; 'generated' (folded-in Library) isn't in the
          // vault counts map — guard both so the lookup never breaks.
          const count = (s.id === 'identity' || s.id === 'generated')
            ? null
            : counts[s.id as keyof typeof counts];
          const active = section === s.id;
          const SectionIcon = s.icon;
          return (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm rounded-t-md transition whitespace-nowrap ${
                active
                  ? 'bg-surface text-white border-b-2 border-emerald-500'
                  : 'text-muted hover:text-slate-200 hover:bg-surface/40'
              }`}
            >
              <SectionIcon className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span>{s.label}</span>
              {count !== null && (
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  count > 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-input text-muted'
                }`}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Status row */}
      {loading && (
        <div className="px-6 py-2 text-xs text-muted bg-ground/40">Loading vault…</div>
      )}
      {error && (
        <div className="px-6 py-2 text-xs text-rose-300 bg-rose-950/40 border-b border-rose-900">
          {error}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-auto p-6">
        {section === 'identity' && (
          <IdentitySection
            email={email}
            data={identity || {}}
            onSaved={load}
          />
        )}
        {section === 'past_performance' && (
          <PastPerfSection email={email} items={pastPerf} onChanged={load} />
        )}
        {section === 'capabilities' && (
          <CapabilitiesSection email={email} items={capabilities} onChanged={load} />
        )}
        {section === 'team' && (
          <TeamSection email={email} items={team} onChanged={load} />
        )}
        {section === 'documents' && (
          <DocumentsSection email={email} items={docs} onChanged={load} />
        )}
        {section === 'generated' && (
          // Folded-in My Library — Mindy's generated outputs archive.
          <LibraryPanel email={email} tier={tier} />
        )}
      </div>
    </div>
  );
}

// ---- Identity ---------------------------------------------------------
function IdentitySection({ email, data, onSaved }: { email: string; data: IdentityProfile; onSaved: () => void }) {
  const [form, setForm] = useState<IdentityProfile>(data);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [naicsSeededNote, setNaicsSeededNote] = useState<string | null>(null);
  const [showAutoFill, setShowAutoFill] = useState(false);

  // Comma-separated array fields are edited as RAW STRINGS while typing, so a
  // comma or trailing space isn't stripped on every keystroke (the old
  // array.join()/split()-per-keystroke round-trip ate them → "can't type").
  // We split to arrays only at save time. Mirrors PastPerfForm's approach.
  const [serviceStatesRaw, setServiceStatesRaw] = useState((data.service_states || []).join(', '));
  const [contractVehiclesRaw, setContractVehiclesRaw] = useState((data.contract_vehicles || []).join(', '));
  const [certificationsRaw, setCertificationsRaw] = useState((data.certifications || []).join(', '));

  useEffect(() => {
    setForm(data);
    setServiceStatesRaw((data.service_states || []).join(', '));
    setContractVehiclesRaw((data.contract_vehicles || []).join(', '));
    setCertificationsRaw((data.certifications || []).join(', '));
  }, [data]);

  const splitCsv = (raw: string): string[] => raw.split(',').map((s) => s.trim()).filter(Boolean);

  // Show the auto-fill banner if identity is meaningfully empty.
  // "Meaningfully empty" = no legal_name AND no UEI saved yet.
  const isEmpty = !form.legal_name?.trim() && !form.uei?.trim();

  const onField = (k: keyof IdentityProfile, v: string | number | string[] | null) => {
    setForm((f) => ({ ...f, [k]: v }));
  };

  const save = async () => {
    setSaving(true);
    try {
      // Fold the raw comma strings into arrays at save time.
      const profile = {
        ...form,
        service_states: splitCsv(serviceStatesRaw),
        contract_vehicles: splitCsv(contractVehiclesRaw),
        certifications: splitCsv(certificationsRaw),
      };
      const res = await authedFetch('/api/app/vault/identity', email, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, profile }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json().catch(() => ({}));
      // Vault NAICS sync ADDITIVELY into Settings (the source of truth alerts
      // read). Report the actual count so the sync is concrete, not invisible —
      // and point users to Settings as the home for fine-tuning. Add-only: we
      // never remove the user's tuned alert codes.
      if (result?.alertNaicsAdded > 0) {
        const n = result.alertNaicsAdded;
        setNaicsSeededNote(`Added ${n} NAICS ${n === 1 ? 'code' : 'codes'} to your alerts & briefings. Fine-tune them anytime in Settings → Opportunity Matching.`);
      } else if (result?.alertNaicsSeeded) {
        setNaicsSeededNote('Your NAICS were applied to alerts & briefings. Fine-tune them anytime in Settings.');
      }
      setSavedAt(new Date().toLocaleTimeString());
      onSaved();
    } catch (e) {
      alert(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-5">
      {/* Day 0 auto-fill banner — shown when identity is empty, hidden
          once the user has saved anything. Single big CTA. */}
      {isEmpty && (
        <div className="rounded-xl border border-emerald-500/40 bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-purple-500/10 p-5">
          <div className="flex items-start gap-4">
            <Zap className="h-7 w-7 shrink-0 text-emerald-300" strokeWidth={1.75} />
            <div className="flex-1 min-w-0">
              <h3 className="text-white font-semibold mb-1">
                Auto-fill from your SAM.gov registration
              </h3>
              <p className="text-sm text-ink-soft mb-3">
                Enter your <strong>UEI</strong> (the 12-character SAM.gov ID) and Mindy will pull
                your legal name, NAICS, certifications, HQ — plus draft a one-liner, capabilities,
                and starter past-performance entries grounded in the GovCon Giants curriculum.
                <span className="block text-xs text-muted mt-1">
                  Takes ~10 seconds. You review everything before it saves.
                </span>
              </p>
              <button
                onClick={() => setShowAutoFill(true)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded transition"
              >
                Auto-fill from UEI →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The modal, mounted at root so the form below stays editable */}
      {showAutoFill && (
        <AutoFillModal
          email={email}
          onClose={() => setShowAutoFill(false)}
          onApplied={() => { setShowAutoFill(false); onSaved(); }}
        />
      )}

      {/* Compact secondary button — visible even when identity has data,
          so power users can re-run the prefill if their SAM changes. */}
      {!isEmpty && (
        <div className="flex justify-end -mb-2">
          <button
            onClick={() => setShowAutoFill(true)}
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-emerald-300 transition"
          >
            <Zap className="h-3.5 w-3.5 shrink-0" strokeWidth={2} /> Re-fetch from SAM.gov
          </button>
        </div>
      )}

      <Field label="Legal name" value={form.legal_name || ''} onChange={(v) => onField('legal_name', v)} placeholder="Acme Federal Services LLC" />
      <Field label="One-liner" value={form.one_liner || ''} onChange={(v) => onField('one_liner', v)} placeholder="AI-powered cybersecurity for federal" hint="Goes into every Company Overview draft" />
      <Field label="Elevator pitch" value={form.elevator_pitch || ''} onChange={(v) => onField('elevator_pitch', v)} placeholder="2-3 sentence longer version" multiline />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="UEI" value={form.uei || ''} onChange={(v) => onField('uei', v)} placeholder="12-character SAM UEI" />
        <Field label="CAGE Code" value={form.cage_code || ''} onChange={(v) => onField('cage_code', v)} placeholder="5-character CAGE" />
        <Field label="EIN" value={form.ein || ''} onChange={(v) => onField('ein', v)} placeholder="XX-XXXXXXX" />
        <Field label="DUNS (legacy)" value={form.duns || ''} onChange={(v) => onField('duns', v)} />
      </div>

      <Field
        label="Certifications (comma-separated)"
        value={certificationsRaw}
        onChange={setCertificationsRaw}
        placeholder="Small Business, 8(a), SDVOSB, WOSB, HUBZone"
      />

      <div>
        <label className="block text-sm text-ink-soft mb-1">Primary NAICS codes</label>
        <NaicsPicker
          value={form.primary_naics || []}
          onChange={(codes) => onField('primary_naics', codes)}
          placeholder='Search NAICS by description (e.g. "consulting") or paste code'
        />
        <p className="text-xs text-faint mt-1">
          The NAICS codes you bid on — your company identity. Saving here also <b className="text-ink-soft">adds them to your alerts</b>.
          The codes Mindy actively watches live in <b className="text-ink-soft">Settings → Opportunity Matching</b> (you can fine-tune there).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="HQ State" value={form.hq_state || ''} onChange={(v) => onField('hq_state', v)} placeholder="FL" />
        <Field label="HQ City" value={form.hq_city || ''} onChange={(v) => onField('hq_city', v)} placeholder="Miami" />
      </div>

      <Field
        label="Service states (comma-separated, where you can perform)"
        value={serviceStatesRaw}
        onChange={setServiceStatesRaw}
        placeholder="FL, GA, AL, NC, SC"
      />

      <Field
        label="Contract vehicles (comma-separated)"
        value={contractVehiclesRaw}
        onChange={setContractVehiclesRaw}
        placeholder="GSA Schedule, OASIS, CIO-SP3"
      />

      {/* Point of contact (#41) — proposals fill "Responsible Office / Contact
          Person" + Point-of-Contact sections from these instead of [placeholders]. */}
      <div className="pt-4 mt-4 border-t border-hairline">
        <div className="flex items-center gap-2 mb-1">
          <span className="h-4 w-1 rounded-full bg-emerald-500" />
          <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Point of Contact</h3>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 uppercase tracking-wide">
            Used in proposals
          </span>
        </div>
        <p className="text-xs text-faint mb-3">
          Mindy drops these into the point-of-contact &amp; cap-statement sections of your proposals — so drafts show your real details, not [placeholders].
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Contact name" value={form.contact_name || ''} onChange={(v) => onField('contact_name', v)} placeholder="Eric Coffie" hint="The responsible person on cert packages" />
          <Field label="Contact title" value={form.contact_title || ''} onChange={(v) => onField('contact_title', v)} placeholder="Founder / President" />
          <Field label="Contact phone" value={form.contact_phone || ''} onChange={(v) => onField('contact_phone', v)} placeholder="(305) 555-0100" />
          <Field label="Contact email" value={form.contact_email || ''} onChange={(v) => onField('contact_email', v)} placeholder="eric@company.com" />
          <Field label="Website" value={form.website || ''} onChange={(v) => onField('website', v)} placeholder="www.company.com" />
          <Field label="Office address" value={form.office_address || ''} onChange={(v) => onField('office_address', v)} placeholder="123 Main St, Miami, FL 33101" />
          <Field label="Single bonding capacity" value={form.bonding_single || ''} onChange={(v) => onField('bonding_single', v)} placeholder="$5M" />
          <Field label="Aggregate bonding capacity" value={form.bonding_aggregate || ''} onChange={(v) => onField('bonding_aggregate', v)} placeholder="$20M" />
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Identity'}
        </button>
        {savedAt && <span className="text-xs text-emerald-400">Saved at {savedAt}</span>}
      </div>
      {naicsSeededNote && (
        <div className="mt-2 inline-flex items-center gap-1 text-xs text-blue-300 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2">
          <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} /> {naicsSeededNote}
        </div>
      )}
    </div>
  );
}

// ---- Past Performance -------------------------------------------------
function PastPerfSection({ email, items, onChanged }: { email: string; items: PastPerf[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  if (items.length === 0 && !adding) {
    return (
      <EmptyState
        icon={Trophy}
        title="No past performance yet"
        body="Add real contracts you have won. Mindy will cite them in your proposal drafts and cap statements instead of using [bracketed placeholders]. Even 3-5 entries make a visible quality difference."
        action="+ Add past performance"
        onAction={() => setAdding(true)}
      />
    );
  }
  // Sort: completed (real) entries first, unfilled SAM templates last.
  const sorted = [...items].sort((a, b) => Number(isPastPerfDraft(a)) - Number(isPastPerfDraft(b)));
  const draftCount = items.filter(isPastPerfDraft).length;

  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <h2 className="text-lg font-medium text-white">{items.length} past performance {items.length === 1 ? 'entry' : 'entries'}</h2>
        <button onClick={() => setAdding(true)} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded">
          + Add past performance
        </button>
      </div>
      {draftCount > 0 && (
        <p className="text-xs text-amber-300/80 mb-4">{draftCount} {draftCount === 1 ? 'entry is' : 'entries are'} an unfilled template — add real details so Mindy cites them instead of placeholders.</p>
      )}
      {adding && (
        <div className="mb-4">
          <PastPerfForm email={email} onSaved={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} />
        </div>
      )}
      <div className="space-y-2">
        {sorted.map((p) => (
          <PastPerfRow key={p.id} p={p} email={email} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}

// A SAM auto-fill template the user hasn't filled in yet — title/agency still
// in [brackets] or scope still has the boilerplate prompt.
function isPastPerfDraft(p: PastPerf): boolean {
  const t = (p.contract_title || '').trim();
  const a = (p.agency || '').trim();
  const s = (p.scope_description || '').toLowerCase();
  const bracketed = /^\[.*\]$/.test(t) || /^\[.*\]$/.test(a);
  const promptScope = s.includes('briefly describe') || s.includes('describe the specific') || s.includes('summarize the scope') || s.includes('fill in the contract');
  return bracketed || promptScope;
}

function PastPerfRow({ p, email, onChanged }: { p: PastPerf; email: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const draft = isPastPerfDraft(p);
  const fmtPeriod = () => {
    const y = (d?: string | null) => (d ? new Date(d).getFullYear() : null);
    const s = y(p.period_start), e = y(p.period_end);
    return s || e ? `${s ?? '?'}–${e ?? 'present'}` : null;
  };
  return (
    <div className={`border rounded-lg bg-ground/40 ${draft ? 'border-amber-500/20' : 'border-surface'}`}>
      {/* Collapsed row — scannable key fields */}
      <button onClick={() => setOpen(o => !o)} className="w-full text-left px-4 py-3 flex items-center gap-3">
        <span className={`shrink-0 transition-transform text-faint ${open ? 'rotate-90' : ''}`}>▸</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-medium truncate">{p.contract_title || '(untitled)'}</span>
            {draft && <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">DRAFT — ADD DETAILS</span>}
          </div>
          <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-xs text-muted mt-0.5">
            <span>{p.agency || '—'}</span>
            {p.contract_value ? <span className="text-emerald-400 font-medium">${p.contract_value.toLocaleString()}</span> : null}
            {p.role ? <span className="capitalize">{p.role}</span> : null}
            {fmtPeriod() ? <span>{fmtPeriod()}</span> : null}
            {p.cpars_rating ? <span className="text-ink-soft">CPARS: {p.cpars_rating}</span> : null}
          </div>
        </div>
      </button>
      {/* Expanded detail */}
      {open && (
        editing ? (
          <div className="px-4 pb-4 pt-1 border-t border-surface/60">
            <PastPerfForm
              email={email}
              initial={p}
              editId={p.id}
              onSaved={() => { setEditing(false); onChanged(); }}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <div className="px-4 pb-4 pt-1 border-t border-surface/60 space-y-2">
            {p.sub_agency && <p className="text-xs text-faint">{p.sub_agency}{p.contract_number ? ` · ${p.contract_number}` : ''}</p>}
            {p.scope_description && <p className="text-sm text-ink-soft">{p.scope_description}</p>}
            {(p.reference_name || p.reference_email) && (
              <p className="text-xs text-muted">Reference: {p.reference_name || ''}{p.reference_email ? ` · ${p.reference_email}` : ''}</p>
            )}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-faint hover:text-emerald-400"
              >Edit</button>
              <button
                onClick={async () => {
                  if (!confirm('Archive this past performance?')) return;
                  await authedFetch(`/api/app/vault/past-performance?id=${p.id}&email=${encodeURIComponent(email)}`, email, {
                    method: 'DELETE',
                  });
                  onChanged();
                }}
                className="text-xs text-faint hover:text-rose-400"
              >Archive</button>
            </div>
          </div>
        )
      )}
    </div>
  );
}

function PastPerfForm({ email, initial, editId, onSaved, onCancel }: { email: string; initial?: PastPerf; editId?: string; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    contract_title: initial?.contract_title || '',
    contract_number: initial?.contract_number || '',
    agency: initial?.agency || '',
    sub_agency: initial?.sub_agency || '',
    period_start: initial?.period_start || '',
    period_end: initial?.period_end || '',
    contract_value: initial?.contract_value != null ? String(initial.contract_value) : '',
    role: initial?.role || 'prime',
    scope_description: initial?.scope_description || '',
    cpars_rating: initial?.cpars_rating || '',
    reference_name: initial?.reference_name || '',
    reference_email: initial?.reference_email || '',
    relevance_keywords: (initial?.relevance_keywords || []).join(', '),
    naics_codes: (initial?.naics_codes || []).join(', '),
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.contract_title.trim() || !form.agency.trim()) {
      alert('Contract title and agency are required.');
      return;
    }
    setSaving(true);
    try {
      await authedFetch('/api/app/vault/past-performance', email, {
        method: editId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          ...(editId ? { id: editId } : {}),
          entry: {
            ...form,
            contract_value: form.contract_value ? Number(form.contract_value) : null,
            relevance_keywords: form.relevance_keywords.split(',').map(s => s.trim()).filter(Boolean),
            naics_codes: form.naics_codes.split(',').map(s => s.trim()).filter(Boolean),
          },
        }),
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-emerald-900 rounded-lg p-5 mb-5 bg-emerald-950/20 space-y-3">
      <h3 className="text-white font-medium">{editId ? 'Edit past performance' : 'New past performance'}</h3>
      <Field label="Contract title *" value={form.contract_title} onChange={(v) => setForm(f => ({ ...f, contract_title: v }))} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Agency *" value={form.agency} onChange={(v) => setForm(f => ({ ...f, agency: v }))} placeholder="Department of the Navy" />
        <Field label="Sub-agency" value={form.sub_agency} onChange={(v) => setForm(f => ({ ...f, sub_agency: v }))} placeholder="NAVFAC Atlantic" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Contract number" value={form.contract_number} onChange={(v) => setForm(f => ({ ...f, contract_number: v }))} />
        <Field label="Contract value ($)" value={form.contract_value} onChange={(v) => setForm(f => ({ ...f, contract_value: v }))} placeholder="2500000" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Period start" value={form.period_start} onChange={(v) => setForm(f => ({ ...f, period_start: v }))} placeholder="2023-06-01" />
        <Field label="Period end" value={form.period_end} onChange={(v) => setForm(f => ({ ...f, period_end: v }))} placeholder="2024-06-01" />
      </div>
      <Field label="Scope (what you did)" value={form.scope_description} onChange={(v) => setForm(f => ({ ...f, scope_description: v }))} multiline />
      <Field label="Relevance keywords (comma-separated)" value={form.relevance_keywords} onChange={(v) => setForm(f => ({ ...f, relevance_keywords: v }))} placeholder="cybersecurity, NIST, incident response" hint="Mindy matches RFPs by these keywords" />
      <Field label="NAICS codes (comma-separated)" value={form.naics_codes} onChange={(v) => setForm(f => ({ ...f, naics_codes: v }))} placeholder="541512, 541611" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Reference name" value={form.reference_name} onChange={(v) => setForm(f => ({ ...f, reference_name: v }))} />
        <Field label="Reference email" value={form.reference_email} onChange={(v) => setForm(f => ({ ...f, reference_email: v }))} />
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={save} disabled={saving} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 bg-input hover:bg-slate-600 text-white text-sm rounded">Cancel</button>
      </div>
    </div>
  );
}

// ---- Capabilities -----------------------------------------------------
function CapabilitiesSection({ email, items, onChanged }: { email: string; items: Capability[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);

  if (items.length === 0 && !adding) {
    return (
      <EmptyState
        icon={Wrench}
        title="No capabilities catalogued yet"
        body="Add what your business actually does, in your own words. Mindy weaves these into Capability Statement sections + Capabilities sections of proposals automatically."
        action="+ Add capability"
        onAction={() => setAdding(true)}
      />
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-medium text-white">{items.length} capabilities</h2>
        <button onClick={() => setAdding(true)} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded">+ Add capability</button>
      </div>
      {adding && (
        <CapabilityForm email={email} onSaved={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} />
      )}
      <div className="space-y-2">
        {[...items].sort((a, b) => Number(isCapabilityDraft(a)) - Number(isCapabilityDraft(b))).map((c) => (
          <CapabilityRow key={c.id} c={c} email={email} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}

function CapabilityForm({ email, initial, editId, onSaved, onCancel }: { email: string; initial?: Capability; editId?: string; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    capability_name: initial?.capability_name || '',
    description: initial?.description || '',
    related_naics: (initial?.related_naics || []).join(', '),
    keywords: (initial?.keywords || []).join(', '),
    evidence: initial?.evidence || '',
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.capability_name.trim() || !form.description.trim()) return;
    setSaving(true);
    try {
      await authedFetch('/api/app/vault/capabilities', email, {
        method: editId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          ...(editId ? { id: editId } : {}),
          entry: {
            ...form,
            related_naics: form.related_naics.split(',').map(s => s.trim()).filter(Boolean),
            keywords: form.keywords.split(',').map(s => s.trim()).filter(Boolean),
          },
        }),
      });
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <div className="border border-emerald-900 rounded-lg p-5 mb-5 bg-emerald-950/20 space-y-3">
      <h3 className="text-white font-medium">{editId ? 'Edit capability' : 'New capability'}</h3>
      <Field label="Capability name *" value={form.capability_name} onChange={(v) => setForm(f => ({ ...f, capability_name: v }))} placeholder="Penetration Testing" />
      <Field label="Description (1-3 sentences in your voice) *" value={form.description} onChange={(v) => setForm(f => ({ ...f, description: v }))} multiline />
      <Field label="Related NAICS (comma-separated)" value={form.related_naics} onChange={(v) => setForm(f => ({ ...f, related_naics: v }))} placeholder="541512, 541519" />
      <Field label="Keywords (comma-separated)" value={form.keywords} onChange={(v) => setForm(f => ({ ...f, keywords: v }))} placeholder="OWASP, pen test, vulnerability assessment" />
      <Field label="Evidence" value={form.evidence} onChange={(v) => setForm(f => ({ ...f, evidence: v }))} placeholder="OSCP certified team, 50+ tests delivered" />
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={onCancel} className="px-3 py-1.5 bg-input hover:bg-slate-600 text-white text-sm rounded">Cancel</button>
      </div>
    </div>
  );
}

// A thin/placeholder capability (AI draft prompt or empty evidence/keywords).
function isCapabilityDraft(c: Capability): boolean {
  const d = (c.description || '').toLowerCase();
  const prompty = d.includes('describe ') || d.includes('in your own words') || d.length < 20;
  const noTags = (c.related_naics || []).length === 0 && (c.keywords || []).length === 0;
  return prompty || noTags;
}

function CapabilityRow({ c, email, onChanged }: { c: Capability; email: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const draft = isCapabilityDraft(c);
  return (
    <div className={`border rounded-lg bg-ground/40 ${draft ? 'border-amber-500/20' : 'border-surface'}`}>
      <button onClick={() => setOpen(o => !o)} className="w-full text-left px-4 py-3 flex items-center gap-3">
        <span className={`shrink-0 transition-transform text-faint ${open ? 'rotate-90' : ''}`}>▸</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-medium truncate">{c.capability_name || '(unnamed)'}</span>
            {draft && <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">DRAFT — ADD DETAILS</span>}
          </div>
          <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap mt-0.5">
            {(c.related_naics || []).slice(0, 4).map(n => (
              <span key={n} className="text-[11px] bg-surface text-muted px-1.5 py-0.5 rounded">{n}</span>
            ))}
            {(c.keywords || []).length > 0 && <span className="text-xs text-faint truncate">{c.keywords!.slice(0, 3).join(' · ')}</span>}
          </div>
        </div>
      </button>
      {open && (
        editing ? (
          <div className="px-4 pb-4 pt-1 border-t border-surface/60">
            <CapabilityForm
              email={email}
              initial={c}
              editId={c.id}
              onSaved={() => { setEditing(false); onChanged(); }}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <div className="px-4 pb-4 pt-1 border-t border-surface/60 space-y-2">
            <p className="text-sm text-ink-soft">{c.description}</p>
            {c.evidence && <p className="text-xs text-muted">Evidence: {c.evidence}</p>}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-faint hover:text-emerald-400"
              >Edit</button>
              <button
                onClick={async () => {
                  if (!confirm('Archive this capability?')) return;
                  await authedFetch(`/api/app/vault/capabilities?id=${c.id}&email=${encodeURIComponent(email)}`, email, {
                    method: 'DELETE',
                  });
                  onChanged();
                }}
                className="text-xs text-faint hover:text-rose-400"
              >Archive</button>
            </div>
          </div>
        )
      )}
    </div>
  );
}

// ---- Team -------------------------------------------------------------
function TeamSection({ email, items, onChanged }: { email: string; items: TeamMember[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);

  if (items.length === 0 && !adding) {
    return (
      <EmptyState
        icon={User}
        title="No key personnel yet"
        body="Add the people you put in proposals — PMs, technical leads, key staff. Mindy uses these to draft Management Plan + Key Personnel sections automatically. Resume PDFs can be attached later. (To invite teammates to your Mindy account, use Settings.)"
        action="+ Add key personnel"
        onAction={() => setAdding(true)}
      />
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-medium text-white">{items.length} key {items.length === 1 ? 'person' : 'people'}</h2>
        <button onClick={() => setAdding(true)} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded">+ Add key personnel</button>
      </div>
      {adding && (
        <TeamForm email={email} onSaved={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} />
      )}
      <div className="space-y-2">
        {/* Key personnel first, then the rest */}
        {[...items].sort((a, b) => Number(!!b.is_key_personnel) - Number(!!a.is_key_personnel)).map((m) => (
          <TeamRow key={m.id} m={m} email={email} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}

function TeamForm({ email, initial, editId, onSaved, onCancel }: { email: string; initial?: TeamMember; editId?: string; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    full_name: initial?.full_name || '',
    title: initial?.title || '',
    security_clearance: initial?.security_clearance || '',
    certifications: (initial?.certifications || []).join(', '),
    years_experience: initial?.years_experience != null ? String(initial.years_experience) : '',
    bio_short: initial?.bio_short || '',
    is_key_personnel: initial?.is_key_personnel ?? true,
  });
  const [saving, setSaving] = useState(false);
  // Resume upload → parse → pre-fill. We keep the stored file's key so it saves
  // with the person; parsed fields land in the form for the user to REVIEW.
  const [resumeStoragePath, setResumeStoragePath] = useState(initial?.resume_storage_path || '');
  const [resumeFilename, setResumeFilename] = useState(initial?.resume_filename || '');
  const [parsing, setParsing] = useState(false);
  const [resumeMsg, setResumeMsg] = useState<string | null>(null);

  const onResume = async (file: File) => {
    setParsing(true);
    setResumeMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('email', email);
      const res = await authedFetch('/api/app/vault/team/resume', email, {
        method: 'POST',
        // NOTE: no Content-Type — browser sets multipart boundary
        body: fd,
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Could not read the resume');
      if (data.storage_path) { setResumeStoragePath(data.storage_path); setResumeFilename(data.filename || file.name); }
      if (data.parsed && data.fields) {
        const f = data.fields;
        setForm(prev => ({
          ...prev,
          full_name: f.full_name || prev.full_name,
          title: f.title || prev.title,
          security_clearance: f.security_clearance || prev.security_clearance,
          certifications: Array.isArray(f.certifications) && f.certifications.length ? f.certifications.join(', ') : prev.certifications,
          years_experience: f.years_experience ? String(f.years_experience) : prev.years_experience,
          bio_short: f.bio_short || prev.bio_short,
        }));
        setResumeMsg('Pre-filled from the resume — review the fields below and edit anything before saving.');
      } else {
        setResumeMsg(data.note || 'Resume saved, but the fields couldn’t be auto-read — please fill them in.');
      }
    } catch (e) {
      setResumeMsg(e instanceof Error ? e.message : 'Resume upload failed');
    } finally { setParsing(false); }
  };

  const save = async () => {
    if (!form.full_name.trim() || !form.title.trim()) return;
    setSaving(true);
    try {
      await authedFetch('/api/app/vault/team', email, {
        method: editId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          ...(editId ? { id: editId } : {}),
          entry: {
            ...form,
            years_experience: form.years_experience ? Number(form.years_experience) : null,
            certifications: form.certifications.split(',').map(s => s.trim()).filter(Boolean),
            resume_storage_path: resumeStoragePath || null,
            resume_filename: resumeFilename || null,
          },
        }),
      });
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <div className="border border-emerald-900 rounded-lg p-5 mb-5 bg-emerald-950/20 space-y-3">
      <h3 className="text-white font-medium">{editId ? 'Edit key personnel' : 'New key personnel'}</h3>

      {/* Resume auto-fill — the 10x shortcut. Parse → review → save. */}
      <div className="rounded-lg border border-dashed border-emerald-700/50 bg-emerald-950/30 p-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-ink-soft">
            <span className="inline-flex items-center gap-1.5 font-medium text-white"><FileText className="h-4 w-4 shrink-0" strokeWidth={2} /> Auto-fill from a resume</span>
            <span className="text-muted"> — upload a PDF or DOCX and Mindy fills the fields for you to review.</span>
          </div>
          <label className={`shrink-0 px-3 py-1.5 rounded text-sm cursor-pointer ${parsing ? 'bg-input text-muted' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}>
            {parsing ? 'Reading…' : (resumeFilename ? 'Replace resume' : 'Upload resume')}
            <input
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              disabled={parsing}
              onChange={(e) => { const file = e.target.files?.[0]; if (file) onResume(file); e.target.value = ''; }}
            />
          </label>
        </div>
        {resumeFilename && !parsing && (
          <p className="text-xs text-emerald-300/90 mt-2">Attached: {resumeFilename}</p>
        )}
        {resumeMsg && <p className="text-xs text-muted mt-2">{resumeMsg}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Full name *" value={form.full_name} onChange={(v) => setForm(f => ({ ...f, full_name: v }))} />
        <Field label="Title *" value={form.title} onChange={(v) => setForm(f => ({ ...f, title: v }))} placeholder="Program Manager" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Security clearance" value={form.security_clearance} onChange={(v) => setForm(f => ({ ...f, security_clearance: v }))} placeholder="Secret" />
        <Field label="Years experience" value={form.years_experience} onChange={(v) => setForm(f => ({ ...f, years_experience: v }))} placeholder="15" />
      </div>
      <Field label="Certifications (comma-separated)" value={form.certifications} onChange={(v) => setForm(f => ({ ...f, certifications: v }))} placeholder="PMP, CISSP" />
      <Field label="Short bio (1-2 sentences)" value={form.bio_short} onChange={(v) => setForm(f => ({ ...f, bio_short: v }))} multiline />
      <label className="flex items-center gap-2 text-sm text-ink-soft">
        <input type="checkbox" checked={form.is_key_personnel} onChange={(e) => setForm(f => ({ ...f, is_key_personnel: e.target.checked }))} />
        Mark as Key Personnel (shows in proposal sections)
      </label>
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={onCancel} className="px-3 py-1.5 bg-input hover:bg-slate-600 text-white text-sm rounded">Cancel</button>
      </div>
    </div>
  );
}

function isTeamDraft(m: TeamMember): boolean {
  // Thin entry: no bio AND no clearance/certs/experience to show.
  return !m.bio_short && !m.security_clearance && !(m.certifications || []).length && !m.years_experience;
}

function TeamRow({ m, email, onChanged }: { m: TeamMember; email: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const draft = isTeamDraft(m);
  return (
    <div className={`border rounded-lg bg-ground/40 ${draft ? 'border-amber-500/20' : 'border-surface'}`}>
      <button onClick={() => setOpen(o => !o)} className="w-full text-left px-4 py-3 flex items-center gap-3">
        <span className={`shrink-0 transition-transform text-faint ${open ? 'rotate-90' : ''}`}>▸</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-medium truncate">{m.full_name || '(unnamed)'}</span>
            {m.is_key_personnel && <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-900 text-emerald-300">KEY PERSONNEL</span>}
            {draft && <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">DRAFT — ADD DETAILS</span>}
          </div>
          <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-xs text-muted mt-0.5">
            <span>{m.title || '—'}</span>
            {m.years_experience ? <span>{m.years_experience} yrs</span> : null}
            {m.security_clearance ? <span className="text-ink-soft">{m.security_clearance} cleared</span> : null}
            {(m.certifications || []).length > 0 ? <span>{m.certifications!.slice(0, 3).join(', ')}</span> : null}
          </div>
        </div>
      </button>
      {open && (
        editing ? (
          <div className="px-4 pb-4 pt-1 border-t border-surface/60">
            <TeamForm
              email={email}
              initial={m}
              editId={m.id}
              onSaved={() => { setEditing(false); onChanged(); }}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <div className="px-4 pb-4 pt-1 border-t border-surface/60 space-y-2">
            {m.bio_short && <p className="text-sm text-ink-soft">{m.bio_short}</p>}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-faint hover:text-emerald-400"
              >Edit</button>
              <button
                onClick={async () => {
                  if (!confirm('Archive this person?')) return;
                  await authedFetch(`/api/app/vault/team?id=${m.id}&email=${encodeURIComponent(email)}`, email, {
                    method: 'DELETE',
                  });
                  onChanged();
                }}
                className="text-xs text-faint hover:text-rose-400"
              >Archive</button>
            </div>
          </div>
        )
      )}
    </div>
  );
}

// ---- Documents (boilerplate / cap statements) -------------------------
// Shape of the parsed cap-statement (mirrors /api/app/vault/documents/parse).
interface ParsedIdentityFields {
  legal_name: string; dba: string; uei: string; cage_code: string; duns: string;
  year_founded: string; certifications: string[]; primary_naics: string[];
  hq_city: string; hq_state: string;
  contact_name: string; contact_title: string; contact_email: string; contact_phone: string;
  website: string; office_address: string;
  bonding_single: string; bonding_aggregate: string;
}
interface ParsedDoc {
  overview: { one_liner: string; elevator_pitch: string };
  identity: ParsedIdentityFields;
  past_performance: {
    contract_title: string; agency: string; contract_number: string;
    role: string; scope_description: string; period: string; contract_value: string;
  }[];
  capabilities: { capability_name: string; description: string; keywords: string[] }[];
}

// Human labels for the identity fields we surface in the review modal.
const IDENTITY_LABELS: { key: keyof ParsedIdentityFields; label: string }[] = [
  { key: 'legal_name', label: 'Legal name' },
  { key: 'dba', label: 'DBA' },
  { key: 'uei', label: 'UEI' },
  { key: 'cage_code', label: 'CAGE' },
  { key: 'duns', label: 'DUNS' },
  { key: 'year_founded', label: 'Founded' },
  { key: 'certifications', label: 'Certifications' },
  { key: 'primary_naics', label: 'NAICS' },
  { key: 'hq_city', label: 'HQ city' },
  { key: 'hq_state', label: 'HQ state' },
  { key: 'contact_name', label: 'Contact' },
  { key: 'contact_title', label: 'Contact title' },
  { key: 'contact_email', label: 'Contact email' },
  { key: 'contact_phone', label: 'Contact phone' },
  { key: 'website', label: 'Website' },
  { key: 'office_address', label: 'Office address' },
  { key: 'bonding_single', label: 'Bonding (single)' },
  { key: 'bonding_aggregate', label: 'Bonding (aggregate)' },
];

// NOTE: contract_value coercion + period splitting now live SERVER-SIDE in
// src/lib/vault/normalize.ts (used by /api/app/vault/documents/commit). The client
// no longer maps parser output → columns — it just sends the kept selections.

function DocumentsSection({ email, items, onChanged }: { email: string; items: BoilerplateDoc[]; onChanged: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  // The parse→review modal state. `review` holds the parsed sections awaiting confirm.
  const [review, setReview] = useState<{ parsed: ParsedDoc; filename: string; documentId: string } | null>(null);

  // Upload a doc. Returns the created document row (with id) so cap statements
  // can immediately be parsed into structured sections.
  const upload = async (file: File, doc_type: string): Promise<BoilerplateDoc | null> => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('email', email);
      fd.append('doc_type', doc_type);
      const res = await authedFetch('/api/app/vault/documents', email, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
      const data = await res.json();
      onChanged();
      return (data?.document as BoilerplateDoc) || null;
    } catch (e) {
      alert(`Upload failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally {
      setUploading(false);
    }
  };

  // Ask the LLM to split an uploaded doc's text into Vault sections, then open
  // the review modal. Never auto-commits — the user confirms in the modal.
  const parseDoc = async (documentId: string, filename: string) => {
    setParsing(true);
    try {
      const res = await authedFetch('/api/app/vault/documents/parse', email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, document_id: documentId }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      if (!data.counts?.total) {
        alert('Mindy stored the document, but found nothing structured to pull out. You can add sections manually.');
        return;
      }
      setReview({ parsed: data.parsed as ParsedDoc, filename: data.filename || filename, documentId });
    } catch (e) {
      alert(`Couldn't parse into sections: ${e instanceof Error ? e.message : String(e)}\n\nThe document is still saved as reference material.`);
    } finally {
      setParsing(false);
    }
  };

  const onCapStatement = async (f: File) => {
    const doc = await upload(f, 'cap_stmt');
    if (doc?.id) await parseDoc(doc.id, doc.original_filename);
  };

  // Remove an uploaded document (soft-delete via the route's archived_at). This
  // does NOT touch any Past Performance / Capability rows already pulled from it —
  // those live independently once saved.
  const [removingId, setRemovingId] = useState<string | null>(null);
  const removeDoc = async (documentId: string, filename: string) => {
    if (!confirm(`Remove "${filename}" from your Vault?\n\nThis only removes the uploaded file — any sections you already saved to your Vault stay.`)) return;
    setRemovingId(documentId);
    try {
      const res = await authedFetch(`/api/app/vault/documents?id=${encodeURIComponent(documentId)}&email=${encodeURIComponent(email)}`, email, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
      onChanged();
    } catch (e) {
      alert(`Couldn't remove the document: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <UploadCard
          title="Upload Capability Statement"
          body="PDF or Word. Mindy reads it and pulls out your Overview, Past Performance, and Capabilities into editable Vault sections — you review each before it's saved."
          accept=".pdf,.docx,.doc"
          disabled={uploading || parsing}
          onFile={onCapStatement}
        />
        <UploadCard
          title="Upload Company Overview / Other"
          body="Any boilerplate doc — company overview, cover letter template, past perf table. Mindy extracts the text and uses it as reference material."
          accept=".pdf,.docx,.doc,.txt"
          disabled={uploading || parsing}
          onFile={(f) => upload(f, 'other')}
        />
      </div>

      {parsing && (
        <div className="mb-4 flex items-center gap-2 text-sm text-emerald-400">
          <span className="inline-block h-3 w-3 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
          Reading your capability statement into sections…
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No documents uploaded yet"
          body="Upload your existing capability statement to get started. Mindy pulls it apart into structured sections you can review, edit, and reuse."
        />
      ) : (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-ink-soft mb-3">Uploaded documents</h2>
          {items.map((d) => (
            <div key={d.id} className="flex justify-between items-center border border-surface rounded-lg p-3 bg-ground/40">
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm truncate">{d.original_filename}</p>
                <p className="text-xs text-muted">
                  {d.doc_type} · {d.page_count ? `${d.page_count} pages · ` : ''}{d.size_bytes ? `${Math.round(d.size_bytes / 1024)} KB · ` : ''}
                  <span className={d.parse_status === 'parsed' ? 'text-emerald-400' : d.parse_status === 'failed' ? 'text-rose-400' : 'text-amber-400'}>
                    {d.parse_status}
                  </span>
                </p>
              </div>
              <div className="ml-3 shrink-0 flex items-center gap-2">
                {/* Pull ANY parsed doc into sections — not just cap_stmt. Users
                    routinely upload a cap statement through the "Other" card;
                    gating on doc_type left those docs stuck with no way to pull.
                    The parser runs on the extracted text regardless of the tag. */}
                {d.parse_status === 'parsed' && (
                  <button
                    onClick={() => parseDoc(d.id, d.original_filename)}
                    disabled={parsing}
                    className="text-xs px-2.5 py-1 rounded border border-emerald-700/60 text-emerald-300 hover:bg-emerald-900/30 disabled:opacity-50"
                  >
                    Pull into sections
                  </button>
                )}
                <button
                  onClick={() => removeDoc(d.id, d.original_filename)}
                  disabled={removingId === d.id}
                  title="Remove this document"
                  className="text-xs px-2 py-1 rounded text-faint hover:text-rose-400 hover:bg-rose-950/30 disabled:opacity-50"
                >
                  {removingId === d.id ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {review && (
        <ParsedDocReview
          email={email}
          filename={review.filename}
          documentId={review.documentId}
          parsed={review.parsed}
          onClose={() => setReview(null)}
          onSaved={() => { setReview(null); onChanged(); }}
        />
      )}
    </div>
  );
}

// Review modal: shows what Mindy pulled out of the capability statement and lets
// the user pick which pieces to save. Each accepted item POSTs to its existing
// structured route (identity / past-performance / capabilities) — nothing is
// written until the user clicks Save.
function ParsedDocReview({
  email, filename, documentId, parsed, onClose, onSaved,
}: {
  email: string;
  filename: string;
  documentId: string;
  parsed: ParsedDoc;
  onClose: () => void;
  onSaved: () => void;
}) {
  const hasOverview = Boolean(parsed.overview.one_liner || parsed.overview.elevator_pitch);
  // Which identity fields actually carry a value (only these are shown / saved).
  const identityFields = IDENTITY_LABELS.filter(({ key }) => {
    const v = parsed.identity?.[key];
    return Array.isArray(v) ? v.length > 0 : Boolean(v);
  });
  const hasIdentity = identityFields.length > 0;
  const [takeOverview, setTakeOverview] = useState(hasOverview);
  const [takeIdentity, setTakeIdentity] = useState(hasIdentity);
  const [ppChecked, setPpChecked] = useState<boolean[]>(parsed.past_performance.map(() => true));
  const [capChecked, setCapChecked] = useState<boolean[]>(parsed.capabilities.map(() => true));
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const fmtIdentityValue = (v: string | string[]) => (Array.isArray(v) ? v.join(', ') : v);

  const toggle = (arr: boolean[], i: number, set: (v: boolean[]) => void) => {
    const next = [...arr];
    next[i] = !next[i];
    set(next);
  };

  const selectedCount =
    (takeOverview && hasOverview ? 1 : 0) +
    (takeIdentity && hasIdentity ? 1 : 0) +
    ppChecked.filter(Boolean).length +
    capChecked.filter(Boolean).length;

  const save = async () => {
    setSaving(true);
    try {
      // ONE transactional call. The client's only job is to send the pieces the
      // user KEPT (checked); the /commit route does ALL coercion + validation +
      // batch insert server-side and returns an authoritative summary. This
      // replaced ~30 hand-assembled POSTs that silently dropped rows on any
      // mapping mismatch (string vs numeric value, missing agency 400, etc.).
      const selections: {
        overview?: { one_liner: string; elevator_pitch: string };
        identity?: Record<string, string | string[]>;
        past_performance?: typeof parsed.past_performance;
        capabilities?: typeof parsed.capabilities;
      } = {};

      if (takeOverview && hasOverview) {
        selections.overview = {
          one_liner: parsed.overview.one_liner,
          elevator_pitch: parsed.overview.elevator_pitch,
        };
      }
      if (takeIdentity && hasIdentity) {
        const idOut: Record<string, string | string[]> = {};
        for (const { key } of identityFields) {
          const v = parsed.identity[key];
          if (Array.isArray(v) ? v.length > 0 : v) idOut[key] = v;
        }
        selections.identity = idOut;
      }
      selections.past_performance = parsed.past_performance.filter((_, i) => ppChecked[i]);
      selections.capabilities = parsed.capabilities.filter((_, i) => capChecked[i]);

      const res = await authedFetch('/api/app/vault/documents/commit', email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, document_id: documentId, selections }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      const total = Number(data.total_saved || 0);
      const skipped: { section: string; item: string; reason: string }[] = data.skipped || [];
      if (skipped.length) {
        // Loud + specific — a partial save is never invisible again.
        setResult(`Saved ${total}. ${skipped.length} skipped.`);
        alert(
          `Saved ${total} item${total === 1 ? '' : 's'} to your Vault.\n\n` +
          `${skipped.length} couldn't be saved:\n` +
          skipped.map((s) => `• ${s.item} (${s.reason})`).join('\n'),
        );
        onSaved(); // refresh + close so the saved ones show
      } else {
        onSaved();
        return;
      }
    } catch (e) {
      setResult(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
      alert(`Couldn't save to your Vault: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-hairline bg-ground-deep shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-surface bg-ground-deep px-5 py-4">
          <div>
            <h3 className="text-white font-semibold">Review what Mindy found</h3>
            <p className="text-xs text-muted truncate max-w-md">From <span className="text-ink-soft">{filename}</span> · uncheck anything wrong before saving</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-6">
          {/* Overview */}
          {hasOverview && (
            <section>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={takeOverview} onChange={() => setTakeOverview((v) => !v)} className="mt-1 accent-emerald-500" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-emerald-300 mb-1">Overview → Identity</p>
                  {parsed.overview.one_liner && <p className="text-sm text-white">{parsed.overview.one_liner}</p>}
                  {parsed.overview.elevator_pitch && <p className="text-xs text-muted mt-1">{parsed.overview.elevator_pitch}</p>}
                </div>
              </label>
            </section>
          )}

          {/* Company info → Identity (UEI, CAGE, NAICS, certs, POC, bonding…) */}
          {hasIdentity && (
            <section>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={takeIdentity} onChange={() => setTakeIdentity((v) => !v)} className="mt-1 accent-emerald-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-emerald-300 mb-2">Company Info → Identity ({identityFields.length})</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                    {identityFields.map(({ key, label }) => (
                      <div key={key} className="min-w-0">
                        <span className="text-[11px] uppercase tracking-wide text-faint">{label}</span>
                        <p className="text-sm text-white break-words">{fmtIdentityValue(parsed.identity[key])}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </label>
            </section>
          )}

          {/* Past performance */}
          {parsed.past_performance.length > 0 && (
            <section>
              <p className="text-sm font-medium text-emerald-300 mb-2">Past Performance ({ppChecked.filter(Boolean).length}/{parsed.past_performance.length})</p>
              <div className="space-y-2">
                {parsed.past_performance.map((p, i) => (
                  <label key={i} className="flex items-start gap-2 cursor-pointer border border-surface rounded-lg p-3 bg-ground/40">
                    <input type="checkbox" checked={ppChecked[i]} onChange={() => toggle(ppChecked, i, setPpChecked)} className="mt-1 accent-emerald-500" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white">{p.contract_title}</p>
                      <p className="text-xs text-muted">
                        {p.agency}
                        {p.contract_number ? ` · ${p.contract_number}` : ''}
                        {p.period ? ` · ${p.period}` : ''}
                        {p.contract_value ? ` · ${p.contract_value}` : ''}
                      </p>
                      {p.scope_description && <p className="text-xs text-faint mt-1 line-clamp-2">{p.scope_description}</p>}
                    </div>
                  </label>
                ))}
              </div>
            </section>
          )}

          {/* Capabilities */}
          {parsed.capabilities.length > 0 && (
            <section>
              <p className="text-sm font-medium text-emerald-300 mb-2">Capabilities ({capChecked.filter(Boolean).length}/{parsed.capabilities.length})</p>
              <div className="space-y-2">
                {parsed.capabilities.map((c, i) => (
                  <label key={i} className="flex items-start gap-2 cursor-pointer border border-surface rounded-lg p-3 bg-ground/40">
                    <input type="checkbox" checked={capChecked[i]} onChange={() => toggle(capChecked, i, setCapChecked)} className="mt-1 accent-emerald-500" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white">{c.capability_name}</p>
                      {c.description && <p className="text-xs text-muted mt-0.5 line-clamp-2">{c.description}</p>}
                      {c.keywords.length > 0 && <p className="text-[11px] text-faint mt-1">{c.keywords.join(' · ')}</p>}
                    </div>
                  </label>
                ))}
              </div>
            </section>
          )}

          {result && <p className="text-sm text-amber-400">{result}</p>}
        </div>

        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-surface bg-ground-deep px-5 py-4">
          <p className="text-xs text-faint">Mindy only pulls text that&apos;s in your document. Nothing saves until you click below.</p>
          <div className="flex gap-2 shrink-0">
            <button onClick={onClose} className="text-sm px-3 py-2 text-ink-soft hover:text-white">Cancel</button>
            <button
              onClick={save}
              disabled={saving || selectedCount === 0}
              className="text-sm px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium disabled:opacity-50"
            >
              {saving ? 'Saving…' : `Save ${selectedCount} to Vault`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Shared atoms -----------------------------------------------------
function Field({
  label, value, onChange, placeholder, hint, multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-sm text-ink-soft mb-1">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full px-3 py-2 bg-ground border border-hairline rounded text-white text-sm focus:border-emerald-500 focus:outline-none"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 bg-ground border border-hairline rounded text-white text-sm focus:border-emerald-500 focus:outline-none"
        />
      )}
      {hint && <span className="block text-xs text-faint mt-1">{hint}</span>}
    </label>
  );
}

function EmptyState({
  icon: Icon, title, body, action, onAction,
}: { icon: LucideIcon; title: string; body: string; action?: string; onAction?: () => void }) {
  return (
    <div className="text-center py-16 max-w-md mx-auto">
      <div className="mb-4 flex justify-center"><Icon className="h-11 w-11 text-faint" strokeWidth={1.5} /></div>
      <h3 className="text-lg font-medium text-white mb-2">{title}</h3>
      <p className="text-sm text-muted mb-5">{body}</p>
      {action && onAction && (
        <button onClick={onAction} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded">
          {action}
        </button>
      )}
    </div>
  );
}

function UploadCard({
  title, body, accept, disabled, onFile,
}: { title: string; body: string; accept: string; disabled?: boolean; onFile: (f: File) => void }) {
  return (
    <label className={`block border-2 border-dashed rounded-lg p-5 transition cursor-pointer ${
      disabled ? 'border-surface opacity-50' : 'border-hairline hover:border-emerald-700 hover:bg-emerald-950/10'
    }`}>
      <h3 className="text-white text-sm font-medium mb-1">{title}</h3>
      <p className="text-xs text-muted mb-3">{body}</p>
      <div className="text-xs text-emerald-400">{disabled ? 'Uploading…' : 'Click to upload'}</div>
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.currentTarget.value = '';
        }}
      />
    </label>
  );
}

// ---- Auto-fill modal ------------------------------------------------
//
// Driven by /api/app/vault/prefill:
//   GET  → fetch SAM Entity + USASpending + AI coach preview
//   POST → write accepted preview to vault tables
//
// Three states: 'input' (UEI entry), 'preview' (review what was found),
// 'applying' (saving). Errors handled inline.

interface PreviewIdentity {
  uei?: string;
  cage_code?: string | null;
  legal_name?: string;
  dba?: string | null;
  certifications?: string[];
  primary_naics?: string[];
  hq_city?: string | null;
  hq_state?: string | null;
  service_states?: string[];
  contract_vehicles?: string[];
  one_liner?: string | null;
  elevator_pitch?: string | null;
}

interface PreviewCapability {
  capability_name: string;
  description: string;
  evidence?: string;
}

interface PreviewSamplePP {
  contract_title: string;
  agency: string;
  contract_value: string;
  scope_description: string;
  coaching_note: string;
}

interface PreviewRealPP {
  contract_title: string;
  agency: string | null;
  contract_number: string | null;
  contract_value: number | null;
  period_start: string | null;
  period_end: string | null;
}

interface PrefillResponse {
  success: boolean;
  error?: string;
  source?: { sam_entity: boolean; usaspending: boolean; ai_coach: boolean };
  identity?: PreviewIdentity;
  past_performance?: PreviewRealPP[];
  capabilities?: PreviewCapability[];
  sample_past_performance?: PreviewSamplePP[];
  summary?: {
    sam_registration_status?: string;
    sam_active?: boolean;
    contracts_found?: number;
    capabilities_drafted?: number;
    sample_pp_drafted?: number;
  };
}

function AutoFillModal({ email, onClose, onApplied }: { email: string; onClose: () => void; onApplied: () => void }) {
  const [stage, setStage] = useState<'input' | 'loading' | 'preview' | 'applying' | 'keywords'>('input');
  const [derivedKeywords, setDerivedKeywords] = useState<string[]>([]);
  const [uei, setUei] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PrefillResponse | null>(null);

  // Per-section accept toggles — user can opt out of any layer.
  const [acceptIdentity, setAcceptIdentity] = useState(true);
  const [acceptCapabilities, setAcceptCapabilities] = useState(true);
  const [acceptSamplePp, setAcceptSamplePp] = useState(true);
  const [acceptRealPp, setAcceptRealPp] = useState(true);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = uei.trim().toUpperCase();
    if (clean.length !== 12) {
      setError('UEI must be exactly 12 characters');
      return;
    }
    setError(null);
    setStage('loading');
    try {
      const res = await authedFetch(
        `/api/app/vault/prefill?uei=${encodeURIComponent(clean)}&email=${encodeURIComponent(email)}`,
        email,
      );
      const data: PrefillResponse = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || `Lookup failed (HTTP ${res.status})`);
        setStage('input');
        return;
      }
      setPreview(data);
      setStage('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
      setStage('input');
    }
  };

  const handleApply = async () => {
    if (!preview) return;
    setStage('applying');
    try {
      const res = await authedFetch('/api/app/vault/prefill', email, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          uei: uei.trim().toUpperCase(),
          identity: acceptIdentity ? preview.identity : null,
          capabilities: acceptCapabilities ? preview.capabilities : [],
          sample_past_performance: acceptSamplePp ? preview.sample_past_performance : [],
          past_performance: acceptRealPp ? preview.past_performance : [],
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || `Apply failed (HTTP ${res.status})`);
        setStage('preview');
        return;
      }
      // Teaching moment: if we derived keywords from their UEI, show them + the
      // keyword-gap lesson before closing. Otherwise close straight away.
      const kws = Array.isArray(data.keywords_derived) ? data.keywords_derived as string[] : [];
      if (kws.length > 0) {
        setDerivedKeywords(kws);
        setStage('keywords');
        return;
      }
      onApplied();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed');
      setStage('preview');
    }
  };

  const summary = preview?.summary;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-ground border border-hairline rounded-2xl w-full max-w-3xl my-8 shadow-2xl shadow-emerald-500/10">
        {/* Header */}
        <div className="px-6 py-4 border-b border-surface flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 shrink-0" strokeWidth={2} />
            <h2 className="text-white font-semibold">Auto-fill from SAM.gov</h2>
          </div>
          <button onClick={onClose} className="text-muted hover:text-white text-xl leading-none" aria-label="Close">×</button>
        </div>

        {/* INPUT */}
        {stage === 'input' && (
          <form onSubmit={handleLookup} className="p-6">
            <p className="text-sm text-ink-soft mb-4">
              Enter your <strong>SAM.gov UEI</strong> (12 characters). Mindy will fetch your registration, draft a one-liner, capabilities, and starter past performance entries — grounded in the GovCon Giants curriculum.
            </p>
            <p className="text-xs text-faint mb-4">
              Don&apos;t know your UEI? Look it up at <a href="https://sam.gov/content/entity-information" target="_blank" rel="noreferrer" className="text-emerald-400 hover:text-emerald-300">sam.gov</a>.
            </p>
            <input
              type="text"
              value={uei}
              onChange={(e) => setUei(e.target.value.toUpperCase().slice(0, 12))}
              placeholder="e.g. W7BEELSVFR91"
              maxLength={12}
              autoFocus
              className="w-full px-4 py-3 bg-surface border border-hairline rounded text-white text-lg font-mono tracking-wider focus:border-emerald-500 focus:outline-none uppercase mb-3"
            />
            {error && <p className="text-sm text-rose-400 mb-3">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 bg-input hover:bg-slate-600 text-white text-sm rounded">
                Cancel
              </button>
              <button
                type="submit"
                disabled={uei.length !== 12}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Look up →
              </button>
            </div>
          </form>
        )}

        {/* LOADING */}
        {stage === 'loading' && (
          <div className="p-12 text-center">
            <div className="inline-block w-10 h-10 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-white font-medium mb-1">Looking up {uei}…</p>
            <p className="text-sm text-muted">
              Fetching SAM.gov registration · checking USASpending · drafting capability profile
            </p>
          </div>
        )}

        {/* PREVIEW */}
        {stage === 'preview' && preview && (
          <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
            {/* Summary chip row */}
            <div className="flex flex-wrap gap-2 text-xs">
              <span className={`px-2 py-1 rounded ${summary?.sam_active ? 'bg-emerald-900/60 text-emerald-300' : 'bg-amber-900/60 text-amber-300'}`}>
                SAM: {summary?.sam_registration_status || 'unknown'}
              </span>
              <span className="px-2 py-1 rounded bg-surface text-ink-soft">
                Capabilities: {summary?.capabilities_drafted || 0}
              </span>
              <span className="px-2 py-1 rounded bg-surface text-ink-soft">
                Sample PP: {summary?.sample_pp_drafted || 0}
              </span>
              {(summary?.contracts_found ?? 0) > 0 && (
                <span className="px-2 py-1 rounded bg-purple-900/60 text-purple-300">
                  USASpending: {summary?.contracts_found} contracts found
                </span>
              )}
            </div>

            {/* Identity */}
            {preview.identity && (
              <section className="border border-surface rounded-lg p-4 bg-ground-deep/50">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acceptIdentity}
                    onChange={(e) => setAcceptIdentity(e.target.checked)}
                    className="mt-1 accent-emerald-500"
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="inline-flex items-center gap-1.5 text-white font-medium mb-2"><IdCard className="h-4 w-4 shrink-0" strokeWidth={2} /> Identity</h3>
                    <div className="text-sm text-ink-soft space-y-1">
                      <div><span className="text-faint">Legal:</span> {preview.identity.legal_name || '—'}</div>
                      <div className="flex gap-4 flex-wrap">
                        <span><span className="text-faint">UEI:</span> <span className="font-mono">{preview.identity.uei || '—'}</span></span>
                        <span><span className="text-faint">CAGE:</span> <span className="font-mono">{preview.identity.cage_code || '—'}</span></span>
                        <span><span className="text-faint">HQ:</span> {[preview.identity.hq_city, preview.identity.hq_state].filter(Boolean).join(', ') || '—'}</span>
                      </div>
                      {(preview.identity.certifications || []).length > 0 && (
                        <div><span className="text-faint">Certifications:</span> {preview.identity.certifications!.join(', ')}</div>
                      )}
                      {(preview.identity.primary_naics || []).length > 0 && (
                        <div className="space-y-1">
                          <span className="text-faint">NAICS:</span>
                          <NaicsBadgeList codes={preview.identity.primary_naics!} max={8} inline inlineTruncate={40} size="sm" />
                        </div>
                      )}
                      {preview.identity.one_liner && (
                        <div className="pt-2 border-t border-surface mt-2"><span className="text-faint">One-liner:</span> <em className="text-emerald-300">&ldquo;{preview.identity.one_liner}&rdquo;</em></div>
                      )}
                      {preview.identity.elevator_pitch && (
                        <div><span className="text-faint">Elevator pitch:</span> <span className="text-ink-soft">{preview.identity.elevator_pitch}</span></div>
                      )}
                    </div>
                  </div>
                </label>
              </section>
            )}

            {/* Capabilities */}
            {(preview.capabilities || []).length > 0 && (
              <section className="border border-surface rounded-lg p-4 bg-ground-deep/50">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acceptCapabilities}
                    onChange={(e) => setAcceptCapabilities(e.target.checked)}
                    className="mt-1 accent-emerald-500"
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="inline-flex items-center gap-1.5 text-white font-medium mb-2"><Wrench className="h-4 w-4 shrink-0" strokeWidth={2} /> Capabilities ({preview.capabilities!.length})</h3>
                    <div className="space-y-2">
                      {preview.capabilities!.map((c, i) => (
                        <div key={i} className="text-sm">
                          <span className="text-white font-medium">{c.capability_name}</span>
                          <span className="text-muted"> — {c.description}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </label>
              </section>
            )}

            {/* Real past performance from USASpending */}
            {(preview.past_performance || []).length > 0 && (
              <section className="border border-purple-900 rounded-lg p-4 bg-purple-950/20">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acceptRealPp}
                    onChange={(e) => setAcceptRealPp(e.target.checked)}
                    className="mt-1 accent-purple-500"
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="inline-flex items-center gap-1.5 text-white font-medium mb-2"><Trophy className="h-4 w-4 shrink-0" strokeWidth={2} /> Past Performance from USASpending ({preview.past_performance!.length})</h3>
                    <p className="text-xs text-purple-300/80 mb-2">Real contracts on file for your UEI.</p>
                    <div className="space-y-1.5 text-sm">
                      {preview.past_performance!.slice(0, 8).map((p, i) => (
                        <div key={i} className="text-ink-soft">
                          <span className="text-white">{p.contract_title.slice(0, 80)}</span>
                          <span className="text-faint"> · {p.agency} · ${(p.contract_value || 0).toLocaleString()}</span>
                        </div>
                      ))}
                      {preview.past_performance!.length > 8 && (
                        <div className="text-xs text-faint">+ {preview.past_performance!.length - 8} more</div>
                      )}
                    </div>
                  </div>
                </label>
              </section>
            )}

            {/* Sample past performance — coaching placeholders */}
            {(preview.sample_past_performance || []).length > 0 && (
              <section className="border border-amber-900 rounded-lg p-4 bg-amber-950/20">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acceptSamplePp}
                    onChange={(e) => setAcceptSamplePp(e.target.checked)}
                    className="mt-1 accent-amber-500"
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="inline-flex items-center gap-1.5 text-white font-medium mb-2"><PenLine className="h-4 w-4 shrink-0" strokeWidth={2} /> Sample Past Performance — Starter Templates ({preview.sample_past_performance!.length})</h3>
                    <p className="text-xs text-amber-300/80 mb-3">
                      Templates with [bracketed placeholders] so you can see what strong past perf looks like in your NAICS. You edit in your real contracts later.
                    </p>
                    <div className="space-y-3">
                      {preview.sample_past_performance!.map((p, i) => (
                        <div key={i} className="text-sm border-l-2 border-amber-800/60 pl-3">
                          <div className="text-white">{p.contract_title}</div>
                          <div className="text-muted text-xs">{p.agency} · {p.contract_value}</div>
                          <div className="text-ink-soft text-xs mt-1">{p.scope_description}</div>
                          {p.coaching_note && (
                            <div className="inline-flex items-start gap-1 text-amber-300/70 text-xs mt-1 italic"><PenLine className="h-3 w-3 shrink-0 mt-0.5" strokeWidth={2} /> {p.coaching_note}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </label>
              </section>
            )}

            {error && <p className="text-sm text-rose-400">{error}</p>}
          </div>
        )}

        {/* APPLYING */}
        {stage === 'applying' && (
          <div className="p-12 text-center">
            <div className="inline-block w-10 h-10 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-white font-medium">Saving to your Vault…</p>
          </div>
        )}

        {/* KEYWORD-GAP TEACHING MOMENT — shown after autofill when we derived
            keywords from the company's real work. Teaches WHY keywords matter. */}
        {stage === 'keywords' && (
          <div className="p-6">
            <div className="rounded-xl border border-purple-500/40 bg-gradient-to-br from-blue-950/40 to-purple-950/40 p-5 mb-5">
              <span className="text-xs font-bold uppercase tracking-wider text-purple-300">One more thing</span>
              <h3 className="text-lg font-bold text-white mt-1 mb-2">We found the words buyers use for your work</h3>
              <p className="text-sm text-ink-soft">
                Your NAICS codes say <strong>who you are</strong>. These keywords say
                <strong> what you sell</strong> — and they catch opportunities your codes
                alone would miss, because the title rarely matches the work.
              </p>
            </div>

            <p className="text-xs uppercase tracking-wider text-faint mb-2">Added to your alerts</p>
            <div className="flex flex-wrap gap-2 mb-5">
              {derivedKeywords.map((kw) => (
                <span key={kw} className="rounded-full border border-purple-400/30 bg-purple-500/10 px-3 py-1.5 text-sm text-purple-100">
                  {kw}
                </span>
              ))}
            </div>

            <p className="text-sm text-muted mb-5">
              Mindy will now match opportunities on these words too — including ones buried
              in the body of a solicitation that a keyword like your NAICS would never surface.
              You can fine-tune them anytime in <strong className="text-ink-soft">Settings → Keywords</strong>.
            </p>

            <button
              onClick={onApplied}
              className="w-full px-5 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-semibold rounded-lg transition-colors"
            >
              Got it — start using Mindy →
            </button>
          </div>
        )}

        {/* Footer */}
        {stage === 'preview' && (
          <div className="px-6 py-4 border-t border-surface flex justify-between items-center bg-ground-deep/50 rounded-b-2xl">
            <button onClick={onClose} className="text-sm text-muted hover:text-white">
              Cancel
            </button>
            <button
              onClick={handleApply}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded"
            >
              Apply to my Vault →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
