/**
 * /ambassadors — the Mindy Ambassadors program (2026-11-12). People apply; the team approves each
 * one by hand (/api/admin/ambassadors). Approved ambassadors get free, unlimited Mindy, a direct line
 * for feedback, and a tracked referral link. Earnings terms are shared on approval (not set yet).
 */
import AmbassadorForm from './AmbassadorForm';

const PERKS: { title: string; body: string; icon: string }[] = [
  {
    title: 'Use Mindy, unlimited',
    body: 'Mindy Pro for free, with no credit limits, in the app and inside Claude or ChatGPT.',
    icon: '<path d="M12 3l2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.3 9.4l6-.9z"/>',
  },
  {
    title: 'Shape the product',
    body: 'A direct line to the team building Mindy. Your feedback decides what we fix and build next, and you see new features first.',
    icon: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
  },
  {
    title: 'Earn from your audience',
    body: 'Your own referral link. Every contractor who signs up through it is tracked to you, and you earn from the customers you bring.',
    icon: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>',
  },
];

const FOR = ['GovCon consultants and coaches', 'APEX Accelerator and SBDC advisors', 'Proposal writers and BD pros', 'GovCon creators on LinkedIn and YouTube', 'Contractors with a network of other contractors'];

const STEPS: [string, string][] = [
  ['Apply', 'Tell us who you are and who you reach. It takes about three minutes.'],
  ['We review', 'Our team reads every application by hand and emails you a decision.'],
  ['Get started', 'Approved ambassadors get unlimited Mindy and their referral link the same day.'],
];

const FAQS: [string, string][] = [
  ['What does it cost?', 'Nothing. The program is free, and so is your Mindy account while you are an ambassador.'],
  ['What does "unlimited" mean?', 'Mindy Pro with no credit limits: the app, the Opportunity Map, and Mindy inside your AI tools.'],
  ['How do I earn?', 'You get a referral link that tracks every contractor who signs up through you. We share the exact earnings terms when you are approved.'],
  ['What do you expect from me?', 'Use Mindy, tell us honestly what works and what does not, and share it with the people you already help.'],
  ['Can I apply if I am already a customer?', 'Yes. Apply with the email address you use for Mindy.'],
];

function Icon({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6 fill-none stroke-(--mp-navy) [stroke-width:1.7] [stroke-linecap:round] [stroke-linejoin:round]" dangerouslySetInnerHTML={{ __html: d }} />;
}

export default function AmbassadorsPage() {
  return (
    <div className="bg-(--mp-paper)">
      <section className="mx-auto max-w-[1080px] px-4 pb-16 pt-14 text-center sm:px-6 md:pt-20">
        <p className="m-0 text-[13px] font-semibold uppercase tracking-[0.1em] text-(--mp-muted)">Mindy Ambassadors</p>
        <h1 className="mx-auto mt-4 mb-0 max-w-[16ch] font-(family-name:--mp-font-serif) text-[40px] font-bold leading-[1.08] text-(--mp-ink) sm:text-[56px]">
          Use Mindy free. Shape it. <span className="text-(--mp-accent)">Get paid.</span>
        </h1>
        <p className="mx-auto mt-5 mb-0 max-w-[40rem] text-[19px] leading-[1.55] text-(--mp-body)">
          For the people other contractors already turn to. Get unlimited Mindy, help decide what we build next, and earn from the contractors you bring.
        </p>
        <a href="#apply" className="mt-8 inline-flex items-center rounded-xl bg-(--mp-navy) px-6 py-3.5 text-[16px] font-semibold text-(--mp-surface) no-underline hover:bg-(--mp-navy-hover)">
          Apply to be an ambassador
        </a>
      </section>

      <section className="bg-(--mp-surface) py-16">
        <div className="mx-auto grid max-w-[1080px] gap-4 px-4 sm:px-6 md:grid-cols-3">
          {PERKS.map((p) => (
            <div key={p.title} className="rounded-2xl border border-(--mp-hair) bg-(--mp-paper) p-6">
              <Icon d={p.icon} />
              <h2 className="mt-4 mb-0 font-(family-name:--mp-font-serif) text-[22px] font-bold text-(--mp-ink)">{p.title}</h2>
              <p className="mt-2 mb-0 text-[16px] leading-[1.55] text-(--mp-body)">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-[1080px] gap-12 px-4 py-16 sm:px-6 md:grid-cols-2">
        <div>
          <h2 className="m-0 font-(family-name:--mp-font-serif) text-[28px] font-bold text-(--mp-ink)">Who it&apos;s for</h2>
          <ul className="mt-5 mb-0 grid list-none gap-3 p-0">
            {FOR.map((f) => (
              <li key={f} className="flex items-start gap-3 text-[16px] text-(--mp-body)">
                <span aria-hidden="true" className="mt-0.5 font-bold text-(--mp-ok)">✓</span>{f}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="m-0 font-(family-name:--mp-font-serif) text-[28px] font-bold text-(--mp-ink)">How it works</h2>
          <ol className="mt-5 mb-0 grid list-none gap-4 p-0">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="grid grid-cols-[32px_1fr] gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-(--mp-navy) text-[14px] font-semibold text-(--mp-surface)">{i + 1}</span>
                <span className="text-[16px] leading-[1.5] text-(--mp-body)"><b className="text-(--mp-ink)">{t}.</b> {d}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="apply" className="scroll-mt-24 border-t border-(--mp-hair) bg-(--mp-surface) py-16">
        <div className="mx-auto max-w-[720px] px-4 sm:px-6">
          <h2 className="m-0 font-(family-name:--mp-font-serif) text-[32px] font-bold text-(--mp-ink)">Apply</h2>
          <p className="mt-2 mb-8 text-[16px] text-(--mp-muted)">We review every application by hand and reply by email.</p>
          <AmbassadorForm />
        </div>
      </section>

      <section className="mx-auto max-w-[720px] px-4 py-16 sm:px-6">
        <h2 className="m-0 font-(family-name:--mp-font-serif) text-[28px] font-bold text-(--mp-ink)">Questions</h2>
        <div className="mt-6 grid gap-3">
          {FAQS.map(([q, a]) => (
            <details key={q} className="rounded-xl border border-(--mp-hair) bg-(--mp-surface) p-4">
              <summary className="cursor-pointer text-[16px] font-semibold text-(--mp-ink)">{q}</summary>
              <p className="mt-2 mb-0 text-[15px] leading-[1.55] text-(--mp-body)">{a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
