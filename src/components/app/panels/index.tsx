'use client';

import { Suspense, lazy } from 'react';
import type { AppPanel, AppTier } from '../UnifiedSidebar';

// Lazy load panels for better performance
const MindyChatPanel = lazy(() => import('./MindyChatPanel'));
const DashboardPanel = lazy(() => import('./DashboardPanel'));
const MarketDossierPanel = lazy(() => import('./MarketDossierPanel'));
const AlertsPanel = lazy(() => import('./AlertsPanel'));
const MarketResearchPanel = lazy(() => import('./MarketResearchPanel'));
const ForecastsPanel = lazy(() => import('./ForecastsPanel'));
const RecompetesPanel = lazy(() => import('./RecompetesPanel'));
const ContractorsPanel = lazy(() => import('./ContractorsPanel'));
const GovDecisionMakersPanel = lazy(() => import('./GovDecisionMakersPanel'));
const PipelinePanel = lazy(() => import('./PipelinePanel'));
// Free-tier "data behind glass" preview surfaces (enterprise-SaaS pattern):
// free users see their own tracked pursuits read-only, or a count+blurred-rows
// teaser for catalog surfaces, instead of a blank upgrade wall.
const PipelinePreviewFree = lazy(() => import('./PipelinePreviewFree'));
const CatalogTeaserFree = lazy(() => import('./CatalogTeaserFree'));
const RelationshipsPanel = lazy(() => import('./RelationshipsPanel'));
const TeamPanel = lazy(() => import('./TeamPanel'));
const UnifiedSettingsPanel = lazy(() => import('./UnifiedSettingsPanel'));
const ProposalsPanel = lazy(() => import('./ProposalsPanel'));
const PricingIntelPanel = lazy(() => import('./PricingIntelPanel'));
const MyTargetListPanel = lazy(() => import('./MyTargetListPanel'));
const GrantsPanel = lazy(() => import('./GrantsPanel'));
const DibbsPanel = lazy(() => import('./DibbsPanel'));
const VaultPanel = lazy(() => import('./VaultPanel'));
const KnowledgeBasePanel = lazy(() => import('./KnowledgeBasePanel'));
const CoachPanel = lazy(() => import('./CoachPanel'));
// LibraryPanel is no longer routed at top level — it's rendered inside
// VaultPanel's "Generated" tab (folded in Jun 25). The 'library' panel id
// redirects into Vault for old deep links.
const DisaVehicleWatchPanel = lazy(() => import('./DisaVehicleWatchPanel'));
const OsbpSmbResearchPanel = lazy(() => import('./OsbpSmbResearchPanel'));
const MiccMrrPanel = lazy(() => import('./MiccMrrPanel'));

interface PanelContainerProps {
  activePanel: AppPanel;
  email: string | null;
  tier: AppTier;
  onPanelChange?: (panel: AppPanel, context?: Record<string, unknown>) => void;
  /** Optional context passed by the previous panel when it requested
   *  a switch. e.g. PipelinePanel sets { pursuit_id: 'xyz' } when the
   *  user clicks 'Draft Proposal', and ProposalsPanel reads it on mount
   *  to auto-load that pursuit's cached SAM attachments. */
  panelContext?: Record<string, unknown>;
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

export default function PanelContainer({ activePanel, email, tier, onPanelChange, panelContext }: PanelContainerProps) {
  const renderPanel = () => {
    switch (activePanel) {
      case 'chat':
        return <MindyChatPanel email={email} tier={tier} onPanelChange={onPanelChange} />;
      case 'dashboard':
        return <DashboardPanel email={email} tier={tier} onPanelChange={onPanelChange} />;
      case 'my-market':
        return <MarketDossierPanel email={email} onNavigate={onPanelChange} />;
      case 'alerts':
        return <AlertsPanel email={email} tier={tier} onPanelChange={onPanelChange} />;
      case 'research':
        return <MarketResearchPanel email={email} tier={tier} />;
      case 'forecasts':
        return email && tier === 'free'
          ? <CatalogTeaserFree email={email} featureId="forecasts" />
          : <ForecastsPanel email={email} tier={tier} />;
      case 'recompetes':
        return email && tier === 'free'
          ? <CatalogTeaserFree email={email} featureId="recompetes" />
          : <RecompetesPanel email={email} tier={tier} />;
      case 'contractors':
        return email && tier === 'free'
          ? <CatalogTeaserFree email={email} featureId="contractors" />
          : <ContractorsPanel email={email} tier={tier} />;
      case 'decision-makers':
        return email && tier === 'free'
          ? <CatalogTeaserFree email={email} featureId="decision-makers" />
          : <GovDecisionMakersPanel email={email} tier={tier} />;
      case 'pipeline':
        return email && tier === 'free'
          ? <PipelinePreviewFree email={email} tier={tier} />
          : <PipelinePanel email={email} tier={tier} onPanelChange={onPanelChange} />;
      case 'contacts':
        return <RelationshipsPanel email={email} tier={tier} panelContext={panelContext} />;
      case 'team':
        return <TeamPanel email={email} tier={tier} />;
      case 'settings':
        return <UnifiedSettingsPanel email={email} tier={tier} />;
      case 'proposals':
        return <ProposalsPanel email={email} tier={tier} panelContext={panelContext} />;
      case 'pricing':
        return <PricingIntelPanel email={email} tier={tier} />;
      case 'target-list':
        return <MyTargetListPanel email={email} tier={tier} onPanelChange={onPanelChange} />;
      case 'knowledge-base':
        return <KnowledgeBasePanel email={email} initialDocId={typeof panelContext?.doc === 'string' ? panelContext.doc : undefined} />;
      case 'coach':
        return <CoachPanel email={email} onPanelChange={onPanelChange} />;
      case 'grants':
        return <GrantsPanel email={email} tier={tier} />;
      case 'dibbs':
        return <DibbsPanel email={email} tier={tier} />;
      case 'disa-watch':
        return <DisaVehicleWatchPanel email={email || ''} />;
      case 'osbp-smb':
        return <OsbpSmbResearchPanel email={email || ''} />;
      case 'micc-mrr':
        return <MiccMrrPanel email={email || ''} />;
      case 'vault':
        return <VaultPanel email={email} tier={tier} />;
      case 'library':
        // Library folded into Vault's "Generated" tab — old deep links land there.
        return <VaultPanel email={email} tier={tier} initialSection="generated" />;
      default:
        return <DashboardPanel email={email} tier={tier} onPanelChange={onPanelChange} />;
    }
  };

  return (
    <Suspense fallback={<PanelLoading />}>
      {renderPanel()}
    </Suspense>
  );
}
