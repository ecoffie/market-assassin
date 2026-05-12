'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MIBetaTier } from '../UnifiedSidebarBeta';
import { getMIApiHeaders } from '../authHeaders';

interface RelationshipsPanelProps {
  email: string | null;
  tier: MIBetaTier;
}

type ContactType = 'government_buyer' | 'osbp' | 'prime' | 'subcontractor' | 'partner' | 'internal';
type TabId = 'buyers' | 'osbp' | 'partners' | 'network';

interface RelationshipContact {
  id: string;
  contact_type: ContactType;
  full_name: string;
  title?: string;
  email?: string;
  phone?: string;
  organization?: string;
  agency?: string;
  office?: string;
  sub_tier?: string;
  source?: string;
  source_record_id?: string;
  notes?: string;
  context?: string;
  created_at?: string;
}

interface Pursuit {
  id: string;
  title: string;
  agency?: string;
  stage?: string;
}

interface ContactLink {
  id: string;
  contact_id: string;
  pipeline_id: string;
  user_pipeline?: {
    id: string;
    title: string;
    agency?: string;
    stage?: string;
  };
}

const TABS: Array<{ id: TabId; label: string; description: string; type?: ContactType }> = [
  { id: 'buyers', label: 'Find Buyers', description: 'Government people tied to your market', type: 'government_buyer' },
  { id: 'osbp', label: 'OSBP Contacts', description: 'Small business office contacts', type: 'osbp' },
  { id: 'partners', label: 'Partners', description: 'Primes, subs, and teaming targets', type: 'prime' },
  { id: 'network', label: 'My Network', description: 'Saved buyers and partners' },
];

function contactTypeLabel(type?: string) {
  switch (type) {
    case 'government_buyer': return 'Buyer';
    case 'osbp': return 'OSBP';
    case 'prime': return 'Prime';
    case 'subcontractor': return 'Sub';
    case 'internal': return 'Internal';
    default: return 'Partner';
  }
}

function typeForTab(tab: TabId): ContactType | 'all' {
  if (tab === 'buyers') return 'government_buyer';
  if (tab === 'osbp') return 'osbp';
  if (tab === 'partners') return 'prime';
  return 'all';
}

