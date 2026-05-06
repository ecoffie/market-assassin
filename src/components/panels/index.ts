// Lazy-loaded panel components for the unified MI platform
// Each panel loads on-demand to keep initial bundle small

import { lazy } from 'react';

// Export PanelContainer as a named export
export { default as PanelContainer } from './PanelContainer';

// Core panels (always available)
export const DashboardPanel = lazy(() => import('./DashboardPanel'));

// Intelligence panels
export const AlertsPanel = lazy(() => import('./AlertsPanel'));
export const MarketResearchPanel = lazy(() => import('./MarketResearchPanel'));
export const ForecastsPanel = lazy(() => import('@/components/bd-assist/ForecastsPanel'));
export const RecompetesPanel = lazy(() => import('./RecompetesPanel'));
export const ContractorsPanel = lazy(() => import('./ContractorsPanel'));
export const GrantsPanel = lazy(() => import('@/components/briefings/GrantsPanel'));
// Note: SbirPanel removed - SBIR/STTR serves R&D companies, not our target (service contractors)

// Pipeline panels
export const PipelinePanel = lazy(() => import('@/components/bd-assist/PipelineBoard'));
export const ContactsPanel = lazy(() => import('@/components/bd-assist/ContactsPanel'));

// Proposal panel
export const ProposalsPanel = lazy(() => import('./ProposalsPanel'));
// Note: ContentReaperPanel removed - Content Reaper is a marketing tool, not BD tool
// Note: ActionPlannerPanel removed - lives at /planner as standalone onboarding tool

// Panel preloading for instant switching
const panelModules = {
  dashboard: () => import('./DashboardPanel'),
  alerts: () => import('./AlertsPanel'),
  research: () => import('./MarketResearchPanel'),
  forecasts: () => import('@/components/bd-assist/ForecastsPanel'),
  recompetes: () => import('./RecompetesPanel'),
  contractors: () => import('./ContractorsPanel'),
  grants: () => import('@/components/briefings/GrantsPanel'),
  pipeline: () => import('@/components/bd-assist/PipelineBoard'),
  proposals: () => import('./ProposalsPanel'),
  contacts: () => import('@/components/bd-assist/ContactsPanel'),
};

// Preload adjacent panels for instant switching
export function preloadPanel(panelKey: keyof typeof panelModules) {
  const loader = panelModules[panelKey];
  if (loader) {
    loader().catch(() => {
      // Silently fail preload - not critical
    });
  }
}

// Preload multiple panels
export function preloadPanels(panels: (keyof typeof panelModules)[]) {
  panels.forEach(preloadPanel);
}
