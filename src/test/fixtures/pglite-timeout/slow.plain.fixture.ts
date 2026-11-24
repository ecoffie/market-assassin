import { describe, it, expect, beforeAll } from 'vitest';
// A SETUP longer than vitest's 10s default hookTimeout (PGlite boot + migrations under load look like this).
beforeAll(async () => { await new Promise((r) => setTimeout(r, 10_500)); });
describe('slow setup', () => { it('runs after a >10s beforeAll', () => { expect(true).toBe(true); }); });
