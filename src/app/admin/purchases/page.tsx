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
  source?: string;
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

type ViewMode = 'purchases' | 'profiles' | 'reconciliation';
type CategoryFilter =
  | 'all'
  | 'govcon_tools'
  | 'ai_tools'
  | 'briefings'
  | 'bundles'
  | 'memberships'
  | 'coaching'
  | 'programs'
  | 'other';

type AccessResponse = {
  marketAssassin?: Array<{ email: string }>;
  opportunityScoutPro?: Array<{ email: string }>;
  contentGenerator?: Array<{ email: string }>;
  recompete?: Array<{ email: string }>;
  database?: Array<{ email: string }>;
};

function productLabel(tier: string, productName: string) {
  const labels: Record<string, string> = {
    ai_tools: 'AI Tools',
    hunter_pro: 'Opportunity Hunter Pro',
    ultimate_giant: 'Ultimate Giant',
    pro_giant: 'Pro Giant',
    market_assassin: 'Market Assassin',
    market_intelligence: 'Market Intelligence',
    alert_pro: 'Alert Pro',
    product_supplier: 'Product Supplier Program',
    coaching: 'Coaching',
    membership: 'Membership',
    content_generator: 'Content Reaper',
    recompete: 'Recompete',
    contractor_database: 'Contractor DB',
    briefings: 'Briefings',
    subscription: 'Subscription',
    other: 'Other',
  };
  return labels[tier] || productName || tier;
}

function normalizedProductGroup(purchase: Purchase) {
  const productName = (purchase.product_name || '').toLowerCase();

  if (
    productName.includes('copy of pro member group') ||
    productName.includes('pro member plan') ||
    productName.includes('ongoing coaching')
  ) {
    return 'Pro Member Group';
  }

  if (productName.includes('pro member lifetime')) {
    return 'PRO Member Lifetime Plan';
  }

  return purchase.product_name || productLabel(purchase.tier, purchase.product_name) || 'Unknown Product';
}

function purchaseCategory(purchase: Purchase): CategoryFilter {
  const tier = purchase.tier || 'other';
  const productName = (purchase.product_name || '').toLowerCase();

  if (normalizedProductGroup(purchase) === 'Pro Member Group') return 'memberships';
  if (tier === 'ai_tools' || productName.includes('ai tools')) return 'ai_tools';
  if (tier === 'briefings' || tier === 'alert_pro' || productName.includes('briefing') || productName.includes('alert')) return 'briefings';
  if (tier === 'ultimate_giant' || tier === 'pro_giant' || productName.includes('bundle')) return 'bundles';
  if (tier === 'membership' || tier === 'subscription' || productName.includes('subscription')) return 'memberships';
  if (tier === 'coaching') return 'coaching';
  if (tier === 'product_supplier') return 'programs';
  if (['hunter_pro', 'market_assassin', 'market_intelligence', 'content_generator', 'recompete', 'contractor_database'].includes(tier)) {
    return 'govcon_tools';
  }
  return 'other';
}

function categoryLabel(category: CategoryFilter) {
  const labels: Record<CategoryFilter, string> = {
    all: 'All',
    govcon_tools: 'GovCon Tools',
    ai_tools: 'AI Tools',
    briefings: 'Briefings',
    bundles: 'Bundles',
    memberships: 'Memberships',
    coaching: 'Coaching',
    programs: 'Programs',
    other: 'Other',
  };
  return labels[category];
}

