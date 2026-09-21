import { existsSync } from 'node:fs';
import { lockDirForRegistry } from './lock';
import { readRegistryFile, resolveRuntimeRegistryPath, resolveSeedRegistryPath } from './registry';
import { resolveGitCommonDir, resolveGitRoot } from './git-paths';

export type RegistryDoctorReport = {
  repositoryRoot: string | null;
  gitCommonDir: string | null;
  trackedSeed: string | null;
  runtimeRegistry: string | null;
  lockDirectory: string | null;
  runtimeRevision: number | null;
  runtimeTaskCount: number | null;
  runtimeExists: boolean;
  runtimeEqualsSeed: boolean | null;
  runtimeIsShared: boolean | null;
  lockPresent: boolean;
  resolutionError: string | null;
};

/** Read-only path/state diagnostic — never mutates registry or acquires locks. */
export function diagnoseRegistry(cwd: string, override?: string): RegistryDoctorReport {
  const root = resolveGitRoot(cwd);
  const common = resolveGitCommonDir(cwd);
  const seed = resolveSeedRegistryPath(cwd);
  const runtime = resolveRuntimeRegistryPath(cwd, override);

  const report: RegistryDoctorReport = {
    repositoryRoot: root.ok ? root.value : null,
    gitCommonDir: common.ok ? common.value : null,
    trackedSeed: seed.ok ? seed.value : null,
    runtimeRegistry: runtime.ok ? runtime.value : null,
    lockDirectory: runtime.ok ? lockDirForRegistry(runtime.value) : null,
    runtimeRevision: null,
    runtimeTaskCount: null,
    runtimeExists: false,
    runtimeEqualsSeed: null,
    runtimeIsShared: null,
    lockPresent: false,
    resolutionError: runtime.ok ? null : `${runtime.code}: ${runtime.message}`,
  };

  if (runtime.ok) {
    report.runtimeExists = existsSync(runtime.value);
    report.lockPresent = existsSync(lockDirForRegistry(runtime.value));
    report.runtimeEqualsSeed =
      seed.ok ? runtime.value === seed.value : null;
    report.runtimeIsShared =
      common.ok
        ? runtime.value.startsWith(`${common.value}/`)
          || runtime.value === common.value
        : null;

    if (report.runtimeExists) {
      const read = readRegistryFile(runtime.value);
      if (read.ok) {
        report.runtimeRevision = read.value.revision;
        report.runtimeTaskCount = Object.keys(read.value.tasks).length;
      }
    }
  }

  return report;
}
