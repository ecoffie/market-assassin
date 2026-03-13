'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { calculateDSBSScore, DSBSInput, DSBSScoreResult, SectionScore } from '@/lib/dsbs-scoring';

// ============ TYPES ============

interface BenchmarkData {
  naicsCode: string;
  broadened: boolean;
  totalContractors: number;
  avgContractCount: number;
  medianContractValue: number;
  avgContractValue: number;
  topByValue: { company: string; contractCount: number; totalValue: number }[];
  topByCount: { company: string; contractCount: number; totalValue: number }[];
  percentWithEmail: number;
  percentWithContact: number;
  percentWithSubPlan: number;
  commonAgencies: { name: string; count: number }[];
  userPercentileByContracts: number;
  userPercentileByValue: number;
}

type AppState = 'email' | 'questionnaire' | 'results';

const DESIGNATION_OPTIONS = [
  { value: '8a', label: '8(a) Business Development' },
  { value: 'hubzone', label: 'HUBZone Certified' },
  { value: 'wosb', label: 'Women-Owned Small Business (WOSB)' },
  { value: 'edwosb', label: 'Economically Disadvantaged WOSB (EDWOSB)' },
  { value: 'sdvosb', label: 'Service-Disabled Veteran-Owned (SDVOSB)' },
];

const CERT_OPTIONS = [
  { value: '8a', label: '8(a)' },
  { value: 'hubzone', label: 'HUBZone' },
  { value: 'wosb', label: 'WOSB' },
  { value: 'edwosb', label: 'EDWOSB' },
  { value: 'sdvosb', label: 'SDVOSB' },
];

const DEFAULT_INPUT: DSBSInput = {
  hasUEI: false, hasCAGE: false, hasWebsite: false, hasPhysicalAddress: false, hasDBA: false,
  hasSizeStandard: false, isSmallBusiness: true, designations: [],
  primaryNAICS: '', secondaryNAICSCount: 0, naicsAlignedWithCapabilities: false,
  narrativeLength: 'none', mentionsAgencies: false, mentionsContractVehicles: false,
  hasMeasurableResults: false, hasDifferentiators: false, mentionsSpecificTech: false,
  contractCount: 0, highestContractValue: 'none', agenciesServed: 0, mostRecentYear: 0,
  sbaCerts: [], hasISO: false, hasCMMI: false, hasStateCerts: false, otherCertsCount: 0,
  keywordCount: 'none', hasPSCCodes: false, hasSICCodes: false,
  hasNamedPOC: false, hasDirectPhone: false, hasDirectEmail: false,
};

// ============ COMPONENTS ============

function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer py-2 px-3 rounded-lg hover:bg-slate-800/50 transition-colors">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500" />
      <span className="text-sm text-slate-300">{label}</span>
    </label>
  );
}

