'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function DatabaseLockedPage() {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/verify-db-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (data.success) {
        window.location.href = '/database.html';
      } else {
        setError(data.error || 'Invalid password');
      }
    } catch {
      setError('Failed to verify password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center px-5 py-16">
      <div className="bg-(--mp-surface) border border-(--mp-line) p-10 max-w-lg text-center">
        <div className="text-6xl mb-5">🔒</div>
        <h1 className="font-(family-name:--mp-font-serif) text-(--mp-ink) mb-3 text-3xl font-bold">
          Federal Contractor Database
        </h1>
        <p className="text-(--mp-body) mb-8 text-base leading-relaxed">
          Access to this database requires a password. Get lifetime access to 3,500+ federal contractors for teaming opportunities.
        </p>

        <div className="bg-(--mp-wash) border border-(--mp-line) p-5 mb-8 text-left">
          <h3 className="text-(--mp-ink) mt-0 mb-3 font-semibold">What&apos;s Included:</h3>
          <ul className="text-(--mp-body) m-0 pl-5 leading-loose text-sm list-disc">
            <li><strong>3,500+</strong> federal contractors</li>
            <li><strong>$430B+</strong> in contract data</li>
            <li><strong>800+</strong> SBLO contacts with emails</li>
            <li><strong>115+</strong> supplier portal links</li>
            <li>Export to CSV for outreach</li>
            <li>Lifetime access</li>
          </ul>
        </div>


        <div className="mt-8 pt-6 border-t border-(--mp-line)">
          <p className="text-(--mp-muted) text-sm mb-4">Already have access? Enter your email:</p>
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              type="email"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="your@email.com"
              className="flex-1 px-4 py-3 border border-(--mp-line) bg-(--mp-surface) text-(--mp-ink) placeholder:text-(--mp-subtle) rounded-[8px] text-center"
            />
            <button
              type="submit"
              disabled={loading || !password}
              className="px-6 py-3 bg-(--mp-navy) hover:bg-(--mp-navy-hover) text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? '...' : 'Unlock'}
            </button>
          </form>
          {error && (
            <p className="text-(--mp-crit) text-sm mt-3">{error}</p>
          )}
        </div>

        <p className="text-(--mp-muted) text-xs mt-6">
          <Link href="/" className="text-(--mp-navy) hover:underline">
            ← Back to Home
          </Link>
        </p>
      </div>
    </div>
  );
}
