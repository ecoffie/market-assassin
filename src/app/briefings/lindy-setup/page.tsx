import type { Metadata } from 'next';
import ConnectionKeyCard from './ConnectionKeyCard';

export const metadata: Metadata = {
  title: 'Connect Briefings to Lindy AI | GovCon Giants',
  description: 'Set up automated briefing delivery to Lindy AI, Zapier, Make, or any automation tool.',
};

export default function LindySetupPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold mb-2">
          Connect Your Briefings to Lindy AI
        </h1>
        <p className="text-gray-400 mb-10">
          Your daily GovCon briefings are available as structured JSON. Connect them to Lindy, Zapier, Make,
          n8n, or any automation platform with a connection key that only reads your own briefings.
        </p>

        {/* Step 1: connection key */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Step 1: Create a connection key</h2>
          <ConnectionKeyCard />
        </section>

        {/* API Endpoint */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Your Briefing API</h2>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 font-mono text-sm overflow-x-auto">
            <p className="text-green-400 mb-2"># Today&apos;s intelligence</p>
            <p className="text-gray-300">GET https://getmindy.ai/api/lindy/intelligence</p>
            <p className="text-gray-300">
              Authorization: Bearer <span className="text-amber-400">YOUR_CONNECTION_KEY</span>
            </p>
            <p className="text-green-400 mt-4 mb-2"># Last 7 days</p>
            <p className="text-gray-300">GET https://getmindy.ai/api/lindy/intelligence?days=7</p>
          </div>
          <p className="text-gray-500 text-sm mt-2">
            The key always returns your own data. An email address in the URL is never accepted as a login.
          </p>
        </section>

        {/* Option A */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-1">Option A: Email Forwarding (Easiest, no key needed)</h2>
          <p className="text-gray-400 text-sm mb-3">Best for conversational Q&amp;A with your briefings</p>
          <ol className="list-decimal list-inside space-y-2 text-gray-300">
            <li>In Lindy, create a new agent with an <strong className="text-white">&quot;Email Received&quot;</strong> trigger</li>
            <li>Set it to watch for emails from <code className="text-amber-400 bg-gray-900 px-1.5 py-0.5 rounded">alerts@mail.getmindy.ai</code></li>
            <li>Lindy reads each briefing email and adds it to your knowledge base</li>
            <li>Ask your Lindy agent questions about your briefings anytime</li>
          </ol>
        </section>

        {/* Option B */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-1">Option B: API Polling (Structured Data)</h2>
          <p className="text-gray-400 text-sm mb-3">Best for automations that need structured fields (agencies, amounts, deadlines)</p>
          <ol className="list-decimal list-inside space-y-2 text-gray-300">
            <li>Create a connection key (Step 1) and keep it somewhere safe</li>
            <li>In Lindy, create an agent with a <strong className="text-white">&quot;Scheduled&quot;</strong> trigger (daily, after 9 AM UTC)</li>
            <li>Add an <strong className="text-white">&quot;HTTP Request&quot;</strong> action: GET the API URL above, with the header <code className="text-amber-400 bg-gray-900 px-1.5 py-0.5 rounded">Authorization: Bearer YOUR_CONNECTION_KEY</code></li>
            <li>Connect the response to a <strong className="text-white">Knowledge Base</strong> action</li>
          </ol>
        </section>

        {/* Option C */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-1">Option C: Works with Any Tool</h2>
          <p className="text-gray-400 text-sm mb-3">Zapier, Make, n8n, or custom scripts</p>
          <p className="text-gray-300">
            Same API, same header. Poll daily, get JSON, and route it wherever you want. If a key is ever exposed,
            revoke it in your account and create a new one.
          </p>
        </section>

        {/* What you can do */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">What You Can Do</h2>
          <ul className="space-y-2 text-gray-300">
            <li className="flex items-start gap-2">
              <span className="text-amber-400 mt-0.5">-</span>
              Ask &quot;What contracts are expiring this week?&quot; via text, phone, or chat
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-400 mt-0.5">-</span>
              Auto-create calendar reminders for deadlines
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-400 mt-0.5">-</span>
              Forward urgent opportunities to your CRM
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-400 mt-0.5">-</span>
              Get a phone call summary of today&apos;s top items
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-400 mt-0.5">-</span>
              Build a Slack bot that answers GovCon questions from your briefing history
            </li>
          </ul>
        </section>

        {/* Response shape */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">API Response Shape</h2>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 font-mono text-sm overflow-x-auto">
            <pre className="text-gray-300">{`{
  "as_of": "2026-10-04T09:30:00Z",
  "user_email": "you@yourcompany.com",
  "has_full_access": true,
  "profile_summary": { "naics_codes": [...], "agencies": [...], "watched_companies": [...] },
  "briefing": {
    "date": "2026-10-04",
    "headline": "3 High-Priority Recompetes This Week",
    "urgent_alerts": 2,
    "top_items": [...]
  },
  "recompetes": { "critical": [...], "high": [...], "upcoming": [...], "total_count": 14 },
  "contractor_activity": { ... },
  "recommended_actions": [...],
  "meta": { "data_freshness": { ... }, "next_briefing_at": "...", "api_version": "..." }
}`}</pre>
          </div>
        </section>

        {/* Need help */}
        <section className="border-t border-gray-800 pt-8">
          <p className="text-gray-400">
            Need help setting this up? Email{' '}
            <a href="mailto:hello@getmindy.ai" className="text-amber-400 hover:underline">
              hello@getmindy.ai
            </a>{' '}
            and we&apos;ll walk you through it.
          </p>
        </section>
      </div>
    </div>
  );
}
