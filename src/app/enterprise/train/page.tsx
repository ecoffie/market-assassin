import type { Metadata } from 'next';

/**
 * /enterprise/train — Mindy Enterprise: train Mindy on how a company wins.
 *
 * Positioning page for the Enterprise pilot program (plan: per-company evals, bulk import,
 * a feedback loop, then per-company training). The page states what is live today and what is
 * in pilot; it must not claim per-company training is generally available until it ships.
 *
 * Public design system only (src/lib/public-site/tokens.ts): rendered inside PublicShell by
 * src/app/enterprise/layout.tsx. No purple (the logo mark is an image), no dark backgrounds
 * other than navy, square corners, weights <= 700.
 */
export const metadata: Metadata = {
  alternates: { canonical: '/enterprise/train' },
  title: 'Mindy Enterprise — train Mindy on how your company wins',
  description:
    'Mindy Enterprise turns your past proposals, debriefs and win history into a version of Mindy built for your company, scored on your own wins. Now onboarding pilot teams.',
};

const CONTACT = '/contact-sales';
const LOGO = '/brand/mindy-logo-icon.svg';

const NAVY = '#1B3A6B';
const NAVY_WASH = '#EFF5FF';
const INK = '#12100E';
const MUTED = '#6B6459';
const LINE = '#DCD8CF';
const PAPER = '#FBFAF7';
const SURFACE = '#FFFFFF';
const ACCENT = '#8C2F1E';
const OK = '#027A48';

const STEPS: { title: string; body: string }[] = [
  { title: 'Define the result.', body: 'We agree what good looks like for your team: full Section L and M compliance, evaluator-ready strengths, your voice, and the win themes that work for you.' },
  { title: 'Build your evals.', body: 'Your past wins, losses and debriefs become a test set. Every version of Mindy is scored on it before your team sees a draft.' },
  { title: 'Train on your work.', body: 'Proposals, redlines, CPARS ratings, resumes and capture notes teach Mindy how your company writes, prices and positions.' },
  { title: 'Deploy where you work.', body: 'Your Mindy runs in the Mindy app and inside Claude, ChatGPT and your own agents.' },
  { title: 'Improve with every bid.', body: 'Edits, debriefs and award results feed the next training round, so each proposal starts closer to a win.' },
];

const SOURCES: { title: string; body: string }[] = [
  { title: 'Past proposals and win themes', body: 'Your structure, voice and discriminators, learned from the volumes that won and the ones that did not.' },
  { title: 'Debriefs and CPARS', body: 'What evaluators rewarded and penalized, turned into the standard every new draft is scored against.' },
  { title: 'Redlines and edits', body: 'Every change your capture team makes teaches Mindy what to write the first time.' },
  { title: 'The federal market', body: 'Mindy already knows awards, recompetes, forecasts and buyers. Training adds your company on top.' },
];

type Status = 'live' | 'pilot';
const STATUS: { status: Status; label: string; title: string; body: string }[] = [
  { status: 'live', label: 'Live', title: 'Grounded in your record', body: 'Drafts cite your saved contracts and people, and leave blanks instead of inventing facts.' },
  { status: 'pilot', label: 'Pilot', title: 'Your eval set and import', body: 'Bulk import of past proposals and a scorecard built from your wins.' },
  { status: 'pilot', label: 'Pilot teams', title: 'A Mindy trained for you', body: 'Per-company training for teams with deep proposal history, released only when it beats the grounded version on your scorecard.' },
];

/** Illustrative only — labelled as such on the page. Replace with pilot results when they exist. */
const SCORECARD: { label: string; general: number; trained: number }[] = [
  { label: 'Section L/M requirements addressed', general: 0.62, trained: 0.94 },
  { label: 'Claims traced to your record', general: 0.41, trained: 1 },
  { label: 'Matches your winning structure', general: 0.35, trained: 0.86 },
  { label: 'Edits needed before submission', general: 0.88, trained: 0.3 },
];

const kicker = 'font-(family-name:--mp-font-mono) text-[12px] font-medium uppercase tracking-[0.12em] text-(--mp-accent)';
const serifH = 'font-(family-name:--mp-font-serif) font-normal tracking-[-0.025em] leading-[1.08] text-balance text-(--mp-ink)';
const btnPrimary = 'inline-flex items-center justify-center rounded-none bg-(--mp-navy) px-5 py-3 text-[15px] font-semibold text-white hover:bg-(--mp-navy-hover)';
const btnGhost = 'inline-flex items-center justify-center rounded-none bg-(--mp-wash) px-5 py-3 text-[15px] font-semibold text-(--mp-ink) hover:bg-(--mp-hair)';

