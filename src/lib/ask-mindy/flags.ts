/**
 * Ask Mindy recipe orchestration flag. Ships OFF and nothing reads it yet: the recipe modules are not wired
 * into any route. Whoever wires them in gates the new path on this, per verified session email:
 *   ASK_MINDY_RECIPES='true'      → on for every caller;
 *   ASK_MINDY_RECIPES='allowlist' → on only for emails in ASK_MINDY_RECIPES_ALLOWLIST;
 *   anything else                 → off.
 * Turning it on anywhere is a feature-flag change (CLAUDE.md rule 1).
 */
import { flagMode } from '@/lib/vault/flags';

export const RECIPES_ENV = 'ASK_MINDY_RECIPES';
export const RECIPES_ALLOWLIST_ENV = 'ASK_MINDY_RECIPES_ALLOWLIST';

export function askMindyRecipesEnabledFor(verifiedEmail: string | null | undefined): boolean {
  const mode = flagMode(RECIPES_ENV);
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  const email = (verifiedEmail || '').trim().toLowerCase();
  if (!email) return false;
  return (process.env[RECIPES_ALLOWLIST_ENV] || '')
    .split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@'))
    .includes(email);
}
