#!/usr/bin/env tsx
/**
 * Concurrent mutation probe — used by agent-tasks.concurrent.test.ts only.
 * Env: AGENT_TASK_REGISTRY_PATH, EXPECTED_REV, ACTOR
 */
import { bumpRevisionProbe } from '../src/lib/agent-tasks/operations';

const registryPath = process.env.AGENT_TASK_REGISTRY_PATH;
const expectedRev = process.env.EXPECTED_REV;
const actor = process.env.ACTOR ?? 'probe';

if (!registryPath || expectedRev === undefined) {
  console.error('missing AGENT_TASK_REGISTRY_PATH or EXPECTED_REV');
  process.exit(2);
}

const result = bumpRevisionProbe(registryPath, actor, Number(expectedRev));
console.log(JSON.stringify(result));
process.exit(result.ok ? 0 : 1);
