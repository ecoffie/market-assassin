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
}

export default function GovDecisionMakersPanel({ email }: Props) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [agencies, setAgencies] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [agency, setAgency] = useState('');
  const [office, setOffice] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load agency facet list once.
  useEffect(() => {
    if (!email) return;
    fetch(`/api/app/federal-contacts?facets=agencies&email=${encodeURIComponent(email)}`)
      .then(r => r.json())
      .then(d => { if (d.success) setAgencies(d.agencies || []); })
      .catch(() => {});
  }, [email]);

  const load = useCallback(async () => {
    if (!email) return;
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams({ email });
      if (search.trim()) p.set('search', search.trim());
      if (agency) p.set('agency', agency);
      if (office.trim()) p.set('office', office.trim());
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
  }, [email, search, agency, office]);

  // Initial load + reload when agency filter changes.
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [agency]);

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
          <input
            value={office}
            onChange={e => setOffice(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load()}
            placeholder="Filter by office…"
            className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-emerald-500 outline-none"
          />
        </div>
      </div>

      {error && <div className="p-4 bg-red-500/10 text-red-300 rounded-lg text-sm">{error}</div>}

      {/* Results table */}
      {!loading && contacts.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/60 text-left text-slate-400">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Agency</th>
                <th className="px-4 py-3 font-medium">Office</th>
                <th className="px-4 py-3 font-medium">Contact</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map(c => (
                <tr key={c.id} className="border-t border-slate-800 hover:bg-slate-800/30">
                  <td className="px-4 py-3 text-white font-medium">{c.contact_fullname || '—'}</td>
                  <td className="px-4 py-3 text-slate-300">{c.contact_title || '—'}</td>
                  <td className="px-4 py-3 text-slate-300">{c.department_ind_agency || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{c.office || c.sub_tier || '—'}</td>
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
        Source: SAM.gov points of contact (contracting officers &amp; specialists named on solicitations), synced daily.
        Program managers and end users aren&apos;t in this dataset yet.
      </p>
    </div>
  );
}
