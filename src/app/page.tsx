import Script from "next/script";
import { AuthRecoveryRedirect } from "./AuthRecoveryRedirect";

/**
 * `/` on every host EXCEPT getmindy.ai (which rewrites `/` → `/today` in next.config.ts).
 *
 * This page used to render the old GovCon Giants "Government Contracting Intelligence
 * Tools" card grid — the combined Market Assassin interface — and it was still live on
 * `market-assassin.vercel.app/` in 2026-09 (see src/lib/mindy/legacy-routes.ts). It now only
 * forwards: Supabase auth tokens in the hash go to the matching getmindy.ai auth page (the
 * behaviour this page always had), and everyone else goes to the Mindy workspace.
 *
 * Client-side on purpose: the URL fragment never reaches the server, so a server redirect
 * would run before the token check and could strand a password-reset link.
 */
export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      <Script id="auth-recovery-redirect" strategy="beforeInteractive">
        {`
          (function () {
            var hash = window.location.hash || '';
            if (hash && hash.charAt(0) === '#') {
              var params = new URLSearchParams(hash.slice(1));
              if (params.get('access_token')) {
                var type = params.get('type');
                var path = type === 'recovery'
                  ? '/app/reset-password'
                  : (type === 'invite' || type === 'signup'
                    ? '/app/setup-password'
                    : (type === 'magiclink' ? '/app' : null));
                if (path) { window.location.replace('https://getmindy.ai' + path + hash); return; }
              }
            }
            // Production aliases of this deployment belong on the canonical domain, where the
            // customer's session lives. Local and preview hosts stay on their own origin.
            var h = window.location.hostname;
            var canonical = h === 'market-assassin.vercel.app' || /(^|\\.)govcongiants\\.com$/.test(h);
            window.location.replace((canonical ? 'https://getmindy.ai' : '') + '/app' + window.location.search);
          })();
        `}
      </Script>
      <AuthRecoveryRedirect />
      <main className="flex min-h-screen items-center justify-center px-6">
        <p className="text-slate-600">
          Opening Mindy… <a href="/app" className="text-blue-600 underline">Continue to your workspace</a>
        </p>
      </main>
    </div>
  );
}
