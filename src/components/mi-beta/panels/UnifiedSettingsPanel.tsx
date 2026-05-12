'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MIBetaTier } from '../UnifiedSidebarBeta';
import { getMIApiHeaders } from '../authHeaders';

interface UnifiedSettingsPanelProps {
  email: string | null;
  tier: MIBetaTier;
}

interface SettingsForm {
  company_name: string;
  display_name: string;
  role_title: string;
  naics_codes: string;
  target_agencies: string;
  email_frequency: string;
  onboarding_completed: boolean;
  two_factor_required: boolean;
}

export default function UnifiedSettingsPanel({ email, tier }: UnifiedSettingsPanelProps) {
  const [form, setForm] = useState<SettingsForm>({
    company_name: '',
    display_name: '',
    role_title: '',
    naics_codes: '',
    target_agencies: '',
    email_frequency: 'daily',
    onboarding_completed: false,
    two_factor_required: true,
  });
  const [workspaceName, setWorkspaceName] = useState('Workspace');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const getAuthHeaders = useCallback((init?: HeadersInit) => getMIApiHeaders(email, init), [email]);

  const loadSettings = useCallback(async () => {
    if (!email) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/mi-beta/workspace?email=${encodeURIComponent(email)}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Failed to load settings');
        return;
      }

      const settings = data.settings || {};
      setWorkspaceName(data.workspace?.name || 'Workspace');
      setForm({
        company_name: settings.company_name || '',
        display_name: settings.display_name || '',
        role_title: settings.role_title || '',
        naics_codes: (settings.naics_codes || []).join(', '),
        target_agencies: (settings.target_agencies || []).join(', '),
        email_frequency: settings.email_frequency || 'daily',
        onboarding_completed: Boolean(settings.onboarding_completed),
        two_factor_required: settings.two_factor_required !== false,
      });
    } catch (err) {
      console.error('Failed to load settings:', err);
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [email, getAuthHeaders]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const saveSettings = async (markComplete = form.onboarding_completed) => {
    if (!email) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch('/api/mi-beta/workspace', {
        method: 'PATCH',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          email,
          company_name: form.company_name,
          display_name: form.display_name,
          role_title: form.role_title,
          naics_codes: parseList(form.naics_codes),
          target_agencies: parseList(form.target_agencies),
          email_frequency: form.email_frequency,
          onboarding_completed: markComplete,
          two_factor_required: form.two_factor_required,
        }),
      });
      const data = await res.json();

      if (!data.success) {
        setError(data.error || 'Failed to save settings');
        return;
      }

      setForm(prev => ({ ...prev, onboarding_completed: markComplete }));
      setMessage(markComplete ? 'Onboarding marked complete.' : 'Settings saved.');
    } catch (err) {
      console.error('Failed to save settings:', err);
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-800 rounded w-64" />
          <div className="h-96 bg-slate-800 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Unified Settings</h1>
        <p className="text-slate-400 mt-1">{workspaceName} • {tierLabel(tier)}</p>
      </div>

      {message && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-300">{message}</div>}
      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-300">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
          <SectionTitle title="Profile" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Display Name" value={form.display_name} onChange={(value) => setForm({ ...form, display_name: value })} placeholder="Eric Coffie" />
            <Field label="Role / Title" value={form.role_title} onChange={(value) => setForm({ ...form, role_title: value })} placeholder="Founder, BD Lead..." />
            <Field label="Company" value={form.company_name} onChange={(value) => setForm({ ...form, company_name: value })} placeholder="Company name" />
            <label className="block">
              <span className="block text-sm text-slate-400 mb-1">Email Frequency</span>
              <select
                value={form.email_frequency}
                onChange={(e) => setForm({ ...form, email_frequency: e.target.value })}
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white outline-none focus:border-emerald-500"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="critical_only">Critical only</option>
              </select>
            </label>
          </div>

          <SectionTitle title="Market Targeting" />
          <Field label="NAICS Codes" value={form.naics_codes} onChange={(value) => setForm({ ...form, naics_codes: value })} placeholder="541512, 541611, 541330" />
          <Field label="Target Agencies" value={form.target_agencies} onChange={(value) => setForm({ ...form, target_agencies: value })} placeholder="VA, DHS, Army, GSA" />

          <SectionTitle title="Security" />
          <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-800 bg-slate-800/40 p-4">
            <div>
              <div className="text-sm font-medium text-white">Require two-factor verification</div>
              <div className="text-xs text-slate-500 mt-1">Adds an extra layer of security to your account.</div>
            </div>
            <input
              type="checkbox"
              checked={form.two_factor_required}
              onChange={(e) => setForm({ ...form, two_factor_required: e.target.checked })}
              className="h-5 w-5 rounded border-slate-600 bg-slate-900 text-emerald-600"
            />
          </label>

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => saveSettings(false)}
              disabled={saving}
              className="px-5 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-60 text-slate-200 rounded-lg transition-colors"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
            <button
              onClick={() => saveSettings(true)}
              disabled={saving}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white rounded-lg font-medium transition-colors"
            >
              Mark Onboarding Complete
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="font-semibold text-white">Onboarding</h2>
            <div className="mt-4 space-y-3">
              <ChecklistItem label="Profile saved" done={Boolean(form.display_name || form.company_name)} />
              <ChecklistItem label="NAICS selected" done={parseList(form.naics_codes).length > 0} />
              <ChecklistItem label="Agencies selected" done={parseList(form.target_agencies).length > 0} />
              <ChecklistItem label="2FA enabled" done={form.two_factor_required} />
              <ChecklistItem label="Ready state complete" done={form.onboarding_completed} />
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="font-semibold text-white mb-2">Session</h2>
            <p className="text-sm text-slate-400">
              Your beta session is protected by a signed two-factor token and expires after 12 hours.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 pt-2">{title}</h2>;
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="block text-sm text-slate-400 mb-1">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 outline-none focus:border-emerald-500"
      />
    </label>
  );
}

function ChecklistItem({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className={`h-5 w-5 rounded-full flex items-center justify-center text-xs ${done ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-500'}`}>
        {done ? '✓' : ''}
      </span>
      <span className={done ? 'text-slate-200' : 'text-slate-500'}>{label}</span>
    </div>
  );
}

function parseList(value: string) {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function tierLabel(tier: MIBetaTier) {
  return tier === 'free' ? 'Free plan' : tier === 'pro' ? 'Pro plan' : tier === 'team' ? 'Team plan' : 'Enterprise plan';
}
