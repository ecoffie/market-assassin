/**
 * Admin: Launch Manager Brief
 *
 * Read-only operating brief built from the launch markdown/source-of-truth files.
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { verifyAdminPassword } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

type SourceFile = {
  label: string;
  relativePath: string;
  text: string;
  modifiedAt: string | null;
  status: 'loaded' | 'missing';
  error?: string;
};

const sourceFiles = {
  todo: 'tasks/todo.md',
  teamBrief: 'docs/strategy/MI-TEAM-ALIGNMENT-SLACK-BRIEF.md',
  commandCenterPrd: 'docs/strategy/MI-INTERNAL-COMMAND-CENTER-PRD.md',
  roadmap: 'tasks/MI-OPERATING-SYSTEM-ROADMAP.md',
};

const launchPrograms = [
  {
    name: 'MI Free Rollout',
    status: 'active',
    objective: 'Activate the audience, complete profiles, and identify users showing real intent.',
    keywords: ['mi free', 'free rollout', 'profile', 'activation', 'onboarding'],
  },
  {
    name: 'MI Pro Launch',
    status: 'active',
    objective: 'Convert serious users into weekly MI intelligence workflows.',
    keywords: ['mi pro', 'briefing', 'forecast', 'recompete', 'contractor', 'pipeline'],
  },
  {
    name: 'May 30 Bootcamp',
    status: 'planning',
    objective: 'Demonstrate MI and qualify serious buyers for Pro, team, bundle, or white-glove paths.',
    keywords: ['may 30', 'bootcamp'],
  },
  {
    name: 'White-Glove Offer',
    status: 'planning',
    objective: 'Move committed customers into execution support when they need help pursuing and winning.',
    keywords: ['white-glove', 'white glove', 'enterprise', 'package'],
  },
  {
    name: 'Contractor SEO Pages',
    status: 'planning',
    objective: 'Attract Google users with public contractor sales history and gate deeper MI workflows.',
    keywords: ['seo', 'contractor', 'canonical', 'public', 'google'],
  },
  {
    name: 'Deal Flow Board',
    status: 'planning',
    objective: 'Give groups and teams a shared board for opportunities, pursuits, partners, and next actions.',
    keywords: ['deal flow', 'teaming', 'shared pursuit', 'partner'],
  },
  {
    name: 'Internal Launch Command Center',
    status: 'active',
    objective: 'Give the team one private operating link for launch state, owners, queues, and decisions.',
    keywords: ['command center', 'launch manager', 'internal', 'owner action'],
  },
];

function readSource(label: string, relativePath: string): SourceFile {
  const absolutePath = path.join(process.cwd(), relativePath);
  try {
    const stat = fs.statSync(absolutePath);
    return {
      label,
      relativePath,
      text: fs.readFileSync(absolutePath, 'utf8'),
      modifiedAt: stat.mtime.toISOString(),
      status: 'loaded',
    };
  } catch (error) {
    return {
      label,
      relativePath,
      text: '',
      modifiedAt: null,
      status: 'missing',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function extractCheckboxes(markdown: string) {
  const items: Array<{ done: boolean; text: string }> = [];
  const regex = /^- \[( |x|X)\] (.+)$/gm;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    items.push({
      done: match[1].toLowerCase() === 'x',
      text: match[2].trim(),
    });
  }
  return items;
}

function extractOpenQuestions(markdown: string) {
  const lines = markdown.split('\n');
  const startIndex = lines.findIndex(line => /^#{2,6}\s+Open Questions\s*$/.test(line.trim()));
  if (startIndex === -1) return [];

  const startLevel = (lines[startIndex].match(/^(#{2,6})/)?.[1].length || 2);
  const questions: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const heading = lines[i].match(/^(#{2,6})\s+/);
    if (heading && heading[1].length <= startLevel) break;
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('- ')) questions.push(trimmed.replace(/^- /, '').trim());
  }
  return questions;
}

function classifyArea(text: string) {
  const value = text.toLowerCase();
  if (/api|security|auth|route|endpoint|supabase|stripe|dashboard|engineering|product|canonical|redirect|domain/.test(value)) return 'product';
  if (/coach|tavin|ryan|zach|randie|proof|success/.test(value)) return 'coach';
  if (/branden|package|enterprise|sales|white-glove|white glove|buyer/.test(value)) return 'sales';
  if (/youtube|instagram|linkedin|social|kash|usama|muneeba|content|clip|post|reel/.test(value)) return 'content';
  if (/eric|founder|10-10|decision/.test(value)) return 'founder';
  if (/outreach|reply|call|annelle|sikander|qualified/.test(value)) return 'outreach';
  return 'launch';
}

function inferOwner(text: string) {
  const value = text.toLowerCase();
  if (/annelle/.test(value)) return 'Annelle';
  if (/sikander/.test(value)) return 'Sikander';
  if (/tavin/.test(value)) return 'Tavin';
  if (/branden/.test(value)) return 'Branden';
  if (/kash/.test(value)) return 'Kash';
  if (/usama/.test(value)) return 'Usama';
  if (/muneeba/.test(value)) return 'Muneeba';
  if (/eric|10-10|founder/.test(value)) return 'Eric';
  if (/coach|customer-success/.test(value)) return 'Coaches';
  if (/api|security|auth|dashboard|supabase|stripe|engineering|product|canonical|redirect|endpoint/.test(value)) return 'Product/Engineering';
  if (/outreach|customer|qualified/.test(value)) return 'Annelle/Sikander';
  if (/social|youtube|instagram|linkedin|content/.test(value)) return 'Kash/Usama/Muneeba';
  return 'Team';
}

function domainWarnings(text: string) {
  return [
    { label: 'tools.govcongiants.org', occurrences: (text.match(/tools\.govcongiants\.org/gi) || []).length },
    { label: 'govcongiants.org', occurrences: (text.match(/(?<!tools\.)govcongiants\.org/gi) || []).length },
    { label: 'shop links', occurrences: (text.match(/\bshop\.govcongiants\.[a-z]+|\/shop\b/gi) || []).length },
  ].filter(item => item.occurrences > 0);
}

function scoreLaunch(
  program: typeof launchPrograms[number],
  todoItems: Array<{ done: boolean; text: string }>,
  sourceText: string
) {
  const relevantTodos = todoItems.filter(item => {
    const text = item.text.toLowerCase();
    return program.keywords.some(keyword => text.includes(keyword));
  });
  const openRelevantTodos = relevantTodos.filter(item => !item.done);
  const hasSourceSignals = program.keywords.some(keyword => sourceText.toLowerCase().includes(keyword));

  let health: 'green' | 'yellow' | 'red' = openRelevantTodos.length > 0 ? 'yellow' : 'green';
  if (openRelevantTodos.length >= 5) health = 'red';
  if (program.name === 'Deal Flow Board' && openRelevantTodos.length === 0) health = 'yellow';
  if (!hasSourceSignals) health = health === 'green' ? 'yellow' : health;

  return {
    ...program,
    health,
    blockers: openRelevantTodos.slice(0, 5).map(item => item.text),
    changes: relevantTodos.filter(item => item.done).slice(0, 5).map(item => item.text),
    actions: openRelevantTodos.slice(0, 5).map(item => ({
      owner: inferOwner(item.text),
      area: classifyArea(item.text),
      action: item.text,
      dueDate: classifyArea(item.text) === 'product' ? 'This sprint' : 'This week',
    })),
  };
}

function buildLaunchManagerBrief() {
  const sources = Object.entries(sourceFiles).map(([label, relativePath]) => readSource(label, relativePath));
  const sourceByLabel = new Map(sources.map(source => [source.label, source]));
  const todoItems = extractCheckboxes(sourceByLabel.get('todo')?.text || '');
  const allSourceText = sources.map(source => source.text).join('\n\n');
  const openTodos = todoItems.filter(item => !item.done);
  const launches = launchPrograms.map(program => scoreLaunch(program, todoItems, allSourceText));

  const ownerActions = openTodos.slice(0, 20).map(item => ({
    owner: inferOwner(item.text),
    area: classifyArea(item.text),
    action: item.text,
    why: 'Open action from the current source-of-truth task list.',
    dueDate: classifyArea(item.text) === 'product' ? 'This sprint' : 'This week',
    source: sourceFiles.todo,
  }));

  const decisions = [
    ...(extractOpenQuestions(sourceByLabel.get('teamBrief')?.text || '')),
    ...(extractOpenQuestions(sourceByLabel.get('roadmap')?.text || '')),
  ].slice(0, 12).map(question => ({
    owner: 'Eric',
    decisionNeeded: question,
    whyItMatters: 'Blocks clean team execution or customer-facing consistency.',
    dueDate: 'This week',
  }));

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    domainPolicy: {
      publicSite: 'https://govcongiants.com',
      miPlatform: 'https://mi.govcongiants.com',
      transitionSurfaces: ['.org', 'tools.govcongiants.org', 'shop URLs'],
      rule: 'New public/sales/SEO links go to govcongiants.com. New product/account/app links go to mi.govcongiants.com.',
      warnings: domainWarnings(allSourceText),
    },
    launches,
    ownerActions,
    decisions,
    freshness: {
      sources: sources.map(source => ({
        label: source.label,
        path: source.relativePath,
        status: source.status,
        modifiedAt: source.modifiedAt,
        error: source.error,
      })),
    },
  };
}

export async function GET(request: NextRequest) {
  const password = request.nextUrl.searchParams.get('password');

  if (!verifyAdminPassword(password)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json(buildLaunchManagerBrief(), {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
