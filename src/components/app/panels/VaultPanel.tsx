'use client';

import { useEffect, useState, useCallback } from 'react';
import type { AppTier } from '../UnifiedSidebar';
import { getMIApiHeaders } from '../authHeaders';

interface Props {
  email: string | null;
  tier: AppTier;
}

type VaultSection = 'identity' | 'past_performance' | 'capabilities' | 'team' | 'documents';

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

const SECTIONS: { id: VaultSection; label: string; icon: string; blurb: string }[] = [
  { id: 'identity', label: 'Identity', icon: '🪪', blurb: 'UEI, CAGE, certifications, one-liner' },
  { id: 'past_performance', label: 'Past Performance', icon: '🏆', blurb: 'Real contracts you have won' },
  { id: 'capabilities', label: 'Capabilities', icon: '🛠️', blurb: 'What you can do, tagged by NAICS' },
  { id: 'team', label: 'Team', icon: '👤', blurb: 'Key personnel and bios' },
  { id: 'documents', label: 'Documents', icon: '📄', blurb: 'Capability statements + boilerplate' },
];

export default function VaultPanel({ email, tier }: Props) {
  const [section, setSection] = useState<VaultSection>('identity');
  const [identity, setIdentity] = useState<IdentityProfile | null>(null);
  const [pastPerf, setPastPerf] = useState<PastPerf[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [docs, setDocs] = useState<BoilerplateDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!email) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/app/vault?email=${encodeURIComponent(email)}`, {
        headers: getMIApiHeaders(email),
      });
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
      <div className="p-8 text-center text-slate-400">
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
      <div className="px-6 py-5 border-b border-slate-800">
        <div className="flex items-center gap-3 mb-1">
          <span className="text-2xl">🗂️</span>
          <h1 className="text-xl font-semibold text-white">My Vault</h1>
        </div>
        <p className="text-sm text-slate-400">
          Everything Mindy uses to make outputs sound like <em>you</em>. The more you store, the more personalized your drafts, briefings, and proposals.
        </p>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 px-4 pt-3 border-b border-slate-800 overflow-x-auto">
        {SECTIONS.map((s) => {
          const count = s.id === 'identity' ? null : counts[s.id as keyof typeof counts];
          const active = section === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm rounded-t-md transition whitespace-nowrap ${
                active
                  ? 'bg-slate-800 text-white border-b-2 border-emerald-500'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
              }`}
            >
              <span>{s.icon}</span>
              <span>{s.label}</span>
              {count !== null && (
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  count > 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-700 text-slate-400'
                }`}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Status row */}
      {loading && (
        <div className="px-6 py-2 text-xs text-slate-400 bg-slate-900/40">Loading vault…</div>
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
      </div>
    </div>
  );
}

// ---- Identity ---------------------------------------------------------
function IdentitySection({ email, data, onSaved }: { email: string; data: IdentityProfile; onSaved: () => void }) {
  const [form, setForm] = useState<IdentityProfile>(data);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => { setForm(data); }, [data]);

  const onField = (k: keyof IdentityProfile, v: string | number | string[] | null) => {
    setForm((f) => ({ ...f, [k]: v }));
  };

  const onArrayField = (k: keyof IdentityProfile, raw: string) => {
    const arr = raw.split(',').map((s) => s.trim()).filter(Boolean);
    setForm((f) => ({ ...f, [k]: arr }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/app/vault/identity', {
        method: 'PUT',
        headers: { ...Object.fromEntries(getMIApiHeaders(email).entries()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, profile: form }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
        value={(form.certifications || []).join(', ')}
        onChange={(v) => onArrayField('certifications', v)}
        placeholder="Small Business, 8(a), SDVOSB, WOSB, HUBZone"
      />

      <Field
        label="Primary NAICS codes (comma-separated)"
        value={(form.primary_naics || []).join(', ')}
        onChange={(v) => onArrayField('primary_naics', v)}
        placeholder="541512, 541611, 541330"
      />

      <div className="grid grid-cols-2 gap-4">
        <Field label="HQ State" value={form.hq_state || ''} onChange={(v) => onField('hq_state', v)} placeholder="FL" />
        <Field label="HQ City" value={form.hq_city || ''} onChange={(v) => onField('hq_city', v)} placeholder="Miami" />
      </div>

      <Field
        label="Service states (comma-separated, where you can perform)"
        value={(form.service_states || []).join(', ')}
        onChange={(v) => onArrayField('service_states', v)}
        placeholder="FL, GA, AL, NC, SC"
      />

      <Field
        label="Contract vehicles (comma-separated)"
        value={(form.contract_vehicles || []).join(', ')}
        onChange={(v) => onArrayField('contract_vehicles', v)}
        placeholder="GSA Schedule, OASIS, CIO-SP3"
      />

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
    </div>
  );
}

// ---- Past Performance -------------------------------------------------
function PastPerfSection({ email, items, onChanged }: { email: string; items: PastPerf[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  if (items.length === 0 && !adding) {
    return (
      <EmptyState
        icon="🏆"
        title="No past performance yet"
        body="Add real contracts you have won. Mindy will cite them in your proposal drafts and cap statements instead of using [bracketed placeholders]. Even 3-5 entries make a visible quality difference."
        action="+ Add past performance"
        onAction={() => setAdding(true)}
      />
    );
  }
  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-medium text-white">{items.length} past performance {items.length === 1 ? 'entry' : 'entries'}</h2>
        <button onClick={() => setAdding(true)} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded">
          + Add past performance
        </button>
      </div>
      {adding && (
        <PastPerfForm email={email} onSaved={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} />
      )}
      <div className="space-y-3">
        {items.map((p) => (
          <div key={p.id} className="border border-slate-800 rounded-lg p-4 bg-slate-900/40">
            <div className="flex justify-between items-start">
              <div className="flex-1 min-w-0">
                <h3 className="text-white font-medium">{p.contract_title}</h3>
                <p className="text-sm text-slate-400">
                  {p.agency}
                  {p.sub_agency && ` · ${p.sub_agency}`}
                  {p.contract_number && ` · ${p.contract_number}`}
                </p>
                {p.contract_value && (
                  <p className="text-sm text-emerald-400 mt-1">${(p.contract_value).toLocaleString()}</p>
                )}
                {p.scope_description && (
                  <p className="text-sm text-slate-300 mt-2">{p.scope_description}</p>
                )}
              </div>
              <button
                onClick={async () => {
                  if (!confirm('Archive this past performance?')) return;
                  await fetch(`/api/app/vault/past-performance?id=${p.id}&email=${encodeURIComponent(email)}`, {
                    method: 'DELETE', headers: getMIApiHeaders(email),
                  });
                  onChanged();
                }}
                className="ml-3 text-xs text-slate-500 hover:text-rose-400"
              >Archive</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PastPerfForm({ email, onSaved, onCancel }: { email: string; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    contract_title: '', contract_number: '', agency: '', sub_agency: '',
    period_start: '', period_end: '', contract_value: '', role: 'prime',
    scope_description: '', cpars_rating: '',
    reference_name: '', reference_email: '',
    relevance_keywords: '', naics_codes: '',
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.contract_title.trim() || !form.agency.trim()) {
      alert('Contract title and agency are required.');
      return;
    }
    setSaving(true);
    try {
      await fetch('/api/app/vault/past-performance', {
        method: 'POST',
        headers: { ...Object.fromEntries(getMIApiHeaders(email).entries()), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
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
      <h3 className="text-white font-medium">New past performance</h3>
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
        <button onClick={onCancel} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded">Cancel</button>
      </div>
    </div>
  );
}

// ---- Capabilities -----------------------------------------------------
function CapabilitiesSection({ email, items, onChanged }: { email: string; items: Capability[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ capability_name: '', description: '', related_naics: '', keywords: '', evidence: '' });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.capability_name.trim() || !form.description.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/app/vault/capabilities', {
        method: 'POST',
        headers: { ...Object.fromEntries(getMIApiHeaders(email).entries()), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          entry: {
            ...form,
            related_naics: form.related_naics.split(',').map(s => s.trim()).filter(Boolean),
            keywords: form.keywords.split(',').map(s => s.trim()).filter(Boolean),
          },
        }),
      });
      setForm({ capability_name: '', description: '', related_naics: '', keywords: '', evidence: '' });
      setAdding(false);
      onChanged();
    } finally { setSaving(false); }
  };

  if (items.length === 0 && !adding) {
    return (
      <EmptyState
        icon="🛠️"
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
        <div className="border border-emerald-900 rounded-lg p-5 mb-5 bg-emerald-950/20 space-y-3">
          <Field label="Capability name *" value={form.capability_name} onChange={(v) => setForm(f => ({ ...f, capability_name: v }))} placeholder="Penetration Testing" />
          <Field label="Description (1-3 sentences in your voice) *" value={form.description} onChange={(v) => setForm(f => ({ ...f, description: v }))} multiline />
          <Field label="Related NAICS (comma-separated)" value={form.related_naics} onChange={(v) => setForm(f => ({ ...f, related_naics: v }))} placeholder="541512, 541519" />
          <Field label="Keywords (comma-separated)" value={form.keywords} onChange={(v) => setForm(f => ({ ...f, keywords: v }))} placeholder="OWASP, pen test, vulnerability assessment" />
          <Field label="Evidence" value={form.evidence} onChange={(v) => setForm(f => ({ ...f, evidence: v }))} placeholder="OSCP certified team, 50+ tests delivered" />
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={() => setAdding(false)} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded">Cancel</button>
          </div>
        </div>
      )}
      <div className="space-y-3">
        {items.map((c) => (
          <div key={c.id} className="border border-slate-800 rounded-lg p-4 bg-slate-900/40">
            <div className="flex justify-between items-start">
              <div className="flex-1 min-w-0">
                <h3 className="text-white font-medium">{c.capability_name}</h3>
                <p className="text-sm text-slate-300 mt-1">{c.description}</p>
                {(c.related_naics || []).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {c.related_naics!.map((n) => (
                      <span key={n} className="text-xs bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">{n}</span>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={async () => {
                  if (!confirm('Archive this capability?')) return;
                  await fetch(`/api/app/vault/capabilities?id=${c.id}&email=${encodeURIComponent(email)}`, {
                    method: 'DELETE', headers: getMIApiHeaders(email),
                  });
                  onChanged();
                }}
                className="ml-3 text-xs text-slate-500 hover:text-rose-400"
              >Archive</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Team -------------------------------------------------------------
function TeamSection({ email, items, onChanged }: { email: string; items: TeamMember[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    full_name: '', title: '', security_clearance: '', certifications: '',
    years_experience: '', bio_short: '', is_key_personnel: true,
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.full_name.trim() || !form.title.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/app/vault/team', {
        method: 'POST',
        headers: { ...Object.fromEntries(getMIApiHeaders(email).entries()), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          entry: {
            ...form,
            years_experience: form.years_experience ? Number(form.years_experience) : null,
            certifications: form.certifications.split(',').map(s => s.trim()).filter(Boolean),
          },
        }),
      });
      setForm({ full_name: '', title: '', security_clearance: '', certifications: '', years_experience: '', bio_short: '', is_key_personnel: true });
      setAdding(false);
      onChanged();
    } finally { setSaving(false); }
  };

  if (items.length === 0 && !adding) {
    return (
      <EmptyState
        icon="👤"
        title="No team members in vault"
        body="Add your key personnel. Mindy uses these to draft Management Plan + Key Personnel sections automatically. Resume PDFs can be attached later."
        action="+ Add team member"
        onAction={() => setAdding(true)}
      />
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-medium text-white">{items.length} team {items.length === 1 ? 'member' : 'members'}</h2>
        <button onClick={() => setAdding(true)} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded">+ Add team member</button>
      </div>
      {adding && (
        <div className="border border-emerald-900 rounded-lg p-5 mb-5 bg-emerald-950/20 space-y-3">
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
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.is_key_personnel} onChange={(e) => setForm(f => ({ ...f, is_key_personnel: e.target.checked }))} />
            Mark as Key Personnel (shows in proposal sections)
          </label>
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
            <button onClick={() => setAdding(false)} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded">Cancel</button>
          </div>
        </div>
      )}
      <div className="space-y-3">
        {items.map((m) => (
          <div key={m.id} className="border border-slate-800 rounded-lg p-4 bg-slate-900/40 flex justify-between items-start">
            <div className="flex-1 min-w-0">
              <h3 className="text-white font-medium">
                {m.full_name}
                {m.is_key_personnel && <span className="ml-2 text-xs bg-emerald-900 text-emerald-300 px-1.5 py-0.5 rounded">Key Personnel</span>}
              </h3>
              <p className="text-sm text-slate-400">{m.title}{m.years_experience && ` · ${m.years_experience} yrs`}{m.security_clearance && ` · ${m.security_clearance} cleared`}</p>
              {m.bio_short && <p className="text-sm text-slate-300 mt-1">{m.bio_short}</p>}
            </div>
            <button
              onClick={async () => {
                if (!confirm('Archive this team member?')) return;
                await fetch(`/api/app/vault/team?id=${m.id}&email=${encodeURIComponent(email)}`, {
                  method: 'DELETE', headers: getMIApiHeaders(email),
                });
                onChanged();
              }}
              className="ml-3 text-xs text-slate-500 hover:text-rose-400"
            >Archive</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Documents (boilerplate / cap statements) -------------------------
function DocumentsSection({ email, items, onChanged }: { email: string; items: BoilerplateDoc[]; onChanged: () => void }) {
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File, doc_type: string) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('email', email);
      fd.append('doc_type', doc_type);
      const res = await fetch('/api/app/vault/documents', {
        method: 'POST',
        headers: getMIApiHeaders(email),
        body: fd,
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
      onChanged();
    } catch (e) {
      alert(`Upload failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <UploadCard
          title="Upload Capability Statement"
          body="PDF or Word. Mindy will parse it into editable sections (Overview, Past Performance, Capabilities, etc.) so the content powers every cap statement going forward."
          accept=".pdf,.docx,.doc"
          disabled={uploading}
          onFile={(f) => upload(f, 'cap_stmt')}
        />
        <UploadCard
          title="Upload Company Overview / Other"
          body="Any boilerplate doc — company overview, cover letter template, past perf table. Mindy extracts the text and uses it as reference material."
          accept=".pdf,.docx,.doc,.txt"
          disabled={uploading}
          onFile={(f) => upload(f, 'other')}
        />
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon="📄"
          title="No documents uploaded yet"
          body="Upload your existing capability statement to get started. Mindy will parse it into structured sections you can edit and reuse."
        />
      ) : (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-slate-300 mb-3">Uploaded documents</h2>
          {items.map((d) => (
            <div key={d.id} className="flex justify-between items-center border border-slate-800 rounded-lg p-3 bg-slate-900/40">
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm truncate">{d.original_filename}</p>
                <p className="text-xs text-slate-400">
                  {d.doc_type} · {d.page_count ? `${d.page_count} pages · ` : ''}{d.size_bytes ? `${Math.round(d.size_bytes / 1024)} KB · ` : ''}
                  <span className={d.parse_status === 'parsed' ? 'text-emerald-400' : d.parse_status === 'failed' ? 'text-rose-400' : 'text-amber-400'}>
                    {d.parse_status}
                  </span>
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
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
      <span className="block text-sm text-slate-300 mb-1">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white text-sm focus:border-emerald-500 focus:outline-none"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded text-white text-sm focus:border-emerald-500 focus:outline-none"
        />
      )}
      {hint && <span className="block text-xs text-slate-500 mt-1">{hint}</span>}
    </label>
  );
}

function EmptyState({
  icon, title, body, action, onAction,
}: { icon: string; title: string; body: string; action?: string; onAction?: () => void }) {
  return (
    <div className="text-center py-16 max-w-md mx-auto">
      <div className="text-5xl mb-4">{icon}</div>
      <h3 className="text-lg font-medium text-white mb-2">{title}</h3>
      <p className="text-sm text-slate-400 mb-5">{body}</p>
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
      disabled ? 'border-slate-800 opacity-50' : 'border-slate-700 hover:border-emerald-700 hover:bg-emerald-950/10'
    }`}>
      <h3 className="text-white text-sm font-medium mb-1">{title}</h3>
      <p className="text-xs text-slate-400 mb-3">{body}</p>
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
