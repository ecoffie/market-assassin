export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Strip HTML-like tags and enforce max length.
 */
export function sanitizeString(input: unknown, maxLength: number = 500): string {
  if (typeof input !== 'string') return '';
  return input.replace(/<[^>]*>/g, '').slice(0, maxLength);
}

/**
 * Validate report generation inputs from the POST body.
 */
export function validateReportInputs(body: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  const inputs = body.inputs as Record<string, unknown> | undefined;
  const selectedAgencies = body.selectedAgencies as unknown[];

  if (!inputs || typeof inputs !== 'object') {
    errors.push('inputs object is required');
  } else {
    if (!inputs.businessType) {
      errors.push('inputs.businessType is required');
    }
    if (!inputs.naicsCode && !inputs.pscCode) {
      errors.push('Either inputs.naicsCode or inputs.pscCode is required');
    }
  }

  if (!Array.isArray(selectedAgencies) || selectedAgencies.length === 0) {
    errors.push('selectedAgencies must be a non-empty array');
  } else if (selectedAgencies.length > 50) {
    errors.push('selectedAgencies cannot exceed 50 items');
  }

  return { valid: errors.length === 0, errors };
}
