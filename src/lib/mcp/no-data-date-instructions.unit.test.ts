import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NO_DATA_DATES } from '@/lib/ask-mindy/outreach-rules';

/**
 * Eric, 2026-11-27: "apply the no date rules everywhere". No prompt, tool description, host rule or tool hint may
 * tell the model or host to STATE how current Mindy's data is ("as of", "data current through", a verified or
 * snapshot date). Opportunity facts (deadlines, end dates, a bill's action date) and dateless lag caveats stay.
 * Source text is read directly: these strings live inside large modules (route handler, registry, tools).
 */
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('instructions never ask for a data date', () => {
  it('chat system prompt: lag in words, no "current through that date", no "as of the as_of date", no "verified date"', () => {
    const route = src('src/app/api/app/chat/route.ts');
    expect(route).not.toMatch(/current through that date/);
    expect(route).not.toMatch(/as of the as_of date/);
    expect(route).not.toMatch(/with its verified date/);
    expect(route).toMatch(/say in words, without a date, that recent awards may not be published yet/);
    expect(route).toMatch(/never state an email or phone the tool did not return/); // kept
  });

  it('tool descriptions (registry + server): no "data current through <date>", no "dated by as_of"', () => {
    for (const f of ['src/lib/mcp/tool-registry.ts', 'src/mcp/server.ts']) {
      const t = src(f);
      expect(t).not.toMatch(/data current through <date>/);
      expect(t).not.toMatch(/dated by as_of/);
    }
    expect(src('src/lib/mcp/tool-registry.ts')).toMatch(/recent awards may not appear yet" \(in words, no data date\)/);
  });

  it('legislation host rules: the bill action date stays, the corpus as-of date is never for the answer', () => {
    const t = src('src/mcp/tools/legislation-status.ts');
    expect(t).not.toMatch(/give their as-of date/);
    expect(t).not.toMatch(/latest stored action as of <date>/);
    expect(t).not.toMatch(/discovery complete as of \$\{/);
    expect(t).not.toMatch(/dates from _meta\.as_of/);
    expect(t).toMatch(/latest_stored_action\.date/);
  });

  it('tool hints: no snapshot / verified / as-of dates; staleness warnings stay in words', () => {
    const sam = src('src/mcp/tools/sam-entity.ts');
    expect(sam).not.toMatch(/as of the date shown/);
    expect(sam).toMatch(/may be out of date \(not re-verified just now\); confirm on SAM\.gov before relying on them/);
    const sblo = src('src/mcp/tools/sblo-contact.ts');
    expect(sblo).not.toMatch(/ as of \$\{|\. As of \$\{|re-verified since \$\{/);
    expect(sblo).toMatch(/no longer shown on the company's page; confirm it before using it/);
    expect(src('src/mcp/tools/market-depth.ts')).not.toMatch(/Data as of \$\{/);
    const fc = src('src/mcp/tools/forecasts.ts');
    expect(fc).not.toMatch(/saved answer from \$\{/);
    expect(fc).toMatch(/saved answer from an earlier lookup and may be out of date/);
    const t2 = src('src/lib/chat/tier2-tools.ts');
    expect(t2).not.toMatch(/saved answer from \$\{/);
    expect(t2).toMatch(/they may be out of date/);
  });

  it('the shared DATES rule names the freshness phrasings and keeps the warning in words', () => {
    expect(NO_DATA_DATES).toMatch(/"current through"/);
    expect(NO_DATA_DATES).toMatch(/"verified on", "last updated"/);
    expect(NO_DATA_DATES).toMatch(/say so in words without a date/);
    expect(NO_DATA_DATES).toMatch(/never drop that warning/);
    expect(NO_DATA_DATES).toMatch(/response deadlines, contract end dates, registration expiry/);
  });
});
