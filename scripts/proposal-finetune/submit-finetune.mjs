/**
 * Submit the proposal fine-tune job to OpenAI (mirrors the Content Reaper
 * LinkedIn submit: gpt-4o-mini, n_epochs 3). Run AFTER reviewing
 * proposal_finetune_review.md.
 *
 * Run: OPENAI_API_KEY=... node scripts/proposal-finetune/submit-finetune.mjs
 */
import OpenAI from 'openai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRAINING_FILE = path.join(__dirname, 'proposal_finetune.jsonl');

if (!process.env.OPENAI_API_KEY) { console.error('Set OPENAI_API_KEY'); process.exit(1); }
if (!fs.existsSync(TRAINING_FILE)) { console.error('Run build-training-data.mjs first'); process.exit(1); }

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const n = fs.readFileSync(TRAINING_FILE, 'utf-8').trim().split('\n').length;
console.log(`Training file: ${n} examples`);
if (n < 10) { console.error('OpenAI needs ≥10 examples'); process.exit(1); }

console.log('1. Uploading training file…');
const file = await client.files.create({ file: fs.createReadStream(TRAINING_FILE), purpose: 'fine-tune' });
console.log(`   ✓ ${file.id} (${file.bytes} bytes)`);

console.log('2. Creating fine-tuning job…');
const job = await client.fineTuning.jobs.create({
  training_file: file.id,
  model: 'gpt-4o-mini-2024-07-18',
  suffix: 'govcon-proposals',
  hyperparameters: { n_epochs: 3 },
});
console.log(`   ✓ Job: ${job.id}  status=${job.status}`);

fs.writeFileSync(path.join(__dirname, 'finetune_job.txt'),
  `job_id=${job.id}\nfile_id=${file.id}\nstatus=${job.status}\nmodel=${job.model}\n`);
console.log(`   Saved to finetune_job.txt. Poll with check-status.mjs`);
