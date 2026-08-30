import type { RegistryResult, VerificationProfile } from './types';

export type ProfileCommandSpec = {
  command: string;
  required: boolean;
  /** When true, `warn` status cannot satisfy this command for integration handoff. */
  blocking: boolean;
};

export type ProfileContract = {
  description: string;
  /** Path glob classes permitted when this is the sole profile (docs-only gate). */
  allowedPathClasses?: string[];
  /** Promote evidence must explain why code gates do not apply. */
  requiresAdminPromoteEvidence?: boolean;
};

/** Registered verification profiles — every ready task must reference one or more. */
export const VERIFICATION_PROFILE_COMMANDS: Record<VerificationProfile, ProfileCommandSpec[]> = {
  'ma-skills': [
    { command: 'npm run verify:ma-skills', required: true, blocking: true },
  ],
  oracles: [
    { command: 'npm run verify:oracles', required: true, blocking: true },
  ],
  'map-contract-verify': [
    { command: 'node scripts/verify-filter-contract.mjs', required: true, blocking: true },
  ],
  'data-provenance': [
    { command: 'npm run test:chain', required: true, blocking: true },
  ],
  'cross-surface-parity': [
    { command: 'npx vitest run src/lib/saved-searches/service.unit.test.ts', required: true, blocking: true },
  ],
  'docs-only': [
    { command: 'npm run verify:ma-skills', required: true, blocking: true },
    { command: 'git diff --check', required: true, blocking: true },
  ],
};

export const PROFILE_CONTRACTS: Record<VerificationProfile, ProfileContract> = {
  'ma-skills': { description: 'Skill registry + on-demand frontmatter integrity' },
  oracles: { description: 'High-stakes decision oracles against live fixtures' },
  'map-contract-verify': { description: 'Map filter contract + browser scripts' },
  'data-provenance': { description: 'Decision-chain provenance fixtures' },
  'cross-surface-parity': { description: 'Shared lib consumer parity tests' },
  'docs-only': {
    description: 'Documentation/skills/registry prose only — code gates still required via ma-skills + diff-check',
    allowedPathClasses: [
      'docs/**',
      '.cursor/skills/**',
      'scripts/ma-skill-registry.json',
      '.claude/agent-tasks/**',
    ],
    requiresAdminPromoteEvidence: true,
  },
};

export function isRegisteredProfile(p: string): p is VerificationProfile {
  return p in VERIFICATION_PROFILE_COMMANDS;
}

export function requiredCommandsForProfiles(profiles: VerificationProfile[]): ProfileCommandSpec[] {
  const seen = new Set<string>();
  const out: ProfileCommandSpec[] = [];
  for (const p of profiles) {
    for (const spec of VERIFICATION_PROFILE_COMMANDS[p]) {
      if (seen.has(spec.command)) continue;
      seen.add(spec.command);
      out.push(spec);
    }
  }
  return out;
}

function pathsAllowedForDocsOnly(allowedPaths: string[]): boolean {
  const classes = PROFILE_CONTRACTS['docs-only'].allowedPathClasses ?? [];
  return allowedPaths.every((p) => classes.some((c) => pathMatchesClass(p, c)));
}

function pathMatchesClass(path: string, classGlob: string): boolean {
  if (classGlob.endsWith('/**')) {
    const prefix = classGlob.slice(0, -3);
    return path === prefix || path.startsWith(`${prefix}/`);
  }
  return path === classGlob;
}

export function assertRegisteredVerificationProfiles(
  profiles: VerificationProfile[],
  opts?: { allowedPaths?: string[]; promoteEvidenceRef?: string },
): RegistryResult<true> {
  if (!profiles.length) {
    return {
      ok: false,
      code: 'verification_incomplete',
      message: 'ready tasks require at least one registered verification profile',
    };
  }
  for (const p of profiles) {
    if (!isRegisteredProfile(p)) {
      return { ok: false, code: 'verification_incomplete', message: `unknown verification profile: ${p}` };
    }
  }
  const specs = requiredCommandsForProfiles(profiles);
  const blocking = specs.filter((s) => s.required && s.blocking);
  if (blocking.length === 0) {
    return {
      ok: false,
      code: 'verification_incomplete',
      message: 'verification profile set has no blocking required commands',
    };
  }
  if (profiles.includes('docs-only')) {
    if (profiles.length > 1) {
      return {
        ok: false,
        code: 'verification_incomplete',
        message: 'docs-only profile must be the sole verification profile on a task',
      };
    }
    const evidence = opts?.promoteEvidenceRef?.trim() ?? '';
    if (!evidence || evidence.length < 12) {
      return {
        ok: false,
        code: 'verification_incomplete',
        message: 'docs-only promote requires --evidence explaining why code gates do not apply (≥12 chars)',
      };
    }
    if (opts?.allowedPaths && !pathsAllowedForDocsOnly(opts.allowedPaths)) {
      return {
        ok: false,
        code: 'verification_incomplete',
        message: 'docs-only tasks may only touch docs/**, .cursor/skills/**, ma-skill-registry.json, .claude/agent-tasks/**',
      };
    }
  }
  return { ok: true, value: true };
}
