/**
 * refresh-contracts used to insert into cron_logs, which production does not
 * use for run history (0 rows). The dashboard and the watchdog read cron_job_runs
 * through reportCronOutcome. The scheduled route defaults to preview and must
 * not be recorded as a successful execute.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(process.cwd(), 'src/app/api/cron/refresh-contracts/route.ts'), 'utf8');

describe('refresh-contracts records runs where ops reads them', () => {
  it('does not write cron_logs', () => {
    expect(src).not.toMatch(/from\('cron_logs'\)/);
  });

  it('a preview is partial, and an execute with errors is not a clean success', () => {
    expect(src).toContain("reportCronOutcome('refresh-contracts', 'partial', 'mode=preview; contract file not written')");
    expect(src).toMatch(/reportCronOutcome\(\s*'refresh-contracts',\s*errors\.length \? 'partial' : 'success'/);
    expect(src).toContain("reportCronOutcome('refresh-contracts', 'error'");
  });
});
