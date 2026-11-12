import type { Metadata } from 'next';
import { Container, Section, Eyebrow, Heading, Standfirst, Dateline } from '@/components/public-site/ui';
import { LAZY_CONTRACTORS_BLUEPRINT as EVENT } from '@/lib/events/lazy-contractors-blueprint';
import RegistrationForm from './RegistrationForm';
import Countdown from './Countdown';

const URL = `https://getmindy.ai${EVENT.path}`;
const DESCRIPTION =
  'A free live event with Eric Coffie: the easiest way to win federal contracts, with Mindy doing the heavy lifting. Saturday, November 28, 2026.';

export const metadata: Metadata = {
  title: `${EVENT.title} — Free Live Event | Mindy`,
  description: DESCRIPTION,
  alternates: { canonical: URL },
  openGraph: { title: EVENT.title, description: DESCRIPTION, url: URL, siteName: 'Mindy', type: 'website' },
  twitter: { card: 'summary_large_image', title: EVENT.title, description: DESCRIPTION },
};

const TAKEAWAYS = [
  'How small businesses find contracts that fit, without searching SAM.gov for hours',
  'A live look at Mindy finding real contracts for real businesses',
  '$50 in free Mindy credits (live attendees only)',
];

export default function LazyContractorsBlueprintPage() {
  const when = [EVENT.dateLabel, EVENT.timeLabel].filter(Boolean).join(' · ');
  return (
    <main>
      <style dangerouslySetInnerHTML={{ __html: LCB_CSS }} />
      <Section>
        <Container>
          <div className="lcb-grid">
            <div>
              <Eyebrow accent>{EVENT.title} · {EVENT.format}</Eyebrow>
              <Heading as="h1" variant="display">Show up live. Get $50 in free Mindy credits.</Heading>
              <Dateline style={{ marginTop: 14 }}>{when} · Live online · Hosted by Eric Coffie</Dateline>
              <Countdown />
            </div>
            {/* On phones the grid stacks: the short form now comes right after the headline. */}
            <RegistrationForm />
            <div>
              <Standfirst>
                Watch the easiest way to win federal contracts, with Mindy doing the heavy lifting. Live
                attendees walk away with $50 in free credits to run it on their own business.
              </Standfirst>
              <p className="mp-label" style={{ marginTop: 28 }}>You&apos;ll walk away with</p>
              <ul className="mp-prose" style={{ marginTop: 12, paddingLeft: 20, display: 'grid', gap: 10, listStyle: 'disc' }}>
                {TAKEAWAYS.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              <p className="mp-prose" style={{ marginTop: 28 }}>
                The big contractors have whole teams hunting for deals every day. You don&apos;t. Mindy scans
                thousands of new federal contracts every night and tells you which ones fit your business. On{' '}
                {EVENT.dateLabel}, Eric goes live to show you how it works, step by step.
              </p>
            </div>
          </div>
        </Container>
      </Section>
    </main>
  );
}

// Desktop: copy left (headline + details), form right, spanning both rows. Phones: one column in
// source order — headline, countdown, FORM, then the details.
const LCB_CSS = `
.lcb-grid{display:grid;gap:28px 48px;align-items:start}
@media (min-width:900px){
  .lcb-grid{grid-template-columns:minmax(0,1fr) minmax(0,440px)}
  .lcb-grid>:nth-child(2){grid-column:2;grid-row:1 / span 2}
  .lcb-grid>:nth-child(3){grid-column:1;grid-row:2}
}
`;