/* ---------- Hero illustration: three isometric layers ---------- */
function IsoLayers() {
  const cx = 300, hw = 210, hh = 105, depth = 12;
  const pt = (x: number, y: number) => `${x},${y}`;
  const plate = (y: number, fill: string, stroke: string) => (
    <g>
      <polygon points={[pt(cx - hw, y), pt(cx, y + hh), pt(cx, y + hh + depth), pt(cx - hw, y + depth)].join(' ')} fill={stroke} fillOpacity={0.12} stroke={stroke} strokeWidth={1.2} />
      <polygon points={[pt(cx, y + hh), pt(cx + hw, y), pt(cx + hw, y + depth), pt(cx, y + hh + depth)].join(' ')} fill={stroke} fillOpacity={0.2} stroke={stroke} strokeWidth={1.2} />
      <polygon points={[pt(cx, y - hh), pt(cx + hw, y), pt(cx, y + hh), pt(cx - hw, y)].join(' ')} fill={fill} stroke={stroke} strokeWidth={1.4} />
    </g>
  );
  const grid = (y: number) =>
    [1, 2, 3, 4, 5].map((i) => {
      const t = i / 6;
      return (
        <g key={i} stroke={LINE} strokeWidth={0.8}>
          <line x1={cx - hw + hw * t} y1={y - hh * t} x2={cx + hw * t} y2={y + hh - hh * t} />
          <line x1={cx - hw + hw * t} y1={y + hh * t} x2={cx + hw * t} y2={y - hh + hh * t} />
        </g>
      );
    });
  const cube = (x: number, y: number, s: number) => (
    <g key={`${x}-${y}`}>
      <polygon points={[pt(x - s, y), pt(x, y + s / 2), pt(x, y + s / 2 + s * 0.8), pt(x - s, y + s * 0.8)].join(' ')} fill={NAVY} fillOpacity={0.18} stroke={NAVY} />
      <polygon points={[pt(x, y + s / 2), pt(x + s, y), pt(x + s, y + s * 0.8), pt(x, y + s / 2 + s * 0.8)].join(' ')} fill={NAVY} fillOpacity={0.32} stroke={NAVY} />
      <polygon points={[pt(x, y - s / 2), pt(x + s, y), pt(x, y + s / 2), pt(x - s, y)].join(' ')} fill={SURFACE} stroke={NAVY} />
    </g>
  );
  const tag = (x: number, y: number, text: string, color: string, ax: number, ay: number) => (
    <g>
      <line x1={ax} y1={ay} x2={x + (x < cx ? 176 : 0)} y2={y + 13} stroke={color} strokeDasharray="3 3" />
      <circle cx={ax} cy={ay} r={3} fill={color} />
      <rect x={x} y={y} width={176} height={26} fill={SURFACE} stroke={color} strokeWidth={1.2} />
      <text x={x + 88} y={y + 17} textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fontSize={11} letterSpacing="0.08em" fill={color}>{text}</text>
    </g>
  );
  const yB = 390, yM = 260, yT = 130;
  return (
    <svg viewBox="0 0 640 520" role="img" aria-label="Three layers: your proposal history at the base, training and evals in the middle, your Mindy on top" className="block h-auto w-full max-w-[620px] justify-self-end">
      {plate(yB, PAPER, MUTED)}
      {grid(yB)}
      <line x1={cx} y1={yM + hh + 10} x2={cx} y2={yB - hh} stroke={NAVY} strokeDasharray="4 4" />
      {plate(yM, SURFACE, NAVY)}
      {cube(cx - 90, yM - 10, 30)}
      {cube(cx + 10, yM + 30, 26)}
      {cube(cx + 70, yM - 30, 22)}
      {cube(cx - 20, yM - 50, 18)}
      <line x1={cx} y1={yT + hh + 10} x2={cx} y2={yM - hh} stroke={NAVY} strokeDasharray="4 4" />
      {plate(yT, NAVY_WASH, NAVY)}
      <image href={LOGO} x={cx - 28} y={yT - 24} width={56} height={45} />
      {tag(430, 36, 'YOUR MINDY', NAVY, cx + 120, yT - 30)}
      {tag(18, 196, 'TRAINING + EVALS', NAVY, cx - 120, yM - 40)}
      {tag(446, 440, 'YOUR PROPOSAL HISTORY', MUTED, cx + 150, yB + 20)}
    </svg>
  );
}

