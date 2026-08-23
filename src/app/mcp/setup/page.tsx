/**
 * getmindy.ai/mcp/setup — the picture-by-picture connect guide.
 *
 * Lives INSIDE the MCP environment (McpNav, the /mcp dark design system) rather than as a
 * static file at the site root, so it reads as a native sibling of Connect / Overview /
 * Pricing and inherits the same header, theme and navigation.
 *
 * WHY IT EXISTS: /mcp's Connect card gives three terse steps — enough for a developer,
 * not enough for a contractor. This is every click, with a screenshot for each one, for
 * BOTH Claude and ChatGPT. ChatGPT is the harder flow (developer mode must be enabled
 * before the plugin option appears at all) and had no coverage anywhere else.
 *
 * Screenshots are real files in /public/mcp-setup (extracted from the source guide) rather
 * than base64 — smaller HTML, and the browser can cache them.
 */
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { McpNav } from '../catalog-ui';

export const metadata: Metadata = {
  title: 'Add Mindy to Claude or ChatGPT — setup guide | Mindy MCP',
  description:
    'Every click, with screenshots: connect Mindy to Claude or ChatGPT and pull real federal contracting data into your chat. One-time setup, no coding, free account.',
  alternates: { canonical: 'https://getmindy.ai/mcp/setup' },
  openGraph: {
    title: 'Add Mindy to Claude or ChatGPT',
    description: 'One-time setup, no coding. Real federal contracting data inside the AI you already use.',
    url: 'https://getmindy.ai/mcp/setup',
    type: 'article',
  },
};

const MCP_URL = 'https://mcp.getmindy.ai/mcp';

interface Step { n: number; title: string; body: string; img?: string }

/**
 * Bold the UI targets inside step copy. A setup guide is scanned, not read — the reader
 * is hunting for the thing to click, so "Settings" and "⌘ + ," must pop out of the
 * sentence. Wrap them in *asterisks* in the copy above and they render bold here.
 */
function emphasize(body: string) {
  return body.split(/(\*[^*]+\*)/g).map((part, i) =>
    part.startsWith('*') && part.endsWith('*') && part.length > 2
      ? <strong key={i} className="font-semibold text-slate-200">{part.slice(1, -1)}</strong>
      : <span key={i}>{part}</span>,
  );
}

const CLAUDE: Step[] = [
  { n: 1, title: 'Open Settings', body: 'Click your name in the bottom-left corner, then *Settings* (or press *⌘ + ,*).', img: 'step-01.jpg' },
  { n: 2, title: 'Go to Connectors', body: 'In the Settings window, look down the left sidebar. Under *Customize*, click *Connectors*.', img: 'step-02.jpg' },
  { n: 3, title: 'Click "Add", then "Browse connectors"', body: 'The *Add* button is at the top right of the Connectors page.', img: 'step-03.jpg' },
  { n: 4, title: 'Find Mindy and click "Connect to Claude"', body: 'Search *mindy*, open the Mindy result, and click the orange *Connect to Claude* button.', img: 'step-04.jpg' },
  { n: 5, title: 'Create your free Mindy account', body: 'A Mindy window opens. Create a free account — 100 credits, no card — with Google, Microsoft, or email. Already have one? Just sign in.', img: 'step-05.jpg' },
  { n: 6, title: 'Allow the connection', body: 'Mindy asks to connect to your account. Click *Allow*.', img: 'step-06.jpg' },
  { n: 7, title: 'Connected', body: 'Back in Claude you will see Mindy marked *Connected* with a green check.', img: 'step-07.jpg' },
  { n: 8, title: 'Set Mindy to "Always allow" (recommended)', body: 'By default Claude asks permission on every Mindy call. On the Mindy connector page, open the *Read-only tools* dropdown and choose *Always allow* so Mindy just works.', img: 'step-08.jpg' },
];

const CHATGPT: Step[] = [
  { n: 1, title: 'First, turn on Developer mode', body: 'You must do this before you can add Mindy. *Settings → Security and login → Developer mode*, and switch it on. You will see an "elevated risk" warning — that is ChatGPT’s standard notice for any custom tool. Mindy is safe; continue.', img: 'step-09.jpg' },
  { n: 2, title: 'Go back to Plugins and add Mindy', body: 'With Developer mode on, the custom-plugin option now works. Open *Plugins*, click the *+* at the top right. Name it *Mindy*, set *Connection → Server URL* to the address below, set *Authentication* to *OAuth*, agree to continue, and click *Create*.', img: 'step-10.jpg' },
  { n: 3, title: 'Click "Sign in with Mindy"', body: 'This is the step that connects the plugin to your account.', img: 'step-11.jpg' },
  { n: 4, title: 'Create your free Mindy account (or sign in)', body: 'A Mindy window opens. Create a free account — 100 credits, no card — or sign in if you already have one. When you finish, it connects back to ChatGPT automatically.', img: 'step-12.jpg' },
  { n: 5, title: 'Allow permissions', body: 'Choose what Mindy is allowed to do. Pick *Allow low-risk actions* (the default) — Mindy can pull federal data without nagging you, and still asks before anything sensitive.', img: 'step-13.jpg' },
  { n: 6, title: 'Done — Mindy is connected', body: 'You will see Mindy connected, with its permissions set. Turn it on in a chat and ask away — same as Claude.', img: 'step-14.jpg' },
];

