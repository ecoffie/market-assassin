'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, X, Handshake } from 'lucide-react';
import type { AppTier } from '../UnifiedSidebar';
import { getMIApiHeaders } from '../authHeaders';
import { useAppTracker } from '../track';
import { useToast } from '../Toast';
import { getNaics } from '@/lib/codes/lookup';

interface ContactsPanelProps {
  email: string | null;
  tier: AppTier;
}

interface TeamingPartner {
  id: string;
  partner_name: string;
  partner_type?: 'prime' | 'sub' | 'jv' | 'mentor';
  uei?: string;
  cage_code?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  contact_title?: string;
  naics_codes?: string[];
  certifications?: string[];
  past_performance?: string;
  outreach_status?: 'none' | 'contacted' | 'responded' | 'meeting' | 'partnered';
  last_contact?: string;
  notes?: string;
  source?: string;
  created_at?: string;
}

interface TeamingStats {
  total: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
}

interface PipelineOpportunity {
  id: string;
  title: string;
  agency?: string;
  stage?: 'tracking' | 'pursuing' | 'bidding' | 'submitted' | 'no_bid' | 'won' | 'lost' | 'archived';
  priority?: 'low' | 'medium' | 'high' | 'critical';
  response_deadline?: string;
  teaming_partners?: string[];
  is_archived?: boolean;
}

const PARTNER_TYPES = [
  { id: 'prime', label: 'Prime', color: 'bg-blue-500' },
  { id: 'sub', label: 'Subcontractor', color: 'bg-emerald-500' },
  { id: 'jv', label: 'Joint Venture', color: 'bg-purple-500' },
  { id: 'mentor', label: 'Mentor', color: 'bg-amber-500' },
] as const;

const OUTREACH_STATUSES = [
  { id: 'none', label: 'Not Started', color: 'text-muted bg-slate-500/20' },
  { id: 'contacted', label: 'Contacted', color: 'text-blue-400 bg-blue-500/20' },
  { id: 'responded', label: 'Responded', color: 'text-amber-400 bg-amber-500/20' },
  { id: 'meeting', label: 'Meeting Set', color: 'text-purple-400 bg-purple-500/20' },
  { id: 'partnered', label: 'Partnered', color: 'text-emerald-400 bg-emerald-500/20' },
] as const;

