import type { Metadata } from 'next';
import PublicShell from '@/components/public-site/PublicShell';
import ContactSalesForm from './ContactSalesForm';

export const metadata: Metadata = {
  title: 'Contact sales — Mindy',
  description: 'Talk to the Mindy team about Team plans, Enterprise and API access, or government use.',
  alternates: { canonical: '/contact-sales' },
};

export default function ContactSalesPage() {
  return (
    <PublicShell contentElement="div">
      <ContactSalesForm />
    </PublicShell>
  );
}