/* ---------- Training loop ---------- */
const LOOP_NODES: { name: string; sub: string; color: string }[] = [
  { name: 'Your work', sub: 'proposals, CPARS', color: MUTED },
  { name: 'Evals', sub: 'scored on your wins', color: ACCENT },
  { name: 'Training', sub: 'on your data only', color: NAVY },
  { name: 'Your Mindy', sub: 'app + your AI tools', color: NAVY },
  { name: 'Bids', sub: 'drafts your team ships', color: OK },
  { name: 'Outcomes', sub: 'edits, debriefs, awards', color: OK },
];

function TrainingLoop() {
  const c = 280, r = 190, n = LOOP_NODES.length;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const at = (a: number) => [c + r * Math.cos(a), c + r * Math.sin(a)] as const;
  return (
    <svg viewBox="0 0 560 560" role="img" aria-label="Training loop: your work, evals, training, your Mindy, bids, outcomes, and back to your work" className="h-auto w-full max-w-[540px]">
      <defs>
        <marker id="train-loop-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill={NAVY} />
        </marker>
      </defs>
      <circle cx={c} cy={c} r={r} fill="none" stroke={LINE} strokeDasharray="4 5" />
      {LOOP_NODES.map((_, i) => {
        const [x1, y1] = at(angle(i) + 0.3);
        const [x2, y2] = at(angle(i + 1) - 0.3);
        return <path key={`arc-${i}`} d={`M${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2}`} fill="none" stroke={NAVY} strokeWidth={1.6} markerEnd="url(#train-loop-arrow)" />;
      })}
      {LOOP_NODES.map((node, i) => {
        const [x, y] = at(angle(i));
        const w = 160, h = 54;
        return (
          <g key={node.name}>
            <rect x={x - w / 2} y={y - h / 2} width={w} height={h} fill={SURFACE} stroke={node.color} strokeWidth={1.3} />
            <rect x={x - w / 2} y={y - h / 2} width={4} height={h} fill={node.color} />
            <text x={x - w / 2 + 14} y={y - 3} fontFamily="Inter, sans-serif" fontSize={14} fontWeight={600} fill={INK}>{node.name}</text>
            <text x={x - w / 2 + 14} y={y + 15} fontFamily="Inter, sans-serif" fontSize={11.5} fill={MUTED}>{node.sub}</text>
          </g>
        );
      })}
      <rect x={c - 34} y={c - 58} width={68} height={68} fill={NAVY_WASH} stroke={NAVY} strokeWidth={1.6} />
      <image href={LOGO} x={c - 22} y={c - 42} width={44} height={35} />
      <text x={c} y={c + 36} textAnchor="middle" fontFamily="Libre Baskerville, serif" fontSize={15} fill={INK}>Each bid trains</text>
      <text x={c} y={c + 56} textAnchor="middle" fontFamily="Libre Baskerville, serif" fontSize={15} fill={INK}>the next one</text>
    </svg>
  );
}

function Ruler() {
  return (
    <svg aria-hidden className="block h-3.5 w-full opacity-30" preserveAspectRatio="none">
      <defs>
        <pattern id="train-ruler" width="8" height="14" patternUnits="userSpaceOnUse">
          <rect width="1" height="14" fill={SURFACE} />
        </pattern>
      </defs>
      <rect width="100%" height="14" fill="url(#train-ruler)" />
    </svg>
  );
}

