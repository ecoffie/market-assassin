import { redirect } from 'next/navigation';

// Redirect /briefings to the root MI dashboard
// The unified platform now lives at /
export default function BriefingsRedirect() {
  redirect('/');
}
