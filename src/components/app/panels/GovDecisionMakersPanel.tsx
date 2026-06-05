'use client';

/**
 * Government Decision Makers — browse the federal_contacts directory
 * (~112K SAM-sourced gov contacts). Search by name/title, filter by
 * agency + office, sort. Read-only directory; saving to CRM lives in the
 * Relationships panel.
 */

import { useState, useEffect, useCallback } from 'react';
import type { AppTier } from '../UnifiedSidebar';

interface Props {
  email: string | null;
  tier: AppTier;
}

interface Contact {
  id: string;
  contact_fullname: string | null;
  contact_title: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  department_ind_agency: string | null;
  office: string | null;
  sub_tier: string | null;
  role_category: string | null;
  role: string | null;       // real job title if we could identify one
  pocLabel: string | null;   // "Primary"/"Secondary" SAM POC designation
  subAgency: string | null;  // derived branch/command (Air Force, Navy, DLA…)
  derivedOffice: string | null; // DoDAAC-decoded office (NAVSUP WSS, DLA Aviation…)
  dodaac: string | null;
  instrumentType: string | null; // BPA / IDIQ / OTA / Purchase Order / RFQ…
}

export default function GovDecisionMakersPanel({ email }: Props) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [agencies, setAgencies] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [agency, setAgency] = useState('');
  const [officeDetail, setOfficeDetail] = useState<Array<{ name: string; amount: number; awards: number }>>([]);
  const [subAgency, setSubAgency] = useState('');
  const [subAgencies, setSubAgencies] = useState<Array<{ name: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trackedOffices, setTrackedOffices] = useState<Set<string>>(new Set());

  // Add a contracting office to My Target List (CRM). Sends the DoDAAC as
  // office_code — the API resolves the canonical name + sub-agency from the
  // dodaac_directory reference table, so the CRM record is always correct.
  const trackOffice = async (c: Contact) => {
    if (!c.dodaac) return;
    try {
      const res = await fetch('/api/app/target-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_email: email,
          agency_name: c.department_ind_agency || 'Department of Defense',
          sub_agency_name: c.subAgency || null,
          office_code: c.dodaac,
          office_name: c.derivedOffice || c.dodaac,
          added_from: 'decision_makers',
        }),
      });
      if (res.ok) {
        setTrackedOffices(prev => new Set(prev).add(c.dodaac!));
      } else if (res.status === 402) {
        setError('Saved target lists are a Mindy Pro feature.');
      }
    } catch { /* non-fatal */ }
  };

  // Load agency facet list once.
  useEffect(() => {
    if (!email) return;
    fetch(`/api/app/federal-contacts?facets=agencies&email=${encodeURIComponent(email)}`)
      .then(r => r.json())
      .then(d => { if (d.success) setAgencies(d.agencies || []); })
      .catch(() => {});
  }, [email]);

  // Load the agency's top CONTRACTING OFFICES (from awards data) when an
  // agency is selected — the "DoD is too broad → here are its real offices"
  // drill-down. This is intelligence, not a contact filter (SAM POC contacts
  // don't carry office, so we can't filter the rows by office).
  useEffect(() => {
    setOfficeDetail([]);
    setSubAgency('');
    setSubAgencies([]);
    if (!email || !agency) return;
    fetch(`/api/app/federal-contacts?facets=offices&agency=${encodeURIComponent(agency)}&email=${encodeURIComponent(email)}`)
      .then(r => r.json())
      .then(d => { if (d.success) setOfficeDetail(d.officeDetail || []); })
      .catch(() => {});
    // Derived sub-agencies present in this agency's contacts (DoD → AF/Navy/…),
    // so the dropdown narrows huge agencies.
    fetch(`/api/app/federal-contacts?facets=subagencies&agency=${encodeURIComponent(agency)}&email=${encodeURIComponent(email)}`)
      .then(r => r.json())
      .then(d => { if (d.success) setSubAgencies(d.subAgencies || []); })
      .catch(() => {});
  }, [email, agency]);

  const load = useCallback(async () => {
    if (!email) return;
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams({ email });
      if (search.trim()) p.set('search', search.trim());
      if (agency) p.set('agency', agency);
      if (subAgency) p.set('subAgency', subAgency);
      p.set('limit', '100');
      const res = await fetch(`/api/app/federal-contacts?${p}`);
      const d = await res.json();
      if (d.success) {
        setContacts(d.contacts || []);
        setTotal(d.total || 0);
      } else {
        setError(d.error || 'Search failed');
        setContacts([]);
      }
    } catch {
      setError('Failed to load contacts');
      setContacts([]);
    }
    setLoading(false);
  }, [email, search, agency, subAgency]);

  // Initial load + reload when agency or sub-agency filter changes.
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [agency, subAgency]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Government Decision Makers</h1>
        <p className="text-slate-400 mt-1">
          Search {total ? total.toLocaleString() : ''} federal contacts from SAM — contracting officers and points of contact.
          <span className="text-slate-500 ml-2 text-sm">Filter by agency &amp; office.</span>
        </p>
      </div>

      {/* Search + filters */}
      <div className="space-y-4">
        <div className="flex gap-3">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load()}
            placeholder="Search by name or title (e.g., contracting officer, Smith)"
            className="flex-1 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
          />
          <button
            onClick={load}
            disabled={loading}
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-white font-medium rounded-lg transition-colors"
          >
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          <select
            value={agency}
            onChange={e => setAgency(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:border-emerald-500 outline-none max-w-xs"
          >
            <option value="">All Agencies</option>
            {agencies.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          {/* Sub-agency / branch drill-down (DoD → Air Force / Navy / DLA…).
              Only shows when the selected agency has derivable sub-agencies. */}
          {agency && subAgencies.length > 1 && (
            <select
              value={subAgency}
              onChange={e => setSubAgency(e.target.value)}
              className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:border-emerald-500 outline-none max-w-xs"
            >
              <option value="">All sub-agencies</option>
              {subAgencies.map(s => <option key={s.name} value={s.name}>{s.name} ({s.count})</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Contracting offices in the selected agency — the "DoD is too broad"
          drill-down, sourced from awards.awarding_office (SAM POC contacts
          don't carry office, so this is agency intelligence, not a row filter). */}
      {agency && officeDetail.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-sm font-semibold text-white">Top contracting offices in {agency}</h3>
            <span className="text-xs text-slate-500">{officeDetail.length} offices · by spend</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {officeDetail.slice(0, 12).map((o) => (
              <span key={o.name} className="text-xs bg-slate-800 text-slate-300 rounded px-2 py-1" title={`${o.awards.toLocaleString()} awards`}>
                {o.name} <span className="text-emerald-400 font-medium">${o.amount >= 1e9 ? (o.amount / 1e9).toFixed(0) + 'B' : (o.amount / 1e6).toFixed(0) + 'M'}</span>
              </span>
            ))}
          </div>
          <p className="text-[10px] text-slate-600 mt-2">From federal award data. The contacts below are SAM points of contact, which don&apos;t carry office — use the office list to know which commands buy, then search by name.</p>
        </div>
      )}

      {error && <div className="p-4 bg-red-500/10 text-red-300 rounded-lg text-sm">{error}</div>}

      {/* Results table */}
      {!loading && contacts.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/60 text-left text-slate-400">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Role / POC</th>
                <th className="px-4 py-3 font-medium">Agency</th>
                <th className="px-4 py-3 font-medium">Office</th>
                <th className="px-4 py-3 font-medium">Contact</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map(c => (
                <tr key={c.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                  <td className="px-4 py-3 text-white font-medium">{c.contact_fullname || '—'}</td>
                  <td className="px-4 py-3">
                    {c.role ? (
                      <span className="text-slate-200">{c.role}</span>
                    ) : c.pocLabel ? (
                      <span className="text-slate-500 italic" title="SAM point-of-contact designation, not a job title">{c.pocLabel} POC</span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {c.department_ind_agency || '—'}
                    {c.subAgency && <span className="block text-xs text-emerald-400/80">{c.subAgency}</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0">
                        {c.derivedOffice || c.office || c.sub_tier || '—'}
                        {c.instrumentType && <span className="block text-[11px] text-slate-600">{c.instrumentType}{c.dodaac ? ` · ${c.dodaac}` : ''}</span>}
                      </div>
                      {/* Track this contracting office to My Target List (CRM).
                          Links via DoDAAC; the name auto-fills from the directory. */}
                      {c.dodaac && c.derivedOffice && (
                        <button
                          onClick={() => trackOffice(c)}
                          disabled={trackedOffices.has(c.dodaac)}
                          className="shrink-0 text-[11px] px-1.5 py-0.5 rounded border border-slate-700 text-slate-400 hover:text-emerald-400 hover:border-emerald-600 disabled:opacity-50 disabled:cursor-default"
                          title="Add this office to My Target List"
                        >
                          {trackedOffices.has(c.dodaac) ? '✓ Tracked' : '+ Track'}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {c.contact_email ? (
                      <a href={`mailto:${c.contact_email}`} className="text-emerald-400 hover:underline">{c.contact_email}</a>
                    ) : c.contact_phone ? (
                      <span className="text-slate-400">{c.contact_phone}</span>
                    ) : <span className="text-slate-600">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > contacts.length && (
            <div className="px-4 py-3 text-xs text-slate-500 border-t border-slate-800">
              Showing {contacts.length} of ~{total.toLocaleString()} — narrow with search, agency, or office.
            </div>
          )}
        </div>
      )}

      {!loading && contacts.length === 0 && !error && (
        <div className="text-center py-12 text-slate-400">
          <div className="text-lg font-medium text-white mb-1">No contacts found</div>
          <div className="text-sm">Try a broader search or a different agency.</div>
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-12 bg-slate-800/40 rounded animate-pulse" />)}
        </div>
      )}

      <p className="text-xs text-slate-600">
        Source: SAM.gov points of contact named on solicitations, synced daily. &quot;Primary/Secondary POC&quot; is SAM&apos;s
        designation for who was listed on a notice — not always a job title. SAM only carries a real role
        (e.g. Contracting Officer) for a minority of contacts; program managers and end users aren&apos;t in this
        dataset yet.
      </p>
    </div>
  );
}
