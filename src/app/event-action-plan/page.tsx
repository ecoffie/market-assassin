/**
 * /event-action-plan — landing page for the free Event Action Plan template.
 * Sign up (GHL tag `event-action-plan-template`), then download the editable Word template.
 */
import type { Metadata } from 'next';
import EventPlanLanding from './EventPlanLanding';

const PAGE_URL = 'https://getmindy.ai/event-action-plan';
const TITLE = 'Free Event Action Plan Template for Industry Days | Mindy';
const DESC = 'A free, editable action plan template for government contracting events and industry days: deadlines, your pitch, who to meet, what to ask and what not to do.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: PAGE_URL },
  openGraph: { title: TITLE, description: DESC, url: PAGE_URL },
};

export default function EventActionPlanPage() {
  return (
    <main>
      <EventPlanLanding />
    </main>
  );
}
