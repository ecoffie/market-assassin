'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Purchase {
  id: string;
  email: string;
  product_id: string;
  product_name: string;
  tier: string;
  amount: number | null;
  currency: string;
  status: string;
  purchased_at: string;
  stripe_customer_id: string | null;
  bundle: string | null;
  metadata: Record<string, unknown> | null;
}

interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  license_key: string | null;
  // Access flags (matching database columns)
  access_hunter_pro: boolean;
  access_content_standard: boolean;
  access_content_full_fix: boolean;
  access_assassin_standard: boolean;
  access_assassin_premium: boolean;
  access_recompete: boolean;
  access_contractor_db: boolean;
  bundle: string | null;
  license_activated_at: string | null;
  created_at: string;
}

type ViewMode = 'purchases' | 'profiles';

export default function AdminPurchasesPage() {
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('purchases');
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchEmail, setSearchEmail] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const res = await fetch('/api/admin/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        setIsAuthenticated(true);
        loadData();
      } else {
        setError('Invalid password');
      }
    } catch {
      setError('Authentication failed');
    }
  };

  const loadData = async () => {
    setLoading(true);
    setError('');

    try {
      // Load purchases
      const purchasesRes = await fetch('/api/admin/list-purchases', {
        headers: { 'x-admin-password': password },
      });

      if (purchasesRes.ok) {
        const data = await purchasesRes.json();
        setPurchases(data.purchases || []);
      }

      // Load profiles
      const profilesRes = await fetch('/api/admin/list-profiles', {
        headers: { 'x-admin-password': password },
      });

      if (profilesRes.ok) {
        const data = await profilesRes.json();
        setProfiles(data.profiles || []);
      }
    } catch (err) {
      console.error('Error loading data:', err);
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    }
  }, [isAuthenticated]);

  const filteredPurchases = searchEmail
    ? purchases.filter(p => p.email.toLowerCase().includes(searchEmail.toLowerCase()))
    : purchases;

  const filteredProfiles = searchEmail
    ? profiles.filter(p => p.email.toLowerCase().includes(searchEmail.toLowerCase()))
    : profiles;

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatAmount = (amount: number | null, currency: string) => {
    if (amount === null) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount);
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full">
          <h1 className="text-2xl font-bold text-gray-900 mb-6 text-center">Admin Access</h1>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Admin Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="Enter admin password"
              />
            </div>

            {error && (
              <p className="text-red-600 text-sm">{error}</p>
            )}

            <button
              type="submit"
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
            >
              Login
            </button>
          </form>

          <div className="mt-4 text-center">
            <Link href="/admin" className="text-blue-600 hover:underline text-sm">
              Back to Admin Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <nav className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Link href="/admin" className="text-gray-600 hover:text-gray-900">
                &larr; Admin
              </Link>
              <h1 className="text-xl font-bold text-gray-900">Purchase Management</h1>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={loadData}
                disabled={loading}
                className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                {loading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white p-4 rounded-xl shadow-sm">
            <p className="text-sm text-gray-500">Total Purchases</p>
            <p className="text-2xl font-bold text-gray-900">{purchases.length}</p>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm">
            <p className="text-sm text-gray-500">Total Profiles</p>
            <p className="text-2xl font-bold text-gray-900">{profiles.length}</p>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm">
            <p className="text-sm text-gray-500">Unique Customers</p>
            <p className="text-2xl font-bold text-gray-900">
              {new Set(purchases.map(p => p.email)).size}
            </p>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm">
            <p className="text-sm text-gray-500">Total Revenue</p>
            <p className="text-2xl font-bold text-green-600">
              {formatAmount(
                purchases.reduce((sum, p) => sum + (p.amount || 0), 0),
                'usd'
              )}
            </p>
          </div>
        </div>

        {/* View Toggles & Search */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('purchases')}
              className={`px-4 py-2 rounded-lg font-medium ${
                viewMode === 'purchases'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100'
              }`}
            >
              Purchases ({purchases.length})
            </button>
            <button
              onClick={() => setViewMode('profiles')}
              className={`px-4 py-2 rounded-lg font-medium ${
                viewMode === 'profiles'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100'
              }`}
            >
              User Profiles ({profiles.length})
            </button>
          </div>

          <div className="flex-1">
            <input
              type="text"
              placeholder="Search by email..."
              value={searchEmail}
              onChange={(e) => setSearchEmail(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Purchases Table */}
        {viewMode === 'purchases' && (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Email</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Product</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Tier</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Amount</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredPurchases.map((purchase) => (
                    <tr key={purchase.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">{purchase.email}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {purchase.product_name || purchase.product_id}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                          {purchase.tier}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {formatAmount(purchase.amount, purchase.currency)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          purchase.status === 'completed'
                            ? 'bg-green-100 text-green-700'
                            : purchase.status === 'refunded'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {purchase.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {formatDate(purchase.purchased_at)}
                      </td>
                    </tr>
                  ))}
                  {filteredPurchases.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                        {loading ? 'Loading...' : 'No purchases found'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* User Profiles Table */}
        {viewMode === 'profiles' && (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Email</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">License Key</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Products</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Bundle</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Activated</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredProfiles.map((profile) => {
                    const accessFlags = [];
                    // Market Assassin
                    if (profile.access_assassin_premium) {
                      accessFlags.push('MA Premium');
                    } else if (profile.access_assassin_standard) {
                      accessFlags.push('MA Standard');
                    }
                    // Content Generator
                    if (profile.access_content_full_fix) {
                      accessFlags.push('CG Full Fix');
                    } else if (profile.access_content_standard) {
                      accessFlags.push('CG Standard');
                    }
                    // Other products
                    if (profile.access_hunter_pro) accessFlags.push('Hunter Pro');
                    if (profile.access_contractor_db) accessFlags.push('Contractor DB');
                    if (profile.access_recompete) accessFlags.push('Recompete');

                    return (
                      <tr key={profile.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm">
                          <div className="text-gray-900">{profile.email}</div>
                          {profile.name && (
                            <div className="text-gray-500 text-xs">{profile.name}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm font-mono text-gray-600">
                          {profile.license_key || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <div className="flex flex-wrap gap-1">
                            {accessFlags.length > 0 ? accessFlags.map((flag, i) => (
                              <span key={i} className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">
                                {flag}
                              </span>
                            )) : (
                              <span className="text-gray-400">None</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {profile.bundle ? (
                            <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                              {profile.bundle}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {profile.license_activated_at ? (
                            <span className="text-green-600">Yes</span>
                          ) : (
                            <span className="text-gray-400">No</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {formatDate(profile.created_at)}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredProfiles.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                        {loading ? 'Loading...' : 'No profiles found'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
