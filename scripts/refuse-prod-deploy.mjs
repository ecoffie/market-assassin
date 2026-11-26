#!/usr/bin/env node
/**
 * Preview-only deploy. Production ships when a PR merges to main and Vercel
 * Git builds that commit. Agents have no chat-approval exception.
 *
 *   npm run deploy
 *   npm run deploy:preview
 *   npm run deploy -- --prod     → refused
 */
import { spawnSync } from 'node:child_process';

export function prodDeployRefusal(argv) {
  const blob = argv.join(' ');
  if (/--prod\b|--production\b|--skip-domain\b|(^|\s)(promote|rollback|redeploy)(\s|$)/.test(blob)) {
    return 'REFUSED: production deploys only from main through Vercel Git. No vercel --prod, promote, rollback, redeploy, or --skip-domain. Use `npm run deploy:preview` for a preview.';
  }
  return null;
}

const isCli = process.argv[1] && process.argv[1].endsWith('refuse-prod-deploy.mjs');
if (isCli) {
  const args = process.argv.slice(2);
  const refusal = prodDeployRefusal(args);
  if (refusal) {
    console.error(refusal);
    process.exit(1);
  }
  const result = spawnSync('vercel', ['deploy', ...args], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
