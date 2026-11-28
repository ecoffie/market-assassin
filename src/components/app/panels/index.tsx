'use client';

import { canBrowseKnowledgeBase } from '@/lib/knowledge-base/access';
import { Suspense, lazy } from 'react';
import type { AppPanel, AppTier } from '../UnifiedSidebar';
import { parseSettingsSection, parseVaultSection } from '@/lib/app/deep-link-params';
import { isTodayHomeEnabled } from '@/lib/app/today-home';
import { getTabTips, isTabTipsEnabled } from '@/lib/app/tab-tips';
import TabCoach from '../TabCoach';

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
const PartnerFinderPanel = lazy(() => import('./PartnerFinderPanel'));
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
// The Opportunity Map (and its Watchlist / Saved pages) in the app shell — a same-origin iframe.
const MapShellPanel = lazy(() => import('./MapShellPanel'));
// Today — one home after sign-in. Rendered only while NEXT_PUBLIC_TODAY_HOME is on (default OFF).
const TodayPanel = lazy(() => import('./TodayPanel'));
const TODAY_HOME = isTodayHomeEnabled();

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
        <p className="text-sm text-muted">Loading panel...</p>
      </div>
    </div>
  );
}

// Panels whose signed-in FREE tier renders a different surface (a teaser / preview) instead of the
// full panel. Their tips describe the full panel, so the free variant shows no tips box.
const FREE_VARIANT_PANELS = new Set<AppPanel>(['forecasts', 'recompetes', 'contractors', 'decision-makers', 'pipeline']);

/** The panel id whose tips describe what is actually rendered for `activePanel` (aliases resolved). */
export function tabTipsPanelId(activePanel: AppPanel, email: string | null, tier: AppTier, todayHome = TODAY_HOME): AppPanel | null {
  if (email && tier === 'free' && FREE_VARIANT_PANELS.has(activePanel)) return null;
  if (activePanel === 'today' && !todayHome) return 'dashboard';
  if (activePanel === 'library') return 'vault';
  return activePanel;
}

export default function PanelContainer({ activePanel, email, tier, onPanelChange, panelContext }: PanelContainerProps) {
  const renderPanel = () => {
    switch (activePanel) {
      case 'today':
        return TODAY_HOME
          ? <TodayPanel email={email} onPanelChange={onPanelChange} />
          : <DashboardPanel email={email} tier={tier} onPanelChange={onPanelChange} />;
      case 'map':
      case 'watchlist':
      case 'saved':
        // key: each panel is its own frame (src is computed once per mount from the app URL).
        return <MapShellPanel key={activePanel} panel={activePanel} onPanelChange={onPanelChange} />;
      case 'chat':
        return <MindyChatPanel email={email} tier={tier} onPanelChange={onPanelChange} />;
      case 'dashboard':
        return <DashboardPanel email={email} tier={tier} onPanelChange={onPanelChange} />;
      case 'my-market':
        return <MarketDossierPanel email={email} onNavigate={onPanelChange} />;
      case 'alerts':
        return <AlertsPanel email={email} tier={tier} onPanelChange={onPanelChange} />;
      case 'research':
        return <MarketResearchPanel email={email} tier={tier} onNavigate={onPanelChange} />;
      case 'forecasts':
        return email && tier === 'free'
          ? <CatalogTeaserFree email={email} featureId="forecasts" onPanelChange={onPanelChange} />
          : <ForecastsPanel email={email} tier={tier} />;
      case 'recompetes':
        return email && tier === 'free'
          ? <CatalogTeaserFree email={email} featureId="recompetes" onPanelChange={onPanelChange} />
          : <RecompetesPanel email={email} tier={tier} />;
      case 'contractors':
        return email && tier === 'free'
          ? <CatalogTeaserFree email={email} featureId="contractors" onPanelChange={onPanelChange} />
          : <ContractorsPanel email={email} tier={tier} />;
      case 'decision-makers':
        return email && tier === 'free'
          ? <CatalogTeaserFree email={email} featureId="decision-makers" onPanelChange={onPanelChange} />
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
        return (
          <UnifiedSettingsPanel
            email={email}
            tier={tier}
            initialSection={parseSettingsSection(typeof panelContext?.section === 'string' ? panelContext.section : null)}
          />
        );
      case 'proposals':
        return <ProposalsPanel email={email} tier={tier} panelContext={panelContext} />;
      case 'pricing':
        return <PricingIntelPanel email={email} tier={tier} />;
      case 'target-list':
        return <MyTargetListPanel email={email} tier={tier} onPanelChange={onPanelChange} />;
      case 'knowledge-base':
        // Staff only (Eric, 2026-11-27). A customer who follows an old link lands in Mindy Chat instead.
        return canBrowseKnowledgeBase(email)
          ? <KnowledgeBasePanel email={email} initialDocId={typeof panelContext?.doc === 'string' ? panelContext.doc : undefined} />
          : <MindyChatPanel email={email} tier={tier} onPanelChange={onPanelChange} />;
      case 'coach':
        return <CoachPanel email={email} onPanelChange={onPanelChange} />;
      case 'grants':
        return <GrantsPanel email={email} tier={tier} />;
      case 'partner-finder':
        return <PartnerFinderPanel email={email} tier={tier} />;
      case 'dibbs':
        return <DibbsPanel email={email} tier={tier} />;
      case 'disa-watch':
        return <DisaVehicleWatchPanel email={email || ''} />;
      case 'osbp-smb':
        return <OsbpSmbResearchPanel email={email || ''} />;
      case 'micc-mrr':
        return <MiccMrrPanel email={email || ''} />;
      case 'vault':
        return (
          <VaultPanel
            email={email}
            tier={tier}
            initialSection={parseVaultSection(typeof panelContext?.section === 'string' ? panelContext.section : null)}
            sectionRequest={panelContext}
          />
        );
      case 'library':
        // Library folded into Vault's "Generated" tab — old deep links land there.
        return <VaultPanel email={email} tier={tier} initialSection="generated" />;
      default:
        return <DashboardPanel email={email} tier={tier} onPanelChange={onPanelChange} />;
    }
  };

  const panel = (
    <Suspense fallback={<PanelLoading />}>
      {renderPanel()}
    </Suspense>
  );

  // "How to use this tab" coach (NEXT_PUBLIC_TAB_TIPS, default OFF). Mounted once here, above the active
  // panel, keyed by panel id — never inside a panel. OFF (or no entry) = exactly the panel, as before.
  if (!isTabTipsEnabled()) return panel;
  const tipsId = tabTipsPanelId(activePanel, email, tier);
  const tips = getTabTips(tipsId);
  if (!tipsId || !tips) return panel;
  return (
    <>
      <TabCoach key={tipsId} panelId={tipsId} tips={tips} />
      {panel}
    </>
  );
}
