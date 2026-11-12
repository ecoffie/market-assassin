/**
 * /features/<slug> — one "How it works" page per way Mindy works, modelled on fyxer.com/flows and
 * /spaces (Eric 2026-11-12). Content lives in src/lib/public-site/features.ts.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FEATURE_PAGES, featurePage, type FeatureMedia } from '@/lib/public-site/features';

export const dynamicParams = false;

export function generateStaticParams() {
  return FEATURE_PAGES.map((f) => ({ slug: f.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const f = featurePage((await params).slug);
  if (!f) return {};
  const url = `https://getmindy.ai/features/${f.slug}`;
  return {
    title: `${f.name} | Mindy`,
    description: f.metaDescription,
    alternates: { canonical: url },
    openGraph: { title: `${f.name} | Mindy`, description: f.metaDescription, url, images: [{ url: f.hero.src }] },
  };
}

const TRIAL_HREF = '/pricing';

function Media({ m, priority = false }: { m: FeatureMedia; priority?: boolean }) {
  return (
    <figure className="m-0">
      <div className="overflow-hidden rounded-2xl border border-(--mp-hair) bg-(--mp-wash) shadow-[0_18px_40px_rgba(18,16,14,.10)]">
        {m.video ? (
          <video className="block w-full h-auto" src={m.video} poster={m.src} autoPlay muted loop playsInline preload="metadata" aria-label={m.alt} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="block w-full h-auto" src={m.src} alt={m.alt} loading={priority ? 'eager' : 'lazy'} />
        )}
      </div>
      <figcaption className="mt-2 text-[13px] text-(--mp-subtle)">
        {m.live ? 'Live Mindy screen' : 'Sample Mindy result for an example company'}
      </figcaption>
    </figure>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.1em] text-(--mp-muted)">
      <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-[3px] bg-(--mp-navy)" />
      {children}
    </p>
  );
}

function TrialButtons({ tryHref, tryLabel }: { tryHref: string; tryLabel: string }) {
  return (
    <>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href={TRIAL_HREF} className="inline-flex items-center rounded-xl bg-(--mp-navy) px-6 py-3.5 text-[16px] font-semibold text-(--mp-surface) no-underline hover:bg-(--mp-navy-hover)">
          Start 14-day free trial
        </Link>
        <Link href={tryHref} className="inline-flex items-center rounded-xl border border-(--mp-line) bg-(--mp-surface) px-6 py-3.5 text-[16px] font-semibold text-(--mp-ink) no-underline hover:border-(--mp-navy)">
          {tryLabel} →
        </Link>
      </div>
      <p className="mt-3 text-[14px] text-(--mp-subtle)">14-day free trial · Cancel anytime</p>
    </>
  );
}

export default async function FeaturePageRoute({ params }: { params: Promise<{ slug: string }> }) {
  const f = featurePage((await params).slug);
  if (!f) notFound();
  const others = FEATURE_PAGES.filter((o) => o.slug !== f.slug);

  return (
    <div className="bg-(--mp-paper)">
      {/* Hero */}
      <section className="mx-auto grid max-w-[1180px] items-center gap-12 px-4 pb-20 pt-14 sm:px-6 md:grid-cols-[1fr_1.1fr] md:pt-20">
        <div>
          <Eyebrow>{f.eyebrow}</Eyebrow>
          <h1 className="mt-4 mb-0 font-(family-name:--mp-font-serif) text-[40px] font-bold leading-[1.08] tracking-[-0.01em] text-(--mp-ink) sm:text-[52px]">
            {f.headline} <span className="text-(--mp-accent)">{f.headlineAccent}</span>
          </h1>
          <p className="mt-5 mb-0 max-w-[34rem] text-[19px] leading-[1.55] text-(--mp-body)">{f.sub}</p>
          <TrialButtons tryHref={f.tryHref} tryLabel={f.tryLabel} />
        </div>
        <Media m={f.hero} priority />
      </section>

      {/* Sections: text and screen alternate sides, like fyxer.com/flows. */}
      <div className="rounded-t-[40px] bg-(--mp-surface) py-8 md:rounded-t-[64px]">
        {f.sections.map((s, i) => (
          <section key={s.heading} className="mx-auto grid max-w-[1180px] items-center gap-10 px-4 py-14 sm:px-6 md:grid-cols-2 md:gap-16 md:py-20">
            <div className={i % 2 === 0 ? 'md:order-2' : ''}>
              <Eyebrow>{s.eyebrow}</Eyebrow>
              <h2 className="mt-3 mb-0 font-(family-name:--mp-font-serif) text-[30px] font-bold leading-[1.15] text-(--mp-ink) sm:text-[36px]">{s.heading}</h2>
              <p className="mt-4 mb-0 max-w-[30rem] text-[17px] leading-[1.6] text-(--mp-body)">{s.body}</p>
            </div>
            <div className={i % 2 === 0 ? 'md:order-1' : ''}>
              <Media m={s.media} />
            </div>
          </section>
        ))}
      </div>

      {/* More ways Mindy works */}
      <section className="border-t border-(--mp-hair) bg-(--mp-paper)">
        <div className="mx-auto max-w-[1180px] px-4 py-16 sm:px-6">
          <h2 className="m-0 font-(family-name:--mp-font-serif) text-[28px] font-bold text-(--mp-ink)">More ways Mindy works</h2>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {others.map((o) => (
              <Link key={o.slug} href={`/features/${o.slug}`} className="grid grid-cols-[24px_1fr] gap-x-3 gap-y-1 rounded-xl border border-(--mp-hair) bg-(--mp-surface) p-4 no-underline hover:border-(--mp-navy)">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="row-span-2 mt-0.5 h-5 w-5 fill-none stroke-(--mp-ink) [stroke-width:1.7] [stroke-linecap:round] [stroke-linejoin:round]" dangerouslySetInnerHTML={{ __html: o.icon }} />
                <span className="text-[16px] font-semibold text-(--mp-ink)">{o.name}</span>
                <span className="text-[14px] leading-[1.45] text-(--mp-muted)">{o.menuDesc}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Closing call to action */}
      <section className="bg-(--mp-navy)">
        <div className="mx-auto max-w-[1180px] px-4 py-16 text-center sm:px-6">
          <h2 className="m-0 font-(family-name:--mp-font-serif) text-[32px] font-bold text-(--mp-surface)">Start finding federal work today.</h2>
          <p className="mx-auto mt-3 mb-0 max-w-[36rem] text-[17px] text-(--mp-navy-wash)">Try Mindy free for 14 days. Pick Pro or Team; you are not charged until the trial ends.</p>
          <Link href={TRIAL_HREF} className="mt-7 inline-flex items-center rounded-xl bg-(--mp-surface) px-6 py-3.5 text-[16px] font-semibold text-(--mp-navy) no-underline">
            Start 14-day free trial
          </Link>
        </div>
      </section>
    </div>
  );
}