export default function RelationshipsPanel({ email, tier }: RelationshipsPanelProps) {
  void tier;
  const [activeTab, setActiveTab] = useState<TabId>('network');
  const [savedContacts, setSavedContacts] = useState<RelationshipContact[]>([]);
  const [candidates, setCandidates] = useState<RelationshipContact[]>([]);
  const [pursuits, setPursuits] = useState<Pursuit[]>([]);
  const [links, setLinks] = useState<ContactLink[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [naicsFilter, setNaicsFilter] = useState('');
  const [agencyFilter, setAgencyFilter] = useState('');
  const [selectedPursuit, setSelectedPursuit] = useState('');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const getAuthHeaders = useCallback((init?: HeadersInit) => getMIApiHeaders(email, init), [email]);

  // Stats computed from saved contacts
  const stats = useMemo(() => {
    const buyers = savedContacts.filter(c => c.contact_type === 'government_buyer' || c.contact_type === 'osbp').length;
    const partners = savedContacts.filter(c => c.contact_type === 'prime' || c.contact_type === 'subcontractor' || c.contact_type === 'partner').length;
    const attached = links.length;
    const recentlySaved = savedContacts
      .filter(c => c.created_at)
      .sort((a, b) => new Date(b.created_at!).getTime() - new Date(a.created_at!).getTime())
      .slice(0, 5);
    return { buyers, partners, attached, recentlySaved, total: savedContacts.length };
  }, [savedContacts, links]);

  // Toast helper
  const showNotification = useCallback((message: string) => {
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3000);
  }, []);

  const savedKeys = useMemo(() => new Set(savedContacts.map(contact => (
    `${contact.contact_type}:${(contact.email || contact.source_record_id || contact.full_name).toLowerCase()}`
  ))), [savedContacts]);

  const linkedByContact = useMemo(() => {
    const map = new Map<string, ContactLink[]>();
    links.forEach(link => {
      const current = map.get(link.contact_id) || [];
      current.push(link);
      map.set(link.contact_id, current);
    });
    return map;
  }, [links]);

  const loadSavedContacts = useCallback(async () => {
    if (!email) return;

    const params = new URLSearchParams({
      email,
      mode: 'saved',
      type: activeTab === 'network' ? 'all' : typeForTab(activeTab),
    });

    if (activeTab === 'network' && searchQuery.trim()) params.set('search', searchQuery.trim());

    const response = await fetch(`/api/mi-beta/relationships?${params.toString()}`, {
      headers: getAuthHeaders(),
    });
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Failed to load relationships');
    setSavedContacts(data.contacts || []);
    setLinks(data.links || []);
  }, [activeTab, email, getAuthHeaders, searchQuery]);

  const loadPursuits = useCallback(async () => {
    if (!email) return;
    const params = new URLSearchParams({ email, mode: 'pursuits' });
    const response = await fetch(`/api/mi-beta/relationships?${params.toString()}`, {
      headers: getAuthHeaders(),
    });
    const data = await response.json();
    if (data.success) setPursuits(data.pursuits || []);
  }, [email, getAuthHeaders]);

  const searchCandidates = useCallback(async () => {
    if (!email || activeTab === 'network') return;
    setSearching(true);
    setNotice(null);
    setError(null);

    try {
      const params = new URLSearchParams({
        email,
        mode: 'candidates',
        type: typeForTab(activeTab),
      });
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      if (naicsFilter.trim()) params.set('naics', naicsFilter.trim());
      if (agencyFilter.trim()) params.set('agency', agencyFilter.trim());

      const response = await fetch(`/api/mi-beta/relationships?${params.toString()}`, {
        headers: getAuthHeaders(),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to search relationships');
      setCandidates(data.candidates || []);
      if ((data.candidates || []).length === 0 && data.dataSourceStatus) setNotice(data.dataSourceStatus);
    } catch (err) {
      console.error('Relationship search failed:', err);
      setError('Failed to search relationships.');
    } finally {
      setSearching(false);
      setLoading(false);
    }
  }, [activeTab, agencyFilter, email, getAuthHeaders, naicsFilter, searchQuery]);

  useEffect(() => {
    async function load() {
      if (!email) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        await Promise.all([loadSavedContacts(), loadPursuits()]);
      } catch (err) {
        console.error('Failed to load relationship data:', err);
        setError('Failed to load saved relationships.');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [email, loadPursuits, loadSavedContacts]);

  useEffect(() => {
    if (activeTab !== 'network') {
      searchCandidates();
    } else {
      setCandidates([]);
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveContact = async (contact: RelationshipContact) => {
    if (!email) return;
    setSavingId(contact.id);
    setNotice(null);
    setError(null);

    try {
      const response = await fetch('/api/mi-beta/relationships', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          user_email: email,
          contact_type: contact.contact_type,
          full_name: contact.full_name,
          title: contact.title,
          email: contact.email,
          phone: contact.phone,
          organization: contact.organization,
          agency: contact.agency,
          office: contact.office,
          sub_tier: contact.sub_tier,
          source: contact.source,
          source_record_id: contact.source_record_id,
          notes: contact.context,
        }),
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to save contact');
      showNotification(data.alreadySaved ? `${contact.full_name} already in network` : `✓ ${contact.full_name} saved to network`);
      await loadSavedContacts();
    } catch (err) {
      console.error('Failed to save contact:', err);
      setError('Failed to save contact.');
    } finally {
      setSavingId(null);
    }
  };

  const attachContact = async (contactId: string) => {
    if (!email || !selectedPursuit) {
      setError('Choose a pursuit first.');
      return;
    }

    const contact = savedContacts.find(c => c.id === contactId);
    const pursuit = pursuits.find(p => p.id === selectedPursuit);
    setSavingId(contactId);
    setNotice(null);
    setError(null);

    try {
      const response = await fetch('/api/mi-beta/relationships', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          action: 'link_contact',
          user_email: email,
          contact_id: contactId,
          pipeline_id: selectedPursuit,
        }),
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to attach contact');
      showNotification(`✓ ${contact?.full_name || 'Contact'} attached to ${pursuit?.title.slice(0, 30) || 'pursuit'}`);
      await loadSavedContacts();
    } catch (err) {
      console.error('Failed to attach contact:', err);
      setError('Failed to attach contact to pursuit.');
    } finally {
      setSavingId(null);
    }
  };

  const displayedContacts = activeTab === 'network' ? savedContacts : candidates;
  const activeTabConfig = TABS.find(tab => tab.id === activeTab) || TABS[0];

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-800 rounded w-56" />
          <div className="grid grid-cols-4 gap-3">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-20 bg-slate-800 rounded-xl" />)}
          </div>
          <div className="h-80 bg-slate-800 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Toast Notification */}
      {showToast && (
        <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-top-2 fade-in duration-200">
          <div className="rounded-lg bg-emerald-600 px-4 py-3 text-white shadow-lg">
            {toastMessage}
          </div>
        </div>
      )}

      {/* Header with Stats */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">My Network</h1>
          <p className="text-slate-400 mt-1">Your saved buyers, partners, and pursuit contacts.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="rounded-lg bg-slate-800 px-4 py-2 text-center">
            <div className="text-lg font-bold text-white">{stats.buyers}</div>
            <div className="text-xs text-slate-500">Buyers</div>
          </div>
          <div className="rounded-lg bg-slate-800 px-4 py-2 text-center">
            <div className="text-lg font-bold text-white">{stats.partners}</div>
            <div className="text-xs text-slate-500">Partners</div>
          </div>
          <div className="rounded-lg bg-slate-800 px-4 py-2 text-center">
            <div className="text-lg font-bold text-emerald-400">{stats.attached}</div>
            <div className="text-xs text-slate-500">Linked</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setNotice(null);
              setError(null);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            {tab.label}
            {tab.id === 'network' && stats.total > 0 && (
              <span className="ml-2 text-xs text-slate-500">({stats.total})</span>
            )}
          </button>
        ))}
      </div>

      {(notice || error) && (
        <div className={`rounded-lg border p-4 ${error ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-200'}`}>
          {error || notice}
        </div>
      )}

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-sm text-slate-400 mb-2">
              {activeTab === 'network' ? 'Search My Network' : `Search ${activeTabConfig.label}`}
            </label>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Name, agency, company, title, email..."
              className="w-full px-3 py-3 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 outline-none focus:border-emerald-500"
            />
          </div>
          {activeTab !== 'network' && (
            <>
              <div className="w-full md:w-44">
                <label className="block text-sm text-slate-400 mb-2">NAICS</label>
                <input
                  value={naicsFilter}
                  onChange={(event) => setNaicsFilter(event.target.value)}
                  placeholder="236, 541"
                  className="w-full px-3 py-3 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 outline-none focus:border-emerald-500"
                />
              </div>
              <div className="w-full md:w-56">
                <label className="block text-sm text-slate-400 mb-2">Agency</label>
                <input
                  value={agencyFilter}
                  onChange={(event) => setAgencyFilter(event.target.value)}
                  placeholder="VA, DHS, GSA"
                  className="w-full px-3 py-3 rounded-lg bg-slate-800 border border-slate-700 text-white placeholder-slate-500 outline-none focus:border-emerald-500"
                />
              </div>
            </>
          )}
          <button
            onClick={activeTab === 'network' ? loadSavedContacts : searchCandidates}
            disabled={searching}
            className="px-6 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white font-medium"
          >
            {searching ? 'Searching...' : 'Search'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-500">Attach saved contacts to:</span>
          <select
            value={selectedPursuit}
            onChange={(event) => setSelectedPursuit(event.target.value)}
            className="min-w-[260px] px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white outline-none focus:border-emerald-500"
          >
            <option value="">Choose a pursuit...</option>
            {pursuits.map(pursuit => (
              <option key={pursuit.id} value={pursuit.id}>
                {pursuit.title.slice(0, 70)}{pursuit.title.length > 70 ? '...' : ''}
              </option>
            ))}
          </select>
          {pursuits.length === 0 && <span className="text-xs text-slate-500">Track an opportunity first to attach contacts.</span>}
        </div>
      </div>

      {/* Recently Saved Quick View (My Network tab only, when contacts exist) */}
      {activeTab === 'network' && stats.recentlySaved.length > 0 && !searchQuery.trim() && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="text-sm font-medium text-slate-400 mb-3">Recently Saved</h3>
          <div className="flex flex-wrap gap-2">
            {stats.recentlySaved.map(contact => (
              <div
                key={contact.id}
                className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2"
              >
                <span className="text-xs text-slate-500">{contactTypeLabel(contact.contact_type)}</span>
                <span className="text-sm text-white">{contact.full_name}</span>
                {contact.organization && (
                  <span className="text-xs text-slate-500">· {contact.organization.slice(0, 20)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-white">{activeTabConfig.label}</h2>
            <p className="text-xs text-slate-500 mt-1">
              {activeTab === 'network' ? `${savedContacts.length} saved contacts` : `${candidates.length} suggested records`}
            </p>
          </div>
        </div>

        <div className="divide-y divide-slate-800">
          {displayedContacts.map(contact => {
            const key = `${contact.contact_type}:${(contact.email || contact.source_record_id || contact.full_name).toLowerCase()}`;
            const isSaved = savedKeys.has(key);
            const attached = linkedByContact.get(contact.id) || [];

            return (
              <div key={contact.id} className="p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">{contactTypeLabel(contact.contact_type)}</span>
                    {contact.source && <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-500">{contact.source}</span>}
                    {attached.length > 0 && <span className="rounded bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">Attached to {attached.length} pursuit{attached.length === 1 ? '' : 's'}</span>}
                  </div>
                  <h3 className="text-lg font-semibold text-white">{contact.full_name}</h3>
                  <p className="text-sm text-slate-400 mt-1">
                    {[contact.title, contact.organization, contact.agency].filter(Boolean).join(' · ') || 'Relationship record'}
                  </p>
                  {(contact.email || contact.phone || contact.office) && (
                    <p className="text-sm text-slate-500 mt-2">
                      {[contact.email, contact.phone, contact.office].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  {(contact.context || contact.notes) && (
                    <p className="text-sm text-slate-500 mt-2 max-w-3xl">{contact.context || contact.notes}</p>
                  )}
                </div>

                <div className="flex flex-wrap xl:flex-col items-stretch gap-2 shrink-0">
                  {activeTab === 'network' ? (
                    <button
                      onClick={() => attachContact(contact.id)}
                      disabled={!selectedPursuit || savingId === contact.id}
                      className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-sm font-medium"
                    >
                      {savingId === contact.id ? 'Attaching...' : 'Attach to Pursuit'}
                    </button>
                  ) : (
                    <button
                      onClick={() => saveContact(contact)}
                      disabled={isSaved || savingId === contact.id}
                      className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-sm font-medium"
                    >
                      {isSaved ? 'Saved' : savingId === contact.id ? 'Saving...' : 'Save to My Network'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {displayedContacts.length === 0 && (
            <div className="p-10 text-center">
              <div className="text-lg font-semibold text-white mb-2">
                {activeTab === 'network' ? 'No saved contacts yet' : 'No records found yet'}
              </div>
              <p className="text-slate-500 max-w-xl mx-auto">
                {activeTab === 'network'
                  ? 'Save buyers or partners from the other tabs, then attach them to pursuits here.'
                  : activeTab === 'buyers'
                    ? 'No SAM buyer contacts matched this search. Try a broader agency or NAICS, then use OSBP contacts when SAM does not publish a person.'
                    : activeTab === 'osbp'
                      ? 'No OSBP contacts matched this search. Try a parent agency such as VA, DHS, GSA, Army, Navy, or NASA.'
                      : 'No partner records matched this search. Try a broader NAICS, agency, or company keyword.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
