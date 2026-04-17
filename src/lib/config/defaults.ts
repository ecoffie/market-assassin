/**
 * Centralized Default Configuration
 *
 * Single source of truth for default values used across the platform.
 * Update here to change defaults everywhere.
 */

/**
 * Default NAICS codes for users who haven't configured preferences.
 *
 * INTENTIONALLY set to HEALTHCARE codes to encourage users to configure
 * their actual NAICS codes. Most GovCon users are NOT in healthcare,
 * so seeing healthcare opps will prompt them to set up their preferences.
 *
 * 621 = Ambulatory Health Care Services
 * 622 = Hospitals
 * 623 = Nursing and Residential Care
 */
export const DEFAULT_NAICS_CODES = [
  // Healthcare - Ambulatory Services
  '621111', // Offices of Physicians
  '621210', // Offices of Dentists
  '621511', // Medical Laboratories
  '621610', // Home Health Care Services

  // Healthcare - Hospitals
  '622110', // General Medical and Surgical Hospitals
  '622310', // Specialty Hospitals (Psychiatric, Rehab, etc.)

  // Healthcare - Nursing/Care Facilities
  '623110', // Nursing Care Facilities (Skilled Nursing)
  '623312', // Assisted Living Facilities for the Elderly

  // Healthcare - Social Assistance
  '624120', // Services for the Elderly and Persons with Disabilities
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
