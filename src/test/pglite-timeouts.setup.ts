import { expect, vi } from 'vitest';
import { PGLITE_HOOK_TIMEOUT_MS } from './pglite-timeouts';

// Every *.pglite.* test file (current and future) gets the longer SETUP budget; nothing else changes.
if (/\.pglite\./.test(String(expect.getState().testPath ?? ''))) vi.setConfig({ hookTimeout: PGLITE_HOOK_TIMEOUT_MS });
