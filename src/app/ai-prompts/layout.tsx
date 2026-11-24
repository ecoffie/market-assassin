import type { Metadata } from 'next';
import PublicShell from '@/components/public-site/PublicShell';

export const metadata: Metadata = {
  alternates: { canonical: '/ai-prompts' },
  title: 'AI Prompts for GovCon | Mindy',
  description: '75+ ready-to-use AI prompts to accelerate your federal contracting business.',
};

export default function AIPromptsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PublicShell>{children}</PublicShell>;
}
