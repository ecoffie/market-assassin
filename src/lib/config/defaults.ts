/**
 * Centralized Default Configuration
 *
 * Single source of truth for default values used across the platform.
 * Update here to change defaults everywhere.
 */

/**
 * Default NAICS codes for users who haven't configured preferences.
 * Covers broad professional services categories.
 *
 * 541 = Professional, Scientific, and Technical Services
 * 561 = Administrative and Support Services
 */
export const DEFAULT_NAICS_CODES = [
  // IT & Computer Services
  '541511', // Custom Computer Programming Services
  '541512', // Computer Systems Design Services
  '541519', // Other Computer Related Services

  // Consulting Services
  '541611', // Administrative Management Consulting
  '541618', // Other Management Consulting
  '541690', // Other Scientific and Technical Consulting

  // Engineering & Technical
  '541330', // Engineering Services
  '541990', // All Other Professional, Scientific, and Technical Services

  // Support Services
  '561210', // Facilities Support Services
];

/**
 * Default agencies to search if user hasn't selected any.
 * Empty array means search all agencies.
 */
export const DEFAULT_AGENCIES: string[] = [];

/**
 * Default business type (set-aside preference).
 * Empty string means no set-aside filter.
 */
export const DEFAULT_BUSINESS_TYPE = '';

/**
 * Default timezone for delivery scheduling.
 */
export const DEFAULT_TIMEZONE = 'America/New_York';

/**
 * Default alert frequency.
 */
export const DEFAULT_ALERT_FREQUENCY = 'daily';

/**
 * Maximum opportunities to include in alerts.
 */
export const MAX_ALERT_OPPORTUNITIES = 25;

/**
 * Maximum opportunities to include in briefings.
 */
export const MAX_BRIEFING_OPPORTUNITIES = 20;
