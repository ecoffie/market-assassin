import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error — plain .mjs script, no type declarations
import { prodDeployRefusal } from '../../../scripts/refuse-prod-deploy.mjs';

const repo = path.resolve(__dirname, '../../..');

describe('production deploys are not a package script', () => {
  it('no package.json script passes --prod', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    for (const [name, command] of Object.entries(pkg.scripts)) {
      expect(command, name).not.toMatch(/--prod/);
    }
    expect(pkg.scripts.deploy).toBe('node scripts/refuse-prod-deploy.mjs');
    expect(pkg.scripts['deploy:preview']).toBe('node scripts/refuse-prod-deploy.mjs');
  });

  it('refuses a production flag and allows a plain preview', () => {
    expect(prodDeployRefusal(['--prod'])).toMatch(/REFUSED/);
    expect(prodDeployRefusal(['promote'])).toMatch(/REFUSED/);
    expect(prodDeployRefusal(['rollback'])).toMatch(/REFUSED/);
    expect(prodDeployRefusal(['redeploy'])).toMatch(/REFUSED/);
    expect(prodDeployRefusal(['--skip-domain'])).toMatch(/REFUSED/);
    expect(prodDeployRefusal([])).toBeNull();
  });
});
