'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppTier } from '../UnifiedSidebar';
import { authedFetch } from '../authHeaders';

interface RelationshipsPanelProps {
  email: string | null;
  tier: AppTier;
  // When the user clicks "Relationships at this agency" from My Target List,
  // we land here pre-scoped to that agency.
  panelContext?: Record<string, unknown>;
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
  target_agency?: string;       // v2: which target agency this relationship is for
  relationship_stage?: string;  // v2: prospect | warm | contacted | met | champion
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

// Discovery tabs = search/find new contacts
// My Network tab = your saved CRM contacts
const TABS: Array<{ id: TabId; label: string; description: string; type?: ContactType; isDiscovery?: boolean }> = [
  { id: 'network', label: 'My Network', description: 'Your saved contacts (CRM)' },
  { id: 'buyers', label: 'Gov Buyers', description: 'Search gov employees from opportunities', type: 'government_buyer', isDiscovery: true },
  { id: 'osbp', label: 'OSBP Directory', description: 'Agency small business office reps', type: 'osbp', isDiscovery: true },
  { id: 'partners', label: 'Find Partners', description: 'Search contractors for teaming', type: 'prime', isDiscovery: true },
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

// v2: relationship stages — the develop-before-pursue progression.
const STAGES: Array<{ id: string; label: string; emoji: string }> = [
  { id: 'prospect', label: 'Prospect', emoji: '○' },
  { id: 'warm', label: 'Warm', emoji: '🟡' },
  { id: 'contacted', label: 'Contacted', emoji: '📨' },
  { id: 'met', label: 'Met', emoji: '🤝' },
  { id: 'champion', label: 'Champion', emoji: '⭐' },
];
function stageColor(stage: string): string {
  switch (stage) {
    case 'warm': return 'bg-amber-500/15 text-amber-300';
    case 'contacted': return 'bg-sky-500/15 text-sky-300';
    case 'met': return 'bg-emerald-500/15 text-emerald-300';
    case 'champion': return 'bg-purple-500/15 text-purple-300';
    default: return 'bg-slate-800 text-slate-400';
  }
}

function typeForTab(tab: TabId): ContactType | 'all' {
  if (tab === 'buyers') return 'government_buyer';
  if (tab === 'osbp') return 'osbp';
  if (tab === 'partners') return 'prime';
  return 'all';
}

export default function RelationshipsPanel({ email, tier, panelContext }: RelationshipsPanelProps) {
  void tier;
  const [activeTab, setActiveTab] = useState<TabId>('network');
  const [savedContacts, setSavedContacts] = useState<RelationshipContact[]>([]);
  const [candidates, setCandidates] = useState<RelationshipContact[]>([]);
  // Pre-truncation count from the API. When > candidates.length, the
  // server hit the MAX_DIRECTORY_RESULTS cap. We surface this in the
  // results header so the user knows they're seeing a slice.
  const [candidatesTotal, setCandidatesTotal] = useState(0);
  const [candidatesTruncated, setCandidatesTruncated] = useState(false);
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
  // Target-List-driven (Eric: Relationships should flow FROM My Target List,
  // and a relationship attaches to a target AGENCY — built BEFORE a pursuit,
  // not after). Load the user's target agencies; default discovery to them;
  // saving attaches to an agency, not a pursuit.
  const [targetAgencies, setTargetAgencies] = useState<string[]>([]);
  const [attachAgency, setAttachAgency] = useState('');

  useEffect(() => {
    if (!email) return;
    authedFetch(`/api/app/target-list?email=${encodeURIComponent(email)}`, email)
      .then(r => r.json())
      .then(d => {
        const ags = Array.from(new Set(((d?.targets || []) as Array<{ agency_name?: string }>)
          .map(t => (t.agency_name || '').trim()).filter(Boolean)));
        setTargetAgencies(ags);
        const fromContext = typeof panelContext?.agency === 'string' ? panelContext.agency as string : '';
        if (fromContext) {
          // Came from a Target List row → scope to THAT agency + show buyers.
          setAttachAgency(fromContext);
          setAgencyFilter(fromContext);
          setActiveTab('buyers');
        } else if (ags.length > 0) {
          setAttachAgency(ags[0]);          // default attach target = first target agency
          setAgencyFilter(prev => prev || ags[0]); // scope discovery to a target agency
        }
      })
      .catch(() => {});
  }, [email, panelContext]);

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

    const response = await authedFetch(`/api/app/relationships?${params.toString()}`, email);
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Failed to load relationships');
    setSavedContacts(data.contacts || []);
    setLinks(data.links || []);
  }, [activeTab, email, searchQuery]);

