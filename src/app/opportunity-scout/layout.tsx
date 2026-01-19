import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Opportunity Hunter | GovCon Giants",
  description: "Find government agencies that buy what you sell. Discover 50+ agencies awarding contracts to businesses like yours.",
};

export default function OpportunityHunterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
