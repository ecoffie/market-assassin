import { NextResponse } from 'next/server';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const TEMPLATES = [
  {
    id: 'story-driven',
    name: 'Story-Driven',
    description: 'Personal narrative connecting your experience to agency challenges'
  },
  {
    id: 'stat-heavy',
    name: 'Data-Driven',
    description: 'Statistics-focused post with hard numbers and sources'
  },
  {
    id: 'question-based',
    name: 'Question-Based',
    description: 'Starts with provocative question (GEO optimized)'
  },
  {
    id: 'case-study',
    name: 'Case Study',
    description: 'Problem -> Solution -> Result format'
  },
  {
    id: 'thought-leadership',
    name: 'Thought Leadership',
    description: 'Industry insight with forward-looking perspective'
  },
  {
    id: 'list-tips',
    name: 'List/Tips',
    description: 'Numbered insights or actionable recommendations'
  },
  {
    id: 'contrarian',
    name: 'Contrarian Take',
    description: 'Challenges common assumptions with fresh perspective'
  },
  {
    id: 'actionable',
    name: 'Actionable How-To',
    description: 'Step-by-step guide showing how to do something specific'
  },
  {
    id: 'observation',
    name: 'Observation & Insight',
    description: "Share something interesting you've noticed"
  },
  {
    id: 'x-vs-y',
    name: 'X vs. Y Comparison',
    description: 'Compare two situations for interesting insights'
  },
  {
    id: 'listicle',
    name: 'Listicle',
    description: 'Curated list of resources, tools, or recommendations'
  }
];

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET() {
  return NextResponse.json({
    success: true,
    templates: TEMPLATES
  }, { headers: corsHeaders });
}
