/**
 * The Mindy Institute — "Why some research isn't published yet" (/research/how-we-publish).
 *
 * Turns the Institute's restraint into a VISIBLE feature (Eric): "Most companies would publish
 * anyway. We publish only when the supporting Observatory standards reach sufficient maturity."
 * The maturity ladder is read LIVE from the methodology registry, so it never goes stale — a metric
 * that graduates moves rungs on its own. The concrete example (The Competition Gap can't publish
 * because a metric it rests on isn't mature) is derived from the live publication registry too.
 *
 * PUBLIC, SEO-indexed. This is the transparency the skeptics (officials, academics, journalists)
 * the flagship research will need to convince are looking for.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { maturityLadder, methodologyById, type LadderTier } from '@/lib/analytics/observatory-methodology';
import { publicationsForDisplay, resolveCitations } from '@/lib/analytics/research-publications';

export const metadata: Metadata = {
  title: 'Why Some Research Isn’t Published Yet — The Mindy Institute',
  description:
    'The Mindy Institute publishes findings only after the supporting Observatory measures reach sufficient maturity. Here is exactly what we can and cannot yet stand behind.',
  alternates: { canonical: 'https://getmindy.ai/research/how-we-publish' },
  openGraph: {
    type: 'article',
    title: 'Why Some Research Isn’t Published Yet',
    description: 'We publish only what our measures can support — and we show you the whole ladder.',
    url: 'https://getmindy.ai/research/how-we-publish',
  },
};

export default function HowWePublish() {
  const ladder = maturityLadder();

  // The concrete example, live: find a not-yet-published publication and the LEAST-mature metric it
  // cites — the honest "this is why it's waiting." Derived, never hand-typed.
  const blockedExample = (() => {
    const order: Record<string, number> = { research: 0, collecting: 1, beta: 2, production: 3 };
    for (const p of publicationsForDisplay()) {
      if (p.status === 'published') continue;
      const cited = resolveCitations(p)
        .map((c) => c.standard)
        .filter((s): s is NonNullable<typeof s> => !!s && s.lifecycle !== 'production')
        .sort((a, b) => order[a.lifecycle] - order[b.lifecycle]);
      if (cited.length) return { title: p.title, metric: cited[0] };
    }
    return null;
  })();

  const published = publicationsForDisplay().filter((p) => p.status === 'published').length;

  return (
    <main className="hw-main">
      <style>{CSS}</style>

      <header className="hw-mast">
        <div className="hw-wrap hw-mastrow">
          <Link href="/research" className="hw-inst"><span className="hw-dot" />The Mindy Institute</Link>
          <Link href="/research" className="hw-back">← All research</Link>
        </div>
      </header>

      <article className="hw-wrap hw-article">
        <div className="hw-kicker">How we publish</div>
        <h1>Why some research isn’t published yet</h1>

        <p className="hw-lead">Most organizations publish first and defend later. We do it the other way around.</p>

        <p>The Mindy Institute publishes a finding only after the Observatory measures it rests on reach
          sufficient maturity. When we don’t have enough evidence to defend a claim, we say so — and we
          don’t publish it. That restraint is not a limitation of the work. It <em>is</em> the work.</p>

        <p>To make that concrete, here is the full ladder — every measure we track, what tier it sits
          at, and the honest reason it’s there. Nothing is hidden; the not-yet-ready measures are listed
          right alongside the ready ones.</p>

        <h2>The maturity ladder</h2>
        <div className="hw-ladder">
          {ladder.map((tier) => <TierBlock key={tier.lifecycle} tier={tier} />)}
        </div>

        <h2>What this means in practice</h2>
        {blockedExample ? (
          <p><b>A worked example.</b> Our forthcoming paper <em>“{blockedExample.title}”</em> rests, in part, on{' '}
            <b>{blockedExample.metric.id} · {blockedExample.metric.name}</b>, which is currently at the{' '}
            <b>{tierLabel(blockedExample.metric.lifecycle)}</b> stage. Until that measure matures, the paper’s
            central claim can’t be fully defended — so it stays forthcoming, not published. When the
            measure graduates, the paper becomes publishable. Not before.</p>
        ) : (
          <p>Every forthcoming publication is gated the same way: it ships only once each measure it rests
            on is mature enough to defend.</p>
        )}

        <p>{published === 0
          ? 'That is why our published shelf is deliberately short today. Each item on it can be defended to a procurement official, an academic, or a journalist, line by line — and that is the only shelf worth building.'
          : 'That is why our published shelf grows slowly. Each item on it can be defended to a procurement official, an academic, or a journalist, line by line.'}</p>

        <div className="hw-cta">
          <Link href="/research" className="hw-cta-link">See what we’ve published →</Link>
        </div>

        <footer className="hw-foot">
          <p><strong>The Mindy Institute</strong> — the research arm of <a href="https://getmindy.ai">Mindy</a>,
            operated by GovCon Giants AI. This ladder is generated live from the Observatory; it reflects
            the state of our measures at the moment you loaded the page.</p>
        </footer>
      </article>
    </main>
  );
}

function TierBlock({ tier }: { tier: LadderTier }) {
  return (
    <section className={`hw-tier hw-tier--${tier.lifecycle}`}>
      <div className="hw-tier-head">
        <span className="hw-tier-dot">{tier.dot}</span>
        <span className="hw-tier-label">{tier.label}</span>
        <span className="hw-tier-count">{tier.metrics.length}</span>
      </div>
      <p className="hw-tier-blurb">{tier.blurb}</p>
      {tier.metrics.length === 0 ? (
        <p className="hw-tier-empty">No measures at this stage right now.</p>
      ) : (
        <ul className="hw-metric-list">
          {tier.metrics.map((m) => (
            <li key={m.id} className="hw-metric">
              <div className="hw-metric-head"><span className="hw-metric-id">{m.id}</span><span className="hw-metric-name">{m.name}</span></div>
              <p className="hw-metric-def">{m.definition}</p>
              {m.reason && <p className="hw-metric-reason"><span className="hw-why">Why not further along:</span> {m.reason}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function tierLabel(lc: string): string {
  return { production: 'Production', beta: 'Beta', collecting: 'Collecting', research: 'Research' }[lc] ?? lc;
}

const CSS = `
.hw-main{--navy:#0b1f3a;--ink:#1d2939;--muted:#667085;--line:#e4e7ec;--accent:#7c3aed;
  --green:#059669;--amber:#b45309;--red:#b42318;
  background:#fff;color:var(--ink);min-height:100vh;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.65}
.hw-wrap{max-width:760px;margin:0 auto;padding:0 22px}
.hw-mast{border-bottom:1px solid var(--line);padding:18px 0}
.hw-mastrow{display:flex;align-items:center;justify-content:space-between;gap:12px;max-width:760px}
.hw-inst{display:flex;align-items:center;gap:9px;font-weight:800;letter-spacing:.02em;color:var(--navy);text-decoration:none}
.hw-dot{width:10px;height:10px;border-radius:50%;background:var(--accent)}
.hw-back{font-size:13px;color:var(--muted);text-decoration:none}
.hw-back:hover{color:var(--navy)}
.hw-article{padding:44px 22px 40px}
.hw-kicker{font-size:12px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--accent)}
.hw-article h1{font-size:36px;line-height:1.15;margin:10px 0 22px;letter-spacing:-.015em;color:var(--navy);text-wrap:balance}
.hw-lead{font-size:20px;line-height:1.5;color:var(--navy);font-weight:600;margin:0 0 22px}
.hw-article p{font-size:17px;margin:0 0 18px;color:#344054}
.hw-article em{font-style:italic}
.hw-article h2{font-size:14px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);font-weight:700;margin:40px 0 16px}
.hw-ladder{display:flex;flex-direction:column;gap:16px}
.hw-tier{border:1px solid var(--line);border-radius:14px;padding:18px 20px;border-left-width:3px}
.hw-tier--production{border-left-color:var(--green)}
.hw-tier--beta{border-left-color:#d97706}
.hw-tier--collecting{border-left-color:#eab308}
.hw-tier--research{border-left-color:#dc2626}
.hw-tier-head{display:flex;align-items:center;gap:9px}
.hw-tier-dot{font-size:13px}
.hw-tier-label{font-size:16px;font-weight:800;color:var(--navy)}
.hw-tier-count{margin-left:auto;font-size:13px;font-weight:700;color:var(--muted);background:#f2f4f7;border-radius:999px;padding:1px 10px;font-variant-numeric:tabular-nums}
.hw-tier-blurb{font-size:14px;color:#475467;margin:6px 0 12px}
.hw-tier-empty{font-size:14px;color:var(--muted);font-style:italic;margin:0}
.hw-metric-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
.hw-metric{border-top:1px solid var(--line);padding-top:12px}
.hw-metric:first-child{border-top:none;padding-top:0}
.hw-metric-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.hw-metric-id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;font-weight:700;color:var(--accent);background:#f5f0ff;border-radius:5px;padding:1px 7px}
.hw-metric-name{font-size:15.5px;font-weight:700;color:var(--ink)}
.hw-metric-def{font-size:14px;color:#475467;margin:6px 0 0}
.hw-metric-reason{font-size:13.5px;color:#667085;margin:6px 0 0}
.hw-why{font-weight:700;color:#475467}
.hw-cta{margin:36px 0 8px}
.hw-cta-link{display:inline-block;font-size:15px;font-weight:700;color:#fff;background:var(--accent);border-radius:10px;padding:11px 20px;text-decoration:none}
.hw-cta-link:hover{background:#6d28d9}
.hw-foot{margin-top:40px;border-top:1px solid var(--line);padding-top:22px}
.hw-foot p{font-size:13.5px;color:var(--muted);line-height:1.6;margin:0}
.hw-foot a{color:var(--accent);text-decoration:none}
@media (max-width:560px){.hw-article h1{font-size:29px}.hw-lead{font-size:18px}.hw-article p{font-size:16px}}
`;
