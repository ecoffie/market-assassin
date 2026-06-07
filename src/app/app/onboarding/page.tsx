'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import SampleOpportunitiesPicker from '@/components/briefings/SampleOpportunitiesPicker';
import { MindyLogo } from '@/components/mindy/MindyLogo';
import { getSupabase } from '@/lib/supabase/client';
import { useAppTracker } from '@/components/app/track';

const INDUSTRY_PRESETS = [
  { label: 'Construction', codes: ['236', '237', '238'], description: 'Building, heavy civil, specialty trades' },
  { label: 'IT Services', codes: ['541511', '541512', '541513', '541519'], description: 'Software, systems design, data processing' },
  { label: 'Cybersecurity', codes: ['541512', '541519', '518210'], description: 'Security systems, data protection' },
  { label: 'Professional Services', codes: ['541'], description: 'Consulting, engineering, R&D' },
  { label: 'Healthcare', codes: ['621', '622', '623'], description: 'Medical, hospitals, nursing care' },
  { label: 'Logistics & Supply', codes: ['493', '484', '488'], description: 'Warehousing, trucking, transportation' },
  { label: 'Facilities & Maintenance', codes: ['561210', '561720', '561730'], description: 'Janitorial, landscaping, building services' },
  { label: 'Training & Education', codes: ['611430', '611420', '611710'], description: 'Professional training, educational services' },
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

      const suggestions = inferProfileSuggestions(businessDescription);
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
      router.push(`/app?email=${encodeURIComponent(email)}`);
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
