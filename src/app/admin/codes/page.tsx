'use client';

import { useState, useEffect } from 'react';

interface AccessCode {
  code: string;
  email: string;
  companyName?: string;
  createdAt: string;
  usedAt?: string;
  used: boolean;
}

export default function AdminCodesPage() {
  const [password, setPassword] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [codes, setCodes] = useState<AccessCode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // New code form
  const [newEmail, setNewEmail] = useState('');
  const [newCompanyName, setNewCompanyName] = useState('');
  const [createdCode, setCreatedCode] = useState<{ code: string; link: string } | null>(null);

  const fetchCodes = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/access-codes?admin=true&password=${password}`);
      const data = await response.json();

      if (data.success) {
        setCodes(data.codes);
        setAuthenticated(true);
        setError('');
      } else {
        setError(data.error || 'Failed to authenticate');
        setAuthenticated(false);
      }
    } catch (err) {
      setError('Failed to fetch codes');
    } finally {
      setLoading(false);
    }
  };

  const createCode = async () => {
    if (!newEmail) {
      setError('Email is required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/access-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          password,
          email: newEmail,
          companyName: newCompanyName,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setCreatedCode({
          code: data.accessCode.code,
          link: data.accessLink,
        });
        setNewEmail('');
        setNewCompanyName('');
        fetchCodes(); // Refresh the list
      } else {
        setError(data.error || 'Failed to create code');
      }
    } catch (err) {
      setError('Failed to create code');
    } finally {
      setLoading(false);
    }
  };

  const deleteCode = async (code: string) => {
    if (!confirm('Are you sure you want to delete this code?')) return;

    try {
      const response = await fetch(`/api/access-codes?code=${code}&password=${password}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (data.success) {
        fetchCodes();
      } else {
        setError(data.error || 'Failed to delete code');
      }
    } catch (err) {
      setError('Failed to delete code');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  // Login form
  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-2xl p-8 max-w-md w-full">
          <div className="text-center mb-6">
            <span className="text-2xl font-bold text-blue-700">GovCon</span>
            <span className="text-2xl font-bold text-amber-500">Giants</span>
            <h1 className="text-xl font-bold text-slate-900 mt-2">Admin Access</h1>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
              {error}
            </div>
          )}

          <input
            type="password"
            placeholder="Admin Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchCodes()}
            className="w-full px-4 py-3 border border-slate-300 rounded-lg mb-4 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />

          <button
            onClick={fetchCodes}
            disabled={loading || !password}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Authenticating...' : 'Login'}
          </button>
        </div>
      </div>
    );
  }

  // Admin dashboard
  return (
    <div className="min-h-screen bg-slate-100 p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <span className="text-2xl font-bold text-blue-700">GovCon</span>
            <span className="text-2xl font-bold text-amber-500">Giants</span>
            <h1 className="text-3xl font-bold text-slate-900 mt-1">Access Code Manager</h1>
          </div>
          <button
            onClick={() => setAuthenticated(false)}
            className="text-slate-600 hover:text-slate-900"
          >
            Logout
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Create New Code */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-8">
          <h2 className="text-xl font-bold text-slate-900 mb-4">Generate New Access Code</h2>

          <div className="grid md:grid-cols-3 gap-4">
            <input
              type="email"
              placeholder="Customer Email *"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <input
              type="text"
              placeholder="Company Name (optional)"
              value={newCompanyName}
              onChange={(e) => setNewCompanyName(e.target.value)}
              className="px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <button
              onClick={createCode}
              disabled={loading || !newEmail}
              className="bg-green-600 text-white py-3 px-6 rounded-lg font-semibold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating...' : 'Generate Code'}
            </button>
          </div>

          {/* Newly created code */}
          {createdCode && (
            <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-green-800 font-semibold mb-2">Access Code Created!</p>
              <div className="flex items-center gap-4 flex-wrap">
                <div>
                  <span className="text-sm text-slate-600">Code:</span>
                  <code className="ml-2 bg-white px-3 py-1 rounded border font-mono">{createdCode.code}</code>
                </div>
                <button
                  onClick={() => copyToClipboard(createdCode.link)}
                  className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
                >
                  Copy Link
                </button>
              </div>
              <p className="text-sm text-slate-600 mt-2 break-all">
                <strong>Link:</strong> {createdCode.link}
              </p>
            </div>
          )}
        </div>

        {/* Codes List */}
        <div className="bg-white rounded-xl shadow-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-slate-900">Access Codes</h2>
            <button
              onClick={fetchCodes}
              className="text-blue-600 hover:text-blue-800"
            >
              Refresh
            </button>
          </div>

          {codes.length === 0 ? (
            <p className="text-slate-500 text-center py-8">No access codes generated yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-3 px-4 font-semibold text-slate-600">Code</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-600">Email</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-600">Company</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-600">Status</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-600">Created</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {codes.map((code) => (
                    <tr key={code.code} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-3 px-4">
                        <code className="bg-slate-100 px-2 py-1 rounded font-mono text-sm">{code.code}</code>
                      </td>
                      <td className="py-3 px-4 text-slate-600">{code.email}</td>
                      <td className="py-3 px-4 text-slate-600">{code.companyName || '-'}</td>
                      <td className="py-3 px-4">
                        {code.used ? (
                          <span className="bg-red-100 text-red-700 px-2 py-1 rounded text-sm font-medium">
                            Used
                          </span>
                        ) : (
                          <span className="bg-green-100 text-green-700 px-2 py-1 rounded text-sm font-medium">
                            Available
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-500 text-sm">
                        {new Date(code.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex gap-2">
                          <button
                            onClick={() => copyToClipboard(`${window.location.origin}/access/${code.code}`)}
                            className="text-blue-600 hover:text-blue-800 text-sm"
                          >
                            Copy Link
                          </button>
                          <button
                            onClick={() => deleteCode(code.code)}
                            className="text-red-600 hover:text-red-800 text-sm"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="mt-6 grid md:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-blue-600">{codes.length}</div>
            <div className="text-slate-600">Total Codes</div>
          </div>
          <div className="bg-white rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-green-600">{codes.filter(c => !c.used).length}</div>
            <div className="text-slate-600">Available</div>
          </div>
          <div className="bg-white rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-red-600">{codes.filter(c => c.used).length}</div>
            <div className="text-slate-600">Used</div>
          </div>
        </div>
      </div>
    </div>
  );
}
