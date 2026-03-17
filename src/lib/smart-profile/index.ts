/**
 * Smart Profile Module
 *
 * Exports all smart profile functionality
 */

// Types
export type {
  SmartUserProfile,
  BriefingUserProfile,
  ProfileUpdatePayload,
  BriefingInteraction,
  ProfileCompletenessBreakdown,
} from './types';

export {
  CERTIFICATION_OPTIONS,
  COMPANY_SIZE_OPTIONS,
  CONTRACT_VEHICLE_OPTIONS,
  GEOGRAPHIC_OPTIONS,
} from './types';

// Service
export {
  getSmartProfile,
  getOrCreateProfile,
  updateProfile,
  getBriefingProfile,
  recordInteraction,
  calculateProfileCompleteness,
  completeOnboarding,
} from './service';