export default function ContactsPanel({ email, tier }: ContactsPanelProps) {
  const [partners, setPartners] = useState<TeamingPartner[]>([]);
  const [pipeline, setPipeline] = useState<PipelineOpportunity[]>([]);
  const [stats, setStats] = useState<TeamingStats>({ total: 0, byStatus: {}, byType: {} });
  const [loading, setLoading] = useState(true);
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPartner, setSelectedPartner] = useState<TeamingPartner | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const tierLabel = tier === 'free' ? 'Free CRM' : tier === 'pro' ? 'Pro CRM' : 'Full CRM';
  const getAuthHeaders = useCallback((init?: HeadersInit) => getMIApiHeaders(email, init), [email]);
  const track = useAppTracker(email);
  const { showToast } = useToast();

  const loadPipeline = useCallback(async () => {
    if (!email) return;

    setPipelineLoading(true);

    try {
      const res = await fetch(`/api/pipeline?email=${encodeURIComponent(email)}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();

      if (data.error) {
        setError(data.error);
      } else {
        setPipeline(data.opportunities || []);
      }
    } catch (err) {
      console.error('Failed to load pipeline:', err);
      setError('Failed to load pipeline pursuits');
    } finally {
      setPipelineLoading(false);
    }
  }, [email, getAuthHeaders]);

  const loadPartners = useCallback(async () => {
    if (!email) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ email });
      if (filterType) params.set('type', filterType);
      if (filterStatus) params.set('status', filterStatus);

      const res = await fetch(`/api/teaming?${params.toString()}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();

      if (data.error) {
        if (data.message?.includes('not yet created')) {
          setPartners([]);
          setStats({ total: 0, byStatus: {}, byType: {} });
        } else {
          setError(data.error);
        }
      } else {
        setPartners(data.partners || []);
        setStats(data.stats || { total: 0, byStatus: {}, byType: {} });
      }
    } catch (err) {
      console.error('Failed to load partners:', err);
      setError('Failed to load teaming partners');
    } finally {
      setLoading(false);
    }
  }, [email, filterType, filterStatus, getAuthHeaders]);

  useEffect(() => {
    loadPartners();
  }, [loadPartners]);

  useEffect(() => {
    loadPipeline();
  }, [loadPipeline]);

  // page_view once per email-resolution.
  useEffect(() => {
    if (!email) return;
    track('page_view', 'contacts');
  }, [email, track]);

  const handleAddPartner = async (partnerData: Partial<TeamingPartner>) => {
    if (!email) return;

    try {
      const res = await fetch('/api/teaming', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          ...partnerData,
          user_email: email,
        }),
      });
      const data = await res.json();

      if (data.success) {
        setIsAdding(false);
        loadPartners();
        track('tool_use', 'contacts', {
          action: 'add_partner',
          // partner_type tells the queue what kind of relationship
          // the user is building — sub, prime, mentor, etc.
          partner_type: partnerData.partner_type,
        });
        showToast({
          message: `${partnerData.partner_name || 'Partner'} added`,
          variant: 'success',
        });
      } else {
        showToast({ message: data.error || 'Could not add partner', variant: 'error' });
      }
    } catch (err) {
      console.error('Failed to add partner:', err);
      showToast({ message: 'Network error — partner not added', variant: 'error' });
    }
  };

  const handleUpdatePartner = async (id: string, updates: Partial<TeamingPartner>) => {
    if (!email) return;

    try {
      const res = await fetch('/api/teaming', {
        method: 'PATCH',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          id,
          user_email: email,
          ...updates,
        }),
      });
      const data = await res.json();

      if (data.success) {
        setSelectedPartner(null);
        loadPartners();
        track('tool_use', 'contacts', {
          action: 'update_partner',
          partner_id: id,
          updated_fields: Object.keys(updates),
        });
        showToast({ message: 'Partner updated', variant: 'success' });
      } else {
        showToast({ message: data.error || 'Could not update partner', variant: 'error' });
      }
    } catch (err) {
      console.error('Failed to update partner:', err);
      showToast({ message: 'Network error — update not saved', variant: 'error' });
    }
  };

  const handleDeletePartner = async (id: string) => {
    if (!email || !confirm('Remove this partner?')) return;

    // Capture the row so Undo can re-create it. Partial best-effort —
    // /api/teaming POST regenerates an id, so the new row has a
    // different id than the deleted one (no FK issues with that
    // since teaming partners aren't referenced elsewhere by id).
    const partnerToRestore = partners.find(p => p.id === id);

    try {
      const res = await fetch('/api/teaming', {
        method: 'DELETE',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id, user_email: email }),
      });
      const data = await res.json();

      if (data.success) {
        setSelectedPartner(null);
        loadPartners();
        track('tool_use', 'contacts', { action: 'delete_partner', partner_id: id });
        showToast({
          message: `${partnerToRestore?.partner_name || 'Partner'} removed`,
          variant: 'info',
          action: partnerToRestore
            ? {
                label: 'Undo',
                onClick: () => {
                  // Re-post the captured row. Don't await — fire-and-
                  // forget keeps the toast snappy. loadPartners will
                  // refresh the list once the server replies.
                  fetch('/api/teaming', {
                    method: 'POST',
                    headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({ ...partnerToRestore, user_email: email }),
                  })
                    .then(() => loadPartners())
                    .catch((err) => console.warn('[ContactsPanel] Undo POST failed:', err));
                },
              }
            : undefined,
        });
      } else {
        showToast({ message: data.error || 'Could not remove partner', variant: 'error' });
      }
    } catch (err) {
      console.error('Failed to delete partner:', err);
      showToast({ message: 'Network error — partner not removed', variant: 'error' });
    }
  };

  const handleTogglePursuit = async (partnerName: string, opportunity: PipelineOpportunity) => {
    if (!email) return;

    const currentPartners = opportunity.teaming_partners || [];
    const isAttached = currentPartners.includes(partnerName);
    const nextPartners = isAttached
      ? currentPartners.filter(name => name !== partnerName)
      : [...currentPartners, partnerName];

    try {
      const res = await fetch('/api/pipeline', {
        method: 'PATCH',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          id: opportunity.id,
          user_email: email,
          teaming_partners: nextPartners,
        }),
      });
      const data = await res.json();

      if (data.success) {
        setPipeline(prev => prev.map(item => (
          item.id === opportunity.id
            ? { ...item, teaming_partners: data.opportunity.teaming_partners || [] }
            : item
        )));
        track('tool_use', 'contacts', {
          action: isAttached ? 'detach_pursuit' : 'attach_pursuit',
          opportunity_id: opportunity.id,
          // partner_count_after is the new total — useful for spotting
          // power-users who team multiple partners per opp.
          partner_count_after: nextPartners.length,
        });
        showToast({
          message: isAttached
            ? `${partnerName} detached from pursuit`
            : `${partnerName} attached to pursuit`,
          variant: 'success',
        });
      } else {
        showToast({
          message: data.error || 'Could not update pursuit partners',
          variant: 'error',
        });
      }
    } catch (err) {
      console.error('Failed to attach pursuit:', err);
      showToast({ message: 'Network error — pursuit not updated', variant: 'error' });
    }
  };

  const getPartnerPursuits = (partnerName: string) => (
    pipeline.filter(opp => (opp.teaming_partners || []).includes(partnerName))
  );

  const filteredPartners = partners.filter(partner => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;

    return [
      partner.partner_name,
      partner.contact_name,
      partner.contact_email,
      partner.contact_phone,
      partner.contact_title,
      partner.uei,
      partner.cage_code,
      partner.notes,
      ...(partner.naics_codes || []),
      ...(partner.certifications || []),
    ].some(value => value?.toLowerCase().includes(query));
  });

  const getStatusBadge = (status?: string) => {
    const statusConfig = OUTREACH_STATUSES.find(s => s.id === status) || OUTREACH_STATUSES[0];
    return statusConfig;
  };

  const getTypeBadge = (type?: string) => {
    const typeConfig = PARTNER_TYPES.find(t => t.id === type);
    return typeConfig;
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'Never';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-surface rounded w-48" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-24 bg-surface rounded-xl" />
            ))}
          </div>
          <div className="h-64 bg-surface rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Teaming CRM</h1>
          <p className="text-muted mt-1">
            {stats.total} teaming partner{stats.total !== 1 ? 's' : ''} in your network
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 rounded-full bg-surface border border-hairline text-xs text-ink-soft">
            {tierLabel}
          </span>
          <button
            onClick={loadPartners}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-surface hover:bg-input text-ink-soft text-sm rounded-lg transition-colors"
          >
            <RefreshCw className="h-4 w-4 shrink-0" strokeWidth={2} /> Refresh
          </button>
          <button
            onClick={() => setIsAdding(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            + Add Partner
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
          {error}
          <button onClick={() => setError(null)} aria-label="Dismiss" className="ml-2 inline-flex items-center text-red-300 hover:text-red-200">
            <X className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-ground border border-surface rounded-xl p-4">
          <div className="text-2xl font-bold text-white">{stats.total}</div>
          <div className="text-xs text-faint">Total Partners</div>
        </div>
        {OUTREACH_STATUSES.slice(1).map(status => (
          <div key={status.id} className="bg-ground border border-surface rounded-xl p-4">
            <div className={`text-2xl font-bold ${status.color.split(' ')[0]}`}>
              {stats.byStatus[status.id] || 0}
            </div>
            <div className="text-xs text-faint">{status.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col lg:flex-row gap-3">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="min-w-0 flex-1 px-3 py-2 bg-surface border border-hairline rounded-lg text-white text-sm placeholder-faint focus:border-blue-500 outline-none"
          placeholder="Search partners, contacts, NAICS, notes..."
        />
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-2 bg-surface border border-hairline rounded-lg text-white text-sm focus:border-blue-500 outline-none"
        >
          <option value="">All Types</option>
          {PARTNER_TYPES.map(type => (
            <option key={type.id} value={type.id}>{type.label}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 bg-surface border border-hairline rounded-lg text-white text-sm focus:border-blue-500 outline-none"
        >
          <option value="">All Statuses</option>
          {OUTREACH_STATUSES.map(status => (
            <option key={status.id} value={status.id}>{status.label}</option>
          ))}
        </select>
      </div>

      {/* Partners List */}
      {filteredPartners.length > 0 ? (
        <div className="bg-ground border border-surface rounded-xl overflow-hidden">
          <div className="divide-y divide-slate-800">
            {filteredPartners.map(partner => {
              const statusBadge = getStatusBadge(partner.outreach_status);
              const typeBadge = getTypeBadge(partner.partner_type);
              const pursuits = getPartnerPursuits(partner.partner_name);

              return (
                <div
                  key={partner.id}
                  onClick={() => setSelectedPartner(partner)}
                  className="p-4 hover:bg-surface/50 cursor-pointer transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium text-white">{partner.partner_name}</h4>
                        {typeBadge && (
                          <span className={`px-2 py-0.5 rounded text-xs ${typeBadge.color} text-white`}>
                            {typeBadge.label}
                          </span>
                        )}
                        <span className={`px-2 py-0.5 rounded text-xs ${statusBadge.color}`}>
                          {statusBadge.label}
                        </span>
                      </div>
                      {partner.contact_name && (
                        <div className="text-sm text-muted">
                          {partner.contact_name}
                          {partner.contact_title && <span className="text-faint"> • {partner.contact_title}</span>}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-faint">
                        {partner.contact_email && <span>{partner.contact_email}</span>}
                        {partner.contact_phone && <span>{partner.contact_phone}</span>}
                        {partner.uei && <span>UEI {partner.uei}</span>}
                        {partner.cage_code && <span>CAGE {partner.cage_code}</span>}
                      </div>
                      {partner.naics_codes && partner.naics_codes.length > 0 && (
                        <div className="text-xs text-faint mt-1">
                          NAICS:{' '}
                          {partner.naics_codes.map((code, idx) => {
                            const entry = getNaics(code);
                            return (
                              <span key={code}>
                                {idx > 0 && ' · '}
                                <span className="font-mono">{code}</span>
                                {entry?.title && <span className="text-slate-600"> — {entry.title}</span>}
                              </span>
                            );
                          })}
                        </div>
                      )}
                      {pursuits.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {pursuits.slice(0, 3).map(opp => (
                            <span key={opp.id} className="px-2 py-1 rounded bg-surface text-xs text-ink-soft">
                              {opp.title}
                            </span>
                          ))}
                          {pursuits.length > 3 && (
                            <span className="px-2 py-1 rounded bg-surface text-xs text-muted">
                              +{pursuits.length - 3} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm text-muted">Pursuits</div>
                      <div className="text-sm text-white mb-3">{pursuits.length}</div>
                      <div className="text-sm text-muted">Last Contact</div>
                      <div className="text-sm text-white">{formatDate(partner.last_contact)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="bg-ground border border-surface rounded-xl p-8 text-center">
          <Handshake className="h-12 w-12 mx-auto mb-4 text-faint" strokeWidth={1.5} />
          <h3 className="text-xl font-semibold text-white mb-2">Build Your Network</h3>
          <p className="text-muted mb-4">
            Add teaming partners to track relationships and coordinate joint pursuits.
          </p>
          <button
            onClick={() => setIsAdding(true)}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Add Your First Partner
          </button>
        </div>
      )}

      {/* Add Partner Modal */}
      {isAdding && (
        <PartnerModal
          onClose={() => setIsAdding(false)}
          onSave={handleAddPartner}
        />
      )}

      {/* Edit Partner Modal */}
      {selectedPartner && (
        <PartnerModal
          partner={selectedPartner}
          pipeline={pipeline}
          attachedPursuits={getPartnerPursuits(selectedPartner.partner_name)}
          pipelineLoading={pipelineLoading}
          onClose={() => setSelectedPartner(null)}
          onSave={(data) => handleUpdatePartner(selectedPartner.id, data)}
          onDelete={() => handleDeletePartner(selectedPartner.id)}
          onTogglePursuit={(opportunity) => handleTogglePursuit(selectedPartner.partner_name, opportunity)}
        />
      )}
    </div>
  );
}

// Partner Modal Component
interface PartnerModalProps {
  partner?: TeamingPartner;
  pipeline?: PipelineOpportunity[];
  attachedPursuits?: PipelineOpportunity[];
  pipelineLoading?: boolean;
  onClose: () => void;
  onSave: (data: Partial<TeamingPartner>) => void;
  onDelete?: () => void;
  onTogglePursuit?: (opportunity: PipelineOpportunity) => void;
}

function PartnerModal({
  partner,
  pipeline = [],
  attachedPursuits = [],
  pipelineLoading = false,
  onClose,
  onSave,
  onDelete,
  onTogglePursuit,
}: PartnerModalProps) {
  const [formData, setFormData] = useState<Partial<TeamingPartner>>({
    partner_name: partner?.partner_name || '',
    partner_type: partner?.partner_type || 'prime',
    contact_name: partner?.contact_name || '',
    contact_email: partner?.contact_email || '',
    contact_phone: partner?.contact_phone || '',
    contact_title: partner?.contact_title || '',
    uei: partner?.uei || '',
    cage_code: partner?.cage_code || '',
    outreach_status: partner?.outreach_status || 'none',
    notes: partner?.notes || '',
  });
  const [naicsInput, setNaicsInput] = useState((partner?.naics_codes || []).join(', '));
  const [certsInput, setCertsInput] = useState((partner?.certifications || []).join(', '));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.partner_name?.trim()) return;
    onSave({
      ...formData,
      naics_codes: parseCsvList(naicsInput),
      certifications: parseCsvList(certsInput),
    });
  };

  const attachedIds = new Set(attachedPursuits.map(opp => opp.id));
  // Only live pursuits are pickable — you don't attach a contact to a
  // finished pursuit. Exclude every terminal stage (won / lost /
  // no_bid / archived) + the is_archived soft-delete flag, matching the
  // active-pursuit definition used on My Pursuits.
  const TERMINAL_STAGES = ['won', 'lost', 'no_bid', 'archived'];
  const activePipeline = pipeline.filter(opp =>
    !opp.is_archived && !TERMINAL_STAGES.includes(opp.stage || '')
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-ground border border-hairline rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-surface">
          <h3 className="text-lg font-semibold text-white">
            {partner ? 'Edit Partner' : 'Add Partner'}
          </h3>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm text-muted mb-1">Company Name *</label>
            <input
              type="text"
              value={formData.partner_name}
              onChange={(e) => setFormData({ ...formData, partner_name: e.target.value })}
              className="w-full px-3 py-2 bg-surface border border-hairline rounded-lg text-white placeholder-faint focus:border-blue-500 outline-none"
              placeholder="Acme Corp"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-muted mb-1">Partner Type</label>
              <select
                value={formData.partner_type}
                onChange={(e) => setFormData({ ...formData, partner_type: e.target.value as TeamingPartner['partner_type'] })}
                className="w-full px-3 py-2 bg-surface border border-hairline rounded-lg text-white focus:border-blue-500 outline-none"
              >
                {PARTNER_TYPES.map(type => (
                  <option key={type.id} value={type.id}>{type.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Outreach Status</label>
              <select
                value={formData.outreach_status}
                onChange={(e) => setFormData({ ...formData, outreach_status: e.target.value as TeamingPartner['outreach_status'] })}
                className="w-full px-3 py-2 bg-surface border border-hairline rounded-lg text-white focus:border-blue-500 outline-none"
              >
                {OUTREACH_STATUSES.map(status => (
                  <option key={status.id} value={status.id}>{status.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-muted mb-1">Contact Name</label>
              <input
                type="text"
                value={formData.contact_name}
                onChange={(e) => setFormData({ ...formData, contact_name: e.target.value })}
                className="w-full px-3 py-2 bg-surface border border-hairline rounded-lg text-white placeholder-faint focus:border-blue-500 outline-none"
                placeholder="John Smith"
              />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Title</label>
              <input
                type="text"
                value={formData.contact_title}
                onChange={(e) => setFormData({ ...formData, contact_title: e.target.value })}
                className="w-full px-3 py-2 bg-surface border border-hairline rounded-lg text-white placeholder-faint focus:border-blue-500 outline-none"
                placeholder="BD Director"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-muted mb-1">Email</label>
              <input
                type="email"
                value={formData.contact_email}
                onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
                className="w-full px-3 py-2 bg-surface border border-hairline rounded-lg text-white placeholder-faint focus:border-blue-500 outline-none"
                placeholder="john@acme.com"
              />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Phone</label>
              <input
                type="tel"
                value={formData.contact_phone}
                onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
                className="w-full px-3 py-2 bg-surface border border-hairline rounded-lg text-white placeholder-faint focus:border-blue-500 outline-none"
                placeholder="(555) 123-4567"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-muted mb-1">UEI</label>
              <input
                type="text"
                value={formData.uei}
                onChange={(e) => setFormData({ ...formData, uei: e.target.value })}
                className="w-full px-3 py-2 bg-surface border border-hairline rounded-lg text-white placeholder-faint focus:border-blue-500 outline-none"
                placeholder="12-character UEI"
              />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">CAGE Code</label>
              <input
                type="text"
                value={formData.cage_code}
                onChange={(e) => setFormData({ ...formData, cage_code: e.target.value })}
                className="w-full px-3 py-2 bg-surface border border-hairline rounded-lg text-white placeholder-faint focus:border-blue-500 outline-none"
                placeholder="5-character CAGE"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-muted mb-1">NAICS Codes</label>
              <input
                type="text"
                value={naicsInput}
                onChange={(e) => setNaicsInput(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-hairline rounded-lg text-white placeholder-faint focus:border-blue-500 outline-none"
                placeholder="541512, 541611"
              />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Certifications</label>
              <input
                type="text"
                value={certsInput}
                onChange={(e) => setCertsInput(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-hairline rounded-lg text-white placeholder-faint focus:border-blue-500 outline-none"
                placeholder="8(a), SDVOSB, HUBZone"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-muted mb-1">Past Performance</label>
            <textarea
              value={formData.past_performance || ''}
              onChange={(e) => setFormData({ ...formData, past_performance: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 bg-surface border border-hairline rounded-lg text-white placeholder-faint focus:border-blue-500 outline-none resize-none"
              placeholder="Relevant agencies, contract vehicles, incumbent work, strengths..."
            />
          </div>

          <div>
            <label className="block text-sm text-muted mb-1">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 bg-surface border border-hairline rounded-lg text-white placeholder-faint focus:border-blue-500 outline-none resize-none"
              placeholder="Add notes about this partner..."
            />
          </div>

          {partner && (
            <div className="border border-surface rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-surface/60 border-b border-surface">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-medium text-white">Attached Pursuits</h4>
                    <p className="text-xs text-faint mt-1">
                      {attachedPursuits.length} active pursuit{attachedPursuits.length !== 1 ? 's' : ''} linked to this partner
                    </p>
                  </div>
                  {pipelineLoading && <span className="text-xs text-faint">Loading...</span>}
                </div>
              </div>

              {activePipeline.length > 0 ? (
                <div className="max-h-60 overflow-y-auto divide-y divide-slate-800">
                  {activePipeline.map(opp => {
                    const checked = attachedIds.has(opp.id);

                    return (
                      <label
                        key={opp.id}
                        className="flex items-start gap-3 px-4 py-3 hover:bg-surface/50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onTogglePursuit?.(opp)}
                          className="mt-1 h-4 w-4 rounded border-slate-600 bg-ground text-blue-600 focus:ring-blue-500"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-white truncate">{opp.title}</span>
                          <span className="mt-1 flex flex-wrap gap-2 text-xs text-faint">
                            {opp.agency && <span>{opp.agency}</span>}
                            {opp.stage && <span>{opp.stage}</span>}
                            {opp.priority && <span>{opp.priority} priority</span>}
                            {opp.response_deadline && <span>Due {new Date(opp.response_deadline).toLocaleDateString()}</span>}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="px-4 py-5 text-sm text-faint">
                  No active pipeline pursuits yet.
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between pt-4">
            <div>
              {partner && onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  className="px-4 py-2 text-red-400 hover:text-red-300 text-sm transition-colors"
                >
                  Delete Partner
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-surface hover:bg-input text-ink-soft text-sm rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {partner ? 'Save Changes' : 'Add Partner'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function parseCsvList(value: string) {
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}
