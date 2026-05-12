'use client';

import { Suspense, lazy } from 'react';
import type { MIBetaPanel, MIBetaTier } from '../UnifiedSidebarBeta';

// Lazy load panels for better performance
const DashboardPanel = lazy(() => import('./DashboardPanel'));
const AlertsPanel = lazy(() => import('./AlertsPanel'));
const MarketResearchPanel = lazy(() => import('./MarketResearchPanel'));
const ForecastsPanel = lazy(() => import('./ForecastsPanel'));
const RecompetesPanel = lazy(() => import('./RecompetesPanel'));
const ContractorsPanel = lazy(() => import('./ContractorsPanel'));
const PipelinePanel = lazy(() => import('./PipelinePanel'));
const RelationshipsPanel = lazy(() => import('./RelationshipsPanel'));
const TeamPanel = lazy(() => import('./TeamPanel'));
const UnifiedSettingsPanel = lazy(() => import('./UnifiedSettingsPanel'));
const ProposalsPanel = lazy(() => import('./ProposalsPanel'));
const GrantsPanel = lazy(() => import('./GrantsPanel'));

interface PanelContainerProps {
  activePanel: MIBetaPanel;
  email: string | null;
  tier: MIBetaTier;
}

function PanelLoading() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-slate-400">Loading panel...</p>
      </div>
    </div>
  );
}

export default function PanelContainer({ activePanel, email, tier }: PanelContainerProps) {
  const renderPanel = () => {
    switch (activePanel) {
      case 'dashboard':
        return <DashboardPanel email={email} tier={tier} />;
      case 'alerts':
        return <AlertsPanel email={email} tier={tier} />;
      case 'research':
        return <MarketResearchPanel email={email} tier={tier} />;
      case 'forecasts':
        return <ForecastsPanel email={email} tier={tier} />;
      case 'recompetes':
        return <RecompetesPanel email={email} tier={tier} />;
      case 'contractors':
        return <ContractorsPanel email={email} tier={tier} />;
      case 'pipeline':
        return <PipelinePanel email={email} tier={tier} />;
      case 'contacts':
        return <RelationshipsPanel email={email} tier={tier} />;
      case 'team':
        return <TeamPanel email={email} tier={tier} />;
      case 'settings':
        return <UnifiedSettingsPanel email={email} tier={tier} />;
      case 'proposals':
        return <ProposalsPanel email={email} tier={tier} />;
      case 'grants':
        return <GrantsPanel email={email} tier={tier} />;
      default:
        return <DashboardPanel email={email} tier={tier} />;
    }
  };

  return (
    <Suspense fallback={<PanelLoading />}>
      {renderPanel()}
    </Suspense>
  );
}
