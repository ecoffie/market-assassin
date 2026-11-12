/**
 * "Which best describes you?" — asked once at the end of onboarding (growth plan item 05:
 * tag signups by type, then see who pays and who refers). Stored as a user_engagement event
 * (event_source 'onboarding', metadata.action 'signup_type'); no schema change.
 */
export const SIGNUP_TYPES = [
  { id: 'sam_registered', label: 'Small business, registered in SAM' },
  { id: 'new_to_govcon', label: 'New to government contracting' },
  { id: 'apex_client', label: 'APEX Accelerator or SBDC client' },
  { id: 'consultant', label: 'Consultant, advisor or proposal writer' },
  { id: 'prime_bd', label: 'BD at a larger contractor' },
  { id: 'student', label: 'Student' },
  { id: 'other', label: 'Other' },
] as const;

export type SignupTypeId = (typeof SIGNUP_TYPES)[number]['id'];

export function isSignupType(v: unknown): v is SignupTypeId {
  return typeof v === 'string' && SIGNUP_TYPES.some((t) => t.id === v);
}

export function signupTypeLabel(id: string): string {
  return SIGNUP_TYPES.find((t) => t.id === id)?.label ?? id;
}
