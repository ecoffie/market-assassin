import type { Metadata } from 'next';
import PublicShell from '@/components/public-site/PublicShell';
import SupportForm from './SupportForm';

export const metadata: Metadata = {
  title: 'Get help — Mindy',
  description: 'Ask the Mindy team anything. A real person reads every message and we usually reply within one business day.',
  alternates: { canonical: '/support' },
};

export default function SupportPage() {
  return (
    <PublicShell contentElement="div">
      <SupportForm />
    </PublicShell>
  );
}
