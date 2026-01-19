'use client';

import { useState, useEffect } from 'react';
import { MarketAssassinTier } from '@/lib/access-codes';

type ContentGeneratorTier = 'content-engine' | 'full-fix';

interface AccessRecord {
  email: string;
  customerName?: string;
  tier: MarketAssassinTier;
  createdAt: string;
  upgradedAt?: string;
}

interface OpportunityHunterProRecord {
  email: string;
  customerName?: string;
  createdAt: string;
  productId: string;
}

interface ContentGeneratorRecord {
  email: string;
  customerName?: string;
  tier?: ContentGeneratorTier;
  createdAt: string;
  upgradedAt?: string;
  productId: string;
}

interface RecompeteRecord {
  email: string;
  customerName?: string;
  createdAt: string;
}

interface DatabaseRecord {
  email: string;
  customerName?: string;
  createdAt: string;
  token: string;
}

export default function AdminDashboard() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // Market Assassin state
  const [maRecords, setMaRecords] = useState<AccessRecord[]>([]);
  const [osProRecords, setOsProRecords] = useState<OpportunityHunterProRecord[]>([]);
  const [cgRecords, setCgRecords] = useState<ContentGeneratorRecord[]>([]);
  const [recompeteRecords, setRecompeteRecords] = useState<RecompeteRecord[]>([]);
  const [databaseRecords, setDatabaseRecords] = useState<DatabaseRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Grant access form state
  const [grantEmail, setGrantEmail] = useState('');
  const [grantName, setGrantName] = useState('');
  const [grantTier, setGrantTier] = useState<MarketAssassinTier>('standard');
  const [grantCgTier, setGrantCgTier] = useState<ContentGeneratorTier>('content-engine');
  const [grantProduct, setGrantProduct] = useState<'market-assassin' | 'opportunity-hunter-pro' | 'content-generator' | 'recompete' | 'database'>('market-assassin');
  const [granting, setGranting] = useState(false);
  const [grantMessage, setGrantMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Active tab
  const [activeTab, setActiveTab] = useState<'market-assassin' | 'opportunity-hunter-pro' | 'content-generator' | 'recompete' | 'database'>('market-assassin');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    try {
      // Verify password via API
      const response = await fetch('/api/admin/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (data.valid) {
        setAuthenticated(true);
        // Store password in sessionStorage for API calls
        sessionStorage.setItem('adminAuth', 'true');
        sessionStorage.setItem('adminPassword', password);
      } else {
        setAuthError('Invalid password');
      }
    } catch {
      setAuthError('Failed to verify password');
    }
  };

  useEffect(() => {
    // Check sessionStorage on mount and re-verify password
    const checkAuth = async () => {
      const storedPassword = sessionStorage.getItem('adminPassword');
      if (storedPassword) {
        try {
          const response = await fetch('/api/admin/verify-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: storedPassword }),
          });
          const data = await response.json();
          if (data.valid) {
            setAuthenticated(true);
            setPassword(storedPassword);
          } else {
            sessionStorage.removeItem('adminAuth');
            sessionStorage.removeItem('adminPassword');
          }
        } catch {
          // Failed to verify, require fresh login
        }
      }
    };
    checkAuth();
  }, []);

  useEffect(() => {
    if (authenticated) {
      fetchRecords();
    }
  }, [authenticated]);

  const fetchRecords = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/list-access', {
        headers: {
          'x-admin-password': sessionStorage.getItem('adminPassword') || password,
        },
      });
      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }
      setMaRecords(data.marketAssassin || []);
      setOsProRecords(data.opportunityScoutPro || []);
      setCgRecords(data.contentGenerator || []);
      setRecompeteRecords(data.recompete || []);
      setDatabaseRecords(data.database || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch records');
    } finally {
      setLoading(false);
    }
  };

  const handleGrantAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    setGranting(true);
    setGrantMessage(null);

    try {
      let endpoint = '/api/admin/grant-ma-tier';
      if (grantProduct === 'opportunity-hunter-pro') {
        endpoint = '/api/admin/grant-os-pro';
      } else if (grantProduct === 'content-generator') {
        endpoint = '/api/admin/grant-content-generator';
      } else if (grantProduct === 'recompete') {
        endpoint = '/api/admin/grant-recompete';
      } else if (grantProduct === 'database') {
        endpoint = '/api/admin/grant-database-access';
      }

      let body;
      if (grantProduct === 'market-assassin') {
        body = { email: grantEmail, tier: grantTier, customerName: grantName || undefined, adminPassword: password };
      } else if (grantProduct === 'content-generator') {
        body = { email: grantEmail, tier: grantCgTier, customerName: grantName || undefined, adminPassword: password };
      } else if (grantProduct === 'database') {
        body = { email: grantEmail, name: grantName || undefined, adminPassword: password };
      } else {
        // For opportunity-hunter-pro and recompete
        body = { email: grantEmail, customerName: grantName || null, adminPassword: password };
      }

      console.log('Sending grant request:', { endpoint, grantProduct, body: { ...body, adminPassword: '[REDACTED]' } });

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      setGrantMessage({ type: 'success', text: data.message });
      setGrantEmail('');
      setGrantName('');
      fetchRecords(); // Refresh the list
    } catch (err) {
      setGrantMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to grant access' });
    } finally {
      setGranting(false);
    }
  };

  const handleRevokeAccess = async (email: string, product: 'market-assassin' | 'opportunity-hunter-pro' | 'content-generator' | 'recompete' | 'database') => {
    if (!confirm(`Are you sure you want to revoke access for ${email}?`)) {
      return;
    }

    try {
      const response = await fetch('/api/admin/revoke-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, product, adminPassword: password }),
      });

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }

      fetchRecords(); // Refresh the list
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to revoke access');
    }
  };

  const handleUpgradeToPremiun = async (email: string) => {
    try {
      const response = await fetch('/api/admin/grant-ma-tier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, tier: 'premium', adminPassword: password }),
      });

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }

      fetchRecords(); // Refresh the list
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to upgrade');
    }
  };

  const handleUpgradeCgToFullFix = async (email: string) => {
    try {
      const response = await fetch('/api/admin/grant-content-generator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, tier: 'full-fix', adminPassword: password }),
      });

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }

      fetchRecords(); // Refresh the list
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to upgrade');
    }
  };

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
          <div className="text-center mb-6">
            <div className="text-4xl mb-3">🔐</div>
            <h1 className="text-2xl font-bold text-slate-900">Admin Access</h1>
            <p className="text-slate-500 text-sm mt-2">Enter your admin password to continue</p>
          </div>

          <form onSubmit={handleLogin}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Admin password"
              className="w-full px-4 py-3 border border-slate-300 rounded-lg mb-4 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              autoFocus
            />
            {authError && (
              <p className="text-red-600 text-sm mb-4">{authError}</p>
            )}
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 px-6 rounded-lg font-bold transition-colors"
            >
              Login
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Admin Dashboard</h1>
              <p className="text-slate-600 mt-1">Manage user access for all products</p>
            </div>
            <button
              onClick={() => {
                sessionStorage.removeItem('adminAuth');
                setAuthenticated(false);
                setPassword('');
              }}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Grant Access Form */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <h2 className="text-xl font-bold text-slate-900 mb-4">Grant Access</h2>
          <form onSubmit={handleGrantAccess} className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Product</label>
                <select
                  value={grantProduct}
                  onChange={(e) => setGrantProduct(e.target.value as 'market-assassin' | 'opportunity-hunter-pro' | 'content-generator' | 'recompete' | 'database')}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-slate-900 bg-white"
                >
                  <option value="market-assassin">Market Assassin</option>
                  <option value="opportunity-hunter-pro">Opportunity Hunter Pro</option>
                  <option value="content-generator">GovCon Content Generator</option>
                  <option value="recompete">Recompete Contracts Tracker</option>
                  <option value="database">Federal Contractor Database</option>
                </select>
              </div>

              {grantProduct === 'market-assassin' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tier</label>
                  <select
                    value={grantTier}
                    onChange={(e) => setGrantTier(e.target.value as MarketAssassinTier)}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-slate-900 bg-white"
                  >
                    <option value="standard">Standard ($297)</option>
                    <option value="premium">Premium ($497)</option>
                  </select>
                </div>
              )}

              {grantProduct === 'content-generator' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tier</label>
                  <select
                    value={grantCgTier}
                    onChange={(e) => setGrantCgTier(e.target.value as ContentGeneratorTier)}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-slate-900 bg-white"
                  >
                    <option value="content-engine">Content Engine ($197)</option>
                    <option value="full-fix">Full Fix ($297)</option>
                  </select>
                </div>
              )}
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email *</label>
                <input
                  type="email"
                  value={grantEmail}
                  onChange={(e) => setGrantEmail(e.target.value)}
                  placeholder="user@example.com"
                  required
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-slate-900 bg-white placeholder-slate-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Customer Name (optional)</label>
                <input
                  type="text"
                  value={grantName}
                  onChange={(e) => setGrantName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-slate-900 bg-white placeholder-slate-400"
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button
                type="submit"
                disabled={granting || !grantEmail}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {granting ? 'Granting...' : 'Grant Access'}
              </button>

              {grantMessage && (
                <p className={`text-sm ${grantMessage.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                  {grantMessage.text}
                </p>
              )}
            </div>
          </form>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('market-assassin')}
            className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
              activeTab === 'market-assassin'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-100'
            }`}
          >
            Market Assassin ({maRecords.length})
          </button>
          <button
            onClick={() => setActiveTab('opportunity-hunter-pro')}
            className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
              activeTab === 'opportunity-hunter-pro'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-100'
            }`}
          >
            Opportunity Hunter Pro ({osProRecords.length})
          </button>
          <button
            onClick={() => setActiveTab('content-generator')}
            className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
              activeTab === 'content-generator'
                ? 'bg-purple-600 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-100'
            }`}
          >
            Content Generator ({cgRecords.length})
          </button>
          <button
            onClick={() => setActiveTab('recompete')}
            className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
              activeTab === 'recompete'
                ? 'bg-amber-600 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-100'
            }`}
          >
            Recompete ({recompeteRecords.length})
          </button>
          <button
            onClick={() => setActiveTab('database')}
            className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
              activeTab === 'database'
                ? 'bg-emerald-600 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-100'
            }`}
          >
            Database ({databaseRecords.length})
          </button>
          <button
            onClick={fetchRecords}
            disabled={loading}
            className="ml-auto px-4 py-2 text-sm text-slate-600 hover:text-slate-800 border border-slate-300 rounded-lg hover:bg-white transition-colors disabled:opacity-50"
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Records Table */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          {activeTab === 'market-assassin' && (
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Email</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Name</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Tier</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Created</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {maRecords.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                      No Market Assassin access records found
                    </td>
                  </tr>
                ) : (
                  maRecords.map((record) => (
                    <tr key={record.email} className="hover:bg-slate-50">
                      <td className="px-6 py-4 text-sm text-slate-900">{record.email}</td>
                      <td className="px-6 py-4 text-sm text-slate-600">{record.customerName || '-'}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2 py-1 text-xs font-bold rounded-full ${
                          record.tier === 'premium'
                            ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white'
                            : 'bg-blue-100 text-blue-800'
                        }`}>
                          {record.tier === 'premium' ? 'Premium' : 'Standard'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        {new Date(record.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex gap-2">
                          {record.tier === 'standard' && (
                            <button
                              onClick={() => handleUpgradeToPremiun(record.email)}
                              className="px-3 py-1 text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg transition-colors"
                            >
                              Upgrade
                            </button>
                          )}
                          <button
                            onClick={() => handleRevokeAccess(record.email, 'market-assassin')}
                            className="px-3 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-800 rounded-lg transition-colors"
                          >
                            Revoke
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {activeTab === 'opportunity-hunter-pro' && (
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Email</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Name</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Created</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {osProRecords.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-slate-500">
                      No Opportunity Hunter Pro access records found
                    </td>
                  </tr>
                ) : (
                  osProRecords.map((record) => (
                    <tr key={record.email} className="hover:bg-slate-50">
                      <td className="px-6 py-4 text-sm text-slate-900">{record.email}</td>
                      <td className="px-6 py-4 text-sm text-slate-600">{record.customerName || '-'}</td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        {new Date(record.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleRevokeAccess(record.email, 'opportunity-hunter-pro')}
                          className="px-3 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-800 rounded-lg transition-colors"
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {activeTab === 'content-generator' && (
            <table className="w-full">
              <thead className="bg-purple-50 border-b border-purple-200">
                <tr>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Email</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Name</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Tier</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Created</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cgRecords.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                      No GovCon Content Generator access records found
                    </td>
                  </tr>
                ) : (
                  cgRecords.map((record) => (
                    <tr key={record.email} className="hover:bg-slate-50">
                      <td className="px-6 py-4 text-sm text-slate-900">{record.email}</td>
                      <td className="px-6 py-4 text-sm text-slate-600">{record.customerName || '-'}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2 py-1 text-xs font-bold rounded-full ${
                          record.tier === 'full-fix'
                            ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
                            : 'bg-purple-100 text-purple-800'
                        }`}>
                          {record.tier === 'full-fix' ? 'Full Fix' : 'Content Engine'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        {new Date(record.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex gap-2">
                          {record.tier !== 'full-fix' && (
                            <button
                              onClick={() => handleUpgradeCgToFullFix(record.email)}
                              className="px-3 py-1 text-xs bg-purple-100 hover:bg-purple-200 text-purple-800 rounded-lg transition-colors"
                            >
                              Upgrade
                            </button>
                          )}
                          <button
                            onClick={() => handleRevokeAccess(record.email, 'content-generator')}
                            className="px-3 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-800 rounded-lg transition-colors"
                          >
                            Revoke
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {activeTab === 'recompete' && (
            <table className="w-full">
              <thead className="bg-amber-50 border-b border-amber-200">
                <tr>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Email</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Name</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Created</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recompeteRecords.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-slate-500">
                      No Recompete Contracts Tracker access records found
                    </td>
                  </tr>
                ) : (
                  recompeteRecords.map((record) => (
                    <tr key={record.email} className="hover:bg-slate-50">
                      <td className="px-6 py-4 text-sm text-slate-900">{record.email}</td>
                      <td className="px-6 py-4 text-sm text-slate-600">{record.customerName || '-'}</td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        {new Date(record.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleRevokeAccess(record.email, 'recompete')}
                          className="px-3 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-800 rounded-lg transition-colors"
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {activeTab === 'database' && (
            <table className="w-full">
              <thead className="bg-emerald-50 border-b border-emerald-200">
                <tr>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Email</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Name</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Created</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {databaseRecords.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-slate-500">
                      No Federal Contractor Database access records found
                    </td>
                  </tr>
                ) : (
                  databaseRecords.map((record) => (
                    <tr key={record.email} className="hover:bg-slate-50">
                      <td className="px-6 py-4 text-sm text-slate-900">{record.email}</td>
                      <td className="px-6 py-4 text-sm text-slate-600">{record.customerName || '-'}</td>
                      <td className="px-6 py-4 text-sm text-slate-600">
                        {new Date(record.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleRevokeAccess(record.email, 'database')}
                          className="px-3 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-800 rounded-lg transition-colors"
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Summary Stats */}
        <div className="grid md:grid-cols-7 gap-4 mt-8">
          <div className="bg-white rounded-xl shadow p-6">
            <div className="text-3xl font-bold text-blue-600">{maRecords.length}</div>
            <div className="text-sm text-slate-600">Total MA Users</div>
          </div>
          <div className="bg-white rounded-xl shadow p-6">
            <div className="text-3xl font-bold text-amber-600">
              {maRecords.filter(r => r.tier === 'premium').length}
            </div>
            <div className="text-sm text-slate-600">Premium Users</div>
          </div>
          <div className="bg-white rounded-xl shadow p-6">
            <div className="text-3xl font-bold text-slate-600">
              {maRecords.filter(r => r.tier === 'standard').length}
            </div>
            <div className="text-sm text-slate-600">Standard Users</div>
          </div>
          <div className="bg-white rounded-xl shadow p-6">
            <div className="text-3xl font-bold text-green-600">{osProRecords.length}</div>
            <div className="text-sm text-slate-600">OH Pro Users</div>
          </div>
          <div className="bg-white rounded-xl shadow p-6">
            <div className="text-3xl font-bold text-purple-600">{cgRecords.length}</div>
            <div className="text-sm text-slate-600">Content Gen Users</div>
          </div>
          <div className="bg-white rounded-xl shadow p-6">
            <div className="text-3xl font-bold text-orange-600">{recompeteRecords.length}</div>
            <div className="text-sm text-slate-600">Recompete Users</div>
          </div>
          <div className="bg-white rounded-xl shadow p-6">
            <div className="text-3xl font-bold text-emerald-600">{databaseRecords.length}</div>
            <div className="text-sm text-slate-600">Database Users</div>
          </div>
        </div>
      </div>
    </div>
  );
}