export default function EnterpriseTrain() {
  return (
    <main className="bg-(--mp-paper) text-(--mp-body)">
      {/* Hero */}
      <section aria-labelledby="hero-h" className="border-b border-(--mp-line)">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="grid items-center gap-6 border-x border-(--mp-line) px-6 py-14 lg:min-h-[560px] lg:grid-cols-[1fr_1.05fr] lg:py-24 lg:pl-12 lg:pr-0">
            <div className="grid gap-5">
              <p className={kicker}>Mindy Enterprise · Pilot program</p>
              <h1 id="hero-h" className={`${serifH} text-[40px] sm:text-[56px] lg:text-[66px]`}>
                Train Mindy on <em className="italic text-(--mp-navy)">how your company wins</em>
              </h1>
              <p className="max-w-[31em] text-[19px] leading-relaxed">
                We turn your past proposals, debriefs and win history into a version of Mindy built for your company. Then we measure it against the results you need: compliant volumes, stronger evaluator scores and more wins.
              </p>
              <div className="flex flex-wrap gap-3">
                <a href={CONTACT} className={btnPrimary}>Talk to sales</a>
                <a href="#process" className={btnGhost}>How training works</a>
              </div>
            </div>
            <IsoLayers />
          </div>
        </div>
      </section>

      {/* Process */}
      <section id="process" aria-labelledby="proc-h">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="border-x border-(--mp-line)">
            <div className="grid gap-4 border-b border-(--mp-line) px-6 pb-10 pt-20 lg:px-12">
              <p className={kicker}>| · How training works · |</p>
              <h2 id="proc-h" className={`${serifH} max-w-[16em] text-[32px] sm:text-[44px]`}>General AI knows contracting. Yours should know your company.</h2>
            </div>
            <div className="grid border-b border-(--mp-line) lg:grid-cols-2">
              <ol className="m-0 list-none p-0 lg:border-r lg:border-(--mp-line)">
                {STEPS.map((s, i) => (
                  <li key={s.title} className="grid gap-1.5 border-b border-(--mp-line) px-6 py-7 last:border-b-0 lg:px-12">
                    <span className="font-(family-name:--mp-font-mono) text-[12px] font-medium tracking-[0.1em] text-(--mp-accent)">{String(i + 1).padStart(2, '0')}</span>
                    <h3 className="text-[17px] font-semibold text-(--mp-ink)">{s.title}</h3>
                    <p className="text-[16.5px] leading-relaxed text-(--mp-muted)">{s.body}</p>
                  </li>
                ))}
              </ol>
              <div className="grid place-items-center bg-(--mp-wash) px-4 py-8">
                <TrainingLoop />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Measured on your results (navy band) */}
      <section aria-labelledby="eval-h" className="bg-(--mp-navy) text-white">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="border-x border-white/20">
            <Ruler />
            <div className="grid items-center gap-12 px-6 py-14 lg:grid-cols-2 lg:px-16 lg:py-22">
              <div className="grid gap-5">
                <p className="font-(family-name:--mp-font-mono) text-[12px] font-medium uppercase tracking-[0.12em] text-white/70">Measured on your results</p>
                <h2 id="eval-h" className="text-balance font-(family-name:--mp-font-serif) text-[32px] font-normal leading-[1.08] tracking-[-0.025em] text-white sm:text-[46px]">Scored on your wins, not a public benchmark</h2>
                <p className="max-w-[32em] text-[17px] leading-relaxed text-white/80">A model is only better if it is better at your work. Every training round is checked against your own eval set, and you see the scorecard before anything reaches your team.</p>
                <div><a href={CONTACT} className="inline-flex items-center justify-center rounded-none bg-white px-5 py-3 text-[15px] font-semibold text-(--mp-navy) hover:bg-(--mp-wash)">Talk to sales</a></div>
              </div>
              <figure aria-label="Illustrative eval scorecard comparing a general AI draft with a trained Mindy draft" className="m-0 min-w-0 border border-white/20 bg-white/5">
                <div className="flex justify-between border-b border-white/20 px-4 py-2.5 font-(family-name:--mp-font-mono) text-[12px] text-white/70">
                  <span>Eval set · past proposals</span>
                  <span>Illustrative</span>
                </div>
                <div className="grid gap-[18px] p-5">
                  <div className="flex flex-wrap gap-5 text-[13px] text-white/75">
                    <span className="inline-flex items-center gap-2"><i className="inline-block size-3 bg-white/35" />General AI draft</span>
                    <span className="inline-flex items-center gap-2"><i className="inline-block size-3 bg-white" />Your trained Mindy</span>
                  </div>
                  {SCORECARD.map((m) => (
                    <div key={m.label} className="grid gap-2 text-[14px] text-white/85">
                      <span>{m.label}</span>
                      <div className="grid gap-1">
                        <b className="block h-2 bg-white/35" style={{ width: `${m.general * 100}%` }} />
                        <b className="block h-2 bg-white" style={{ width: `${m.trained * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </figure>
            </div>
            <div className="grid border-t border-white/20 md:grid-cols-3">
              {[
                ['Yours', 'Trained only on your data, used only for your company'],
                ['Measured', 'Every round scored on your past wins before release'],
                ['Improving', 'Each bid’s outcome feeds the next training round'],
              ].map(([big, small]) => (
                <div key={big} className="grid gap-2 border-b border-white/20 px-6 py-8 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0 lg:px-16 lg:py-10">
                  <strong className="font-(family-name:--mp-font-serif) text-[40px] font-normal leading-none tracking-[-0.03em] text-white">{big}</strong>
                  <span className="text-[15px] text-white/80">{small}</span>
                </div>
              ))}
            </div>
            <Ruler />
          </div>
        </div>
      </section>

      {/* What we train on */}
      <section aria-labelledby="sources-h">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="grid gap-7 border-x border-(--mp-line) pb-6 pt-22">
            <div className="grid gap-4 px-6 lg:px-12">
              <p className={kicker}>| · What we train on · |</p>
              <h2 id="sources-h" className={`${serifH} max-w-[15em] text-[32px] sm:text-[44px]`}>The knowledge that wins your bids, captured</h2>
            </div>
            <div className="mx-4 grid border-l border-t border-(--mp-line) md:grid-cols-2 lg:mx-12">
              {SOURCES.map((s) => (
                <div key={s.title} className="grid content-start gap-3 border-b border-r border-(--mp-line) bg-(--mp-surface) px-6 py-8 lg:px-10 lg:py-9">
                  <h3 className="text-[18px] font-semibold text-(--mp-ink)">{s.title}</h3>
                  <p className="text-[16.5px] leading-relaxed text-(--mp-muted)">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Where the program is today */}
      <section aria-labelledby="now-h">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="grid gap-7 border-x border-(--mp-line) pb-4 pt-6">
            <div className="grid gap-4 px-6 lg:px-12">
              <p className={kicker}>| · Where the program is today · |</p>
              <h2 id="now-h" className={`${serifH} max-w-[16em] text-[32px] sm:text-[44px]`}>Start with what works now. Train as your data grows.</h2>
            </div>
            <div className="mx-4 grid border-l border-t border-(--mp-line) lg:mx-12 lg:grid-cols-3">
              {STATUS.map((s) => (
                <div key={s.title} className="grid content-start justify-items-start gap-2.5 border-b border-r border-(--mp-line) bg-(--mp-surface) px-6 py-7 lg:px-8">
                  <span
                    className={
                      s.status === 'live'
                        ? 'rounded-(--mp-radius-chip) border border-(--mp-ok-line) bg-(--mp-ok-bg) px-2 py-0.5 font-(family-name:--mp-font-mono) text-[11px] uppercase tracking-[0.08em] text-(--mp-ok)'
                        : 'rounded-(--mp-radius-chip) border border-(--mp-line) bg-(--mp-wash) px-2 py-0.5 font-(family-name:--mp-font-mono) text-[11px] uppercase tracking-[0.08em] text-(--mp-navy)'
                    }
                  >
                    {s.label}
                  </span>
                  <h3 className="text-[18px] font-semibold text-(--mp-ink)">{s.title}</h3>
                  <p className="text-[16px] leading-relaxed text-(--mp-muted)">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Close */}
      <section aria-labelledby="close-h" className="mt-16 border-t border-(--mp-line)">
        <div className="mx-auto max-w-[1200px] px-6">
          <div className="grid justify-items-center gap-5 border-x border-(--mp-line) px-6 py-24 text-center lg:py-28">
            <h2 id="close-h" className={`${serifH} max-w-[14em] text-[34px] sm:text-[52px]`}>Train a Mindy for your company</h2>
            <p className="max-w-[30em] text-[18px] text-(--mp-muted)">Mindy Enterprise is onboarding pilot teams. Tell us your team size and how many proposals you submit a year.</p>
            <a href={CONTACT} className={btnPrimary}>Talk to sales</a>
            <p className="font-(family-name:--mp-font-mono) text-[12px] text-(--mp-muted)">admin@getmindy.ai · typically replies within a business day</p>
          </div>
        </div>
      </section>
    </main>
  );
}
