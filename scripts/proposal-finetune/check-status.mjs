/**
 * Poll the proposal fine-tune job; print the resulting ft: model id when done.
 * Run: OPENAI_API_KEY=... node scripts/proposal-finetune/check-status.mjs
 */
import OpenAI from 'openai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jobTxt = fs.readFileSync(path.join(__dirname, 'finetune_job.txt'), 'utf-8');
const jobId = jobTxt.match(/job_id=(.+)/)?.[1];
if (!process.env.OPENAI_API_KEY) { console.error('Set OPENAI_API_KEY'); process.exit(1); }

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const job = await client.fineTuning.jobs.retrieve(jobId);
console.log(`Status: ${job.status}`);
if (job.fine_tuned_model) {
  console.log(`\n✅ DONE. Model ID:\n   ${job.fine_tuned_model}\n`);
  console.log(`Wire it in: set PROPOSAL_FINETUNED_MODEL=${job.fine_tuned_model} in Vercel,`);
  console.log(`then point lib/proposal/v2.ts at it (existing engine stays as fallback).`);
} else {
  console.log('Not finished yet — re-run in a few minutes. (Fine-tunes take ~10-30 min.)');
}
