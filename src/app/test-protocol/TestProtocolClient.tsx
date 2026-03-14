'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

interface TestDefinition {
  id: string;
  name: string;
  category: string;
  method: 'GET' | 'POST';
  endpoint: string;
  body?: Record<string, unknown>;
  check: (data: unknown, status: number) => { pass: boolean; detail: string };
}

interface TestResult {
  id: string;
  status: 'pending' | 'pass' | 'fail' | 'warning';
  responseTime: number;
  httpStatus: number;
  detail: string;
  responsePreview: string;
}

interface ChecklistItem {
  id: string;
  section: string;
  description: string;
  url?: string;
  checked: boolean;
  notes: string;
}

// ── Test Definitions ───────────────────────────────────────────────────────

const SMOKE_EMAIL = 'test-smoke@govcongiants.com';

const TESTS: TestDefinition[] = [
  // Category 1 — Health Checks
  {
    id: 'health-templates',
    name: 'Templates',
    category: 'Health Checks',
    method: 'GET',
    endpoint: '/api/templates',
    check: (data: unknown, status: number) => {
      const d = data as Record<string, unknown>;
      if (status !== 200) return { pass: false, detail: `HTTP ${status}` };
      if (Array.isArray(d?.templates)) return { pass: true, detail: `${(d.templates as unknown[]).length} templates` };
      return { pass: false, detail: 'Missing templates array' };
    },
  },
  {
    id: 'health-painpoints',
    name: 'Pain Points (all)',
    category: 'Health Checks',
    method: 'GET',
    endpoint: '/api/pain-points?action=all',
    check: (data: unknown, status: number) => {
      const d = data as Record<string, unknown>;
      if (status !== 200) return { pass: false, detail: `HTTP ${status}` };
      if (Array.isArray(d?.agencies) && (d?.count as number) > 0) return { pass: true, detail: `${d.count} agencies` };
      return { pass: false, detail: 'Missing agencies or count=0' };
    },
  },
  {
    id: 'health-budget',
    name: 'Budget Authority',
    category: 'Health Checks',
    method: 'GET',
    endpoint: '/api/budget-authority',
    check: (data: unknown, status: number) => {
      const d = data as Record<string, unknown>;
      if (status !== 200) return { pass: false, detail: `HTTP ${status}` };
      if (Array.isArray(d?.data)) return { pass: true, detail: `${(d.data as unknown[]).length} agencies` };
      return { pass: false, detail: 'Missing data array' };
    },
  },
  {
    id: 'health-contractors-stats',
    name: 'Contractors Stats',
    category: 'Health Checks',
    method: 'GET',
    endpoint: '/api/contractors?action=stats',
    check: (_data: unknown, status: number) => {
      if (status === 200) return { pass: true, detail: 'Stats returned' };
      return { pass: false, detail: `HTTP ${status}` };
    },
  },

  // Category 2 — Access Control Denial
  {
    id: 'deny-contentgen',
    name: 'Content Gen Deny',
    category: 'Access Denial',
    method: 'POST',
    endpoint: '/api/verify-content-generator',
    body: { email: SMOKE_EMAIL },
    check: (data: unknown) => {
      const d = data as Record<string, unknown>;
      if (d?.hasAccess === false) return { pass: true, detail: 'Correctly denied' };
      if (d?.hasAccess === true) return { pass: false, detail: 'UNEXPECTED: granted access to smoke email' };
      return { pass: true, detail: 'Denied (non-boolean response)' };
    },
  },
  {
    id: 'deny-ospro',
    name: 'Opp Hunter Pro Deny',
    category: 'Access Denial',
    method: 'POST',
    endpoint: '/api/verify-ospro-access',
    body: { email: SMOKE_EMAIL },
    check: (data: unknown) => {
      const d = data as Record<string, unknown>;
      if (d?.hasAccess === false) return { pass: true, detail: 'Correctly denied' };
      if (d?.hasAccess === true) return { pass: false, detail: 'UNEXPECTED: granted' };
      return { pass: true, detail: 'Denied' };
    },
  },
  {
    id: 'deny-recompete',
    name: 'Recompete Deny',
    category: 'Access Denial',
    method: 'POST',
    endpoint: '/api/verify-recompete-access',
    body: { email: SMOKE_EMAIL },
    check: (data: unknown) => {
      const d = data as Record<string, unknown>;
      if (d?.hasAccess === true) return { pass: false, detail: 'UNEXPECTED: granted' };
      return { pass: true, detail: 'Correctly denied' };
    },
  },
  {
    id: 'deny-briefings',
    name: 'Briefings Deny',
    category: 'Access Denial',
    method: 'POST',
    endpoint: '/api/briefings/verify',
    body: { email: SMOKE_EMAIL },
    check: (data: unknown) => {
      const d = data as Record<string, unknown>;
      if (d?.hasAccess === false) return { pass: true, detail: 'Correctly denied' };
      if (d?.hasAccess === true) return { pass: false, detail: 'UNEXPECTED: granted' };
      return { pass: true, detail: 'Denied' };
    },
  },
  {
    id: 'deny-ma',
    name: 'MA Access Deny',
    category: 'Access Denial',
    method: 'POST',
    endpoint: '/api/verify-ma-access',
    body: { email: SMOKE_EMAIL, accessCode: 'FAKE-CODE-123' },
    check: (data: unknown) => {
      const d = data as Record<string, unknown>;
      if (d?.hasAccess === true) return { pass: false, detail: 'UNEXPECTED: granted' };
      return { pass: true, detail: 'Correctly denied' };
    },
  },
  {
    id: 'deny-db',
    name: 'DB Access Deny',
    category: 'Access Denial',
    method: 'POST',
    endpoint: '/api/verify-db-access',
    body: { email: SMOKE_EMAIL, accessCode: 'FAKE-CODE-123' },
    check: (data: unknown) => {
      const d = data as Record<string, unknown>;
      if (d?.hasAccess === true) return { pass: false, detail: 'UNEXPECTED: granted' };
      return { pass: true, detail: 'Correctly denied' };
    },
  },

  // Category 3 — Data Endpoints
  {
    id: 'data-dsbs',
    name: 'DSBS Benchmark',
    category: 'Data Endpoints',
    method: 'POST',
    endpoint: '/api/dsbs-scorer/benchmark',
    body: { naicsCode: '541512' },
    check: (data: unknown, status: number) => {
      const d = data as Record<string, unknown>;
      if (status !== 200) return { pass: false, detail: `HTTP ${status}` };
      if ((d?.totalContractors as number) > 0) return { pass: true, detail: `${d.totalContractors} contractors` };
      return { pass: false, detail: 'totalContractors missing or 0' };
    },
  },
  {
    id: 'data-painpoints-dod',
    name: 'Pain Points (DoD)',
    category: 'Data Endpoints',
    method: 'GET',
    endpoint: '/api/pain-points?agency=Department of Defense',
    check: (data: unknown, status: number) => {
      const d = data as Record<string, unknown>;
      if (status !== 200) return { pass: false, detail: `HTTP ${status}` };
      if (Array.isArray(d?.painPoints) && (d?.count as number) > 0) return { pass: true, detail: `${d.count} pain points` };
      return { pass: false, detail: 'No pain points for DoD' };
    },
  },
  {
    id: 'data-budget-dod',
    name: 'Budget (DoD)',
    category: 'Data Endpoints',
    method: 'GET',
    endpoint: '/api/budget-authority?agency=Department of Defense',
    check: (data: unknown, status: number) => {
      if (status !== 200) return { pass: false, detail: `HTTP ${status}` };
      const d = data as Record<string, unknown>;
      if (d?.data || d?.agency) return { pass: true, detail: 'Budget data returned' };
      return { pass: false, detail: 'No budget data' };
    },
  },
  {
    id: 'data-budget-winners',
    name: 'Budget Winners',
    category: 'Data Endpoints',
    method: 'GET',
    endpoint: '/api/budget-authority?type=winners&limit=5',
    check: (data: unknown, status: number) => {
      const d = data as Record<string, unknown>;
      if (status !== 200) return { pass: false, detail: `HTTP ${status}` };
      if (Array.isArray(d?.data) && (d.data as unknown[]).length === 5) return { pass: true, detail: '5 winners returned' };
      if (Array.isArray(d?.data)) return { pass: true, detail: `${(d.data as unknown[]).length} winners` };
      return { pass: false, detail: 'Missing data' };
    },
  },
  {
    id: 'data-contractors',
    name: 'Contractors Search',
    category: 'Data Endpoints',
    method: 'GET',
    endpoint: '/api/contractors?naics=541512&limit=5',
    check: (data: unknown, status: number) => {
      if (status !== 200) return { pass: false, detail: `HTTP ${status}` };
      return { pass: true, detail: 'Results returned' };
    },
  },

  // Category 4 — Lead Capture & Activation
  {
    id: 'lead-capture',
    name: 'Lead Capture',
    category: 'Lead & Activation',
    method: 'POST',
    endpoint: '/api/capture-lead',
    body: { email: SMOKE_EMAIL, name: 'Smoke Test', resource: 'test-protocol' },
    check: (data: unknown, status: number) => {
      const d = data as Record<string, unknown>;
      if (status === 200 && d?.success) return { pass: true, detail: 'Lead captured' };
      if (status === 200) return { pass: true, detail: 'OK response' };
      return { pass: false, detail: `HTTP ${status}` };
    },
  },
  {
    id: 'activate-deny',
    name: 'Activate (deny)',
    category: 'Lead & Activation',
    method: 'POST',
    endpoint: '/api/activate',
    body: { email: 'nobody-exists-here@fake.test' },
    check: (data: unknown, status: number) => {
      const d = data as Record<string, unknown>;
      if (d?.hasAccess === true) return { pass: false, detail: 'UNEXPECTED: found access for fake email' };
      if (status === 200 || status === 404) return { pass: true, detail: 'Correctly denied' };
      return { pass: true, detail: `Denied (HTTP ${status})` };
    },
  },

  // Category 5 — Content Library
  {
    id: 'content-library',
    name: 'Content Library List',
    category: 'Content Library',
    method: 'GET',
    endpoint: '/api/content-generator/library',
    check: (_data: unknown, status: number) => {
      if (status === 200) return { pass: true, detail: 'Library accessible' };
      if (status === 401 || status === 403) return { pass: true, detail: 'Auth required (expected)' };
      return { pass: false, detail: `HTTP ${status}` };
    },
  },
];

