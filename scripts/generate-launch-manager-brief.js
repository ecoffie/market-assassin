#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT_DIR = '/tmp';

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

function parseArgs(argv) {
  const args = { outDir: DEFAULT_OUT_DIR, jsonOnly: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json-only') {
      args.jsonOnly = true;
    } else if (arg === '--out-dir' && argv[i + 1]) {
      args.outDir = path.resolve(argv[i + 1]);
      i += 1;
    }
  }
  return args;
}

function readSource(label, relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  try {
    const stat = fs.statSync(absolutePath);
    return {
      label,
      relativePath,
      absolutePath,
      text: fs.readFileSync(absolutePath, 'utf8'),
      modifiedAt: stat.mtime.toISOString(),
      status: 'loaded',
    };
  } catch (error) {
    return {
      label,
      relativePath,
      absolutePath,
      text: '',
      modifiedAt: null,
      status: 'missing',
      error: error.message,
    };
  }
}

function getSources() {
  return Object.entries(sourceFiles).reduce((acc, [label, relativePath]) => {
    acc[label] = readSource(label, relativePath);
    return acc;
  }, {});
}

function extractCheckboxes(markdown) {
  const items = [];
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

function extractSection(markdown, headingText) {
  const lines = markdown.split('\n');
  const startIndex = lines.findIndex((line) => {
    const trimmed = line.trim();
    return /^#{2,6}\s+/.test(trimmed) && trimmed.replace(/^#{2,6}\s+/, '').trim() === headingText;
  });

  if (startIndex === -1) return '';

  const startHeading = lines[startIndex].match(/^(#{2,6})\s+/)[1].length;
  const section = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const headingMatch = lines[i].match(/^(#{2,6})\s+/);
    if (headingMatch && headingMatch[1].length <= startHeading) break;
    section.push(lines[i]);
  }
  return section.join('\n').trim();
}

function extractBoldSection(markdown, label) {
  const startMarker = `**${label}:**`;
  const start = markdown.indexOf(startMarker);
  if (start === -1) return '';
  const rest = markdown.slice(start + startMarker.length);
  const next = rest.search(/\n\*\*[^*\n]+:\*\*/);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

function parseMarkdownTable(section) {
  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && line.endsWith('|'))
    .filter((line) => !/^\|\s*-+/.test(line))
    .map((line) => line.slice(1, -1).split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length > 1);
}

function normalizeDue(due) {
  if (!due) return 'This week';
  if (/sprint/i.test(due)) return 'This sprint';
  if (/starting now/i.test(due)) return 'Starting now';
  return due;
}

function classifyArea(text) {
  const value = text.toLowerCase();
  if (/api|security|auth|route|endpoint|supabase|stripe|dashboard|engineering|product|canonical|redirect|domain/.test(value)) {
    return 'product';
  }
  if (/coach|tavin|ryan|zach|randie|proof|success/.test(value)) {
    return 'coach';
  }
  if (/branden|package|enterprise|sales|white-glove|white glove|buyer/.test(value)) {
    return 'sales';
  }
  if (/youtube|instagram|linkedin|social|kash|usama|muneeba|content|clip|post|reel/.test(value)) {
    return 'content';
  }
  if (/eric|founder|10-10|decision/.test(value)) {
    return 'founder';
  }
  if (/outreach|reply|call|annelle|sikander|qualified/.test(value)) {
    return 'outreach';
  }
  return 'launch';
}

function inferOwner(text) {
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
  if (/api|security|auth|dashboard|supabase|stripe|engineering|product|canonical|redirect|endpoint/.test(value)) {
    return 'Product/Engineering';
  }
  if (/outreach|customer|qualified/.test(value)) return 'Annelle/Sikander';
  if (/social|youtube|instagram|linkedin|content/.test(value)) return 'Kash/Usama/Muneeba';
  return 'Team';
}

function parseImmediateActions(teamBriefText) {
  const section = extractBoldSection(teamBriefText, 'Immediate actions this week');
  const rows = parseMarkdownTable(section);
  if (!rows.length) return [];

  const [header, ...dataRows] = rows;
  const ownerIndex = header.findIndex((cell) => /owner/i.test(cell));
  const actionIndex = header.findIndex((cell) => /action/i.test(cell));
  const dueIndex = header.findIndex((cell) => /due/i.test(cell));

  return dataRows.map((row) => {
    const owner = row[ownerIndex] || 'Team';
    const action = row[actionIndex] || '';
    return {
      owner,
      area: classifyArea(`${owner} ${action}`),
      action,
      why: 'Keeps MI launch execution tied to customer behavior, activation, or revenue readiness.',
      due_date: normalizeDue(row[dueIndex]),
      status: 'not_started',
      source: sourceFiles.teamBrief,
    };
  });
}

function parseOpenQuestions(markdown, ownerFallback) {
  const section = extractSection(markdown, 'Open Questions');
  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.replace(/^- /, '').trim())
    .filter(Boolean)
    .map((question) => ({
      decisionNeeded: question,
      whyItMatters: 'Blocks clean team execution or customer-facing consistency.',
      owner: ownerFallback,
      due_date: 'This week',
      options: [],
      recommendation: '',
      blockedLaunches: inferBlockedLaunches(question),
      finalDecision: null,
      source: sourceFiles.teamBrief,
    }));
}

function inferBlockedLaunches(text) {
  const value = text.toLowerCase();
  if (/slack|growth ops/.test(value)) return ['Internal Launch Command Center'];
  if (/command center/.test(value)) return ['Internal Launch Command Center'];
  if (/white-glove|white glove/.test(value)) return ['White-Glove Offer', 'MI Pro Launch'];
  if (/contractor|seo|public/.test(value)) return ['Contractor SEO Pages'];
  if (/deal flow|board/.test(value)) return ['Deal Flow Board'];
  if (/domain|\.com|\.org|mi\.govcongiants/.test(value)) return ['MI Pro Launch', 'Contractor SEO Pages'];
  return ['MI Pro Launch'];
}

function ownerActionsFromTodo(todoItems) {
  return todoItems
    .filter((item) => !item.done)
    .slice(0, 16)
    .map((item) => ({
      owner: inferOwner(item.text),
      area: classifyArea(item.text),
      action: item.text,
      why: 'Open action from the current source-of-truth task list.',
      due_date: classifyArea(item.text) === 'product' ? 'This sprint' : 'This week',
      status: 'not_started',
      source: sourceFiles.todo,
    }));
}

function scoreLaunch(program, todoItems, sourceText) {
  const relevantTodos = todoItems.filter((item) => {
    const text = item.text.toLowerCase();
    return program.keywords.some((keyword) => text.includes(keyword));
  });
  const openRelevantTodos = relevantTodos.filter((item) => !item.done);
  const hasSourceSignals = program.keywords.some((keyword) => sourceText.toLowerCase().includes(keyword));

  let health = openRelevantTodos.length > 0 ? 'yellow' : 'green';
  if (openRelevantTodos.length >= 5) health = 'red';
  if (program.name === 'Deal Flow Board' && openRelevantTodos.length === 0) health = 'yellow';
  if (!hasSourceSignals) health = health === 'green' ? 'yellow' : health;

  return {
    ...program,
    health,
    changes: relevantTodos.filter((item) => item.done).slice(0, 5).map((item) => item.text),
    blockers: openRelevantTodos.slice(0, 5).map((item) => item.text),
    customerSignals: customerSignalsFor(program.name),
    productReadiness: productReadinessFor(program.name, openRelevantTodos.length),
    contentReadiness: contentReadinessFor(program.name),
    outreachReadiness: outreachReadinessFor(program.name),
    actions: openRelevantTodos.slice(0, 5).map((item) => ({
      owner: inferOwner(item.text),
      area: classifyArea(item.text),
      action: item.text,
      due_date: classifyArea(item.text) === 'product' ? 'This sprint' : 'This week',
      status: 'not_started',
      source: sourceFiles.todo,
    })),
  };
}

function customerSignalsFor(launchName) {
  if (launchName === 'MI Free Rollout') {
    return ['Profile completion', 'custom NAICS setup', 'first alert open', 'first MI login'];
  }
  if (launchName === 'MI Pro Launch') {
    return ['Briefing opens/clicks', 'time in MI', 'saved opportunities', 'pipeline/team/proposal activity'];
  }
  if (launchName === 'May 30 Bootcamp') {
    return ['Livestream viewers', 'registrants', 'replies', 'booked calls', 'upgrade interest'];
  }
  if (launchName === 'White-Glove Offer') {
    return ['Budget signal', 'team size', 'urgent pursuit pain', 'package presentation follow-up'];
  }
  if (launchName === 'Contractor SEO Pages') {
    return ['Organic search traffic', 'contractor page views', 'MI deep-link clicks', 'signup conversion'];
  }
  if (launchName === 'Deal Flow Board') {
    return ['Team invites', 'shared pursuits', 'partner adds', 'proposal tasks'];
  }
  return ['Owner updates', 'blocked decisions', 'fresh metrics', 'team action completion'];
}

function productReadinessFor(launchName, blockerCount) {
  const base = blockerCount ? [`${blockerCount} open product/task dependencies`] : ['No matching open task dependencies found'];
  if (launchName === 'Internal Launch Command Center') {
    return ['V1 shell documented', 'live Supabase/Stripe/email/app wiring still pending', ...base];
  }
  return base;
}

function contentReadinessFor(launchName) {
  if (launchName === 'May 30 Bootcamp') {
    return ['Needs platform demo language, proof stories, and offer path assets aligned to MI Free / MI Pro / white-glove.'];
  }
  if (launchName === 'Contractor SEO Pages') {
    return ['Needs public/gated copy that ranks on Google while pushing deeper workflows into MI.'];
  }
  return ['Use MI Free / MI Pro / MI Internal / white-glove language consistently.'];
}

function outreachReadinessFor(launchName) {
  if (launchName === 'MI Free Rollout') {
    return ['Audience activation should be treated as a filter; high-intent behavior gets human follow-up.'];
  }
  if (launchName === 'White-Glove Offer') {
    return ['Branden and Eric need clean context before enterprise or high-ticket conversations.'];
  }
  return ['Annelle/Sikander should prioritize qualified, active, profile-complete, paid, or responsive users.'];
}

function calculateFreshness(sources) {
  const now = Date.now();
  const byFile = Object.values(sources).reduce((acc, source) => {
    if (source.status !== 'loaded') {
      acc[source.label] = 'missing';
      return acc;
    }
    const ageHours = (now - new Date(source.modifiedAt).getTime()) / 36e5;
    acc[source.label] = ageHours <= 72 ? 'fresh' : ageHours <= 168 ? 'aging' : 'stale';
    return acc;
  }, {});

  return {
    todo: byFile.todo || 'unknown',
    outreach: 'unknown',
    stripe: 'unknown',
    supabase: 'unknown',
    content: byFile.teamBrief === 'fresh' ? 'manual-fresh' : 'manual',
    sourceFiles: byFile,
  };
}

function domainWarnings(text) {
  const patterns = [
    { name: 'tools.govcongiants.org', regex: /tools\.govcongiants\.org/gi },
    { name: 'govcongiants.org', regex: /(?<!tools\.)govcongiants\.org/gi },
    { name: 'shop links', regex: /\bshop\.govcongiants\.[a-z]+|\/shop\b/gi },
  ];

  return patterns
    .map((pattern) => ({
      label: pattern.name,
      occurrences: (text.match(pattern.regex) || []).length,
    }))
    .filter((item) => item.occurrences > 0);
}

function buildMarkdown(report) {
  const lines = [];
  lines.push('# MI Launch Manager Brief');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push('## Launch Health');
  report.launches.forEach((launch) => {
    lines.push(`- ${launch.name}: ${launch.health.toUpperCase()} - ${launch.objective}`);
    if (launch.blockers.length) {
      lines.push(`  Blockers: ${launch.blockers.slice(0, 2).join('; ')}`);
    }
  });
  lines.push('');
  lines.push('## Team Broadcast Draft');
  lines.push(report.teamBroadcastDraft.headline);
  lines.push('');
  report.teamBroadcastDraft.whatChanged.forEach((item) => lines.push(`- ${item}`));
  lines.push('');
  lines.push('## Owner Actions');
  report.ownerActions.slice(0, 12).forEach((action) => {
    lines.push(`- ${action.owner} (${action.area}): ${action.action} [${action.due_date}]`);
  });
  lines.push('');
  lines.push('## Open Decisions');
  report.decisions.forEach((decision) => {
    lines.push(`- ${decision.owner}: ${decision.decisionNeeded}`);
  });
  lines.push('');
  lines.push('## Domain Policy');
  lines.push(`- Public/sales/SEO: ${report.domainPolicy.publicSite}`);
  lines.push(`- MI app/account/admin: ${report.domainPolicy.miPlatform}`);
  lines.push(`- Transition only: ${report.domainPolicy.transitionSurfaces.join(', ')}`);
  return `${lines.join('\n')}\n`;
}

function buildReport() {
  const sources = getSources();
  const todoItems = extractCheckboxes(sources.todo.text);
  const allSourceText = Object.values(sources).map((source) => source.text).join('\n\n');
  const immediateActions = parseImmediateActions(sources.teamBrief.text);
  const todoActions = ownerActionsFromTodo(todoItems);
  const openDecisions = [
    ...parseOpenQuestions(sources.teamBrief.text, 'Eric'),
    ...parseOpenQuestions(sources.roadmap.text, 'Eric/Product'),
  ];

  const launches = launchPrograms.map((program) => scoreLaunch(program, todoItems, allSourceText));
  const warnings = domainWarnings(allSourceText);

  return {
    generatedAt: new Date().toISOString(),
    sourceFiles: Object.values(sources).map((source) => ({
      label: source.label,
      path: source.relativePath,
      status: source.status,
      modifiedAt: source.modifiedAt,
    })),
    domainPolicy: {
      publicSite: 'https://govcongiants.com',
      miPlatform: 'https://mi.govcongiants.com',
      transitionSurfaces: ['.org', 'tools.govcongiants.org', 'shop URLs'],
      rule: 'New public/sales/SEO links go to govcongiants.com. New product/account/app links go to mi.govcongiants.com.',
      warnings,
    },
    launches,
    ownerActions: [...immediateActions, ...todoActions],
    teamBroadcastDraft: {
      headline: 'GovCon Giants is operating the MI launch from one customer-first source of truth.',
      whatChanged: [
        'Market Intelligence is the core product; training supports onboarding and success.',
        'MI Free, MI Pro, MI Internal, and white-glove must be used consistently.',
        'Customers and users come before advisory outreach; high-intent behavior gets human attention.',
        'Public pages belong on govcongiants.com, and app/account/admin workflows belong on mi.govcongiants.com.',
      ],
      owners: immediateActions.map((action) => `${action.owner}: ${action.action}`),
      externalLanguage: [
        'MI helps small businesses find, evaluate, pursue, and win federal contracts.',
        'MI Free gives basic opportunity alerts and profile setup.',
        'MI Pro gives paid intelligence, briefings, forecasts, recompetes, contractors, pipeline, teaming, and proposal workflows.',
        'White-glove is execution support for committed customers.',
      ],
      doNotSay: [
        'Do not position this as another training program.',
        'Do not use old product names as the main customer-facing offer when MI is the unified product.',
        'Do not send new customer-facing links to .org, tools, or shop unless the task is specifically a redirect/compatibility fix.',
        'Do not promise guaranteed contract wins.',
      ],
    },
    decisions: openDecisions,
    blockers: launches.flatMap((launch) => launch.blockers.map((blocker) => ({
      launch: launch.name,
      blocker,
      owner: inferOwner(blocker),
      area: classifyArea(blocker),
    }))),
    freshness: calculateFreshness(sources),
  };
}

function main() {
  const args = parseArgs(process.argv);
  const report = buildReport();
  fs.mkdirSync(args.outDir, { recursive: true });

  const jsonPath = path.join(args.outDir, 'mi-launch-manager-brief.json');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

  let markdownPath = null;
  if (!args.jsonOnly) {
    markdownPath = path.join(args.outDir, 'mi-launch-manager-brief.md');
    fs.writeFileSync(markdownPath, buildMarkdown(report));
  }

  const summary = {
    generatedAt: report.generatedAt,
    launches: report.launches.length,
    ownerActions: report.ownerActions.length,
    decisions: report.decisions.length,
    blockers: report.blockers.length,
    outputs: {
      json: jsonPath,
      markdown: markdownPath,
    },
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
