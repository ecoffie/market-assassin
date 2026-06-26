'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import SampleOpportunitiesPicker from '@/components/briefings/SampleOpportunitiesPicker';
import MarketDataMap from '@/components/app/market/MarketDataMap';
import OnboardingScan, { type RevealData } from '@/components/app/onboarding/OnboardingScan';
import { MindyLogo } from '@/components/mindy/MindyLogo';
import { getSupabase } from '@/lib/supabase/client';
import { useAppTracker } from '@/components/app/track';
import { getMIApiHeaders } from '@/components/app/authHeaders';

const INDUSTRY_PRESETS = [
  { label: 'Construction', codes: ['236', '237', '238'], description: 'Building, heavy civil, specialty trades' },
  { label: 'IT Services', codes: ['541511', '541512', '541513', '541519'], description: 'Software, systems design, data processing' },
  { label: 'Cybersecurity', codes: ['541512', '541519', '518210'], description: 'Security systems, data protection' },
  { label: 'Professional Services', codes: ['541'], description: 'Consulting, engineering, R&D' },
  { label: 'Healthcare', codes: ['621', '622', '623'], description: 'Medical, hospitals, nursing care' },
  { label: 'Logistics & Supply', codes: ['493', '484', '488'], description: 'Warehousing, trucking, transportation' },
  { label: 'Facilities & Maintenance', codes: ['561210', '561720', '561730'], description: 'Janitorial, landscaping, building services' },
  { label: 'Training & Education', codes: ['611430', '611420', '611710'], description: 'Professional training, educational services' },
  // PRODUCT / RESELLER verticals — the picker was all services; sellers of goods
  // (esp. medical-supply students) had nowhere to land. NAICS grounded in real
  // USASpending "medical supplies" spend (423450/339112/339113/325412).
  { label: 'Medical Supplies & Equipment', codes: ['423450', '339112', '339113', '325412', '339115'], description: 'Sell medical/dental/hospital supplies, devices, instruments' },
  { label: 'Products & Wholesale', codes: ['423', '424'], description: 'Resell/distribute goods to the government' },
  { label: 'Manufacturing', codes: ['332', '333', '334', '335'], description: 'Make products — metal, machinery, electronics' },
  { label: 'Office & Industrial Supplies', codes: ['453210', '424120', '423840', '423610'], description: 'Office, janitorial, industrial & MRO supplies' },
];

const QUICK_AGENCIES = ['DHS', 'VA', 'GSA', 'DoD', 'Army Corps', 'HHS', 'DOE', 'NASA', 'DOJ', 'DOT'];

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID',
  'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO',
  'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA',
  'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];

const REGION_PRESETS: Record<string, string[]> = {
  Southeast: ['FL', 'GA', 'AL', 'SC', 'NC', 'TN'],
  'Mid-Atlantic': ['VA', 'MD', 'DC', 'WV', 'DE', 'PA', 'NJ'],
  Southwest: ['TX', 'OK', 'AR', 'LA', 'NM'],
  'West Coast': ['CA', 'OR', 'WA', 'NV', 'AZ'],
  Midwest: ['IL', 'IN', 'OH', 'MI', 'WI', 'MN', 'IA', 'MO'],
  Northeast: ['NY', 'MA', 'CT', 'RI', 'NH', 'VT', 'ME'],
};

const BUSINESS_TYPES = [
  { value: 'Small Business', label: 'Small Business (General)' },
  { value: 'SDVOSB', label: 'SDVOSB - Service-Disabled Veteran-Owned' },
  { value: 'VOSB', label: 'VOSB - Veteran-Owned Small Business' },
  { value: '8a', label: '8(a) - SBA 8(a) Program' },
  { value: 'WOSB', label: 'WOSB - Women-Owned Small Business' },
  { value: 'EDWOSB', label: 'EDWOSB - Economically Disadvantaged WOSB' },
  { value: 'HUBZone', label: 'HUBZone' },
  { value: 'Native American/Tribal', label: 'Native American / Tribal / ISBEE' },
];

const STEP_LABELS = ['Match', 'Industries', 'Geography', 'Agencies', 'Delivery'];
const TOTAL_STEPS = STEP_LABELS.length;

type ProfileSuggestions = {
  industries: string[];
  naicsCodes: string[];
  states: string[];
  agencies: string[];
  setAsides: string[];
  reasons: string[];
};

type ExtractedProfile = {
  naicsCodes: Array<{ code: string; name: string; count: number }>;
  pscCodes: Array<{ code: string; count: number }>;
  keywords: string[];
  agencies: Array<{ name: string; count: number }>;
};

const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  wisconsin: 'WI',
  wyoming: 'WY',
};

const CITY_STATE_HINTS: Record<string, string> = {
  atlanta: 'GA',
  baltimore: 'MD',
  birmingham: 'AL',
  boston: 'MA',
  charlotte: 'NC',
  chicago: 'IL',
  dallas: 'TX',
  denver: 'CO',
  'fort lauderdale': 'FL',
  honolulu: 'HI',
  houston: 'TX',
  jacksonville: 'FL',
  'las vegas': 'NV',
  'los angeles': 'CA',
  miami: 'FL',
  nashville: 'TN',
  orlando: 'FL',
  philadelphia: 'PA',
  phoenix: 'AZ',
  portsmouth: 'NH',
  'san antonio': 'TX',
  'san diego': 'CA',
  tampa: 'FL',
  tucson: 'AZ',
  'washington dc': 'DC',
};

function addUnique(values: string[], additions: string[]) {
  return [...new Set([...values, ...additions.filter(Boolean)])];
}

function getIndustriesForNaics(naicsCodes: string[]) {
  const industries = new Set<string>();

  for (const naicsCode of naicsCodes) {
    for (const preset of INDUSTRY_PRESETS) {
      if (preset.codes.some(code => naicsCode.startsWith(code) || code.startsWith(naicsCode))) {
        industries.add(preset.label);
      }
    }
  }

  return Array.from(industries);
}

function normalizeAgencyName(name: string) {
  const lowerName = name.toLowerCase();

  if (lowerName.includes('veterans')) return 'VA';
  if (lowerName.includes('defense') || lowerName.includes('army') || lowerName.includes('navy') || lowerName.includes('air force')) return 'DoD';
  if (lowerName.includes('general services')) return 'GSA';
  if (lowerName.includes('homeland')) return 'DHS';
  if (lowerName.includes('health') || lowerName.includes('human services')) return 'HHS';
  if (lowerName.includes('energy')) return 'DOE';
  if (lowerName.includes('nasa')) return 'NASA';
  if (lowerName.includes('justice')) return 'DOJ';
  if (lowerName.includes('transportation')) return 'DOT';
  if (lowerName.includes('corps of engineers')) return 'Army Corps';

  return name;
}

