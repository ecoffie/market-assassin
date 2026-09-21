import { redirect } from 'next/navigation';

// BD Assist was legacy - redirect to unified MI dashboard
export default function BDAssistPage() {
  redirect('/briefings');
}