function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="mt-6 space-y-8">
      {steps.map((s) => (
        <li key={s.n}>
          <div className="flex items-start gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-500 text-[13px] font-bold text-[#06120c]">{s.n}</span>
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-slate-100">{s.title}</h3>
              <p className="mt-1 text-[14px] leading-relaxed text-slate-400">{emphasize(s.body)}</p>
            </div>
          </div>
          {s.img && (
            <div className="mt-3 max-w-[460px] overflow-hidden rounded-xl border border-white/[0.08] bg-white sm:ml-10">
              <Image
                src={`/mcp-setup/${s.img}`}
                alt={s.title}
                width={1400}
                height={900}
                className="h-auto w-full max-h-[340px] object-cover object-top"
                unoptimized
              />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

export default function McpSetupPage() {
  return (
    <main className="min-h-screen bg-[#0a0f1e] text-slate-200">
      <div className="mx-auto max-w-3xl px-5 py-8 sm:px-6">
        <McpNav active="connect" />

        <div className="mt-10">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-emerald-400">Setup guide</p>
          <h1 className="mt-2 text-[30px] font-bold leading-tight text-white sm:text-[36px]">Put Mindy inside your AI assistant</h1>
          <p className="mt-3 text-[16px] leading-relaxed text-slate-400">
            Ask Mindy for real federal-contracting data right inside Claude or ChatGPT. One-time setup. No coding.
          </p>
        </div>

        {/* The address, once, up top */}
        <div className="mt-6 rounded-xl border border-white/[0.08] bg-[#101728] px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">The address you&rsquo;ll paste</p>
          <code className="mt-1 block truncate font-mono text-[14px] text-emerald-300">{MCP_URL}</code>
        </div>

        {/* Which one */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <a href="#claude" className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 transition hover:bg-emerald-500/[0.1]">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300">Easiest — start here</p>
            <p className="mt-1 text-[15px] font-semibold text-slate-100">Claude</p>
            <p className="mt-0.5 text-[13px] text-slate-400">Built in. Connect, make a free account, allow, done.</p>
          </a>
          <a href="#chatgpt" className="rounded-xl border border-white/[0.08] bg-[#101728] px-4 py-3 transition hover:bg-white/[0.04]">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Also works</p>
            <p className="mt-1 text-[15px] font-semibold text-slate-100">ChatGPT</p>
            <p className="mt-0.5 text-[13px] text-slate-400">More steps: Developer mode, add Mindy, sign in, permissions.</p>
          </a>
        </div>

        <section id="claude" className="mt-14 scroll-mt-6">
          <h2 className="text-[22px] font-bold text-white">Claude — connect Mindy</h2>
          <p className="mt-1 text-[14px] text-slate-400">In the Claude desktop or web app. This is the easy one.</p>
          <StepList steps={CLAUDE} />
          <div className="mt-6 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-4 py-3">
            <p className="text-[14px] text-slate-300">
              <span className="font-semibold text-emerald-300">That&rsquo;s it for Claude.</span> Ask:{' '}
              <span className="text-slate-200">&ldquo;Use Mindy to find contracts expiring in my NAICS in the next 6 months.&rdquo;</span>
            </p>
          </div>
          <p className="mt-3 text-[13px] text-slate-500">
            Don&rsquo;t see Mindy in the directory? In the Add menu choose <span className="text-slate-300">Add custom connector</span> and paste{' '}
            <code className="font-mono text-emerald-300">{MCP_URL}</code>.
          </p>
        </section>

        <section id="chatgpt" className="mt-16 scroll-mt-6">
          <h2 className="text-[22px] font-bold text-white">ChatGPT — connect Mindy</h2>
          <p className="mt-1 text-[14px] text-slate-400">On the web (chatgpt.com). More steps than Claude — do them once, in order.</p>
          <StepList steps={CHATGPT} />
          <div className="mt-6 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] px-4 py-3">
            <p className="text-[14px] font-semibold text-emerald-300">That&rsquo;s it for ChatGPT.</p>
          </div>
        </section>

        {/* The question every single demo attendee asked: "do I have to say Mindy?"
            No. There is no magic word, and users cannot self-diagnose this — a chat that
            answers from model knowledge instead of calling Mindy looks like it worked. */}
        <section id="ask" className="mt-16 scroll-mt-6">
          <h2 className="text-[22px] font-bold text-white">Now just ask — normally</h2>
          <p className="mt-2 max-w-[52ch] text-[15px] leading-relaxed text-slate-400">
            You don&rsquo;t need special wording, and you don&rsquo;t have to say
            &ldquo;Mindy.&rdquo; Ask the way you&rsquo;d ask a person. When the question needs
            real federal contracting data, your assistant reaches for Mindy on its own.
          </p>

          <ul className="mt-5 grid gap-2.5">
            {[
              'Find cybersecurity opportunities in Virginia for a small business.',
              'Who should I team with on this one?',
              'What contracts are coming up for recompete at the VA next year?',
              "Here's what my company does — what should I be bidding on?",
            ].map((q) => (
              <li
                key={q}
                className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-[15px] text-slate-200"
              >
                &ldquo;{q}&rdquo;
              </li>
            ))}
          </ul>

          <p className="mt-5 max-w-[52ch] text-[14px] leading-relaxed text-slate-500">
            You also don&rsquo;t need to write a biography first. Give Mindy your company name,
            what you sell, your capabilities, any certifications and where you work &mdash;
            that&rsquo;s enough to start. Add past performance and the rest as you go.
          </p>
        </section>

        <div className="mt-14 flex flex-wrap items-center gap-3 border-t border-white/[0.07] pt-6 text-[13px] text-slate-500">
          <Link href="/mcp" className="text-emerald-300 underline underline-offset-2 hover:text-emerald-200">Back to Connect</Link>
          <span>·</span>
          <Link href="/mcp/pricing" className="text-slate-400 underline underline-offset-2 hover:text-slate-300">See pricing</Link>
          <span>·</span>
          <span>Questions? support@getmindy.ai</span>
        </div>
      </div>
    </main>
  );
}
