'use client';

import { useState, useEffect } from 'react';

export interface PipelineModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: PipelineFormData) => Promise<void>;
  initialData?: PipelineFormData | null;
  email: string;
}

export interface PipelineFormData {
  id?: string;
  title: string;
  agency?: string;
  value_estimate?: string;
  naics_code?: string;
  set_aside?: string;
  response_deadline?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  win_probability?: number;
  notes?: string;
  source?: string;
  external_url?: string;
  teaming_partners?: string | string[];
  stage?: string;
}

export default function PipelineModal({ isOpen, onClose, onSave, initialData, email }: PipelineModalProps) {
  const [formData, setFormData] = useState<PipelineFormData>({
    title: '',
    agency: '',
    value_estimate: '',
    naics_code: '',
    set_aside: '',
    response_deadline: '',
    priority: 'medium',
    win_probability: 50,
    notes: '',
    source: 'manual',
    external_url: '',
    teaming_partners: '',
    stage: 'tracking'
  });

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (initialData) {
      setFormData({
        ...initialData,
        teaming_partners: Array.isArray(initialData.teaming_partners)
          ? initialData.teaming_partners.join(', ')
          : initialData.teaming_partners || ''
      });
    } else {
      // Reset form
      setFormData({
        title: '',
        agency: '',
        value_estimate: '',
        naics_code: '',
        set_aside: '',
        response_deadline: '',
        priority: 'medium',
        win_probability: 50,
        notes: '',
        source: 'manual',
        external_url: '',
        teaming_partners: '',
        stage: 'tracking'
      });
    }
    setError('');
  }, [initialData, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!formData.title.trim()) {
      setError('Title is required');
      return;
    }

    setIsSaving(true);

    try {
      // Convert teaming_partners string to array
      const partners = formData.teaming_partners;
      const partnersArray = Array.isArray(partners)
        ? partners
        : (typeof partners === 'string' && partners.trim())
          ? partners.split(',').map(p => p.trim()).filter(Boolean)
          : [];

      const dataToSave = {
        ...formData,
        teaming_partners: partnersArray
      };

      await onSave(dataToSave);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full my-8">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">
            {initialData ? 'Edit Opportunity' : 'Add to Pipeline'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6">
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
            {/* Title */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                placeholder="Opportunity title"
                required
              />
            </div>

            {/* Agency */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Agency
              </label>
              <input
                type="text"
                value={formData.agency || ''}
                onChange={(e) => setFormData({ ...formData, agency: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                placeholder="Department of Defense"
              />
            </div>

            {/* Row: Value + NAICS */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Value Estimate
                </label>
                <input
                  type="text"
                  value={formData.value_estimate || ''}
                  onChange={(e) => setFormData({ ...formData, value_estimate: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  placeholder="$5M-$10M"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  NAICS Code
                </label>
                <input
                  type="text"
                  value={formData.naics_code || ''}
                  onChange={(e) => setFormData({ ...formData, naics_code: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                  placeholder="541512"
                />
              </div>
            </div>

            {/* Row: Set-Aside + Deadline */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Set-Aside
                </label>
                <select
                  value={formData.set_aside || ''}
                  onChange={(e) => setFormData({ ...formData, set_aside: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                >
                  <option value="">None</option>
                  <option value="8(a)">8(a)</option>
                  <option value="SDVOSB">SDVOSB</option>
                  <option value="WOSB">WOSB</option>
                  <option value="HUBZone">HUBZone</option>
                  <option value="SB">Small Business</option>
                  <option value="Unrestricted">Unrestricted</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Response Deadline
                </label>
                <input
                  type="date"
                  value={formData.response_deadline || ''}
                  onChange={(e) => setFormData({ ...formData, response_deadline: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                />
              </div>
            </div>

            {/* Row: Priority + Stage */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Priority
                </label>
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value as any })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Stage
                </label>
                <select
                  value={formData.stage}
                  onChange={(e) => setFormData({ ...formData, stage: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                >
                  <option value="tracking">Tracking</option>
                  <option value="pursuing">Pursuing</option>
                  <option value="bidding">Bidding</option>
                  <option value="submitted">Submitted</option>
                  <option value="won">Won</option>
                  <option value="lost">Lost</option>
                </select>
              </div>
            </div>

            {/* Win Probability Slider */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Win Probability: {formData.win_probability}%
              </label>
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={formData.win_probability}
                onChange={(e) => setFormData({ ...formData, win_probability: parseInt(e.target.value) })}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
            </div>

            {/* External URL */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                External URL
              </label>
              <input
                type="url"
                value={formData.external_url || ''}
                onChange={(e) => setFormData({ ...formData, external_url: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                placeholder="https://sam.gov/..."
              />
            </div>

            {/* Teaming Partners */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Teaming Partners (comma-separated)
              </label>
              <input
                type="text"
                value={formData.teaming_partners || ''}
                onChange={(e) => setFormData({ ...formData, teaming_partners: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                placeholder="Acme Corp, Tech Solutions Inc"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Notes
              </label>
              <textarea
                value={formData.notes || ''}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
                rows={4}
                placeholder="Internal notes, strategy, key contacts..."
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 mt-6 pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving...' : initialData ? 'Update' : 'Add to Pipeline'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
