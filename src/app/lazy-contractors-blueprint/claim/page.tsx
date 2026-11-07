import type { Metadata } from 'next';
import { Container, Section, Eyebrow, Heading, Standfirst } from '@/components/public-site/ui';
import { LAZY_CONTRACTORS_BLUEPRINT as EVENT, lazyBlueprintClaimState } from '@/lib/events/lazy-contractors-blueprint';
import ClaimForm from './ClaimForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `Claim $50 in Mindy credits — ${EVENT.title} | Mindy`,
  description: `Live attendees of ${EVENT.title} claim $50 (${EVENT.claimCredits}) in free Mindy credits.`,
  robots: { index: false, follow: false },
};

export default function ClaimPage() {
  const state = lazyBlueprintClaimState();
  return (
    <main>
      <Section>
        <Container width="prose">
          <Eyebrow accent>{EVENT.title} · Live attendees only</Eyebrow>
          <Heading as="h1" variant="display">Claim your $50 in free Mindy credits</Heading>
          <Standfirst style={{ marginTop: 18 }}>
            Thanks for being here live. Enter the email you registered with and we&apos;ll add {EVENT.claimCredits} credits
            ($50 worth) to your Mindy account right away.
          </Standfirst>
          <div style={{ marginTop: 28 }}>
            <ClaimForm initialState={state} credits={EVENT.claimCredits} />
          </div>
        </Container>
      </Section>
    </main>
  );
}
