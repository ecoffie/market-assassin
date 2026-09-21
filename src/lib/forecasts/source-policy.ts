export type SourceStage = 'production' | 'validate' | 'disabled';

export interface ForecastSourcePolicy {
  code: string;
  name: string;
  stage: SourceStage;
  rationale: string;
  schedulerEnabled: boolean;
  manualOnly: boolean;
}

export const FORECAST_SOURCE_POLICY: Record<string, ForecastSourcePolicy> = {
  DHS: {
    code: 'DHS',
    name: 'Department of Homeland Security',
    stage: 'production',
    rationale: 'Best current scraper reliability and validated API-interception path.',
    schedulerEnabled: true,
    manualOnly: false,
  },
  GSA: {
    code: 'GSA',
    name: 'General Services Administration',
    stage: 'production',
    rationale: 'Strong candidate for production use after API-first hardening and deterministic IDs.',
    schedulerEnabled: true,
    manualOnly: false,
  },
  Treasury: {
    code: 'Treasury',
    name: 'Department of the Treasury',
    stage: 'validate',
    rationale: 'Usable with supervision, but still needs repeat-run validation before unattended scheduling.',
    schedulerEnabled: false,
    manualOnly: true,
  },
  EPA: {
    code: 'EPA',
    name: 'Environmental Protection Agency',
    stage: 'validate',
    rationale: 'Promising, but still selector-heavy and better suited for supervised runs today.',
    schedulerEnabled: false,
    manualOnly: true,
  },
  USDA: {
    code: 'USDA',
    name: 'Department of Agriculture',
    stage: 'validate',
    rationale: 'Reasonable early coverage, but still page-structure dependent and not ready for unattended production.',
    schedulerEnabled: false,
    manualOnly: true,
  },
  HHS: {
    code: 'HHS',
    name: 'Department of Health and Human Services',
    stage: 'validate',
    rationale: 'Useful for manual validation, but not reliable enough for unattended cron use yet.',
    schedulerEnabled: false,
    manualOnly: true,
  },
  VA: {
    code: 'VA',
    name: 'Department of Veterans Affairs',
    stage: 'disabled',
    rationale: 'Portal access requires authentication and currently fails honestly when blocked.',
    schedulerEnabled: false,
    manualOnly: false,
  },
  DOD: {
    code: 'DOD',
    name: 'Department of Defense',
    stage: 'disabled',
    rationale: 'Multi-source approach still needs stronger file ingestion and deterministic sourcing.',
    schedulerEnabled: false,
    manualOnly: false,
  },
};

export function getForecastSourcesByStage(stage: SourceStage): ForecastSourcePolicy[] {
  return Object.values(FORECAST_SOURCE_POLICY)
    .filter(source => source.stage === stage)
    .sort((a, b) => a.code.localeCompare(b.code));
}

export function getSchedulerEnabledForecastSources(): ForecastSourcePolicy[] {
  return Object.values(FORECAST_SOURCE_POLICY)
    .filter(source => source.schedulerEnabled)
    .sort((a, b) => a.code.localeCompare(b.code));
}
