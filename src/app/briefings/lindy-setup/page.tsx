import type { Metadata } from 'next';

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
          Your daily GovCon briefings are available as structured JSON via API.
          Connect them to Lindy, Zapier, Make, n8n, or any automation platform.
        </p>

        {/* API Endpoint */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Your Briefing API</h2>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 font-mono text-sm overflow-x-auto">
            <p className="text-green-400 mb-2"># Latest briefing</p>
            <p className="text-gray-300">
              GET https://tools.govcongiants.org/api/briefings/latest?email=<span className="text-amber-400">YOUR_EMAIL</span>
            </p>
            <p className="text-green-400 mt-4 mb-2"># Last 7 days</p>
            <p className="text-gray-300">
              GET https://tools.govcongiants.org/api/briefings/latest?email=<span className="text-amber-400">YOUR_EMAIL</span>&days=7
            </p>
          </div>
          <p className="text-gray-500 text-sm mt-2">
            Access is gated to your subscriber email. Max 30 days of history.
          </p>
        </section>

        {/* Option A */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-1">Option A: Email Forwarding (Easiest)</h2>
          <p className="text-gray-400 text-sm mb-3">Best for conversational Q&A with your briefings</p>
          <ol className="list-decimal list-inside space-y-2 text-gray-300">
            <li>In Lindy, create a new agent with an <strong className="text-white">&quot;Email Received&quot;</strong> trigger</li>
            <li>Set it to watch for emails from <code className="text-amber-400 bg-gray-900 px-1.5 py-0.5 rounded">hello@govconedu.com</code></li>
            <li>Lindy automatically reads your briefing email and adds it to your knowledge base</li>
            <li>Ask your Lindy agent questions about your briefings anytime</li>
          </ol>
        </section>

        {/* Option B */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-1">Option B: API Polling (Structured Data)</h2>
          <p className="text-gray-400 text-sm mb-3">Best for automations that need structured fields (agencies, amounts, deadlines)</p>
          <ol className="list-decimal list-inside space-y-2 text-gray-300">
            <li>In Lindy, create an agent with a <strong className="text-white">&quot;Scheduled&quot;</strong> trigger (daily, after 9 AM UTC)</li>
            <li>Add an <strong className="text-white">&quot;HTTP Request&quot;</strong> action: GET the API URL above</li>
            <li>Connect the response to a <strong className="text-white">Knowledge Base</strong> action</li>
            <li>Now Lindy has your structured briefing data — agencies, amounts, deadlines, relevance scores</li>
          </ol>
        </section>

        {/* Option C */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-1">Option C: Works with Any Tool</h2>
          <p className="text-gray-400 text-sm mb-3">Zapier, Make, n8n, or custom scripts</p>
          <p className="text-gray-300">
            The same API works with any automation platform. Poll daily, get JSON, route to wherever you want.
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
  "success": true,
  "briefing_date": "2026-03-10",
  "generated_at": "2026-03-10T09:00:00Z",
  "briefing": {
    "summary": {
      "headline": "3 High-Priority Recompetes This Week",
      "subheadline": "...",
      "quickStats": [...],
      "urgentAlerts": 2
    },
    "topItems": [...],
    "categorizedItems": { ... },
    "totalItems": 15,
    "sourcesIncluded": ["fpds", "sam_gov", "web_intel"]
  }
}`}</pre>
          </div>
        </section>

        {/* Need help */}
        <section className="border-t border-gray-800 pt-8">
          <p className="text-gray-400">
            Need help setting this up? Email{' '}
            <a href="mailto:service@govcongiants.com" className="text-amber-400 hover:underline">
              service@govcongiants.com
            </a>{' '}
            and we&apos;ll walk you through it.
          </p>
        </section>
      </div>
    </div>
  );
}