export default function AdminPurchasesPage() {
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('purchases');
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [accessByEmail, setAccessByEmail] = useState<Record<string, string[]>>({});
  const [purchaseSource, setPurchaseSource] = useState<string>('unknown');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchEmail, setSearchEmail] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');

  const getPurchaseEmail = (purchase: Purchase) => (purchase.email || '').toLowerCase().trim();
  const getProfileEmail = (profile: UserProfile) => (profile.email || '').toLowerCase().trim();

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
        sessionStorage.setItem('adminPassword', password);
        setIsAuthenticated(true);
      } else {
        setError('Invalid password');
      }
    } catch {
      setError('Authentication failed');
    }
  };

  const loadData = async (passwordOverride?: string) => {
    const adminPassword = passwordOverride || password || sessionStorage.getItem('adminPassword') || '';

    if (!adminPassword) {
      setError('Admin password missing. Please log in again.');
      setIsAuthenticated(false);
      return;
    }

    setLoading(true);
    setError('');
    const loadErrors: string[] = [];

    const fetchAdminJson = async <T,>(label: string, url: string): Promise<T | null> => {
      const res = await fetch(url, {
        headers: { 'x-admin-password': adminPassword },
        cache: 'no-store',
      });

      if (!res.ok) {
        const body = await res.text();
        loadErrors.push(`${label} failed (${res.status})${body ? `: ${body.slice(0, 140)}` : ''}`);
        return null;
      }

      return res.json() as Promise<T>;
    };

    try {
      const purchasesData = await fetchAdminJson<{ purchases?: Purchase[]; source?: string }>(
        'Purchases',
        '/api/admin/list-purchases?days=365'
      );

      if (purchasesData) {
        setPurchases(Array.isArray(purchasesData.purchases) ? purchasesData.purchases : []);
        setPurchaseSource(purchasesData.source || 'unknown');
      }

      const profilesRes = await fetch('/api/admin/list-profiles', {
        headers: { 'x-admin-password': adminPassword },
        cache: 'no-store',
      });

      if (profilesRes.ok) {
        const data = await profilesRes.json();
        setProfiles(Array.isArray(data.profiles) ? data.profiles : []);
      } else {
        const body = await profilesRes.text();
        loadErrors.push(`Profiles failed (${profilesRes.status})${body ? `: ${body.slice(0, 140)}` : ''}`);
      }

      const accessRes = await fetch('/api/admin/list-access', {
        headers: { 'x-admin-password': adminPassword },
        cache: 'no-store',
      });

      if (accessRes.ok) {
        const data: AccessResponse = await accessRes.json();
        const nextAccess: Record<string, string[]> = {};
        const addAccess = (email: string | undefined, tool: string) => {
          const normalized = (email || '').toLowerCase().trim();
          if (!normalized) return;
          if (!nextAccess[normalized]) nextAccess[normalized] = [];
          if (!nextAccess[normalized].includes(tool)) nextAccess[normalized].push(tool);
        };

        data.marketAssassin?.forEach((record) => addAccess(record.email, 'Market Assassin'));
        data.opportunityScoutPro?.forEach((record) => addAccess(record.email, 'Opportunity Hunter Pro'));
        data.contentGenerator?.forEach((record) => addAccess(record.email, 'Content Reaper'));
        data.recompete?.forEach((record) => addAccess(record.email, 'Recompete'));
        data.database?.forEach((record) => addAccess(record.email, 'Contractor DB'));
        setAccessByEmail(nextAccess);
      } else {
        const body = await accessRes.text();
        loadErrors.push(`Access failed (${accessRes.status})${body ? `: ${body.slice(0, 140)}` : ''}`);
      }

      if (loadErrors.length > 0) {
        setError(loadErrors.join(' | '));
      }
    } catch (err) {
      console.error('Error loading data:', err);
      setError(`Failed to load data: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const storedPassword = sessionStorage.getItem('adminPassword');
    if (storedPassword) {
      setPassword(storedPassword);
      setIsAuthenticated(true);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    }
  }, [isAuthenticated]);

  const matchesSearch = (purchase: Purchase) => {
    const needle = searchEmail.toLowerCase().trim();
    if (!needle) return true;
    return (
      getPurchaseEmail(purchase).includes(needle) ||
      (purchase.product_name || '').toLowerCase().includes(needle) ||
      (purchase.product_id || '').toLowerCase().includes(needle)
    );
  };

  const categoryMatches = (purchase: Purchase) => (
    categoryFilter === 'all' || purchaseCategory(purchase) === categoryFilter
  );

  const filteredPurchases = purchases.filter(p => matchesSearch(p) && categoryMatches(p));

  const filteredProfiles = searchEmail
    ? profiles.filter(p => getProfileEmail(p).includes(searchEmail.toLowerCase()))
    : profiles;

  const filteredReconciliation = purchases.filter(p => matchesSearch(p) && categoryMatches(p));

  const unmatchedToolPurchases = purchases.filter((purchase) => {
    if (purchase.tier === 'ai_tools') return false;
    const email = getPurchaseEmail(purchase);
    if (!email) return true;
    return (accessByEmail[email] || []).length === 0;
  });

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
      currency: (currency || 'usd').toUpperCase(),
    }).format(amount);
  };

  const purchaseCategories: CategoryFilter[] = [
    'all',
    'govcon_tools',
    'ai_tools',
    'briefings',
    'bundles',
    'memberships',
    'coaching',
    'programs',
    'other',
  ];

  const categorySummary = purchaseCategories.map((category) => {
    const categoryPurchases = category === 'all'
      ? purchases
      : purchases.filter((purchase) => purchaseCategory(purchase) === category);
    return {
      category,
      count: categoryPurchases.length,
      revenue: categoryPurchases.reduce((sum, purchase) => sum + (purchase.amount || 0), 0),
    };
  });

  const productSummary = Object.values(
    purchases.reduce<Record<string, { key: string; label: string; category: CategoryFilter; count: number; revenue: number }>>(
      (acc, purchase) => {
        const category = purchaseCategory(purchase);
        if (categoryFilter !== 'all' && category !== categoryFilter) return acc;
        const label = normalizedProductGroup(purchase);
        const key = `${category}:${label}`;
        if (!acc[key]) {
          acc[key] = { key, label, category, count: 0, revenue: 0 };
        }
        acc[key].count += 1;
        acc[key].revenue += purchase.amount || 0;
        return acc;
      },
      {}
    )
  ).sort((a, b) => b.revenue - a.revenue);

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

  const adminTabs = [
    { href: '/admin/dashboard', label: 'Operations', icon: '📊' },
    { href: '/admin', label: 'Access Control', icon: '🔐' },
    { href: '/admin/purchases', label: 'Purchases', icon: '💳' },
    { href: '/admin/emails', label: 'Email History', icon: '📧' },
    { href: '/admin/feedback', label: 'Feedback', icon: '💬' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation Tabs */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-1 py-2">
            <span className="text-gray-500 text-sm mr-4">Admin:</span>
            {adminTabs.map((tab) => {
              const isActive = tab.href === '/admin/purchases';
              return (
                <a
                  key={tab.href}
                  href={tab.href}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {tab.icon} {tab.label}
                </a>
              );
            })}
          </div>
        </div>
      </div>

      {/* Header */}
      <nav className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-bold text-gray-900">Purchase Management</h1>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={() => loadData()}
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
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <div className="bg-white p-4 rounded-xl shadow-sm">
            <p className="text-sm text-gray-500">Total Purchases</p>
            <p className="text-2xl font-bold text-gray-900">{purchases.length}</p>
          </div>
          <div className="bg-white p-4 rounded-xl shadow-sm">
            <p className="text-sm text-gray-500">Payment Source</p>
            <p className="text-2xl font-bold text-gray-900 capitalize">{purchaseSource}</p>
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
          <div className="bg-white p-4 rounded-xl shadow-sm">
            <p className="text-sm text-gray-500">Needs Access Check</p>
            <p className={`text-2xl font-bold ${unmatchedToolPurchases.length > 0 ? 'text-orange-600' : 'text-green-600'}`}>
              {unmatchedToolPurchases.length}
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
            <button
              onClick={() => setViewMode('reconciliation')}
              className={`px-4 py-2 rounded-lg font-medium ${
                viewMode === 'reconciliation'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100'
              }`}
            >
              Payment + Access ({unmatchedToolPurchases.length})
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

        {/* Category Summary */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Payment Categories</h2>
              <p className="text-sm text-gray-500">
                Filter charges by product family. AI Tools/mo stays separate from GovCon tool access.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {categorySummary.map((summary) => (
                <button
                  key={summary.category}
                  onClick={() => setCategoryFilter(summary.category)}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    categoryFilter === summary.category
                      ? 'border-blue-600 bg-blue-50 text-blue-800'
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <span className="block text-sm font-semibold">{categoryLabel(summary.category)}</span>
                  <span className="block text-xs text-gray-500">
                    {summary.count} / {formatAmount(summary.revenue, 'usd')}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {productSummary.slice(0, 9).map((product) => (
              <div key={product.key} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{product.label}</p>
                    <p className="mt-1 text-xs text-gray-500">{categoryLabel(product.category)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">{formatAmount(product.revenue, 'usd')}</p>
                    <p className="text-xs text-gray-500">{product.count} charge{product.count === 1 ? '' : 's'}</p>
                  </div>
                </div>
              </div>
            ))}
            {productSummary.length === 0 && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">
                No payments in this category.
              </div>
            )}
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
                          {productLabel(purchase.tier, purchase.product_name)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {formatAmount(purchase.amount, purchase.currency)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          purchase.status === 'completed' || purchase.status === 'succeeded'
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

        {/* Payment + Access Reconciliation */}
        {viewMode === 'reconciliation' && (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b bg-blue-50">
              <p className="text-sm text-blue-900 font-medium">Payment + Access Reconciliation</p>
              <p className="text-xs text-blue-700 mt-1">
                AI Tools payments are treated as a separate product. Tool access checks compare payment email to Access Control records.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Payment Email</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Product</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Amount</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Access Found</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredReconciliation.map((purchase) => {
                    const email = getPurchaseEmail(purchase);
                    const accessTools = accessByEmail[email] || [];
                    const isSeparateAiTools = purchase.tier === 'ai_tools';
                    const hasAccess = accessTools.length > 0;
                    return (
                      <tr key={`reconcile-${purchase.id}`} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-900">{purchase.email || '-'}</td>
                        <td className="px-4 py-3 text-sm">
                          <div className="text-gray-900">{purchase.product_name || purchase.product_id}</div>
                          <div className="text-xs text-gray-500">{productLabel(purchase.tier, purchase.product_name)}</div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {formatAmount(purchase.amount, purchase.currency)}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <div className="flex flex-wrap gap-1">
                            {accessTools.length > 0 ? accessTools.map((tool) => (
                              <span key={tool} className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">
                                {tool}
                              </span>
                            )) : (
                              <span className="text-gray-400">None on this email</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {isSeparateAiTools ? (
                            <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                              Separate AI Tools product
                            </span>
                          ) : hasAccess ? (
                            <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                              Access matched
                            </span>
                          ) : (
                            <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded-full text-xs font-medium">
                              Check access email
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {formatDate(purchase.purchased_at)}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredReconciliation.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                        {loading ? 'Loading...' : 'No payments found'}
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
                    // Content Reaper
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
