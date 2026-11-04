import type { Metadata } from 'next';
import { Container, Section, Eyebrow, Heading, Standfirst, Dateline } from '@/components/public-site/ui';
import { LAZY_CONTRACTORS_BLUEPRINT as EVENT } from '@/lib/events/lazy-contractors-blueprint';
import RegistrationForm from './RegistrationForm';

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
      <Section>
        <Container>
          <div style={{ display: 'grid', gap: 40, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
            <div>
              <Eyebrow accent>{EVENT.format}</Eyebrow>
              <Heading as="h1" variant="display">{EVENT.title}</Heading>
              <Standfirst style={{ marginTop: 18 }}>
                The easiest way to win federal contracts, with Mindy doing the heavy lifting.
              </Standfirst>
              <Dateline style={{ marginTop: 18 }}>{when} · Live online · Hosted by Eric Coffie</Dateline>

              <p className="mp-label" style={{ marginTop: 36 }}>You&apos;ll walk away with</p>
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
            <RegistrationForm />
          </div>
        </Container>
      </Section>
    </main>
  );
}