  const loadPursuits = useCallback(async () => {
    if (!email) return;
    const params = new URLSearchParams({ email, mode: 'pursuits' });
    const response = await authedFetch(`/api/app/relationships?${params.toString()}`, email);
    const data = await response.json();
    if (data.success) setPursuits(data.pursuits || []);
  }, [email]);

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

      const response = await authedFetch(`/api/app/relationships?${params.toString()}`, email);
      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to search relationships');
      setCandidates(data.candidates || []);
      setCandidatesTotal(typeof data.total === 'number' ? data.total : (data.candidates || []).length);
      setCandidatesTruncated(!!data.truncated);
      if ((data.candidates || []).length === 0 && data.dataSourceStatus) setNotice(data.dataSourceStatus);
    } catch (err) {
      console.error('Relationship search failed:', err);
      setError('Failed to search relationships.');
    } finally {
      setSearching(false);
      setLoading(false);
    }
  }, [activeTab, agencyFilter, email, naicsFilter, searchQuery]);

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
    if (activeTab === 'network') {
      setCandidates([]);
      return;
    }
    // Debounce 350ms so typing in the NAICS / Agency / search inputs
    // doesn't hammer the API on every keystroke. Per-tab change fires
    // immediately (debounce window includes the first activeTab tick
    // so there's no double-fetch).
    const t = setTimeout(() => {
      searchCandidates();
    }, 350);
    return () => clearTimeout(t);
  }, [activeTab, searchQuery, naicsFilter, agencyFilter, searchCandidates]);

  // v2: update a saved relationship's stage (prospect→warm→…→champion).
  // Optimistic; PATCH persists (graceful degrade pre-migration).
  const updateStage = async (contactId: string, stage: string) => {
    if (!email) return;
    setSavedContacts(prev => prev.map(c => c.id === contactId ? { ...c, relationship_stage: stage } : c));
    try {
      await authedFetch('/api/app/relationships', email, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_email: email, id: contactId, relationship_stage: stage }),
      });
    } catch { /* optimistic — non-fatal */ }
  };

  const saveContact = async (contact: RelationshipContact) => {
    if (!email) return;
    setSavingId(contact.id);
    setNotice(null);
    setError(null);

    try {
      const response = await authedFetch('/api/app/relationships', email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_email: email,
          contact_type: contact.contact_type,
          full_name: contact.full_name,
          title: contact.title,
          email: contact.email,
          phone: contact.phone,
          organization: contact.organization,
          agency: contact.agency,
          // Attach to the chosen TARGET AGENCY (the long-game BD relationship),
          // not a pursuit. Falls back to the contact's own agency.
          target_agency: (attachAgency && attachAgency !== '__other__') ? attachAgency : contact.agency,
          office: contact.office,
          sub_tier: contact.sub_tier,
          source: contact.source,
          source_record_id: contact.source_record_id,
          notes: contact.context,
        }),
      });

      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to save contact');

      // If user picked a pursuit in the dropdown, auto-attach. Lets
      // Discovery-tab Save do BOTH actions in one click — saving to
      // network AND binding to the active pursuit. Without this the
      // dropdown was a visual no-op on Discovery tabs (user complaint
      // 2026-05-24). The saved contact ID may come back on the POST
      // response directly; if not, we fall back to looking it up by
      // source_record_id after reloading the saved list.
      const savedId: string | undefined = data.contact?.id || data.id;
      await loadSavedContacts();

      if (selectedPursuit && !data.alreadySaved) {
        const linkId = savedId
          || savedContacts.find(c => c.source_record_id === contact.source_record_id)?.id;
        const pursuit = pursuits.find(p => p.id === selectedPursuit);
        if (linkId) {
          try {
            await authedFetch('/api/app/relationships', email, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'link_contact',
                user_email: email,
                contact_id: linkId,
                pipeline_id: selectedPursuit,
              }),
            });
            showNotification(`✓ ${contact.full_name} saved + attached to ${pursuit?.title.slice(0, 30) || 'pursuit'}`);
            await loadSavedContacts();
            return;
          } catch (linkErr) {
            console.warn('[Relationships] Save succeeded but attach failed:', linkErr);
            // Fall through to plain save toast
          }
        }
      }

      showNotification(data.alreadySaved ? `${contact.full_name} already in network` : `✓ ${contact.full_name} saved to network`);
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
      const response = await authedFetch('/api/app/relationships', email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  // v2: on My Network, sort by agency so contacts cluster — "who do I know at
  // each target agency" (Eric). Group headers are rendered inline on change.
  const networkSorted = useMemo(() => {
    const agOf = (c: RelationshipContact) => (c.target_agency || c.agency || 'Unassigned');
    return [...savedContacts].sort((a, b) => agOf(a).localeCompare(agOf(b)) || (a.full_name || '').localeCompare(b.full_name || ''));
  }, [savedContacts]);
  const displayedContacts = activeTab === 'network' ? networkSorted : candidates;
  const agencyOf = (c: RelationshipContact) => (c.target_agency || c.agency || 'Unassigned');
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
          <h1 className="text-2xl font-bold text-white">Relationships</h1>
          <p className="text-slate-400 mt-1">
            {activeTab === 'network'
              ? 'Your saved buyers, partners, and pursuit contacts.'
              : activeTab === 'buyers'
              ? 'Government employees tied to your opportunities (from SAM.gov POC data).'
              : activeTab === 'osbp'
              ? 'Small business office reps who help small businesses win contracts.'
              : 'Contractors you can partner with for teaming arrangements.'}
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">In your network</div>
          <div className="flex flex-wrap gap-3">
            <div className="rounded-lg bg-slate-800 px-4 py-2 text-center">
              <div className="text-lg font-bold text-white">{stats.buyers}</div>
              <div className="text-xs text-slate-500">Gov buyers</div>
            </div>
            <div className="rounded-lg bg-slate-800 px-4 py-2 text-center">
              <div className="text-lg font-bold text-white">{stats.partners}</div>
              <div className="text-xs text-slate-500">Partners</div>
            </div>
            <div className="rounded-lg bg-slate-800 px-4 py-2 text-center" title="Contacts you've linked to a specific pursuit">
              <div className="text-lg font-bold text-emerald-400">{stats.attached}</div>
              <div className="text-xs text-slate-500">On a pursuit</div>
            </div>
          </div>
        </div>
      </div>

      {/* TWO distinct modes (Eric: confusing that "my saved" and "search to
          find new" looked like the same kind of tab). Row 1 = what you HAVE.
          Row 2 = where you go FIND more. */}
      <div className="space-y-3">
        {/* Row 1 — MY NETWORK (what you have) */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 w-20 shrink-0">Your network</span>
          <button
            onClick={() => { setActiveTab('network'); setNotice(null); setError(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'network'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'text-slate-400 hover:text-white hover:bg-slate-800 border border-transparent'
            }`}
          >
            📇 My Saved Contacts
            <span className="ml-2 text-xs text-slate-500">({stats.total})</span>
          </button>
        </div>

        {/* Row 2 — FIND NEW (discovery search) */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 w-20 shrink-0">Find new</span>
          {TABS.filter(tab => tab.isDiscovery).map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setNotice(null); setError(null); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800 border border-transparent'
              }`}
            >
              🔍 {tab.label}
            </button>
          ))}
        </div>
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

        {/* Attach to a TARGET AGENCY, not a pursuit (Eric: relationships are
            built BEFORE pursuing). The relationship lives with the agency in
            your Target List; pursuit-attach is optional + secondary. */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-500">
            {activeTab === 'network' ? 'These contacts belong to:' : 'Save to agency:'}
          </span>
          {targetAgencies.length > 0 ? (
            <select
              value={attachAgency}
              onChange={(event) => setAttachAgency(event.target.value)}
              className="min-w-[260px] px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white outline-none focus:border-emerald-500"
            >
              {targetAgencies.map(a => <option key={a} value={a}>{a}</option>)}
              <option value="__other__">Other agency…</option>
            </select>
          ) : (
            <span className="text-xs text-slate-500">Add agencies to <b>My Target List</b> first — relationships are built per target agency.</span>
          )}
          {/* Optional: also link to a pursuit (late-stage teaming). */}
          {pursuits.length > 0 && (
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer hover:text-slate-300">also link a pursuit (optional)</summary>
              <select
                value={selectedPursuit}
                onChange={(event) => setSelectedPursuit(event.target.value)}
                className="mt-1 min-w-[220px] px-2 py-1.5 rounded bg-slate-800 border border-slate-700 text-white text-xs outline-none"
              >
                <option value="">No pursuit</option>
                {pursuits.map(pursuit => (
                  <option key={pursuit.id} value={pursuit.id}>{pursuit.title.slice(0, 60)}</option>
                ))}
              </select>
            </details>
          )}
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
            <h2 className="font-semibold text-white">
              {activeTab === 'network' ? '📇 My Saved Contacts' : `🔍 Search results · ${activeTabConfig.label}`}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {activeTab === 'network'
                ? `${savedContacts.length} contact${savedContacts.length === 1 ? '' : 's'} in your network`
                : candidatesTruncated && candidatesTotal > candidates.length
                  ? <>
                      <span className="text-blue-300">Found {candidatesTotal.toLocaleString()}+</span> — showing {candidates.length}. <span className="text-slate-400">Click <b>Save</b> on anyone to add them to your network.</span> Narrow by NAICS/agency to focus.
                    </>
                  : <><span className="text-blue-300">Found {candidates.length}</span> you can add — click <b>Save</b> on anyone to add them to your network.</>}
            </p>
          </div>
        </div>

        <div className="divide-y divide-slate-800">
          {displayedContacts.map((contact, idx) => {
            const key = `${contact.contact_type}:${(contact.email || contact.source_record_id || contact.full_name).toLowerCase()}`;
            const isSaved = savedKeys.has(key);
            const attached = linkedByContact.get(contact.id) || [];
            // v2: agency group header on the network tab when the agency changes.
            const showAgencyHeader = activeTab === 'network'
              && (idx === 0 || agencyOf(displayedContacts[idx - 1]) !== agencyOf(contact));

            return (
              <div key={contact.id}>
              {showAgencyHeader && (
                <div className="px-5 py-2 bg-slate-900/60 border-y border-slate-800 text-xs font-semibold uppercase tracking-wider text-emerald-300">
                  {agencyOf(contact)}
                </div>
              )}
              <div className="p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">{contactTypeLabel(contact.contact_type)}</span>
                    {/* v2: relationship STAGE — develop-before-pursue tracking.
                        Network tab only; quick inline change. */}
                    {activeTab === 'network' && (
                      <select
                        value={contact.relationship_stage || 'prospect'}
                        onChange={(e) => updateStage(contact.id, e.target.value)}
                        className={`rounded px-2 py-1 text-xs border-0 outline-none cursor-pointer ${stageColor(contact.relationship_stage || 'prospect')}`}
                        title="Where this relationship stands"
                      >
                        {STAGES.map(s => <option key={s.id} value={s.id}>{s.emoji} {s.label}</option>)}
                      </select>
                    )}
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
                    // Optional pursuit-attach only when a pursuit is chosen
                    // (relationships belong to agencies now, not pursuits).
                    selectedPursuit ? (
                      <button
                        onClick={() => attachContact(contact.id)}
                        disabled={savingId === contact.id}
                        className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-sm font-medium"
                      >
                        {savingId === contact.id ? 'Attaching...' : 'Attach to Pursuit'}
                      </button>
                    ) : (
                      <span className="text-xs text-slate-500 px-2">In your network{contact.agency ? ` · ${contact.agency}` : ''}</span>
                    )
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
