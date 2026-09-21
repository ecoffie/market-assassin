import { Suspense } from 'react';
import AccessClient from './AccessClient';

export default function AccessPage() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <Suspense
        fallback={
          <div className="max-w-md w-full rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center">
            <h1 className="text-2xl font-bold text-white mb-3">Secure Access</h1>
            <p className="text-slate-300">Loading secure link...</p>
          </div>
        }
      >
        <AccessClient />
      </Suspense>
    </div>
  );
}