function inferProfileSuggestions(description: string): ProfileSuggestions | null {
  const text = description.trim().toLowerCase();
  if (!text) return null;

  const suggestions: ProfileSuggestions = {
    industries: [],
    naicsCodes: [],
    states: [],
    agencies: [],
    setAsides: [],
    reasons: [],
  };

  const matchesAny = (terms: string[]) => terms.some(term => text.includes(term));

  if (matchesAny(['construction', 'build', 'building', 'renovation', 'remodel', 'general contractor', 'facility', 'facilities'])) {
    suggestions.industries = addUnique(suggestions.industries, ['Construction', 'Facilities & Maintenance']);
    suggestions.naicsCodes = addUnique(suggestions.naicsCodes, ['236220', '237990', '238990']);
    suggestions.agencies = addUnique(suggestions.agencies, ['DoD', 'GSA', 'Army Corps']);
    suggestions.reasons.push('Construction and facilities keywords');
  }

  if (matchesAny(['software', 'cloud', 'data', 'systems', 'application', 'app development', 'it support', 'help desk'])) {
    suggestions.industries = addUnique(suggestions.industries, ['IT Services']);
    suggestions.naicsCodes = addUnique(suggestions.naicsCodes, ['541511', '541512', '541519']);
    suggestions.agencies = addUnique(suggestions.agencies, ['GSA', 'DHS', 'DoD']);
    suggestions.reasons.push('IT services keywords');
  }

  if (matchesAny(['cyber', 'cybersecurity', 'security assessment', 'compliance', 'risk management', 'zero trust', 'soc'])) {
    suggestions.industries = addUnique(suggestions.industries, ['Cybersecurity', 'IT Services']);
    suggestions.naicsCodes = addUnique(suggestions.naicsCodes, ['541512', '541519', '518210']);
    suggestions.agencies = addUnique(suggestions.agencies, ['DHS', 'DoD', 'GSA']);
    suggestions.reasons.push('Cybersecurity keywords');
  }

  if (matchesAny(['consulting', 'engineering', 'program management', 'project management', 'research', 'professional service'])) {
    suggestions.industries = addUnique(suggestions.industries, ['Professional Services']);
    suggestions.naicsCodes = addUnique(suggestions.naicsCodes, ['541611', '541330', '541990']);
    suggestions.agencies = addUnique(suggestions.agencies, ['GSA', 'DoD', 'DOE']);
    suggestions.reasons.push('Professional services keywords');
  }

  if (matchesAny(['medical', 'healthcare', 'hospital', 'clinic', 'nursing', 'patient'])) {
    suggestions.industries = addUnique(suggestions.industries, ['Healthcare']);
    suggestions.naicsCodes = addUnique(suggestions.naicsCodes, ['621111', '621999', '622110']);
    suggestions.agencies = addUnique(suggestions.agencies, ['HHS']);
    suggestions.reasons.push('Healthcare keywords');
  }

  if (matchesAny(['logistics', 'warehouse', 'warehousing', 'transportation', 'trucking', 'freight', 'supply'])) {
    suggestions.industries = addUnique(suggestions.industries, ['Logistics & Supply']);
    suggestions.naicsCodes = addUnique(suggestions.naicsCodes, ['493110', '484121', '488510']);
    suggestions.agencies = addUnique(suggestions.agencies, ['DoD', 'GSA', 'DHS']);
    suggestions.reasons.push('Logistics and supply keywords');
  }

  if (matchesAny(['training', 'education', 'curriculum', 'instructor', 'workforce'])) {
    suggestions.industries = addUnique(suggestions.industries, ['Training & Education']);
    suggestions.naicsCodes = addUnique(suggestions.naicsCodes, ['611430', '611420', '611710']);
    suggestions.agencies = addUnique(suggestions.agencies, ['DoD', 'DHS', 'HHS']);
    suggestions.reasons.push('Training keywords');
  }

  if (matchesAny(['sdvosb', 'service-disabled veteran', 'service disabled veteran'])) {
    suggestions.setAsides = addUnique(suggestions.setAsides, ['SDVOSB', 'VOSB']);
    suggestions.agencies = addUnique(suggestions.agencies, ['VA']);
    suggestions.reasons.push('Veteran-owned certification keywords');
  } else if (matchesAny(['vosb', 'veteran owned', 'veteran-owned'])) {
    suggestions.setAsides = addUnique(suggestions.setAsides, ['VOSB']);
    suggestions.agencies = addUnique(suggestions.agencies, ['VA']);
    suggestions.reasons.push('Veteran-owned certification keywords');
  }

  if (matchesAny(['woman owned', 'woman-owned', 'women owned', 'women-owned', 'wosb'])) {
    suggestions.setAsides = addUnique(suggestions.setAsides, ['WOSB']);
    suggestions.reasons.push('Women-owned certification keywords');
  }
  if (matchesAny(['edwosb', 'economically disadvantaged'])) {
    suggestions.setAsides = addUnique(suggestions.setAsides, ['EDWOSB']);
    suggestions.reasons.push('EDWOSB certification keywords');
  }
  if (matchesAny(['8(a)', '8a ', ' 8a', 'sba 8'])) {
    suggestions.setAsides = addUnique(suggestions.setAsides, ['8a']);
    suggestions.reasons.push('8(a) certification keywords');
  }
  if (matchesAny(['hubzone', 'hub zone'])) {
    suggestions.setAsides = addUnique(suggestions.setAsides, ['HUBZone']);
    suggestions.reasons.push('HUBZone certification keywords');
  }
  if (matchesAny(['small business', 'small-business'])) {
    suggestions.setAsides = addUnique(suggestions.setAsides, ['Small Business']);
    suggestions.reasons.push('Small business keyword');
  }

  for (const [city, state] of Object.entries(CITY_STATE_HINTS)) {
    if (text.includes(city)) {
      suggestions.states = addUnique(suggestions.states, [state]);
    }
  }

  for (const [stateName, state] of Object.entries(STATE_NAME_TO_CODE)) {
    if (text.includes(stateName)) {
      suggestions.states = addUnique(suggestions.states, [state]);
    }
  }

  for (const state of US_STATES) {
    const statePattern = new RegExp(`(^|[^a-z])${state.toLowerCase()}([^a-z]|$)`);
    if (statePattern.test(text)) {
      suggestions.states = addUnique(suggestions.states, [state]);
    }
  }

  const hasAnySuggestion =
    suggestions.industries.length > 0 ||
    suggestions.naicsCodes.length > 0 ||
    suggestions.states.length > 0 ||
    suggestions.agencies.length > 0 ||
    suggestions.setAsides.length > 0;

  return hasAnySuggestion ? suggestions : null;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  // Tracker: fires onboarding_step on each goToStep + a final
  // onboarding_step with completed=true on successful save. Critical
  // funnel signal for activation queues.
  const track = useAppTracker(email);
  const [accessToken, setAccessToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Setup mode. 'choose' = the door picker; 'uei' = paste UEI → SAM/USASpending
  // pull → confirm; 'auto' = describe → confirm; 'manual' = the step wizard.
  // UEI is the highest-quality path (identity + NAICS + certs + REAL award history
  // → grounds the hidden-match capability vector), so it's the first/recommended
  // door — but always skippable (Eric, Jun 2026; only 5 users had a UEI when it
  // was a post-setup Vault afterthought).
  const [mode, setMode] = useState<'choose' | 'uei' | 'auto' | 'manual'>('choose');
  const [autoText, setAutoText] = useState('');
  const [ueiInput, setUeiInput] = useState('');
  const [autoLoading, setAutoLoading] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [autoProfile, setAutoProfile] = useState<any | null>(null);   // the confirm-screen extraction
  // Slurpee choreography: 'scanning' shows the source-by-source scan + count-up
  // reveal; 'done' = user clicked through → the editable confirm screen.
  const [scanPhase, setScanPhase] = useState<'idle' | 'scanning' | 'done'>('idle');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [overview, setOverview] = useState<any | null>(null);   // /api/market-overview — feeds the reveal counts + MarketDataMap

  const [businessDescription, setBusinessDescription] = useState('');
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([]);
  const [customNaics, setCustomNaics] = useState('');
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [selectedAgencies, setSelectedAgencies] = useState<string[]>([]);
  const [customAgencies, setCustomAgencies] = useState('');
  const [selectedSetAsides, setSelectedSetAsides] = useState<string[]>([]);
  const [frequency, setFrequency] = useState<'daily' | 'mwf' | 'tth' | 'weekly' | 'paused'>('daily');
  const [profileSuggestions, setProfileSuggestions] = useState<ProfileSuggestions | null>(null);
  const [showSamplePicker, setShowSamplePicker] = useState(false);
  const [calibratedFromSamples, setCalibratedFromSamples] = useState(false);
  const [skippedSamplePicker, setSkippedSamplePicker] = useState(false);
  const [calibrationMessage, setCalibrationMessage] = useState('');

  useEffect(() => {
    async function checkAuth() {
      const supabase = getSupabase();
      if (!supabase) {
        router.push('/signup');
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user?.email || !session.access_token) {
        router.push('/signup');
        return;
      }

      const userEmail = session.user.email.toLowerCase();

      // OAuth's redirectTo always lands here, so returning users hit the
      // onboarding wizard on every sign-in. Check whether they've already
      // filled in a real profile — if so, skip the wizard and drop them
      // straight on /app. The mount-time auth ladder on /app handles the
      // rest (token mint, profile load).
      try {
        const res = await fetch(
          `/api/alerts/preferences?email=${encodeURIComponent(userEmail)}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } }
        );
        if (res.ok) {
          const data = await res.json();
          const codes: string[] = data?.data?.naicsCodes || [];
          if (codes.length > 0) {
            router.push(`/app?email=${encodeURIComponent(userEmail)}`);
            return;
          }
        }
      } catch {
        // Network hiccup — fall through to the wizard rather than
        // bouncing the user to an error state. They can re-save their
        // profile harmlessly.
      }

      setEmail(userEmail);
      setAccessToken(session.access_token);
      setLoading(false);
    }

    checkAuth();
  }, [router]);

  // Mint + store the MI auth token before leaving onboarding. OAuth users arrive
  // here with a Supabase session but NO MI token; without this they land in the
  // app "logged in" yet every 2FA-gated route fails ("Invalid two-factor
  // session") until they re-login another way. Calling mindy-session here (the
  // same endpoint /app's bootstrap uses) guarantees the token is set on the way
  // out instead of relying on a bootstrap that can silently fail. Best-effort —
  // the /app bootstrap is still the backstop, but this closes the OAuth gap.
  const ensureMIToken = async () => {
    try {
      const supabase = getSupabase();
      const { data: { session } } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
      const bearer = session?.access_token || accessToken;
      if (!bearer) return;
      const res = await fetch('/api/auth/mindy-session', {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}` },
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && data.sessionToken) {
        localStorage.setItem('mi_beta_auth_token', data.sessionToken);
        localStorage.setItem('mi_beta_authenticated_at', data.authenticatedAt || new Date().toISOString());
        if (email) localStorage.setItem('mi_beta_email', email);
      }
    } catch { /* backstop: /app bootstrap retries */ }
  };

  const allNaicsCodes = useMemo(() => {
    const presetCodes = selectedIndustries.flatMap(industry => {
      const preset = INDUSTRY_PRESETS.find(item => item.label === industry);
      return preset?.codes || [];
    });
    const customCodes = customNaics
      .split(/[,\s]+/)
      .map(code => code.trim())
      .filter(code => /^\d+$/.test(code));

    return [...new Set([...presetCodes, ...customCodes])];
  }, [customNaics, selectedIndustries]);

  const allAgencies = useMemo(() => {
    const custom = customAgencies
      .split(',')
      .map(agency => agency.trim())
      .filter(Boolean);

    return [...new Set([...selectedAgencies, ...custom])];
  }, [customAgencies, selectedAgencies]);

  function toggleValue(value: string, setter: React.Dispatch<React.SetStateAction<string[]>>) {
    setter(prev => (prev.includes(value) ? prev.filter(item => item !== value) : [...prev, value]));
  }

  function goToStep(nextStep: number) {
    setError('');
    setStep(nextStep);
    track('onboarding_step', 'onboarding', { from_step: step, to_step: nextStep });
  }

  // AUTO MODE (#64): paste capability text → extract (LLM industry + real data) →
  // show the confirm screen. The user reviews before anything commits.
  async function runAutoExtract() {
    const text = autoText.trim();
    if (text.length < 4) { setError('Tell us what you do + where (e.g. "janitorial in Florida").'); return; }
    setAutoLoading(true); setError(''); setOverview(null); setScanPhase('scanning');
    try {
      const res = await fetch('/api/app/profile-from-text', {
        method: 'POST',
        headers: getMIApiHeaders(email, { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }),
        body: JSON.stringify({ email, text }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) { setScanPhase('idle'); setError(d.error || 'Couldn’t read that — try naming the service + state.'); return; }
      setAutoProfile(d.profile);
      track('onboarding_step', 'onboarding', { step: 'auto_extract', industry: d.profile?.industryPhrase });
      void loadOverview(d.profile);   // reveal counts + confirm tiles (one fetch, passed down)
    } catch {
      setScanPhase('idle');
      setError('Something went wrong extracting your profile. Try again or set up manually.');
    } finally { setAutoLoading(false); }
  }

  // Best-effort market-overview load — powers the reveal counters AND the confirm
  // screen's MarketDataMap (handed down as initialData → one fetch, not two).
  // Never blocks the reveal: on failure it shows market $ + codes + source count.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function loadOverview(profile: any) {
    try {
      const qs = new URLSearchParams();
      if (profile?.industryPhrase) qs.set('keyword', profile.industryPhrase);
      if ((profile?.naics || []).length) qs.set('naics', (profile.naics || []).join(','));
      if (email) qs.set('email', email);
      const r = await fetch(`/api/market-overview?${qs.toString()}`);
      const j = await r.json();
      if (j?.success) setOverview(j);
    } catch { /* reveal degrades gracefully */ }
  }

  // Reveal stats — every number is REAL (extraction + /api/market-overview). Built
  // reactively; the choreography holds the scan until this is non-null, then enriches
  // as the overview lands. Market $ + code count + source count always show.
  const revealData: RevealData | null = useMemo(() => {
    if (!autoProfile) return null;
    const money = (n: number) => n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${Math.round(n / 1e6)}M` : n > 0 ? `$${Math.round(n / 1e3)}K` : '—';
    const tiles = (overview?.tiles || []) as Array<{ key: string; count: number }>;
    const tileCount = (k: string) => tiles.find((t) => t.key === k)?.count || 0;
    const market = overview?.market?.totalMarket || autoProfile.totalMarket || 0;
    const codeCount = autoProfile.naicsCount || (autoProfile.naics || []).length || 0;
    const stats: RevealData['stats'] = [];
    if (market > 0) stats.push({ icon: '💰', display: money(market), label: 'addressable market', accent: true });
    if (codeCount) stats.push({ icon: '🧩', value: codeCount, label: 'NAICS codes mapped' });
    if (tileCount('forecasts')) stats.push({ icon: '📋', value: tileCount('forecasts'), label: 'forecasted buys' });
    if (tileCount('recompetes')) stats.push({ icon: '🔁', value: tileCount('recompetes'), label: 'recompetes expiring' });
    if (tileCount('setasides')) stats.push({ icon: '🎯', value: tileCount('setasides'), label: 'reserved for small biz' });
    if (tileCount('grants')) stats.push({ icon: '💵', value: tileCount('grants'), label: 'grant programs' });
    stats.push({ icon: '🗂️', value: 28, label: 'data sources, one market' });
    return { headline: autoProfile.industryPhrase || 'your business', stats };
  }, [autoProfile, overview]);

  // UEI path — the highest-quality setup. Pull SAM registration + USASpending
  // award history, then map into the SAME autoProfile shape the confirm screen
  // already renders (so we reuse all that UI). Also persists the UEI to the Vault
  // identity row so the capability-vector engine grounds hidden matches on the
  // user's real award history (memory: hidden_match_coverage_reality).
  async function runUeiExtract() {
    const uei = ueiInput.trim().toUpperCase();
    if (!/^[A-Z0-9]{12}$/.test(uei)) { setError('A UEI is 12 letters/numbers (from your SAM.gov registration).'); return; }
    setAutoLoading(true); setError(''); setOverview(null); setScanPhase('scanning');
    try {
      // Preview pull (identity + past performance + AI-drafted capabilities).
      const res = await fetch(`/api/app/vault/prefill?uei=${encodeURIComponent(uei)}&email=${encodeURIComponent(email)}`, {
        headers: getMIApiHeaders(email, { Authorization: `Bearer ${accessToken}` }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) {
        setScanPhase('idle');
        setError(d.error || `No SAM.gov registration found for ${uei}. Check it, or describe your business instead.`);
        return;
      }
      const identity = d.identity || {};
      const naics: string[] = Array.isArray(identity.primary_naics)
        ? identity.primary_naics.filter((c: unknown) => typeof c === 'string' && /^\d{2,6}$/.test(c))
        : [];
      // Map prefill → the confirm screen's autoProfile shape. industryPhrase from
      // the AI one-liner (or legal name); agencies from real award history.
      const agencyNames = Array.from(new Set(
        (d.past_performance || []).map((p: { agency?: string }) => p.agency).filter(Boolean),
      )).slice(0, 6).map((name) => ({ name }));
      setAutoProfile({
        industryPhrase: (d.ai_coach?.one_liner || identity.legal_name || 'Your business').slice(0, 80),
        naics,
        naicsCount: naics.length,
        keywords: [],
        topPsc: null,
        agencies: agencyNames,
        states: identity.hq_state ? [identity.hq_state] : [],
        setAsides: Array.isArray(identity.certifications) ? identity.certifications : [],
        totalMarket: 0,
        uei,                       // carried through confirmAuto → Vault write
        legalName: identity.legal_name || null,
        pastPerfCount: (d.past_performance || []).length,
      });
      track('onboarding_step', 'onboarding', { step: 'uei_extract', uei, pastPerf: (d.past_performance || []).length });
      // Even the UEI path gets a market reveal — overview grounds $ + tiles from the
      // one-liner + the registration's NAICS (covers UEI's totalMarket=0).
      void loadOverview({ industryPhrase: (d.ai_coach?.one_liner || identity.legal_name || ''), naics });
    } catch {
      setScanPhase('idle');
      setError('Couldn’t reach SAM.gov just now. Try again or describe your business instead.');
    } finally { setAutoLoading(false); }
  }

  // Confirm the Auto profile → push the extracted values into the normal state
  // vars + save (reuses /api/mindy/profile, same as Manual).
  async function confirmAuto() {
    if (!autoProfile) return;
    setSaving(true); setError('');
    try {
      // UEI path: write SAM identity + USASpending past performance into the Vault
      // FIRST (non-blocking) — this is what grounds the hidden-match capability
      // vector on real award history. Failure here doesn't block the profile save.
      if (autoProfile.uei) {
        try {
          await fetch('/api/app/vault/prefill', {
            method: 'POST',
            headers: getMIApiHeaders(email, { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }),
            body: JSON.stringify({ email, uei: autoProfile.uei, accept: { identity: true, past_performance: true } }),
          });
        } catch { /* non-fatal — alerts profile below still saves */ }
      }
      const res = await fetch('/api/mindy/profile', {
        method: 'POST',
        headers: getMIApiHeaders(email, { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }),
        body: JSON.stringify({
          email,
          businessDescription: autoText.trim() || null,
          naicsCodes: autoProfile.naics || [],
          // precise: save the tight ~8-code coverage set EXACTLY as shown on the
          // confirm screen — no prefix expansion (that bloated profiles to 31 codes).
          // What the user sees IS what's saved. Breadth is an explicit opt-in, not
          // an accident (Eric: tight-and-precise default; coverage % shows they're
          // not missing the money).
          precise: true,
          // Persist the extracted keywords — they were shown on the confirm screen
          // but used to be dropped, leaving keyword-empty profiles. The user's own
          // words are the strongest search signal.
          keywords: autoProfile.keywords || [],
          businessType: autoProfile.setAsides?.[0] || 'Small Business',
          setAsides: autoProfile.setAsides || [],
          targetAgencies: (autoProfile.agencies || []).map((a: { name: string }) => a.name),
          locationStates: autoProfile.states || [],
          alertFrequency: 'weekdays',
          onboardingComplete: true,
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) { setError(d.error || 'Failed to save. Try again.'); return; }
      track('onboarding_step', 'onboarding', { step: 'completion', status: 'success', mode: 'auto' });
      // Land in the Vault so the user finishes a COMPLETE profile — enter their UEI
      // (auto-fills company identity + NAICS) and confirm keywords. Without this
      // hand-off users stop at NAICS-only and have incomplete profiles.
      await ensureMIToken();
      router.push(`/app?email=${encodeURIComponent(email)}&panel=vault&onboarded=1`);
    } catch {
      setError('Failed to save your profile. Please try again.');
    } finally { setSaving(false); }
  }

  // "Let me adjust" — carry the Auto extraction into the Manual wizard, pre-filled.
  function adjustInManual() {
    if (autoProfile) {
      setCustomNaics((autoProfile.naics || []).join(', '));
      setSelectedStates(autoProfile.states || []);
      setSelectedSetAsides(autoProfile.setAsides || []);
      setBusinessDescription(autoText);
    }
    setMode('manual'); setStep(1);
  }

  // Toggle a state on the Auto confirm screen (coverage control — Eric wants to
  // add/remove states there).
  function toggleAutoState(code: string) {
    setAutoProfile((p: { states?: string[] } | null) => {
      if (!p) return p;
      const states = p.states || [];
      return { ...p, states: states.includes(code) ? states.filter((s: string) => s !== code) : [...states, code] };
    });
  }

  // Inline edit (#64) — remove a NAICS code the user doesn't want (the nurse-
  // staffing case: drop generic 561320, keep healthcare 621111).
  function removeAutoNaics(code: string) {
    setAutoProfile((p: { naics?: string[] } | null) => p ? { ...p, naics: (p.naics || []).filter((c: string) => c !== code) } : p);
  }

  // SAME-SECTOR setup suggestions (Eric, "catch everything for me" — Jun 2026):
  // after we derive the user's codes, proactively surface high-value codes in
  // THEIR sector that they don't have, so the profile is complete on day one.
  // Reuses /api/app/keyword-coverage's `missing` (already same-sector-gated, so it
  // never suggests adjacent industries like ship building for a builder).
  type CodeSuggestion = { code: string; name: string; amount: number };
  const [codeSuggestions, setCodeSuggestions] = useState<CodeSuggestion[]>([]);
  useEffect(() => {
    const phrase = autoProfile?.industryPhrase;
    const have: string[] = autoProfile?.naics || [];
    if (!phrase || have.length === 0) { setCodeSuggestions([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/app/keyword-coverage?keyword=${encodeURIComponent(phrase)}&have=${encodeURIComponent(have.join(','))}`,
          { headers: getMIApiHeaders(email, { Authorization: `Bearer ${accessToken}` }) },
        );
        if (!res.ok) return;
        const j = await res.json();
        const miss = (j?.coverage?.missing || []) as CodeSuggestion[];
        if (!cancelled) setCodeSuggestions(miss.slice(0, 6));
      } catch { /* suggestions are optional — never block the confirm screen */ }
    })();
    return () => { cancelled = true; };
    // Re-run when the derived codes change (user removes one → re-evaluate gaps).
  }, [autoProfile?.industryPhrase, (autoProfile?.naics || []).join(','), email, accessToken]);

  function addSuggestedNaics(code: string) {
    setAutoProfile((p: { naics?: string[] } | null) => p ? { ...p, naics: [...new Set([...(p.naics || []), code])] } : p);
    setCodeSuggestions((s) => s.filter((x) => x.code !== code));
  }

  // Keyword tuning on the confirm screen — extraction grabs generic words
  // ("demolition firm" → "firm"); let the user drop junk + add the capability
  // words that catch mislabeled titles. Keywords drive alert matching.
  const [keywordDraft, setKeywordDraft] = useState('');
  function removeAutoKeyword(kw: string) {
    setAutoProfile((p: { keywords?: string[] } | null) => p ? { ...p, keywords: (p.keywords || []).filter((k: string) => k !== kw) } : p);
  }
  function addAutoKeyword() {
    const kw = keywordDraft.trim().toLowerCase();
    if (!kw) return;
    setAutoProfile((p: { keywords?: string[] } | null) => p ? { ...p, keywords: [...new Set([...(p.keywords || []), kw])] } : p);
    setKeywordDraft('');
  }

  // Inline edit — the user fixes the industry phrase ("nurse staffing" not
  // "professional services") → re-ground codes/agencies from the corrected phrase.
  const [editingIndustry, setEditingIndustry] = useState(false);
  const [industryDraft, setIndustryDraft] = useState('');
  async function reExtractIndustry() {
    const phrase = industryDraft.trim();
    if (!phrase) { setEditingIndustry(false); return; }
    setAutoLoading(true);
    try {
      const res = await fetch('/api/app/profile-from-text', {
        method: 'POST',
        headers: getMIApiHeaders(email, { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }),
        body: JSON.stringify({ email, text: phrase }),
      });
      const d = await res.json();
      if (res.ok && d.success) {
        // keep the user's states/set-asides, replace the industry-derived parts.
        setAutoProfile((prev: Record<string, unknown> | null) => ({
          ...d.profile,
          states: (prev?.states as string[]) || d.profile.states,
          setAsides: (prev?.setAsides as string[]) || d.profile.setAsides,
        }));
      }
    } catch { /* keep current */ }
    setEditingIndustry(false); setAutoLoading(false);
  }

  function applyProfileSuggestions(suggestions: ProfileSuggestions) {
    setSelectedIndustries(prev => addUnique(prev, suggestions.industries));
    setSelectedStates(prev => addUnique(prev, suggestions.states));
    setSelectedAgencies(prev => addUnique(prev, suggestions.agencies.filter(agency => QUICK_AGENCIES.includes(agency))));
    setSelectedSetAsides(prev => addUnique(prev, suggestions.setAsides));

    if (suggestions.naicsCodes.length > 0) {
      const existingCodes = customNaics
        .split(/[,\s]+/)
        .map(code => code.trim())
        .filter(Boolean);
      setCustomNaics(addUnique(existingCodes, suggestions.naicsCodes).join(', '));
    }

    const customAgencySuggestions = suggestions.agencies.filter(agency => !QUICK_AGENCIES.includes(agency));
    if (customAgencySuggestions.length > 0) {
      const existingAgencies = customAgencies
        .split(',')
        .map(agency => agency.trim())
        .filter(Boolean);
      setCustomAgencies(addUnique(existingAgencies, customAgencySuggestions).join(', '));
    }
  }

  function handleProfileExtracted(profile: ExtractedProfile) {
    const extractedNaics = profile.naicsCodes.map(item => item.code).filter(Boolean);
    const extractedIndustries = getIndustriesForNaics(extractedNaics);
    const normalizedAgencies = profile.agencies
      .map(agency => normalizeAgencyName(agency.name))
      .filter(Boolean);

    const suggestions: ProfileSuggestions = {
      industries: extractedIndustries,
      naicsCodes: extractedNaics,
      states: inferProfileSuggestions(businessDescription)?.states || [],
      agencies: normalizedAgencies,
      setAsides: inferProfileSuggestions(businessDescription)?.setAsides || [],
      reasons: ['Calibrated from selected real opportunities'],
    };

    setProfileSuggestions(suggestions);
    applyProfileSuggestions(suggestions);
    setCalibratedFromSamples(true);
    setSkippedSamplePicker(false);
    setShowSamplePicker(false);
    setCalibrationMessage('Profile calibrated from your opportunity selections. Review the suggested NAICS codes, agencies, and geography before finishing.');
    goToStep(2);
  }

  async function handleNext() {
    setError('');

    if (step === 1) {
      if (businessDescription.trim().length >= 10 && !calibratedFromSamples && !skippedSamplePicker) {
        setShowSamplePicker(true);
        return;
      }

      // Ground the day-1 codes in REAL USASpending data (#59) — NOT the hardcoded
      // 3-per-industry map, which silently misses 72% of the user's market and
      // breaks their alerts forever. /api/suggest-codes returns the full coverage
      // set so new users start with COMPLETE codes. Local map is the fallback.
      let suggestions = inferProfileSuggestions(businessDescription);
      try {
        const res = await fetch('/api/suggest-codes', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: businessDescription.trim(), maxResults: 8 }),
        });
        const d = await res.json();
        const realNaics = (d.naicsSuggestions || []).map((s: { code: string }) => s.code);
        if (realNaics.length) {
          suggestions = {
            industries: suggestions?.industries || [],
            naicsCodes: realNaics,                  // the FULL grounded set, not 3
            agencies: suggestions?.agencies || [],
            states: suggestions?.states || [],
            setAsides: suggestions?.setAsides || [],
            reasons: ['Grounded in real federal award data — these are the codes where the money actually flows for your work'],
          };
        }
      } catch { /* keep the local-map fallback */ }
      setProfileSuggestions(suggestions);
      if (suggestions) {
        applyProfileSuggestions(suggestions);
      }
    }

    if (step === 2 && allNaicsCodes.length === 0) {
      setError('Please select at least one industry or enter a NAICS code.');
      return;
    }

    if (step < TOTAL_STEPS) {
      goToStep(step + 1);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/mindy/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          email,
          businessDescription: businessDescription.trim() || null,
          naicsCodes: allNaicsCodes,
          businessType: selectedSetAsides[0] || null,
          setAsides: selectedSetAsides,
          targetAgencies: allAgencies,
          locationStates: selectedStates,
          alertFrequency: frequency,
          onboardingComplete: true,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to save your profile. Please try again.');
        track('onboarding_step', 'onboarding', {
          step: 'completion',
          status: 'failure',
          error: data.error || 'unknown',
        });
        return;
      }

      track('onboarding_step', 'onboarding', {
        step: 'completion',
        status: 'success',
        naics_count: (allNaicsCodes || []).length,
        agency_count: (allAgencies || []).length,
        state_count: (selectedStates || []).length,
        set_aside_count: (selectedSetAsides || []).length,
        alert_frequency: frequency,
        has_business_description: !!businessDescription.trim(),
      });
      // Hand off to the Vault to complete the profile (UEI → identity + NAICS,
      // confirm keywords). See the auto-mode finish for the full rationale.
      await ensureMIToken();
      router.push(`/app?email=${encodeURIComponent(email)}&panel=vault&onboarded=1`);
    } catch {
      setError('Something went wrong saving your profile. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
      </main>
    );
  }

  // ── AUTO vs MANUAL (#64) — the two-door picker + the Auto paste/confirm flow.
  if (mode !== 'manual') {
    return (
      <main className="min-h-screen bg-slate-950 px-4 py-10 text-white">
        <div className="mx-auto max-w-2xl">
          <header className="mb-8 text-center">
            <MindyLogo size={64} className="mx-auto mb-5" />
            <h1 className="text-3xl font-bold">Set up your profile</h1>
            <p className="mt-2 text-slate-400">Mindy finds the right federal opportunities for you</p>
          </header>

          {/* The door choice — UEI first (highest-quality: pulls real identity +
              NAICS + certs + award history → grounds hidden matches). All optional. */}
          {mode === 'choose' && (
            <div className="grid gap-4">
              <button onClick={() => setMode('uei')} className="text-left rounded-xl border border-emerald-500/50 bg-emerald-950/20 p-5 hover:border-emerald-400 transition-colors">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-2xl">🏛️</span>
                  <span className="text-lg font-semibold text-white">Set up from my SAM.gov UEI</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wide bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full">Best</span>
                </div>
                <p className="text-sm text-slate-400">Paste your 12-character UEI. Mindy pulls your legal name, NAICS, certifications, and your real federal award history — the most accurate setup, and it powers capability-matched opportunities.</p>
                <div className="text-xs text-emerald-300 mt-3 font-medium">~10 seconds, most accurate →</div>
              </button>
              <div className="grid sm:grid-cols-2 gap-4">
                <button onClick={() => setMode('auto')} className="text-left rounded-xl border border-purple-500/40 bg-purple-950/20 p-5 hover:border-purple-400 transition-colors">
                  <div className="text-2xl mb-2">⚡</div>
                  <div className="text-lg font-semibold text-white">Describe my business</div>
                  <p className="text-sm text-slate-400 mt-1">No UEI? Paste your capability statement or describe what you do in a sentence. Mindy figures out your codes, market, and who buys.</p>
                  <div className="text-xs text-purple-300 mt-3 font-medium">~30 seconds →</div>
                </button>
                <button onClick={() => { setMode('manual'); setStep(1); }} className="text-left rounded-xl border border-slate-700 bg-slate-900 p-5 hover:border-slate-500 transition-colors">
                  <div className="text-2xl mb-2">✏️</div>
                  <div className="text-lg font-semibold text-white">Manual setup</div>
                  <p className="text-sm text-slate-400 mt-1">Go step by step — pick your NAICS codes, target agencies, and geography yourself.</p>
                  <div className="text-xs text-slate-500 mt-3 font-medium">For power users →</div>
                </button>
              </div>
            </div>
          )}

          {/* UEI input — paste → pull → the shared confirm screen. */}
          {/* Slurpee choreography — the source-by-source scan + count-up reveal.
              Shows for BOTH auto + uei while extracting; replaces the blank pause. */}
          {(mode === 'auto' || mode === 'uei') && scanPhase === 'scanning' && (
            <OnboardingScan reveal={revealData} onContinue={() => setScanPhase('done')} />
          )}

          {mode === 'uei' && !autoProfile && scanPhase === 'idle' && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/10 p-5">
              <button onClick={() => { setMode('choose'); setError(''); }} className="text-xs text-slate-400 hover:text-white mb-3">← Back</button>
              <label className="block text-sm font-medium text-white mb-2">Your SAM.gov UEI</label>
              <input
                value={ueiInput}
                onChange={e => setUeiInput(e.target.value.toUpperCase())}
                onKeyDown={e => { if (e.key === 'Enter') runUeiExtract(); }}
                maxLength={12}
                placeholder="e.g. ABC123DEF456"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm tracking-widest placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
              <p className="text-xs text-slate-500 mt-2">The 12-character ID from your SAM.gov registration. Find it at sam.gov → Entity Management.</p>
              {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
              <div className="mt-3 flex items-center gap-3">
                <button onClick={runUeiExtract} disabled={autoLoading || ueiInput.trim().length !== 12} className="h-10 px-5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white text-sm font-medium rounded-lg">
                  {autoLoading ? 'Pulling from SAM.gov…' : 'Pull my profile →'}
                </button>
                <button onClick={() => { setError(''); setMode('auto'); }} className="text-sm text-slate-400 hover:text-white underline underline-offset-2">
                  No UEI? Describe my business instead
                </button>
              </div>
            </div>
          )}

          {/* AUTO — paste, then a LIGHT confirm screen */}
          {mode === 'auto' && !autoProfile && scanPhase === 'idle' && (
            <div className="rounded-xl border border-purple-500/30 bg-purple-950/20 p-5">
              <button onClick={() => setMode('choose')} className="text-xs text-slate-400 hover:text-white mb-3">← Back</button>
              <label className="block text-sm font-medium text-white mb-2">Tell Mindy what you do</label>
              <textarea
                value={autoText}
                onChange={e => setAutoText(e.target.value)}
                rows={4}
                placeholder="Paste your capability statement / website text, or just describe it — e.g. 'We provide commercial janitorial and facility cleaning for federal buildings in Florida. SDVOSB.'  (One sentence like 'I do IT staffing in Texas' works too.)"
                className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white text-sm placeholder-slate-500 focus:border-purple-500 focus:outline-none resize-y"
              />
              {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
              <button onClick={runAutoExtract} disabled={autoLoading || autoText.trim().length < 4} className="mt-3 h-10 px-5 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 text-white text-sm font-medium rounded-lg">
                {autoLoading ? 'Reading…' : 'Set me up →'}
              </button>
              {/* Escape hatch — if auto-extract fails (niche description, no NAICS
                  match), don't trap the user in a retry loop. One click to the
                  step-by-step manual setup. */}
              {error && (
                <button
                  onClick={() => { setError(''); setMode('manual'); setStep(1); }}
                  className="mt-3 ml-3 h-10 px-4 text-sm font-medium text-slate-300 hover:text-white underline underline-offset-2"
                >
                  Set it up manually instead →
                </button>
              )}
            </div>
          )}

          {/* AUTO confirm — the wow + safety net (editable states) */}
          {(mode === 'auto' || mode === 'uei') && autoProfile && scanPhase === 'done' && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/10 p-5">
              <div className="text-sm text-slate-400 mb-3">
                {autoProfile.uei
                  ? <>Pulled from SAM.gov{autoProfile.legalName ? ` — ${autoProfile.legalName}` : ''}{autoProfile.pastPerfCount ? ` · ${autoProfile.pastPerfCount} past awards found` : ''}. Look right? Fix anything below.</>
                  : <>Here&rsquo;s what Mindy found — look right? Anything off, just fix it.</>}
              </div>
              {/* Coverage hero — the wow moment. The HEADLINE number is the coverage
                  SET Mindy actually applies to your profile (the chips below — 6 for
                  demolition). The lesson cites the FULL market ($ + total codes that
                  bought it) so the user sees what the single-code crowd misses. All
                  numbers fact-check on USASpending by searching the core keyword
                  (Eric QC, demolition: "Demolition Services" exact-phrase was
                  under-reporting $1.4B as $8M — fixed in keyword-coverage). */}
              {(autoProfile.naics?.length || 0) > 1 && (
                <div className="mb-4 rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 to-slate-900 p-4">
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black text-emerald-400">{autoProfile.naics.length}</span>
                    <span className="text-sm font-semibold text-white">NAICS codes cover ~90% of your market</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    Most contractors track just the one obvious code.
                    {autoProfile.totalMarket ? (
                      <> Mindy mapped a{' '}
                        <span className="text-emerald-300 font-semibold">
                          {autoProfile.totalMarket >= 1e9
                            ? `$${(autoProfile.totalMarket / 1e9).toFixed(1)}B`
                            : `$${Math.round(autoProfile.totalMarket / 1e6)}M`}
                        </span>{' '}
                        market across{' '}
                        <span className="text-emerald-300 font-semibold">{autoProfile.naicsCount}</span> codes
                        {autoProfile.topPsc ? <> (top buy: PSC <span className="text-emerald-300 font-semibold">{autoProfile.topPsc.code}</span>)</> : null}
                      </>
                    ) : null}
                    {' '}— so your alerts catch opportunities the single-code crowd misses.
                  </p>
                </div>
              )}
              {/* Market Data Map (#4) — the conversion teaser: what's IN your
                  market right now (forecasts, recompetes, grants, competitors).
                  Counts + $ are free; the detail behind each is Pro. */}
              {(autoProfile.industryPhrase || (autoProfile.naics?.length || 0) > 0) && (
                <div className="mb-4">
                  <MarketDataMap
                    keyword={autoProfile.industryPhrase}
                    naics={(autoProfile.naics || []).join(',')}
                    email={email}
                    initialData={overview}
                  />
                </div>
              )}
              <div className="space-y-3 text-sm">
                {/* Industry — editable. Wrong guess? Retype it → Mindy re-grounds. */}
                <div>
                  <span className="text-slate-500">Your work: </span>
                  {editingIndustry ? (
                    <span className="inline-flex items-center gap-2">
                      <input autoFocus value={industryDraft} onChange={e => setIndustryDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') reExtractIndustry(); }}
                        placeholder="e.g. nurse staffing, medical supplies"
                        className="px-2 py-1 bg-slate-800 border border-purple-500 rounded text-white text-sm w-56 focus:outline-none" />
                      <button onClick={reExtractIndustry} disabled={autoLoading} className="text-xs text-emerald-400">{autoLoading ? '…' : 'Update'}</button>
                      <button onClick={() => setEditingIndustry(false)} className="text-xs text-slate-500">cancel</button>
                    </span>
                  ) : (
                    <>
                      <span className="text-white font-medium capitalize">{autoProfile.industryPhrase}</span>
                      <button onClick={() => { setIndustryDraft(autoProfile.industryPhrase); setEditingIndustry(true); }} className="ml-2 text-xs text-purple-400 hover:text-purple-300">edit</button>
                    </>
                  )}
                </div>
                {/* Codes — removable chips (the nurse case: drop generic 561320). */}
                <div>
                  <span className="text-slate-500">Codes (click ✕ to remove): </span>
                  {(autoProfile.naics || []).slice(0, 8).map((c: string) => (
                    <span key={c} className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-200 mr-1 mb-1">
                      {c}<button onClick={() => removeAutoNaics(c)} className="text-slate-500 hover:text-red-400">✕</button>
                    </span>
                  ))}
                  {autoProfile.topPsc && <span className="inline-block rounded bg-purple-500/20 px-2 py-0.5 text-xs text-purple-300 mr-1">PSC {autoProfile.topPsc.code}</span>}
                </div>
                {/* Same-sector suggestions — high-value codes in the user's own
                    line of work they don't have yet. One tap to add. Never suggests
                    adjacent industries (the API gates to the user's sector). */}
                {codeSuggestions.length > 0 && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-2.5">
                    <div className="text-xs font-medium text-emerald-300 mb-1.5">
                      💡 Also in your line of work — tap to add:
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {codeSuggestions.map((s) => (
                        <button
                          key={s.code}
                          onClick={() => addSuggestedNaics(s.code)}
                          className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-200 hover:bg-emerald-500/20"
                          title={`${s.name} — $${Math.round((s.amount || 0) / 1e6)}M`}
                        >
                          + {s.code} <span className="text-emerald-400/80 max-w-[180px] truncate">{s.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {/* Keywords — tune the words that catch mislabeled opportunity titles.
                    Extraction can grab generics; drop junk + add real capability words. */}
                <div>
                  <span className="text-slate-500">Keywords (catch titles your codes miss): </span>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {(autoProfile.keywords || []).map((kw: string) => (
                      <span key={kw} className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-200">
                        {kw}<button onClick={() => removeAutoKeyword(kw)} className="text-slate-500 hover:text-red-400">✕</button>
                      </span>
                    ))}
                    <input
                      value={keywordDraft}
                      onChange={e => setKeywordDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addAutoKeyword(); } }}
                      placeholder="+ add a keyword"
                      className="w-32 bg-transparent border-b border-slate-700 text-xs text-white placeholder-slate-600 focus:border-purple-500 focus:outline-none px-1 py-0.5"
                    />
                  </div>
                </div>
                {autoProfile.setAsides?.length > 0 && (
                  <div><span className="text-slate-500">Set-asides detected: </span>{autoProfile.setAsides.map((s: string) => <span key={s} className="inline-block rounded bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300 mr-1">{s}</span>)}</div>
                )}
                {/* States — editable coverage control (Eric: add/remove states here) */}
                <div>
                  <span className="text-slate-500">Where you&rsquo;ll get alerts (click to add/remove): </span>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {[...US_STATES, 'PR'].map((code) => {
                      const on = (autoProfile.states || []).includes(code);
                      return (
                        <button key={code} type="button" onClick={() => toggleAutoState(code)}
                          className={`px-1.5 py-0.5 rounded text-[11px] ${on ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-500 hover:text-slate-300'}`}>
                          {code}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1">No states selected = nationwide alerts.</p>
                </div>
                <div>
                  <span className="text-slate-500">Who buys this: </span>
                  <span className="text-slate-300">{(autoProfile.agencies || []).slice(0, 5).map((a: { name: string }) => a.name.replace('Department of ', '')).join(', ')}</span>
                </div>
              </div>
              {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
              <div className="mt-5 flex items-center gap-3">
                <button onClick={confirmAuto} disabled={saving} className="h-10 px-5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white text-sm font-medium rounded-lg">
                  {saving ? 'Setting up…' : 'Looks right — finish setup ✓'}
                </button>
                <button onClick={adjustInManual} className="h-10 px-4 text-sm text-slate-300 hover:text-white">Let me adjust the details</button>
              </div>
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-white">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 text-center">
          <MindyLogo size={64} className="mx-auto mb-5" />
          <h1 className="text-3xl font-bold">Set up your profile</h1>
          <p className="mt-2 text-slate-400">Help Mindy find the right opportunities for you</p>
        </header>

        <div className="mb-8">
          <div className="mb-2 flex items-center justify-between">
            {STEP_LABELS.map((label, index) => {
              const stepNumber = index + 1;
              const isComplete = stepNumber < step;
              const isActive = stepNumber === step;

              return (
                <div key={label} className="flex w-10 flex-col items-center gap-2">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                      isComplete || isActive
                        ? 'bg-purple-600 text-white'
                        : 'bg-slate-800 text-slate-500'
                    }`}
                  >
                    {isComplete ? '✓' : stepNumber}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-gradient-to-r from-purple-600 to-purple-500 transition-all"
              style={{ width: `${((step - 1) / (TOTAL_STEPS - 1)) * 100}%` }}
            />
          </div>
          <div className="mt-2 grid grid-cols-5 gap-1 text-center text-xs text-slate-500">
            {STEP_LABELS.map(label => (
              <span key={label}>{label}</span>
            ))}
          </div>
        </div>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 md:p-8">
          {error && (
            <div className="mb-5 rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}
          {calibrationMessage && (
            <div className="mb-5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              {calibrationMessage}
            </div>
          )}

          {step === 1 && (
            <div>
              <h2 className="mb-2 text-xl font-semibold">Tell us about your business</h2>
              <p className="mb-6 text-sm text-slate-400">
                Describe what your company does so Mindy can match the right opportunities.
              </p>
              <textarea
                value={businessDescription}
                onChange={event => setBusinessDescription(event.target.value)}
                placeholder="Example: We provide cybersecurity consulting, cloud security assessments, and compliance support for federal agencies."
                rows={5}
                className="w-full resize-none rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-purple-500"
              />
              <p className="mt-2 text-xs text-slate-500">
                Optional, but it helps Mindy rank matches more intelligently.
              </p>
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setShowSamplePicker(true);
                }}
                disabled={businessDescription.trim().length < 10}
                className="mt-4 w-full rounded-xl border border-purple-500/40 bg-purple-600/20 px-5 py-3 text-sm font-semibold text-purple-100 transition-colors hover:bg-purple-600/30 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-500"
              >
                Show real opportunities and suggest NAICS
              </button>
              <p className="mt-2 text-center text-xs text-slate-500">
                Pick examples that look right, and Mindy will pre-fill NAICS codes and agencies for review.
              </p>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="mb-2 text-xl font-semibold">What industries do you serve?</h2>
              <p className="mb-6 text-sm text-slate-400">
                Select your primary industries. You can also add specific NAICS codes.
              </p>
              {profileSuggestions && (
                <div className="mb-6 rounded-xl border border-purple-500/30 bg-purple-500/10 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-purple-100">Mindy found suggestions from your description</p>
                      <p className="mt-1 text-xs text-slate-400">Review these now. You can add or remove anything before finishing setup.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setProfileSuggestions(null)}
                      className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 hover:text-white"
                    >
                      Hide
                    </button>
                  </div>
                  <div className="grid gap-3 text-xs sm:grid-cols-2">
                    {profileSuggestions.industries.length > 0 && (
                      <div>
                        <p className="mb-1 font-medium uppercase tracking-wide text-slate-500">Industries</p>
                        <div className="flex flex-wrap gap-1.5">
                          {profileSuggestions.industries.map(value => (
                            <span key={value} className="rounded-full bg-purple-600/30 px-2 py-1 text-purple-100">{value}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {profileSuggestions.naicsCodes.length > 0 && (
                      <div>
                        <p className="mb-1 font-medium uppercase tracking-wide text-slate-500">NAICS</p>
                        <div className="flex flex-wrap gap-1.5">
                          {profileSuggestions.naicsCodes.map(value => (
                            <span key={value} className="rounded-full bg-slate-800 px-2 py-1 font-mono text-slate-200">{value}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {profileSuggestions.states.length > 0 && (
                      <div>
                        <p className="mb-1 font-medium uppercase tracking-wide text-slate-500">Geography</p>
                        <div className="flex flex-wrap gap-1.5">
                          {profileSuggestions.states.map(value => (
                            <span key={value} className="rounded-full bg-emerald-600/20 px-2 py-1 text-emerald-100">{value}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {profileSuggestions.agencies.length > 0 && (
                      <div>
                        <p className="mb-1 font-medium uppercase tracking-wide text-slate-500">Agencies</p>
                        <div className="flex flex-wrap gap-1.5">
                          {profileSuggestions.agencies.map(value => (
                            <span key={value} className="rounded-full bg-slate-800 px-2 py-1 text-slate-200">{value}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {profileSuggestions.setAsides.length > 0 && (
                      <div>
                        <p className="mb-1 font-medium uppercase tracking-wide text-slate-500">Set-asides</p>
                        <div className="flex flex-wrap gap-1.5">
                          {profileSuggestions.setAsides.map(value => (
                            <span key={value} className="rounded-full bg-amber-500/20 px-2 py-1 text-amber-100">{value}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {INDUSTRY_PRESETS.map(preset => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => toggleValue(preset.label, setSelectedIndustries)}
                    className={`rounded-xl border p-4 text-left transition-colors ${
                      selectedIndustries.includes(preset.label)
                        ? 'border-purple-500 bg-purple-600/20 ring-2 ring-purple-500/25'
                        : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="font-medium">{preset.label}</div>
                    <p className="mt-1 text-xs text-slate-500">{preset.description}</p>
                  </button>
                ))}
              </div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                Additional NAICS codes
              </label>
              <input
                value={customNaics}
                onChange={event => setCustomNaics(event.target.value)}
                placeholder="541512, 236220, 541"
                className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 font-mono text-sm text-white placeholder-slate-500 outline-none focus:border-purple-500"
              />
              {allNaicsCodes.length > 0 && (
                <div className="mt-4 rounded-lg border border-purple-500/20 bg-purple-500/10 p-3">
                  <p className="mb-2 text-xs font-medium text-purple-300">Selected NAICS codes:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {allNaicsCodes.slice(0, 18).map(code => (
                      <span key={code} className="rounded bg-purple-600/30 px-2 py-0.5 font-mono text-xs text-purple-200">
                        {code}
                      </span>
                    ))}
                    {allNaicsCodes.length > 18 && (
                      <span className="text-xs text-slate-500">+{allNaicsCodes.length - 18} more</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className="mb-2 text-xl font-semibold">Where do you perform work?</h2>
              <p className="mb-6 text-sm text-slate-400">
                Select states for place-of-performance filtering. Leave blank for nationwide coverage.
              </p>
              <div className="mb-4 flex flex-wrap gap-2">
                {Object.keys(REGION_PRESETS).map(region => (
                  <button
                    key={region}
                    type="button"
                    onClick={() => setSelectedStates(REGION_PRESETS[region])}
                    className="rounded-full bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
                  >
                    {region}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setSelectedStates([])}
                  className="rounded-full bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
                >
                  Clear
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-800 p-3">
                <div className="grid grid-cols-4 gap-1 sm:grid-cols-6">
                  {US_STATES.map(state => (
                    <button
                      key={state}
                      type="button"
                      onClick={() => toggleValue(state, setSelectedStates)}
                      className={`rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                        selectedStates.includes(state)
                          ? 'bg-purple-600 text-white'
                          : 'bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      {state}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-4 rounded-lg border border-slate-700 bg-slate-800/50 p-3 text-sm text-slate-300">
                {selectedStates.length > 0 ? `${selectedStates.length} states selected: ${selectedStates.join(', ')}` : 'No states selected = nationwide coverage'}
              </div>
            </div>
          )}

          {step === 4 && (
            <div>
              <h2 className="mb-2 text-xl font-semibold">Which agencies matter most?</h2>
              <p className="mb-6 text-sm text-slate-400">
                Pick priority agencies or leave this open for all federal opportunities.
              </p>
              <div className="mb-6 flex flex-wrap gap-2">
                {QUICK_AGENCIES.map(agency => (
                  <button
                    key={agency}
                    type="button"
                    onClick={() => toggleValue(agency, setSelectedAgencies)}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                      selectedAgencies.includes(agency)
                        ? 'bg-purple-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
                    }`}
                  >
                    {agency}
                  </button>
                ))}
              </div>
              <label className="mb-2 block text-sm font-medium text-slate-300">
                Other agencies
              </label>
              <textarea
                value={customAgencies}
                onChange={event => setCustomAgencies(event.target.value)}
                placeholder="Army Corps of Engineers, USPS, FBI"
                rows={2}
                className="w-full resize-none rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-purple-500"
              />
              <label className="mb-2 mt-6 block text-sm font-medium text-slate-300">
                Set-aside eligibility
              </label>
              <p className="mb-3 text-xs text-slate-500">
                Choose only certifications you actually hold. Mindy uses this to avoid ranking opportunities you are not eligible to prime.
              </p>
              <div className="grid gap-2">
                {BUSINESS_TYPES.map(type => {
                  const checked = selectedSetAsides.includes(type.value);
                  return (
                    <label
                      key={type.value}
                      className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-colors ${
                        checked
                          ? 'border-purple-500/40 bg-purple-600/20 text-white'
                          : 'border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-600 hover:text-white'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleValue(type.value, setSelectedSetAsides)}
                        className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-purple-600 focus:ring-purple-500"
                      />
                      <span>{type.label}</span>
                    </label>
                  );
                })}
              </div>
              {selectedSetAsides.length === 0 && (
                <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-100">
                  Small-business and special set-asides will be down-ranked until you select the statuses you can actually claim. Sources Sought/RFI notices still stay visible.
                </div>
              )}
              {(selectedSetAsides.includes('SDVOSB') || selectedSetAsides.includes('VOSB')) && (
                <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-100">
                  Mindy will keep veteran-focused VA opportunities in your recommendations because your profile says you are veteran-owned.
                </div>
              )}
              {allAgencies.length > 0 && (
                <div className="mt-4 rounded-lg border border-purple-500/20 bg-purple-500/10 p-3 text-sm text-purple-100">
                  Selected agencies: {allAgencies.join(', ')}
                </div>
              )}
            </div>
          )}

          {step === 5 && (
            <div>
              <h2 className="mb-2 text-xl font-semibold">How often should Mindy alert you?</h2>
              <p className="mb-6 text-sm text-slate-400">
                Choose your preferred delivery frequency. You can change this later.
              </p>
              <div className="space-y-3">
                {([
                  { value: 'daily', title: 'Daily', detail: 'Every morning with fresh matching opportunities' },
                  { value: 'mwf', title: 'Mon / Wed / Fri', detail: 'Every other weekday — less inbox, still timely' },
                  { value: 'tth', title: 'Tue / Thu', detail: 'Twice a week — for light readers' },
                  { value: 'weekly', title: 'Weekly', detail: 'A weekly digest of the best matches' },
                  { value: 'paused', title: 'Paused', detail: 'Save my settings but hold the emails for now' },
                ] as const).map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setFrequency(option.value)}
                    className={`w-full rounded-xl border p-4 text-left transition-colors ${
                      frequency === option.value
                        ? 'border-purple-500 bg-purple-600/20 ring-2 ring-purple-500/25'
                        : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="font-medium">{option.title}</div>
                    <p className="mt-1 text-sm text-slate-400">{option.detail}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-8 flex items-center justify-between border-t border-slate-800 pt-6">
            <button
              type="button"
              onClick={() => (step > 1 ? goToStep(step - 1) : router.push('/signup'))}
              className="px-4 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:text-white"
            >
              Back
            </button>
            <div className="flex items-center gap-3">
              {step === 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setProfileSuggestions(null);
                    setSkippedSamplePicker(true);
                    goToStep(2);
                  }}
                  className="px-4 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:text-white"
                >
                  Skip for now
                </button>
              )}
              <button
                type="button"
                onClick={handleNext}
                disabled={saving}
                className="rounded-xl bg-purple-600 px-7 py-2.5 font-semibold text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? 'Saving...' : step === TOTAL_STEPS ? 'Complete Setup' : 'Continue'}
              </button>
            </div>
          </div>
        </section>

        {showSamplePicker && (
          <SampleOpportunitiesPicker
            email={email}
            initialDescription={businessDescription}
            autoFetch={businessDescription.trim().length >= 10}
            onProfileExtracted={handleProfileExtracted}
            onClose={() => setShowSamplePicker(false)}
          />
        )}

        <p className="mt-6 text-center text-xs text-slate-500">Setting up for {email}</p>
      </div>
    </main>
  );
}