// ── Manual Checklist ───────────────────────────────────────────────────────

const DEFAULT_CHECKLIST: Omit<ChecklistItem, 'checked' | 'notes'>[] = [
  // Homepage
  { id: 'home-renders', section: 'Homepage', description: 'Page renders without errors, 7 tool cards visible', url: '/' },
  { id: 'home-dsbs', section: 'Homepage', description: 'DSBS Scorer shows FREE badge', url: '/' },
  { id: 'home-links', section: 'Homepage', description: 'All tool card links navigate correctly' },
  // DSBS Scorer
  { id: 'dsbs-gate', section: 'DSBS Scorer', description: 'Email gate appears, captures lead', url: '/dsbs-scorer' },
  { id: 'dsbs-flow', section: 'DSBS Scorer', description: '8-step questionnaire completes with score results', url: '/dsbs-scorer' },
  { id: 'dsbs-pdf', section: 'DSBS Scorer', description: 'PDF export downloads successfully' },
  // Market Assassin
  { id: 'ma-page', section: 'Market Assassin', description: 'Product page renders with pricing', url: '/market-assassin' },
  { id: 'ma-gate', section: 'Market Assassin', description: 'Access gate denies without purchase' },
  // Content Reaper
  { id: 'cr-page', section: 'Content Reaper', description: 'Product page renders', url: '/content-generator' },
  { id: 'cr-gate', section: 'Content Reaper', description: 'Access gate works correctly' },
  // Opportunity Hunter
  { id: 'oh-search', section: 'Opportunity Hunter', description: 'Search returns agency results', url: '/opportunity-hunter' },
  { id: 'oh-modal', section: 'Opportunity Hunter', description: 'Agency modal opens with details' },
  { id: 'oh-sat', section: 'Opportunity Hunter', description: 'SAT teaser column is blurred for free users' },
  // Contractor Database
  { id: 'db-gate', section: 'Contractor Database', description: 'Access gate requires purchase', url: '/contractor-database' },
  { id: 'db-search', section: 'Contractor Database', description: 'Search/filter works for authorized users' },
  // Recompete Tracker
  { id: 'rc-gate', section: 'Recompete Tracker', description: 'Access gate works', url: '/expiring-contracts' },
  { id: 'rc-list', section: 'Recompete Tracker', description: 'Contract list loads with USASpending links' },
  // Daily Briefings
  { id: 'br-gate', section: 'Daily Briefings', description: 'Email gate appears', url: '/briefings' },
  { id: 'br-dash', section: 'Daily Briefings', description: 'Dashboard loads for authorized users' },
  // Free Resources
  { id: 'fr-page', section: 'Free Resources', description: '11 resources listed', url: '/free-resources' },
  { id: 'fr-gate', section: 'Free Resources', description: 'Email capture modal appears before download' },
  { id: 'fr-download', section: 'Free Resources', description: 'At least one resource downloads successfully' },
  // Store
  { id: 'store-redirect', section: 'Store', description: 'Redirects to shop.govcongiants.org', url: '/store' },
  // Activate
  { id: 'activate-page', section: 'Activate', description: 'Email lookup works, shows tool list', url: '/activate' },
  // Bundles
  { id: 'bundle-starter', section: 'Bundles', description: 'Starter bundle page renders', url: '/bundles/starter' },
  { id: 'bundle-pro', section: 'Bundles', description: 'Pro Giant bundle page renders', url: '/bundles/pro-giant' },
  { id: 'bundle-ultimate', section: 'Bundles', description: 'Ultimate bundle page renders', url: '/bundles/ultimate' },
  { id: 'bundle-stripe', section: 'Bundles', description: 'Stripe payment links are correct on all bundles' },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function truncatePreview(obj: unknown, maxLen = 300): string {
  const s = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  return s.length > maxLen ? s.slice(0, maxLen) + '...' : s;
}

const CATEGORIES = [...new Set(TESTS.map((t) => t.category))];
const CHECKLIST_SECTIONS = [...new Set(DEFAULT_CHECKLIST.map((c) => c.section))];

// ── Component ──────────────────────────────────────────────────────────────

export default function TestProtocolClient({ commitSha }: { commitSha: string | null }) {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // Test state
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [running, setRunning] = useState(false);
  const [runningTestId, setRunningTestId] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());

  // Checklist state
  const [checklist, setChecklist] = useState<Record<string, { checked: boolean; notes: string }>>({});

  // Tab
  const [activeTab, setActiveTab] = useState<'tests' | 'checklist'>('tests');
  const firstFailRef = useRef<HTMLDivElement | null>(null);

  // ── Auth ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const stored = sessionStorage.getItem('adminPassword');
    if (stored) {
      fetch('/api/admin/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: stored }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.valid) {
            setAuthenticated(true);
            setPassword(stored);
          } else {
            sessionStorage.removeItem('adminPassword');
          }
        })
        .catch(() => {});
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      const r = await fetch('/api/admin/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const d = await r.json();
      if (d.valid) {
        setAuthenticated(true);
        sessionStorage.setItem('adminPassword', password);
      } else {
        setAuthError('Invalid password');
      }
    } catch {
      setAuthError('Failed to verify');
    }
  };

  // ── Persist / Load ──────────────────────────────────────────────────

  useEffect(() => {
    try {
      const saved = localStorage.getItem('test-protocol-results');
      if (saved) {
        const parsed = JSON.parse(saved);
        setResults(parsed.results || {});
        setLastRun(parsed.lastRun || null);
      }
    } catch {}
    try {
      const saved = localStorage.getItem('test-protocol-checklist');
      if (saved) setChecklist(JSON.parse(saved));
    } catch {}
  }, []);

  const persistResults = useCallback((r: Record<string, TestResult>, ts: string) => {
    localStorage.setItem('test-protocol-results', JSON.stringify({ results: r, lastRun: ts }));
  }, []);

  const persistChecklist = useCallback((c: Record<string, { checked: boolean; notes: string }>) => {
    localStorage.setItem('test-protocol-checklist', JSON.stringify(c));
  }, []);

  // ── Run Tests ───────────────────────────────────────────────────────

  const runSingleTest = async (test: TestDefinition): Promise<TestResult> => {
    const start = performance.now();
    try {
      const opts: RequestInit = { method: test.method, headers: { 'Content-Type': 'application/json' } };
      if (test.body) opts.body = JSON.stringify(test.body);
      const resp = await fetch(test.endpoint, opts);
      const elapsed = Math.round(performance.now() - start);
      let data: unknown;
      try {
        data = await resp.json();
      } catch {
        data = await resp.text();
      }
      const { pass, detail } = test.check(data, resp.status);
      return {
        id: test.id,
        status: pass ? 'pass' : 'fail',
        responseTime: elapsed,
        httpStatus: resp.status,
        detail,
        responsePreview: truncatePreview(data),
      };
    } catch (err) {
      return {
        id: test.id,
        status: 'fail',
        responseTime: Math.round(performance.now() - start),
        httpStatus: 0,
        detail: `Network error: ${err instanceof Error ? err.message : 'unknown'}`,
        responsePreview: '',
      };
    }
  };

  const runAllTests = async () => {
    setRunning(true);
    const newResults: Record<string, TestResult> = {};

    for (const test of TESTS) {
      setRunningTestId(test.id);
      const result = await runSingleTest(test);
      newResults[test.id] = result;
      setResults({ ...newResults });
      // Small delay to avoid hammering
      await new Promise((r) => setTimeout(r, 200));
    }

    const ts = new Date().toISOString();
    setLastRun(ts);
    setRunning(false);
    setRunningTestId(null);
    persistResults(newResults, ts);

    // Auto-scroll to first failure
    setTimeout(() => firstFailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  };

  const runOneTest = async (test: TestDefinition) => {
    setRunningTestId(test.id);
    const result = await runSingleTest(test);
    const newResults = { ...results, [test.id]: result };
    setResults(newResults);
    const ts = new Date().toISOString();
    setLastRun(ts);
    setRunningTestId(null);
    persistResults(newResults, ts);
  };

  // ── Checklist Handlers ──────────────────────────────────────────────

  const toggleCheck = (id: string) => {
    const updated = { ...checklist, [id]: { checked: !checklist[id]?.checked, notes: checklist[id]?.notes || '' } };
    setChecklist(updated);
    persistChecklist(updated);
  };

  const updateNotes = (id: string, notes: string) => {
    const updated = { ...checklist, [id]: { checked: checklist[id]?.checked || false, notes } };
    setChecklist(updated);
    persistChecklist(updated);
  };

  const resetChecklist = () => {
    setChecklist({});
    localStorage.removeItem('test-protocol-checklist');
  };

  // ── Computed Stats ──────────────────────────────────────────────────

  const passed = Object.values(results).filter((r) => r.status === 'pass').length;
  const failed = Object.values(results).filter((r) => r.status === 'fail').length;
  const warnings = Object.values(results).filter((r) => r.status === 'warning').length;
  const pending = TESTS.length - Object.keys(results).length;

  const checklistTotal = DEFAULT_CHECKLIST.length;
  const checklistDone = DEFAULT_CHECKLIST.filter((c) => checklist[c.id]?.checked).length;

  // ── Render: Auth Gate ───────────────────────────────────────────────

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-xl p-8 max-w-md w-full">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-white">Test Protocol</h1>
            <p className="text-slate-400 text-sm mt-2">Enter admin password to continue</p>
          </div>
          <form onSubmit={handleLogin}>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Admin password"
              className="w-full px-4 py-3 border border-slate-600 rounded-lg mb-4 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-white bg-slate-700 placeholder-slate-400"
              autoFocus
            />
            {authError && <p className="text-red-400 text-sm mb-4">{authError}</p>}
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 px-6 rounded-lg font-bold transition-colors">
              Login
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Render: Main Dashboard ──────────────────────────────────────────

  const statusColor = (s: TestResult['status']) => {
    if (s === 'pass') return 'text-green-400';
    if (s === 'fail') return 'text-red-400';
    if (s === 'warning') return 'text-yellow-400';
    return 'text-slate-500';
  };

  const statusBg = (s: TestResult['status']) => {
    if (s === 'pass') return 'bg-green-900/30 border-green-800';
    if (s === 'fail') return 'bg-red-900/30 border-red-800';
    if (s === 'warning') return 'bg-yellow-900/30 border-yellow-800';
    return 'bg-slate-800 border-slate-700';
  };

  const statusDot = (s: TestResult['status']) => {
    if (s === 'pass') return 'bg-green-400';
    if (s === 'fail') return 'bg-red-400';
    if (s === 'warning') return 'bg-yellow-400';
    return 'bg-slate-600';
  };

  let firstFailFound = false;

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Test Protocol</h1>
            <p className="text-slate-400 text-sm mt-1">API smoke tests + manual QA checklist</p>
          </div>
          <button
            onClick={() => {
              sessionStorage.removeItem('adminPassword');
              setAuthenticated(false);
              setPassword('');
            }}
            className="text-sm text-slate-400 hover:text-white border border-slate-700 px-3 py-1.5 rounded-lg transition-colors"
          >
            Logout
          </button>
        </div>

        {/* Deploy Info */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 mb-6 flex items-center gap-6 text-sm">
          <div>
            <span className="text-slate-400">Commit: </span>
            <span className="font-mono text-blue-400">{commitSha ? commitSha.slice(0, 7) : 'local'}</span>
          </div>
          <div>
            <span className="text-slate-400">Host: </span>
            <span className="font-mono text-blue-400">{typeof window !== 'undefined' ? window.location.hostname : ''}</span>
          </div>
          {lastRun && (
            <div>
              <span className="text-slate-400">Last run: </span>
              <span className="text-slate-300">{new Date(lastRun).toLocaleString()}</span>
            </div>
          )}
        </div>

        {/* Summary Bar */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 mb-6 flex items-center gap-6">
          <span className="text-green-400 font-bold">{passed} passed</span>
          <span className="text-red-400 font-bold">{failed} failed</span>
          {warnings > 0 && <span className="text-yellow-400 font-bold">{warnings} warnings</span>}
          {pending > 0 && <span className="text-slate-500">{pending} pending</span>}
          <div className="ml-auto flex items-center gap-3">
            <span className="text-slate-400 text-sm">Checklist: {checklistDone}/{checklistTotal}</span>
            <button
              onClick={runAllTests}
              disabled={running}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:text-blue-400 text-white px-4 py-2 rounded-lg font-bold text-sm transition-colors"
            >
              {running ? 'Running...' : 'Run All Tests'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('tests')}
            className={`px-4 py-2 rounded-lg font-semibold text-sm transition-colors ${
              activeTab === 'tests' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            API Tests ({TESTS.length})
          </button>
          <button
            onClick={() => setActiveTab('checklist')}
            className={`px-4 py-2 rounded-lg font-semibold text-sm transition-colors ${
              activeTab === 'checklist' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            Manual Checklist ({checklistDone}/{checklistTotal})
          </button>
        </div>

        {/* ── API Tests Tab ────────────────────────────────────────────── */}
        {activeTab === 'tests' && (
          <div className="space-y-6">
            {CATEGORIES.map((cat) => (
              <div key={cat}>
                <h2 className="text-lg font-bold text-slate-300 mb-3">{cat}</h2>
                <div className="space-y-2">
                  {TESTS.filter((t) => t.category === cat).map((test) => {
                    const result = results[test.id];
                    const isRunning = runningTestId === test.id;
                    const isExpanded = expandedResults.has(test.id);
                    const isFirstFail = result?.status === 'fail' && !firstFailFound;
                    if (isFirstFail) firstFailFound = true;

                    return (
                      <div
                        key={test.id}
                        ref={isFirstFail ? firstFailRef : undefined}
                        className={`border rounded-lg px-4 py-3 ${result ? statusBg(result.status) : 'bg-slate-800 border-slate-700'}`}
                      >
                        <div className="flex items-center gap-3">
                          {/* Status dot */}
                          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${result ? statusDot(result.status) : 'bg-slate-600'} ${isRunning ? 'animate-pulse' : ''}`} />

                          {/* Name & endpoint */}
                          <div className="flex-1 min-w-0">
                            <span className="font-semibold text-sm">{test.name}</span>
                            <span className="text-slate-500 text-xs ml-2 font-mono">
                              {test.method} {test.endpoint.length > 50 ? test.endpoint.slice(0, 50) + '...' : test.endpoint}
                            </span>
                          </div>

                          {/* Result info */}
                          {result && (
                            <div className="flex items-center gap-3 text-xs flex-shrink-0">
                              <span className={statusColor(result.status)}>{result.detail}</span>
                              <span className="text-slate-500">HTTP {result.httpStatus}</span>
                              <span className="text-slate-500">{result.responseTime}ms</span>
                              <button
                                onClick={() => {
                                  const next = new Set(expandedResults);
                                  isExpanded ? next.delete(test.id) : next.add(test.id);
                                  setExpandedResults(next);
                                }}
                                className="text-slate-500 hover:text-slate-300 transition-colors"
                              >
                                {isExpanded ? 'Hide' : 'Show'}
                              </button>
                            </div>
                          )}

                          {/* Run button */}
                          <button
                            onClick={() => runOneTest(test)}
                            disabled={running}
                            className="text-xs text-blue-400 hover:text-blue-300 disabled:text-slate-600 font-semibold flex-shrink-0 transition-colors"
                          >
                            {isRunning ? 'Running...' : 'Run'}
                          </button>
                        </div>

                        {/* Expanded response preview */}
                        {isExpanded && result && (
                          <pre className="mt-3 text-xs text-slate-400 bg-slate-900/50 rounded p-3 overflow-x-auto max-h-48 whitespace-pre-wrap">
                            {result.responsePreview || '(empty response)'}
                          </pre>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Manual Checklist Tab ─────────────────────────────────────── */}
        {activeTab === 'checklist' && (
          <div className="space-y-6">
            {/* Progress bar */}
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-300 font-semibold">Progress: {checklistDone}/{checklistTotal}</span>
                <button onClick={resetChecklist} className="text-xs text-slate-500 hover:text-red-400 transition-colors">
                  Reset All
                </button>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-2">
                <div
                  className="bg-green-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${checklistTotal > 0 ? (checklistDone / checklistTotal) * 100 : 0}%` }}
                />
              </div>
            </div>

            {CHECKLIST_SECTIONS.map((section) => (
              <div key={section}>
                <h2 className="text-lg font-bold text-slate-300 mb-3">{section}</h2>
                <div className="space-y-2">
                  {DEFAULT_CHECKLIST.filter((c) => c.section === section).map((item) => {
                    const state = checklist[item.id] || { checked: false, notes: '' };
                    return (
                      <div key={item.id} className={`border rounded-lg px-4 py-3 ${state.checked ? 'bg-green-900/20 border-green-800/50' : 'bg-slate-800 border-slate-700'}`}>
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={state.checked}
                            onChange={() => toggleCheck(item.id)}
                            className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-green-500 focus:ring-green-500 focus:ring-offset-0 cursor-pointer"
                          />
                          <span className={`flex-1 text-sm ${state.checked ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{item.description}</span>
                          {item.url && (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-400 hover:text-blue-300 font-semibold flex-shrink-0 transition-colors"
                            >
                              Open
                            </a>
                          )}
                        </div>
                        <div className="mt-2 ml-7">
                          <textarea
                            value={state.notes}
                            onChange={(e) => updateNotes(item.id, e.target.value)}
                            placeholder="Notes..."
                            rows={1}
                            className="w-full text-xs bg-slate-900/50 border border-slate-700 rounded px-2 py-1.5 text-slate-400 placeholder-slate-600 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 resize-none"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
