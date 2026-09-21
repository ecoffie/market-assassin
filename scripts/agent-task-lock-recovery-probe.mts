import { acquireRegistryLock, recoverStaleLockDirAtomic } from '../src/lib/agent-tasks/lock';
import { resolveRegistryPath } from '../src/lib/agent-tasks/registry';

const regPath = resolveRegistryPath(process.cwd());
const mode = process.env.MODE ?? 'recover';

if (mode === 'acquire') {
  const lock = acquireRegistryLock({ registryPath: regPath, owner: 'live-acquirer', waitMs: 2000 });
  if (!lock.ok) {
    console.log(JSON.stringify({ ok: false, code: lock.code }));
    process.exit(0);
  }
  console.log(JSON.stringify({ ok: true, owner: lock.value.meta.owner }));
  lock.value.release();
  process.exit(0);
}

const recovered = recoverStaleLockDirAtomic({ registryPath: regPath });
if (!recovered.ok) {
  console.log(JSON.stringify({ ok: false, code: recovered.code }));
  process.exit(0);
}
console.log(JSON.stringify({ ok: true, previousOwner: recovered.value?.owner ?? null }));
