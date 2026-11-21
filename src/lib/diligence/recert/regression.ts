/**
 * Regression projection of a RecertReview: every field that carries a legal-review result,
 * nothing that is presentation. The Halvik golden file is this projection, frozen.
 */
import type { RecertReview } from './engine';

export function projectReview(r: RecertReview) {
  return {
    policy_version: r.policy_version,
    policy_legal_review_status: r.policy_legal_review_status,
    as_of: r.as_of,
    fact_mode: r.fact_mode,
    target_uei: r.target_uei,
    summary: r.summary,
    deal_rules: r.deal_rules.map((d) => ({ rule_id: d.rule_id, review: d.review })),
    instruments: r.instruments.map((i) => ({
      federal_fact: i.federal_fact,
      rules: i.rules.map((x) => ({
        rule_id: x.rule_id,
        citations: x.regulatory_fact.citations.map((c) => c.cite),
        review: x.review,
      })),
    })),
    diligence_requests: r.diligence_requests,
  };
}
