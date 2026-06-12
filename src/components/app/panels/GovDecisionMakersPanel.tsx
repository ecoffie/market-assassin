'use client';

/**
 * Government Decision Makers — browse the federal_contacts directory
 * (~112K SAM-sourced gov contacts). Search by name/title, filter by
 * agency + office, sort. Read-only directory; saving to CRM lives in the
 * Relationships panel.
 */

import { useState, useEffect, useCallback } from 'react';
import type { AppTier } from '../UnifiedSidebar';
import { getMIApiHeaders } from '../authHeaders';

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
  roleCategory: string | null;  // classified role badge (KO / Small Business / Program …)
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
  const [trackNote, setTrackNote] = useState<string | null>(null);
  // Office roster (#16) — the COMPLETE contact list for a specific buying office
  // (DoDAAC-decoded, domestic). Loaded on agency select; one office expandable.
  const [officeRosters, setOfficeRosters] = useState<Array<{ name: string; count: number }>>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [openRoster, setOpenRoster] = useState<{ office: string; people: any[] } | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  // The user's target agencies (from My Target List) — Decision Makers should
  // default to THESE (Eric QA: "it should already track my 9 pre-selected
  // agencies"). 'targets' scope filters contacts to any target agency.
  const [targetAgencies, setTargetAgencies] = useState<string[]>([]);
  const [scope, setScope] = useState<'targets' | 'all'>('all');

  useEffect(() => {
    if (!email) return;
    fetch(`/api/app/target-list?email=${encodeURIComponent(email)}`)
      .then(r => r.json())
      .then(d => {
        const ags = Array.from(new Set(((d?.targets || d?.targetList || []) as Array<{ agency_name?: string }>)
          .map(t => (t.agency_name || '').trim()).filter(Boolean)));
        setTargetAgencies(ags);
        if (ags.length > 0) setScope('targets'); // default to the user's targets
      })
      .catch(() => {});
  }, [email]);

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
        // Tell the user WHERE it went (Eric QA: "where does Track go?").
        setTrackNote(`✓ ${c.derivedOffice || c.dodaac} added to My Target List (Pipeline → My Target List).`);
        setTimeout(() => setTrackNote(null), 5000);
      } else if (res.status === 402) {
        setError('Saved target lists are a Mindy Pro feature.');
      }
    } catch { /* non-fatal */ }
  };

  // Load agency facet list once.
  useEffect(() => {
    if (!email) return;
    fetch(`/api/app/federal-contacts?facets=agencies&email=${encodeURIComponent(email)}`, { headers: getMIApiHeaders(email) })
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
    setOfficeRosters([]);
    setOpenRoster(null);
    if (!email || !agency) return;
    fetch(`/api/app/federal-contacts?facets=offices&agency=${encodeURIComponent(agency)}&email=${encodeURIComponent(email)}`, { headers: getMIApiHeaders(email) })
      .then(r => r.json())
      .then(d => { if (d.success) setOfficeDetail(d.officeDetail || []); })
      .catch(() => {});
    // Derived sub-agencies present in this agency's contacts (DoD → AF/Navy/…),
    // so the dropdown narrows huge agencies.
    fetch(`/api/app/federal-contacts?facets=subagencies&agency=${encodeURIComponent(agency)}&email=${encodeURIComponent(email)}`, { headers: getMIApiHeaders(email) })
      .then(r => r.json())
      .then(d => { if (d.success) setSubAgencies(d.subAgencies || []); })
      .catch(() => {});
    // Office rosters (#16) — the buying offices with a COMPLETE contact list
    // (DoDAAC-decoded, domestic). Populated for DoD/DLA/Navy; empty for civilian.
    fetch(`/api/app/federal-contacts?facets=office-roster&agency=${encodeURIComponent(agency)}&email=${encodeURIComponent(email)}`, { headers: getMIApiHeaders(email) })
      .then(r => r.json())
      .then(d => { if (d.success) setOfficeRosters(d.offices || []); })
      .catch(() => {});
  }, [email, agency]);

  // Load the full roster for one office on click.
  const openOfficeRoster = useCallback(async (officeName: string) => {
    if (!email || !agency) return;
    if (openRoster?.office === officeName) { setOpenRoster(null); return; }
    setRosterLoading(true);
    try {
      const res = await fetch(`/api/app/federal-contacts?facets=office-roster&agency=${encodeURIComponent(agency)}&office=${encodeURIComponent(officeName)}&email=${encodeURIComponent(email)}`, { headers: getMIApiHeaders(email) });
      const d = await res.json();
      setOpenRoster(d.success ? { office: officeName, people: d.roster || [] } : null);
    } catch {
      setOpenRoster(null);
    } finally {
      setRosterLoading(false);
    }
  }, [email, agency, openRoster]);

  const load = useCallback(async () => {
    if (!email) return;
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams({ email });
      if (search.trim()) p.set('search', search.trim());
      if (agency) p.set('agency', agency);
      if (subAgency) p.set('subAgency', subAgency);
      // In 'targets' scope we filter client-side across the user's agencies, so
      // pull a wider window to ensure all targets are represented.
      p.set('limit', scope === 'targets' && !agency ? '400' : '100');
      const res = await fetch(`/api/app/federal-contacts?${p}`, { headers: getMIApiHeaders(email) });
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
  }, [email, search, agency, subAgency, scope]);

  // Initial load + reload when agency / sub-agency / scope changes.
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [agency, subAgency, scope]);

  // Scope to the user's target agencies (My Target List) when 'targets' is on
  // and no single agency is explicitly selected. Normalized match so "DEPT OF
  // DEFENSE" matches "Department of Defense".
  const normAg = (s: string) => (s || '').toUpperCase().replace(/[.,]/g, ' ').replace(/\b(DEPARTMENT|DEPT|OF|THE|US|U S|ADMINISTRATION|AGENCY|NATIONAL)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const targetKeys = new Set(targetAgencies.map(normAg).filter(Boolean));
  const visibleContacts = (scope === 'targets' && !agency && targetKeys.size > 0)
    ? contacts.filter(c => targetKeys.has(normAg(c.department_ind_agency || '')))
    : contacts;

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
        <div className="flex flex-wrap gap-3 items-center">
          {/* Scope to the user's Target List agencies (Eric QA: DM should
              default to my pre-selected agencies). Only when targets exist. */}
          {targetAgencies.length > 0 && (
            <div className="inline-flex rounded-lg border border-slate-700 bg-slate-800 p-0.5 text-sm">
              <button
                onClick={() => { setScope('targets'); setAgency(''); }}
                className={`px-3 py-1.5 rounded-md transition-colors ${scope === 'targets' && !agency ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}
                title={`Only your ${targetAgencies.length} target agencies`}
              >
                ⭐ My Targets ({targetAgencies.length})
              </button>
              <button
                onClick={() => setScope('all')}
                className={`px-3 py-1.5 rounded-md transition-colors ${scope === 'all' || agency ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                All
              </button>
            </div>
          )}
          <select
            value={agency}
            onChange={e => { setAgency(e.target.value); if (e.target.value) setScope('all'); }}
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

      {/* Office rosters (#16) — the COMPLETE contact list for a specific buying
          OFFICE, not an agency slice. Available where solicitation numbers decode
          to a DoDAAC (DoD / DLA / Navy). Click an office → its full roster. */}
      {agency && officeRosters.length > 0 && (
        <div className="bg-slate-900 border border-emerald-500/20 rounded-xl p-4">
          <div className="flex items-baseline justify-between mb-1">
            <h3 className="text-sm font-semibold text-white">📇 Full contact rosters by buying office</h3>
            <span className="text-xs text-slate-500">{officeRosters.length} offices · 100% list</span>
          </div>
          <p className="text-[11px] text-slate-500 mb-3">The complete people list for a specific contracting office — not an agency sample. Click an office to see everyone.</p>
          <div className="flex flex-wrap gap-2">
            {officeRosters.slice(0, 16).map((o) => (
              <button
                key={o.name}
                type="button"
                onClick={() => openOfficeRoster(o.name)}
                className={`text-xs rounded px-2.5 py-1.5 transition-colors ${openRoster?.office === o.name ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
              >
                {o.name} <span className="text-emerald-400 font-medium">{o.count}</span>
              </button>
            ))}
          </div>
          {rosterLoading && <div className="mt-3 text-xs text-slate-500">Loading roster…</div>}
          {openRoster && (
            <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/50 p-3">
              <div className="text-xs font-semibold text-emerald-300 mb-2">{openRoster.office} — {openRoster.people.length} contacts (complete)</div>
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 max-h-80 overflow-auto">
                {openRoster.people.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="min-w-0 flex-1">
                      <span className="block text-slate-200 truncate">{c.contact_fullname || '—'}</span>
                      <span className="block text-slate-500 truncate">
                        {c.roleCategory && <span className="text-emerald-400/80">{c.roleCategory} · </span>}
                        {c.contact_email || c.contact_phone || 'no contact info'}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {error && <div className="p-4 bg-red-500/10 text-red-300 rounded-lg text-sm">{error}</div>}
      {trackNote && <div className="px-4 py-2.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-lg text-sm">{trackNote}</div>}

      {/* Results table */}
      {/* Count at the TOP (Eric: so people see how many names are in the DB
          under their target agencies before scrolling). Scope-aware. */}
      {!loading && visibleContacts.length > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-300">
            <b className="text-white">{scope === 'targets' && !agency ? visibleContacts.length.toLocaleString() : total.toLocaleString()}</b>
            {scope === 'targets' && !agency
              ? <> contacts across your <b className="text-emerald-400">{targetAgencies.length} target agencies</b></>
              : <> contacts{agency ? ` at ${agency}` : ' in the directory'}</>}
          </span>
          {total > visibleContacts.length && <span className="text-xs text-slate-500">showing {visibleContacts.length}</span>}
        </div>
      )}

      {!loading && visibleContacts.length > 0 && (
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
              {visibleContacts.map(c => (
                <tr key={c.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                  <td className="px-4 py-3 text-white font-medium">{c.contact_fullname || '—'}</td>
                  <td className="px-4 py-3">
                    {c.role ? (
                      <div>
                        {/* Real role category badge (Eric: who to call for what). */}
                        {c.roleCategory && (
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold mr-1.5 ${
                            c.roleCategory === 'Contracting Officer' ? 'bg-emerald-500/20 text-emerald-300'
                            : c.roleCategory === 'Small Business' ? 'bg-amber-500/20 text-amber-300'
                            : c.roleCategory === 'Program / Technical' ? 'bg-blue-500/20 text-blue-300'
                            : 'bg-slate-700 text-slate-300'
                          }`}>{c.roleCategory}</span>
                        )}
                        <span className="text-slate-300 text-xs">{c.role}</span>
                      </div>
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
                        {/* derivedOffice is cleaned/validated server-side; the
                            raw c.office is messy SAM data (cities/codes) so we
                            fall back to the clean sub-agency, not c.office. */}
                        {c.derivedOffice || c.sub_tier || '—'}
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
          {total > visibleContacts.length && (
            <div className="px-4 py-3 text-xs text-slate-500 border-t border-slate-800">
              Showing {visibleContacts.length} of ~{total.toLocaleString()} — narrow with search, agency, or office.
            </div>
          )}
        </div>
      )}

      {!loading && visibleContacts.length === 0 && !error && (
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
