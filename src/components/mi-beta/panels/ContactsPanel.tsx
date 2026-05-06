'use client';

import { useState, useEffect, useCallback } from 'react';
import type { MIBetaTier } from '../UnifiedSidebarBeta';

interface ContactsPanelProps {
  email: string | null;
  tier: MIBetaTier;
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

const PARTNER_TYPES = [
  { id: 'prime', label: 'Prime', color: 'bg-blue-500' },
  { id: 'sub', label: 'Subcontractor', color: 'bg-emerald-500' },
  { id: 'jv', label: 'Joint Venture', color: 'bg-purple-500' },
  { id: 'mentor', label: 'Mentor', color: 'bg-amber-500' },
] as const;

const OUTREACH_STATUSES = [
  { id: 'none', label: 'Not Started', color: 'text-slate-400 bg-slate-500/20' },
  { id: 'contacted', label: 'Contacted', color: 'text-blue-400 bg-blue-500/20' },
  { id: 'responded', label: 'Responded', color: 'text-amber-400 bg-amber-500/20' },
  { id: 'meeting', label: 'Meeting Set', color: 'text-purple-400 bg-purple-500/20' },
  { id: 'partnered', label: 'Partnered', color: 'text-emerald-400 bg-emerald-500/20' },
] as const;

export default function ContactsPanel({ email, tier }: ContactsPanelProps) {
  const [partners, setPartners] = useState<TeamingPartner[]>([]);
  const [stats, setStats] = useState<TeamingStats>({ total: 0, byStatus: {}, byType: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPartner, setSelectedPartner] = useState<TeamingPartner | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [filterType, setFilterType] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');

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

      const res = await fetch(`/api/teaming?${params.toString()}`);
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
  }, [email, filterType, filterStatus]);

  useEffect(() => {
    loadPartners();
  }, [loadPartners]);

