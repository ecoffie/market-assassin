/**
 * The Mindy Institute — public /research index (the Institute's front door).
 *
 * PUBLIC, SEO-indexed (Class A). Reads the publications registry directly (no fetch, no auth) and
 * shows two honest groups:
 *  - Published — real links to /research/<slug>, with edition/version/date.
 *  - Forthcoming — the real pipeline, framed publicly as "in development". NO OBS-### maturity
 *    internals here (that's the standards-engine / admin view); the public framing is simply what
 *    the Institute is working on next.
 *
 * The counterpart internal view is /admin/research (the publications library with cited-metric
 * maturity + readiness). Same registry, different gate — this one is the outward face.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { publicationsForDisplay, type Publication, type PubKind } from '@/lib/analytics/research-publications';

export const metadata: Metadata = {
  title: 'The Mindy Institute — Research on the Federal Procurement Market',
  description:
    'The Mindy Institute publishes grounded research on how the public procurement market actually behaves — benchmarks, white papers, and an annual report, each derived from live federal data.',
  alternates: { canonical: 'https://getmindy.ai/research' },
  openGraph: {
    type: 'website',
    title: 'The Mindy Institute — Federal Procurement Research',
    description:
      'Grounded research on how the public procurement market behaves — benchmarks and reports derived from live federal data.',
    url: 'https://getmindy.ai/research',
  },
};

const KIND_LABEL: Record<PubKind, string> = {
  annual: 'Annual Report',
  white_paper: 'White Paper',
  press: 'Press',
  index: 'Benchmark',
  dataset: 'Dataset',
};

export default function ResearchIndex() {
  const all = publicationsForDisplay();
  const published = all.filter((p) => p.status === 'published' && p.slug);
  const forthcoming = all.filter((p) => p.status !== 'published' && p.status !== 'archived');

  return (
    <main className="ri-main">
      <style>{CSS}</style>

      <header className="ri-mast">
        <div className="ri-wrap">
          <div className="ri-inst"><span className="ri-dot" />The Mindy Institute</div>
        </div>
      </header>

      <section className="ri-hero">
        <div className="ri-wrap">
          <div className="ri-kicker">Research</div>
          <h1>How the federal procurement market actually behaves.</h1>
          <p className="ri-lede">
            The Mindy Institute publishes grounded research on the public procurement market —
            who buys, how competition really works, and where small business has room to win.
            Every figure is derived from live federal data, not estimated.
          </p>
          <Link href="/research/about" className="ri-why">Why the Institute exists →</Link>
        </div>
      </section>

      <section className="ri-wrap ri-section">
        <h2>Published</h2>
        {published.length === 0 ? (
          <p className="ri-empty">The first publications are being prepared. Check back shortly.</p>
        ) : (
          <div className="ri-grid">
            {published.map((p) => <PublishedCard key={p.id} p={p} />)}
          </div>
        )}
      </section>

      {forthcoming.length > 0 && (
        <section className="ri-wrap ri-section">
          <h2>Forthcoming</h2>
          <p className="ri-subnote">
            What the Institute is preparing next. Each rests on measures that are still maturing —
            we publish a report only when its underlying data is ready to stand behind.
          </p>
          <div className="ri-grid">
            {forthcoming.map((p) => <ForthcomingCard key={p.id} p={p} />)}
          </div>
        </section>
      )}

      <footer className="ri-foot">
        <div className="ri-wrap">
          <p>
            The Mindy Institute is the research arm of <a href="https://getmindy.ai">Mindy</a>,
            operated by GovCon Giants AI. Research is grounded in live federal solicitation and
            award data.
          </p>
        </div>
      </footer>
    </main>
  );
}

function PublishedCard({ p }: { p: Publication }) {
  return (
    <Link href={`/research/${p.slug}`} className="ri-card ri-card--pub">
      <div className="ri-card-top">
        <span className="ri-kind">{KIND_LABEL[p.kind]}</span>
        {p.edition && <span className="ri-ed">Edition {p.edition}{p.version ? ` · ${p.version}` : ''}</span>}
      </div>
      <h3>{p.title}</h3>
      <p className="ri-summary">{p.summary}</p>
      <span className="ri-read">Read the {KIND_LABEL[p.kind].toLowerCase()} →</span>
    </Link>
  );
}

function ForthcomingCard({ p }: { p: Publication }) {
  return (
    <div className="ri-card ri-card--soon">
      <div className="ri-card-top">
        <span className="ri-kind">{KIND_LABEL[p.kind]}</span>
        <span className="ri-soon">In development{p.edition ? ` · ${p.edition}` : ''}</span>
      </div>
      <h3>{p.title}</h3>
      <p className="ri-summary">{p.summary}</p>
    </div>
  );
}

const CSS = `
.ri-main{--navy:#0b1f3a;--ink:#101828;--muted:#667085;--line:#e4e7ec;--accent:#7c3aed;--green:#059669;
  background:#fff;color:var(--ink);min-height:100vh;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.55}
.ri-wrap{max-width:960px;margin:0 auto;padding:0 22px}
.ri-mast{border-bottom:1px solid var(--line);padding:20px 0}
.ri-inst{display:flex;align-items:center;gap:9px;font-weight:800;letter-spacing:.02em;color:var(--navy)}
.ri-dot{width:10px;height:10px;border-radius:50%;background:var(--accent)}
.ri-hero{padding:52px 0 30px;border-bottom:1px solid var(--line)}
.ri-kicker{font-size:12px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--accent)}
.ri-hero h1{font-size:40px;line-height:1.12;margin:10px 0 8px;letter-spacing:-.015em;color:var(--navy);max-width:16ch;text-wrap:balance}
.ri-lede{font-size:18px;color:#344054;max-width:640px;margin:8px 0 0}
.ri-why{display:inline-block;margin-top:16px;font-size:14px;font-weight:700;color:var(--accent);text-decoration:none}
.ri-why:hover{text-decoration:underline}
.ri-section{padding:38px 0 6px}
.ri-section h2{font-size:13px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);font-weight:700;margin:0 0 4px}
.ri-subnote{font-size:14px;color:var(--muted);margin:6px 0 18px;max-width:620px}
.ri-empty{color:var(--muted);font-size:15px;margin:14px 0}
.ri-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;margin-top:16px}
.ri-card{border:1px solid var(--line);border-radius:14px;padding:20px 22px;display:block;text-decoration:none;color:inherit;transition:border-color .15s,box-shadow .15s,transform .15s}
.ri-card--pub{border-left:3px solid var(--green)}
.ri-card--pub:hover{border-color:#cfd8e3;box-shadow:0 6px 22px rgba(16,24,40,.07);transform:translateY(-1px)}
.ri-card--soon{border-left:3px solid var(--line);background:#fcfcfd}
.ri-card-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}
.ri-kind{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--accent)}
.ri-ed{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
.ri-soon{font-size:11.5px;font-weight:600;color:var(--muted);background:#f2f4f7;border:1px solid var(--line);border-radius:999px;padding:2px 9px}
.ri-card h3{font-size:19px;line-height:1.25;margin:0 0 8px;color:var(--navy);letter-spacing:-.01em}
.ri-summary{font-size:14px;color:#475467;margin:0}
.ri-read{display:inline-block;margin-top:14px;font-size:13.5px;font-weight:700;color:var(--green)}
.ri-foot{margin-top:40px;border-top:1px solid var(--line);padding:22px 0 60px}
.ri-foot p{font-size:13px;color:var(--muted);max-width:640px}
.ri-foot a{color:var(--accent);text-decoration:none}
@media (max-width:560px){.ri-hero h1{font-size:30px}.ri-lede{font-size:16px}}
`;
