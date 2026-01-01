'use client';

import { useState, useEffect } from 'react';

interface PasswordProtectProps {
  children: React.ReactNode;
  toolName: string;
  storageKey: string;
}

// Passwords for protected tools
const TOOL_PASSWORDS: Record<string, string> = {
  'fma-authenticated': 'govcon#2026',      // Federal Market Assassin
  'fcd-authenticated': 'underdog#2026',    // Federal Contractor Database
};

export default function PasswordProtect({ children, toolName, storageKey }: PasswordProtectProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check if already authenticated in this session
    const authenticated = sessionStorage.getItem(storageKey);
    if (authenticated === 'true') {
      setIsAuthenticated(true);
    }
    setIsLoading(false);
  }, [storageKey]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const correctPassword = TOOL_PASSWORDS[storageKey] || '';
    if (password === correctPassword) {
      sessionStorage.setItem(storageKey, 'true');
      setIsAuthenticated(true);
      setError('');
    } else {
      setError('Incorrect password. Please try again.');
      setPassword('');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  if (isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center px-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8 max-w-md w-full shadow-2xl">
        <div className="text-center mb-8">
          <div className="mb-4">
            <span className="text-3xl font-bold text-blue-400">GovCon</span>
            <span className="text-3xl font-bold text-amber-400">Giants</span>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">{toolName}</h1>
          <p className="text-slate-400">This tool is password protected</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-2">
              Enter Password
            </label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter access password"
              autoFocus
            />
          </div>

          {error && (
            <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
          >
            Access Tool
          </button>
        </form>

        <div className="mt-6 text-center">
          <a
            href="/"
            className="text-slate-400 hover:text-slate-300 text-sm transition-colors"
          >
            ← Back to Tools
          </a>
        </div>
      </div>
    </div>
  );
}
