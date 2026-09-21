#!/usr/bin/env tsx
/** Test helper — first-use bootstrap probe under shared runtime lock. */
import { mutateRegistry } from '../../../src/lib/agent-tasks/registry';

const path = process.env.RUNTIME_PATH;
if (!path) {
  console.error('missing RUNTIME_PATH');
  process.exit(1);
}

const r = mutateRegistry(
  path,
  null,
  () => ({
    ok: false,
    code: 'task_not_found',
    message: 'bootstrap probe',
  }),
  { lockOwner: process.env.LOCK_OWNER ?? 'bootstrap-probe' },
);

process.exit(r.ok || (!r.ok && r.code === 'task_not_found') ? 0 : 1);
