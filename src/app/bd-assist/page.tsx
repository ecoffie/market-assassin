import { redirect } from 'next/navigation';

// BD Assist was legacy — its pipeline lives in the /app workspace now (the proxy
// redirects first; this is the fallback if the proxy matcher ever drops the path).
export default function BDAssistPage() {
  redirect('/app?panel=pipeline');
}