  const handleAddPartner = async (partnerData: Partial<TeamingPartner>) => {
    if (!email) return;

    try {
      const res = await fetch('/api/teaming', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...partnerData,
          user_email: email,
        }),
      });
      const data = await res.json();

      if (data.success) {
        setIsAdding(false);
        loadPartners();
      } else {
        setError(data.error || 'Failed to add partner');
      }
    } catch (err) {
      console.error('Failed to add partner:', err);
      setError('Failed to add partner');
    }
  };

  const handleUpdatePartner = async (id: string, updates: Partial<TeamingPartner>) => {
    if (!email) return;

    try {
      const res = await fetch('/api/teaming', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
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
      } else {
        setError(data.error || 'Failed to update partner');
      }
    } catch (err) {
      console.error('Failed to update partner:', err);
      setError('Failed to update partner');
    }
  };

  const handleDeletePartner = async (id: string) => {
    if (!email || !confirm('Remove this partner?')) return;

    try {
      const res = await fetch('/api/teaming', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, user_email: email }),
      });
      const data = await res.json();

      if (data.success) {
        setSelectedPartner(null);
        loadPartners();
      } else {
        setError(data.error || 'Failed to remove partner');
      }
    } catch (err) {
      console.error('Failed to delete partner:', err);
      setError('Failed to remove partner');
    }
  };

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
          <div className="h-8 bg-slate-800 rounded w-48" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-24 bg-slate-800 rounded-xl" />
            ))}
          </div>
          <div className="h-64 bg-slate-800 rounded-xl" />
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
          <p className="text-slate-400 mt-1">
            {stats.total} teaming partner{stats.total !== 1 ? 's' : ''} in your network
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadPartners}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors"
          >
            🔄 Refresh
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
          <button onClick={() => setError(null)} className="ml-2 text-red-300 hover:text-red-200">
            ✕
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="text-2xl font-bold text-white">{stats.total}</div>
          <div className="text-xs text-slate-500">Total Partners</div>
        </div>
        {OUTREACH_STATUSES.slice(1).map(status => (
          <div key={status.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className={`text-2xl font-bold ${status.color.split(' ')[0]}`}>
              {stats.byStatus[status.id] || 0}
            </div>
            <div className="text-xs text-slate-500">{status.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 outline-none"
        >
          <option value="">All Types</option>
          {PARTNER_TYPES.map(type => (
            <option key={type.id} value={type.id}>{type.label}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm focus:border-blue-500 outline-none"
        >
          <option value="">All Statuses</option>
          {OUTREACH_STATUSES.map(status => (
            <option key={status.id} value={status.id}>{status.label}</option>
          ))}
        </select>
      </div>

      {/* Partners List */}
      {partners.length > 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="divide-y divide-slate-800">
            {partners.map(partner => {
              const statusBadge = getStatusBadge(partner.outreach_status);
              const typeBadge = getTypeBadge(partner.partner_type);

              return (
                <div
                  key={partner.id}
                  onClick={() => setSelectedPartner(partner)}
                  className="p-4 hover:bg-slate-800/50 cursor-pointer transition-colors"
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
                        <div className="text-sm text-slate-400">
                          {partner.contact_name}
                          {partner.contact_title && <span className="text-slate-500"> • {partner.contact_title}</span>}
                        </div>
                      )}
                      {partner.naics_codes && partner.naics_codes.length > 0 && (
                        <div className="text-xs text-slate-500 mt-1">
                          NAICS: {partner.naics_codes.join(', ')}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm text-slate-400">Last Contact</div>
                      <div className="text-sm text-white">{formatDate(partner.last_contact)}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <div className="text-5xl mb-4">🤝</div>
          <h3 className="text-xl font-semibold text-white mb-2">Build Your Network</h3>
          <p className="text-slate-400 mb-4">
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
          onClose={() => setSelectedPartner(null)}
          onSave={(data) => handleUpdatePartner(selectedPartner.id, data)}
          onDelete={() => handleDeletePartner(selectedPartner.id)}
        />
      )}
    </div>
  );
}

// Partner Modal Component
interface PartnerModalProps {
  partner?: TeamingPartner;
  onClose: () => void;
  onSave: (data: Partial<TeamingPartner>) => void;
  onDelete?: () => void;
}

function PartnerModal({ partner, onClose, onSave, onDelete }: PartnerModalProps) {
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.partner_name?.trim()) return;
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-800">
          <h3 className="text-lg font-semibold text-white">
            {partner ? 'Edit Partner' : 'Add Partner'}
          </h3>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Company Name *</label>
            <input
              type="text"
              value={formData.partner_name}
              onChange={(e) => setFormData({ ...formData, partner_name: e.target.value })}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 outline-none"
              placeholder="Acme Corp"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Partner Type</label>
              <select
                value={formData.partner_type}
                onChange={(e) => setFormData({ ...formData, partner_type: e.target.value as TeamingPartner['partner_type'] })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:border-blue-500 outline-none"
              >
                {PARTNER_TYPES.map(type => (
                  <option key={type.id} value={type.id}>{type.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Outreach Status</label>
              <select
                value={formData.outreach_status}
                onChange={(e) => setFormData({ ...formData, outreach_status: e.target.value as TeamingPartner['outreach_status'] })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:border-blue-500 outline-none"
              >
                {OUTREACH_STATUSES.map(status => (
                  <option key={status.id} value={status.id}>{status.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Contact Name</label>
              <input
                type="text"
                value={formData.contact_name}
                onChange={(e) => setFormData({ ...formData, contact_name: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 outline-none"
                placeholder="John Smith"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Title</label>
              <input
                type="text"
                value={formData.contact_title}
                onChange={(e) => setFormData({ ...formData, contact_title: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 outline-none"
                placeholder="BD Director"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Email</label>
              <input
                type="email"
                value={formData.contact_email}
                onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 outline-none"
                placeholder="john@acme.com"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Phone</label>
              <input
                type="tel"
                value={formData.contact_phone}
                onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 outline-none"
                placeholder="(555) 123-4567"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">UEI</label>
              <input
                type="text"
                value={formData.uei}
                onChange={(e) => setFormData({ ...formData, uei: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 outline-none"
                placeholder="12-character UEI"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">CAGE Code</label>
              <input
                type="text"
                value={formData.cage_code}
                onChange={(e) => setFormData({ ...formData, cage_code: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 outline-none"
                placeholder="5-character CAGE"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 outline-none resize-none"
              placeholder="Add notes about this partner..."
            />
          </div>

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
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors"
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
