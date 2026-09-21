/**
 * Intelligence Module
 *
 * Exports for metrics tracking, guardrails, and circuit breakers
 * used by daily-alerts, briefings, and other intelligence crons.
 */

// Metrics
export {
  IntelligenceMetrics,
  logIntelligenceDelivery,
  recordUserFeedback,
  getMetricsDashboard,
  type MetricType,
  type MetricsData,
} from './metrics';

// Guardrails
export {
  GuardrailMonitor,
  CircuitBreaker,
  validateBeforeSend,
  postSendValidation,
  getGuardrailStatus,
  type EmailBatch,
  type ValidationResult,
  type SendResults,
  type GuardrailCheckResult,
} from './guardrails';
