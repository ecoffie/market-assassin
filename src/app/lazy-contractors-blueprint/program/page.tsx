import type { Metadata } from 'next';
import { Container, Section, Eyebrow, Heading, Standfirst } from '@/components/public-site/ui';
import { LAZY_CONTRACTORS_BLUEPRINT as EVENT } from '@/lib/events/lazy-contractors-blueprint';
import ProgramInterestForm from './ProgramInterestForm';

export const metadata: Metadata = {
  title: `${EVENT.programName} — ${EVENT.programStartLabel} | Mindy`,
  description: `Tell us if you want a seat in the ${EVENT.programName}, starting ${EVENT.programStartLabel}.`,
  robots: { index: false, follow: false },
};

const POINTS = [
  'Two months, done with you: we set you up and work your first bids alongside you',
  'Starts in January 2027, so you open the new year with real opportunities in hand',
  'Bonus Mindy credits for everyone who joins',
];

export default function ProgramInterestPage() {
  return (
    <main>
      <Section>
        <Container>
          <div style={{ display: 'grid', gap: 40, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
            <div>
              <Eyebrow accent>New Year special · {EVENT.programStartLabel}</Eyebrow>
              <Heading as="h1" variant="display">Want help winning your first contract in 2027?</Heading>
              <Standfirst style={{ marginTop: 18 }}>
                The {EVENT.programName} is a two-month program where our team works with you to find, qualify and bid on
                federal contracts using Mindy. Seats are limited. Answer a few questions and we&apos;ll reach out.
              </Standfirst>
              <ul className="mp-prose" style={{ marginTop: 24, paddingLeft: 20, display: 'grid', gap: 10, listStyle: 'disc' }}>
                {POINTS.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
            <ProgramInterestForm />
          </div>
        </Container>
      </Section>
    </main>
  );
}
