import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '2026 GovCon Action Plan | GovCon Giants',
  description: 'Your step-by-step roadmap to winning federal contracts in 2026.',
};

export default function ActionPlan2026Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