function ScoreGauge({ score, tier }: { score: number; tier: string }) {
  const color = score >= 85 ? 'text-green-400' : score >= 70 ? 'text-cyan-400' : score >= 50 ? 'text-amber-400' : 'text-red-400';
  const bg = score >= 85 ? 'bg-green-500/20 border-green-500/30' : score >= 70 ? 'bg-cyan-500/20 border-cyan-500/30' : score >= 50 ? 'bg-amber-500/20 border-amber-500/30' : 'bg-red-500/20 border-red-500/30';
  const ringColor = score >= 85 ? '#4ade80' : score >= 70 ? '#22d3ee' : score >= 50 ? '#fbbf24' : '#f87171';
  const circumference = 2 * Math.PI * 70;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className={`${bg} border rounded-2xl p-8 flex flex-col items-center`}>
      <div className="relative w-44 h-44">
        <svg className="w-44 h-44 -rotate-90" viewBox="0 0 160 160">
          <circle cx="80" cy="80" r="70" fill="none" stroke="#334155" strokeWidth="8" />
          <circle cx="80" cy="80" r="70" fill="none" stroke={ringColor} strokeWidth="8"
            strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
            className="transition-all duration-1000 ease-out" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-5xl font-bold ${color}`}>{score}</span>
          <span className="text-slate-500 text-sm">/100</span>
        </div>
      </div>
      <p className={`mt-4 text-lg font-bold ${color}`}>{tier}</p>
    </div>
  );
}

function SectionCard({ section }: { section: SectionScore }) {
  const [expanded, setExpanded] = useState(false);
  const pct = section.percentage;
  const barColor = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-cyan-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500';
  const priorityColors: Record<string, string> = {
    critical: 'text-red-400 bg-red-500/20 border-red-500/30',
    high: 'text-amber-400 bg-amber-500/20 border-amber-500/30',
    medium: 'text-cyan-400 bg-cyan-500/20 border-cyan-500/30',
    low: 'text-green-400 bg-green-500/20 border-green-500/30',
  };

  return (
    <div className="bg-slate-800/60 rounded-xl border border-slate-700/40 overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full p-4 text-left hover:bg-slate-800/80 transition-colors">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-slate-200">{section.name}</h3>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${priorityColors[section.priority]}`}>
              {section.priority}
            </span>
            <span className="text-sm font-bold text-slate-300">{section.score}/{section.maxScore}</span>
            <svg className={`w-4 h-4 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
        <div className="w-full bg-slate-700 rounded-full h-2">
          <div className={`${barColor} h-2 rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
        </div>
      </button>
      {expanded && section.recommendations.length > 0 && (
        <div className="px-4 pb-4 border-t border-slate-700/40 pt-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Recommendations</p>
          <ul className="space-y-2">
            {section.recommendations.map((rec, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-400">
                <span className="text-amber-400 mt-0.5">*</span>
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function formatCurrency(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

// ============ MAIN PAGE ============

export default function DSBSScorerPage() {
  const [appState, setAppState] = useState<AppState>(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('dsbs_scorer_email')) return 'questionnaire';
    return 'email';
  });
  const [email, setEmail] = useState('');
  const [step, setStep] = useState(1);
  const [input, setInput] = useState<DSBSInput>({ ...DEFAULT_INPUT });
  const [result, setResult] = useState<DSBSScoreResult | null>(null);
  const [benchmark, setBenchmark] = useState<BenchmarkData | null>(null);
  const [loading, setLoading] = useState(false);

  const totalSteps = 8;

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    try {
      await fetch('/api/capture-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), resourceId: 'dsbs-scorer' }),
      });
    } catch { /* non-blocking */ }

    localStorage.setItem('dsbs_scorer_email', email.trim().toLowerCase());
    setAppState('questionnaire');
  };

  const handleScore = useCallback(async () => {
    setLoading(true);

    // Calculate score client-side
    const scoreResult = calculateDSBSScore(input);
    setResult(scoreResult);

    // Fetch benchmark from API
    if (input.primaryNAICS) {
      try {
        const valueMap: Record<string, number> = {
          none: 0, under25k: 12500, '25k_150k': 87500, '150k_750k': 450000, '750k_5m': 2875000, over5m: 7500000,
        };
        const res = await fetch(`/api/dsbs-scorer/benchmark?naics=${input.primaryNAICS}&contracts=${input.contractCount}&value=${valueMap[input.highestContractValue] || 0}`);
        const data = await res.json();
        if (data.success && data.benchmark) {
          setBenchmark(data.benchmark);
        }
      } catch { /* non-blocking */ }
    }

    setLoading(false);
    setAppState('results');
  }, [input]);

  const update = (partial: Partial<DSBSInput>) => setInput(prev => ({ ...prev, ...partial }));

  // ============ RENDER: EMAIL GATE ============
  if (appState === 'email') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-lg w-full">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-slate-100 mb-2">DSBS Profile Scorer</h1>
            <p className="text-slate-400">Rate your Dynamic Small Business Search profile in 2 minutes</p>
          </div>
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-8">
            <div className="space-y-4 mb-6">
              <div className="flex items-start gap-3">
                <span className="text-cyan-400 text-lg">1</span>
                <div><p className="text-slate-200 font-medium">Answer 8 quick sections about your DSBS profile</p></div>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-cyan-400 text-lg">2</span>
                <div><p className="text-slate-200 font-medium">Get a 0-100 score with section breakdowns</p></div>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-cyan-400 text-lg">3</span>
                <div><p className="text-slate-200 font-medium">See how you compare to competitors in your NAICS</p></div>
              </div>
            </div>
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email to start"
                required
                className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
              />
              <button type="submit" className="w-full bg-cyan-500 hover:bg-cyan-600 text-white font-bold py-3 px-6 rounded-lg transition-colors">
                Start Free Assessment
              </button>
            </form>
            <p className="text-xs text-slate-500 text-center mt-4">Free tool. No credit card required.</p>
          </div>
        </div>
      </div>
    );
  }

  // ============ RENDER: RESULTS ============
  if (appState === 'results' && result) {
    return (
      <div className="min-h-screen bg-slate-950 py-8 px-4">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-slate-100 mb-2">Your DSBS Profile Score</h1>
            <p className="text-slate-400">Based on your self-assessment responses</p>
          </div>

          {/* Score Gauge */}
          <div className="flex justify-center mb-8">
            <ScoreGauge score={result.overallScore} tier={result.tierLabel} />
          </div>

          {/* Top 5 Recommendations */}
          {result.topRecommendations.length > 0 && (
            <div className="bg-slate-800/60 rounded-xl border border-slate-700/40 p-6 mb-8">
              <h2 className="text-lg font-bold text-slate-100 mb-4">Top Priority Actions</h2>
              <ol className="space-y-3">
                {result.topRecommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                    <span className="text-sm text-slate-300">{rec}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Section Scores */}
          <h2 className="text-lg font-bold text-slate-100 mb-4">Section Breakdown</h2>
          <div className="space-y-2 mb-8">
            {result.sections.map((section) => (
              <SectionCard key={section.key} section={section} />
            ))}
          </div>

          {/* NAICS Benchmark */}
          {benchmark && (
            <div className="bg-slate-800/60 rounded-xl border border-slate-700/40 p-6 mb-8">
              <h2 className="text-lg font-bold text-slate-100 mb-1">
                NAICS Benchmark: {benchmark.naicsCode}
                {benchmark.broadened && <span className="text-xs text-slate-500 ml-2">(broadened to 3-digit prefix)</span>}
              </h2>
              <p className="text-sm text-slate-500 mb-4">{benchmark.totalContractors} contractors in your space</p>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-slate-900/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-cyan-400">{benchmark.userPercentileByContracts}th</p>
                  <p className="text-xs text-slate-500">Percentile (Contracts)</p>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-cyan-400">{benchmark.userPercentileByValue}th</p>
                  <p className="text-xs text-slate-500">Percentile (Value)</p>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-slate-200">{benchmark.avgContractCount}</p>
                  <p className="text-xs text-slate-500">Avg Contracts</p>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-slate-200">{formatCurrency(benchmark.medianContractValue)}</p>
                  <p className="text-xs text-slate-500">Median Value</p>
                </div>
              </div>

              {/* Top Competitors */}
              {benchmark.topByValue.length > 0 && (
                <>
                  <p className="text-sm font-semibold text-slate-400 mb-2">Top Contractors by Value</p>
                  <div className="overflow-x-auto mb-4">
                    <table className="w-full text-sm">
                      <thead><tr className="text-slate-500 text-xs uppercase">
                        <th className="text-left py-2 px-3">Company</th>
                        <th className="text-right py-2 px-3">Contracts</th>
                        <th className="text-right py-2 px-3">Total Value</th>
                      </tr></thead>
                      <tbody>
                        {benchmark.topByValue.map((c, i) => (
                          <tr key={i} className="border-t border-slate-700/30">
                            <td className="py-2 px-3 text-slate-300">{c.company}</td>
                            <td className="py-2 px-3 text-right text-slate-400">{c.contractCount}</td>
                            <td className="py-2 px-3 text-right text-slate-400">{formatCurrency(c.totalValue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {/* Common Agencies */}
              {benchmark.commonAgencies.length > 0 && (
                <>
                  <p className="text-sm font-semibold text-slate-400 mb-2">Most Common Agencies</p>
                  <div className="flex flex-wrap gap-2">
                    {benchmark.commonAgencies.map((a, i) => (
                      <span key={i} className="px-3 py-1 bg-slate-700/50 text-slate-300 text-xs rounded-full">
                        {a.name} ({a.count})
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Cross-Sell CTAs */}
          {result.crossSells.length > 0 && (
            <div className="mb-8">
              <h2 className="text-lg font-bold text-slate-100 mb-4">Recommended Tools</h2>
              <div className="grid md:grid-cols-3 gap-4">
                {result.crossSells.map((sell, i) => (
                  <Link key={i} href={sell.url} className="bg-slate-800/60 rounded-xl border border-slate-700/40 p-5 hover:border-cyan-500/40 transition-colors block">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-bold text-slate-200">{sell.product}</h3>
                      <span className="text-cyan-400 text-sm font-bold">{sell.price}</span>
                    </div>
                    <p className="text-sm text-slate-400">{sell.reason}</p>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-4 justify-center">
            <button onClick={() => { setAppState('questionnaire'); setStep(1); setResult(null); setBenchmark(null); }}
              className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-slate-300 font-semibold rounded-lg transition-colors">
              Retake Assessment
            </button>
            <Link href="/" className="px-6 py-3 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 font-semibold rounded-lg transition-colors border border-cyan-500/30">
              Explore All Tools
            </Link>
          </div>

          {/* Source */}
          <div className="mt-8 pt-4 border-t border-slate-700/50 text-center">
            <p className="text-xs text-slate-500">
              Benchmark data from SBA Prime Contractor Directory & FPDS. Score is based on your self-assessment — actual DSBS profile may vary.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ============ RENDER: QUESTIONNAIRE ============
  return (
    <div className="min-h-screen bg-slate-950 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-slate-100">DSBS Profile Assessment</h1>
          <p className="text-sm text-slate-400 mt-1">Step {step} of {totalSteps}</p>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-slate-800 rounded-full h-2 mb-8">
          <div className="bg-cyan-500 h-2 rounded-full transition-all duration-300" style={{ width: `${(step / totalSteps) * 100}%` }} />
        </div>

        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          {/* Step 1: Business Identity */}
          {step === 1 && (
            <>
              <h2 className="text-lg font-bold text-slate-100 mb-1">Business Identity</h2>
              <p className="text-sm text-slate-400 mb-4">Does your DSBS profile include these foundational elements?</p>
              <div className="space-y-1">
                <Checkbox checked={input.hasUEI} onChange={(v) => update({ hasUEI: v })} label="I have a UEI (Unique Entity Identifier)" />
                <Checkbox checked={input.hasCAGE} onChange={(v) => update({ hasCAGE: v })} label="I have a CAGE code" />
                <Checkbox checked={input.hasWebsite} onChange={(v) => update({ hasWebsite: v })} label="My company website is listed" />
                <Checkbox checked={input.hasPhysicalAddress} onChange={(v) => update({ hasPhysicalAddress: v })} label="My physical business address is listed" />
                <Checkbox checked={input.hasDBA} onChange={(v) => update({ hasDBA: v })} label="I have a DBA name listed (if applicable)" />
              </div>
            </>
          )}

          {/* Step 2: Size & Type */}
          {step === 2 && (
            <>
              <h2 className="text-lg font-bold text-slate-100 mb-1">Business Size & Type</h2>
              <p className="text-sm text-slate-400 mb-4">Your size and socioeconomic designations determine set-aside eligibility.</p>
              <div className="space-y-4">
                <Checkbox checked={input.hasSizeStandard} onChange={(v) => update({ hasSizeStandard: v })} label="I have declared my SBA size standard" />
                <Checkbox checked={input.isSmallBusiness} onChange={(v) => update({ isSmallBusiness: v })} label="I qualify as a small business" />
                <div>
                  <p className="text-sm font-semibold text-slate-300 mb-2">Socioeconomic Designations</p>
                  {DESIGNATION_OPTIONS.map((opt) => (
                    <Checkbox key={opt.value} checked={input.designations.includes(opt.value)}
                      onChange={(checked) => {
                        const newDesignations = checked
                          ? [...input.designations, opt.value]
                          : input.designations.filter(d => d !== opt.value);
                        update({ designations: newDesignations });
                      }}
                      label={opt.label} />
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Step 3: NAICS Codes */}
          {step === 3 && (
            <>
              <h2 className="text-lg font-bold text-slate-100 mb-1">NAICS Codes</h2>
              <p className="text-sm text-slate-400 mb-4">Agencies search DSBS by NAICS code — more relevant codes means more visibility.</p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-1">Primary NAICS Code</label>
                  <input type="text" value={input.primaryNAICS} onChange={(e) => update({ primaryNAICS: e.target.value })}
                    placeholder="e.g., 541330" maxLength={6}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-cyan-500 focus:border-transparent" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-1">How many secondary NAICS codes do you have?</label>
                  <select value={input.secondaryNAICSCount} onChange={(e) => update({ secondaryNAICSCount: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-200 focus:ring-2 focus:ring-cyan-500 focus:border-transparent">
                    <option value={0}>None</option>
                    <option value={1}>1-2</option>
                    <option value={3}>3-4</option>
                    <option value={5}>5-9</option>
                    <option value={10}>10+</option>
                  </select>
                </div>
                <Checkbox checked={input.naicsAlignedWithCapabilities} onChange={(v) => update({ naicsAlignedWithCapabilities: v })}
                  label="My NAICS codes align with my capabilities narrative" />
              </div>
            </>
          )}

          {/* Step 4: Capabilities Narrative */}
          {step === 4 && (
            <>
              <h2 className="text-lg font-bold text-slate-100 mb-1">Capabilities Narrative</h2>
              <p className="text-sm text-slate-400 mb-4">This is the most important text in your profile — it is what agencies read first.</p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-1">How long is your capabilities narrative?</label>
                  <select value={input.narrativeLength} onChange={(e) => update({ narrativeLength: e.target.value as DSBSInput['narrativeLength'] })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-200 focus:ring-2 focus:ring-cyan-500 focus:border-transparent">
                    <option value="none">I do not have one</option>
                    <option value="short">Short (under 100 words)</option>
                    <option value="medium">Medium (100-250 words)</option>
                    <option value="long">Long (250-500 words)</option>
                    <option value="comprehensive">Comprehensive (500+ words)</option>
                  </select>
                </div>
                <p className="text-sm font-semibold text-slate-300">Does your narrative include:</p>
                <Checkbox checked={input.mentionsAgencies} onChange={(v) => update({ mentionsAgencies: v })} label="Specific agency names you have served or want to serve" />
                <Checkbox checked={input.mentionsContractVehicles} onChange={(v) => update({ mentionsContractVehicles: v })} label="Contract vehicles (GSA Schedule, SEWP, BPAs, etc.)" />
                <Checkbox checked={input.hasMeasurableResults} onChange={(v) => update({ hasMeasurableResults: v })} label="Measurable results ($ saved, % improved, projects delivered)" />
                <Checkbox checked={input.hasDifferentiators} onChange={(v) => update({ hasDifferentiators: v })} label="Clear differentiators vs. competitors" />
                <Checkbox checked={input.mentionsSpecificTech} onChange={(v) => update({ mentionsSpecificTech: v })} label="Specific technologies, tools, or methodologies" />
              </div>
            </>
          )}

          {/* Step 5: Past Performance */}
          {step === 5 && (
            <>
              <h2 className="text-lg font-bold text-slate-100 mb-1">Past Performance</h2>
              <p className="text-sm text-slate-400 mb-4">Past performance is the #1 evaluation factor in most federal proposals.</p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-1">How many federal contracts have you had?</label>
                  <select value={input.contractCount} onChange={(e) => update({ contractCount: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-200 focus:ring-2 focus:ring-cyan-500 focus:border-transparent">
                    <option value={0}>None</option>
                    <option value={1}>1-2</option>
                    <option value={3}>3-5</option>
                    <option value={7}>6-10</option>
                    <option value={15}>11+</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-1">Highest single contract value?</label>
                  <select value={input.highestContractValue} onChange={(e) => update({ highestContractValue: e.target.value as DSBSInput['highestContractValue'] })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-200 focus:ring-2 focus:ring-cyan-500 focus:border-transparent">
                    <option value="none">No contracts yet</option>
                    <option value="under25k">Under $25K</option>
                    <option value="25k_150k">$25K - $150K</option>
                    <option value="150k_750k">$150K - $750K</option>
                    <option value="750k_5m">$750K - $5M</option>
                    <option value="over5m">Over $5M</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-1">How many different agencies have you served?</label>
                  <select value={input.agenciesServed} onChange={(e) => update({ agenciesServed: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-200 focus:ring-2 focus:ring-cyan-500 focus:border-transparent">
                    <option value={0}>None</option>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3-5</option>
                    <option value={6}>6+</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-1">Most recent contract year?</label>
                  <select value={input.mostRecentYear} onChange={(e) => update({ mostRecentYear: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-200 focus:ring-2 focus:ring-cyan-500 focus:border-transparent">
                    <option value={0}>No contracts yet</option>
                    <option value={2026}>2025-2026</option>
                    <option value={2024}>2023-2024</option>
                    <option value={2022}>2021-2022</option>
                    <option value={2019}>Before 2021</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {/* Step 6: Certifications */}
          {step === 6 && (
            <>
              <h2 className="text-lg font-bold text-slate-100 mb-1">Certifications</h2>
              <p className="text-sm text-slate-400 mb-4">Certifications open doors to set-aside contracts and signal quality to buyers.</p>
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-semibold text-slate-300 mb-2">SBA Certifications</p>
                  {CERT_OPTIONS.map((opt) => (
                    <Checkbox key={opt.value} checked={input.sbaCerts.includes(opt.value)}
                      onChange={(checked) => {
                        const newCerts = checked
                          ? [...input.sbaCerts, opt.value]
                          : input.sbaCerts.filter(c => c !== opt.value);
                        update({ sbaCerts: newCerts });
                      }}
                      label={opt.label} />
                  ))}
                </div>
                <Checkbox checked={input.hasISO} onChange={(v) => update({ hasISO: v })} label="ISO Certified (9001, 27001, etc.)" />
                <Checkbox checked={input.hasCMMI} onChange={(v) => update({ hasCMMI: v })} label="CMMI Appraised" />
                <Checkbox checked={input.hasStateCerts} onChange={(v) => update({ hasStateCerts: v })} label="State/local certifications (MBE, DBE, etc.)" />
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-1">Other certifications count</label>
                  <select value={input.otherCertsCount} onChange={(e) => update({ otherCertsCount: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-200 focus:ring-2 focus:ring-cyan-500 focus:border-transparent">
                    <option value={0}>None</option>
                    <option value={1}>1-2</option>
                    <option value={3}>3+</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {/* Step 7: Keywords */}
          {step === 7 && (
            <>
              <h2 className="text-lg font-bold text-slate-100 mb-1">Keywords & Searchability</h2>
              <p className="text-sm text-slate-400 mb-4">Keywords determine whether agencies can find you when searching DSBS.</p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-300 mb-1">How many keywords in your profile?</label>
                  <select value={input.keywordCount} onChange={(e) => update({ keywordCount: e.target.value as DSBSInput['keywordCount'] })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-slate-200 focus:ring-2 focus:ring-cyan-500 focus:border-transparent">
                    <option value="none">None / I am not sure</option>
                    <option value="few">1-5 keywords</option>
                    <option value="moderate">6-15 keywords</option>
                    <option value="many">16+ keywords</option>
                  </select>
                </div>
                <Checkbox checked={input.hasPSCCodes} onChange={(v) => update({ hasPSCCodes: v })} label="I have PSC (Product Service Codes) listed" />
                <Checkbox checked={input.hasSICCodes} onChange={(v) => update({ hasSICCodes: v })} label="I have SIC codes listed" />
              </div>
            </>
          )}

          {/* Step 8: Contact */}
          {step === 8 && (
            <>
              <h2 className="text-lg font-bold text-slate-100 mb-1">Contact Information</h2>
              <p className="text-sm text-slate-400 mb-4">Agencies want to reach a real person — not a generic inbox.</p>
              <div className="space-y-1">
                <Checkbox checked={input.hasNamedPOC} onChange={(v) => update({ hasNamedPOC: v })} label="I have a named point of contact" />
                <Checkbox checked={input.hasDirectPhone} onChange={(v) => update({ hasDirectPhone: v })} label="Direct phone number listed" />
                <Checkbox checked={input.hasDirectEmail} onChange={(v) => update({ hasDirectEmail: v })} label="Direct email address listed (not info@ or contact@)" />
              </div>
            </>
          )}

          {/* Navigation */}
          <div className="flex justify-between mt-8">
            <button onClick={() => setStep(Math.max(1, step - 1))} disabled={step === 1}
              className="px-5 py-2.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed text-slate-300 font-semibold rounded-lg transition-colors">
              Back
            </button>
            {step < totalSteps ? (
              <button onClick={() => setStep(step + 1)}
                className="px-5 py-2.5 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold rounded-lg transition-colors">
                Next
              </button>
            ) : (
              <button onClick={handleScore} disabled={loading}
                className="px-6 py-2.5 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white font-bold rounded-lg transition-colors">
                {loading ? 'Scoring...' : 'Get My Score'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
