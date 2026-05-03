'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import SampleOpportunitiesPicker from '@/components/briefings/SampleOpportunitiesPicker';

// Industry presets with icons
const INDUSTRY_PRESETS = [
  { label: 'Construction', codes: ['236', '237', '238'], description: 'Building, heavy civil, specialty trades', icon: '🏗️' },
  { label: 'IT Services', codes: ['541511', '541512', '541513', '541519'], description: 'Software, systems design, data processing', icon: '💻' },
  { label: 'Cybersecurity', codes: ['541512', '541519', '518210'], description: 'Security systems, data protection', icon: '🛡️' },
  { label: 'Professional Services', codes: ['541'], description: 'Consulting, engineering, R&D', icon: '📊' },
  { label: 'Healthcare', codes: ['621', '622', '623'], description: 'Medical, hospitals, nursing care', icon: '🏥' },
  { label: 'Logistics & Supply', codes: ['493', '484', '488'], description: 'Warehousing, trucking, transportation', icon: '📦' },
  { label: 'Facilities & Maintenance', codes: ['561210', '561720', '561730'], description: 'Janitorial, landscaping, building services', icon: '🔧' },
  { label: 'Training & Education', codes: ['611430', '611420', '611710'], description: 'Professional training, educational services', icon: '🎓' },
];

const QUICK_AGENCIES = ['DHS', 'VA', 'GSA', 'DoD', 'Army Corps', 'HHS', 'DOE', 'NASA', 'DOJ', 'DOT'];

const US_STATES = [
  { value: 'AL', label: 'Alabama' }, { value: 'AK', label: 'Alaska' }, { value: 'AZ', label: 'Arizona' },
  { value: 'AR', label: 'Arkansas' }, { value: 'CA', label: 'California' }, { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' }, { value: 'DE', label: 'Delaware' }, { value: 'DC', label: 'Washington DC' },
  { value: 'FL', label: 'Florida' }, { value: 'GA', label: 'Georgia' }, { value: 'HI', label: 'Hawaii' },
  { value: 'ID', label: 'Idaho' }, { value: 'IL', label: 'Illinois' }, { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' }, { value: 'KS', label: 'Kansas' }, { value: 'KY', label: 'Kentucky' },
  { value: 'LA', label: 'Louisiana' }, { value: 'ME', label: 'Maine' }, { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' }, { value: 'MI', label: 'Michigan' }, { value: 'MN', label: 'Minnesota' },
  { value: 'MS', label: 'Mississippi' }, { value: 'MO', label: 'Missouri' }, { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' }, { value: 'NV', label: 'Nevada' }, { value: 'NH', label: 'New Hampshire' },
  { value: 'NJ', label: 'New Jersey' }, { value: 'NM', label: 'New Mexico' }, { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' }, { value: 'ND', label: 'North Dakota' }, { value: 'OH', label: 'Ohio' },
  { value: 'OK', label: 'Oklahoma' }, { value: 'OR', label: 'Oregon' }, { value: 'PA', label: 'Pennsylvania' },
  { value: 'RI', label: 'Rhode Island' }, { value: 'SC', label: 'South Carolina' }, { value: 'SD', label: 'South Dakota' },
  { value: 'TN', label: 'Tennessee' }, { value: 'TX', label: 'Texas' }, { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' }, { value: 'VA', label: 'Virginia' }, { value: 'WA', label: 'Washington' },
  { value: 'WV', label: 'West Virginia' }, { value: 'WI', label: 'Wisconsin' }, { value: 'WY', label: 'Wyoming' },
];

const REGION_PRESETS: Record<string, string[]> = {
  'Southeast': ['FL', 'GA', 'AL', 'SC', 'NC', 'TN'],
  'Mid-Atlantic': ['VA', 'MD', 'DC', 'WV', 'DE', 'PA', 'NJ'],
  'Southwest': ['TX', 'OK', 'AR', 'LA', 'NM'],
  'West Coast': ['CA', 'OR', 'WA', 'NV', 'AZ'],
  'Midwest': ['IL', 'IN', 'OH', 'MI', 'WI', 'MN', 'IA', 'MO'],
  'Northeast': ['NY', 'MA', 'CT', 'RI', 'NH', 'VT', 'ME'],
};

const BUSINESS_TYPES = [
  { value: '', label: 'No set-aside preference' },
  { value: 'SDVOSB', label: 'SDVOSB - Service-Disabled Veteran-Owned' },
  { value: 'VOSB', label: 'VOSB - Veteran-Owned Small Business' },
  { value: '8a', label: '8(a) - SBA 8(a) Program' },
  { value: 'WOSB', label: 'WOSB - Women-Owned Small Business' },
  { value: 'EDWOSB', label: 'EDWOSB - Economically Disadvantaged WOSB' },
  { value: 'HUBZone', label: 'HUBZone' },
  { value: 'Small Business', label: 'Small Business (General)' },
];

interface ExtractedProfile {
  naicsCodes: Array<{ code: string; name: string; count: number }>;
  pscCodes: Array<{ code: string; count: number }>;
  keywords: string[];
  agencies: Array<{ name: string; count: number }>;
}

// Loading fallback for Suspense
function SignupLoading() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="flex items-center gap-3 text-slate-400">
        <svg className="animate-spin h-6 w-6" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        Loading...
      </div>
    </div>
  );
}

// Main page wrapper with Suspense
export default function AlertSignupPage() {
  return (
    <Suspense fallback={<SignupLoading />}>
      <AlertSignupContent />
    </Suspense>
  );
}

function AlertSignupContent() {
  const searchParams = useSearchParams();

  // Wizard state
  const [step, setStep] = useState(0); // 0 = email entry, 1-4 = wizard steps
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Profile form state
  const [businessDescription, setBusinessDescription] = useState('');
  const [showSamplePicker, setShowSamplePicker] = useState(false);
  const [calibrationMessage, setCalibrationMessage] = useState('');
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([]);
  const [customNaics, setCustomNaics] = useState('');
  const [selectedAgencies, setSelectedAgencies] = useState<string[]>([]);
  const [customAgencies, setCustomAgencies] = useState('');
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [businessType, setBusinessType] = useState('');
  const [frequency, setFrequency] = useState<'daily' | 'weekly'>('daily');

  // Invitation token state
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteData, setInviteData] = useState<{
    valid: boolean;
    customerId: string;
    email: string | null;
    firstName: string | null;
    productName: string | null;
  } | null>(null);
  const [verifyingInvite, setVerifyingInvite] = useState(false);
  const [inviteError, setInviteError] = useState('');

  const totalSteps = 5;

  // Check for invite token on mount
  useEffect(() => {
    const token = searchParams.get('invite');
    if (token) {
      setInviteToken(token);
      verifyInvitation(token);
    }
  }, [searchParams]);

  async function verifyInvitation(token: string) {
    setVerifyingInvite(true);
    setInviteError('');

    try {
      const res = await fetch(`/api/invitations/verify?token=${encodeURIComponent(token)}`);
      const data = await res.json();

      if (res.ok && data.valid) {
        setInviteData(data);
        if (data.email) {
          setEmail(data.email);
        }
      } else {
        setInviteError(data.error || 'Invalid invitation link');
        setInviteToken(null);
      }
    } catch {
      setInviteError('Failed to verify invitation');
      setInviteToken(null);
    } finally {
      setVerifyingInvite(false);
    }
  }

  // Get all NAICS codes from selected industries + custom
  const getAllNaicsCodes = (): string[] => {
    const fromIndustries = selectedIndustries.flatMap(industry => {
      const preset = INDUSTRY_PRESETS.find(p => p.label === industry);
      return preset?.codes || [];
    });
    const custom = customNaics
      .split(/[,\s]+/)
      .map(c => c.trim())
      .filter(c => /^\d+$/.test(c));
    return [...new Set([...fromIndustries, ...custom])];
  };

  // Get all agencies from selected + custom
  const getAllAgencies = (): string[] => {
    const custom = customAgencies
      .split(/[,]+/)
      .map(a => a.trim())
      .filter(a => a.length > 0);
    return [...new Set([...selectedAgencies, ...custom])];
  };

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError('Please enter your email');
      return;
    }
    setEmail(trimmed);
    setError('');
    setStep(1); // Start wizard
  };

  const goToStep = (nextStep: number) => {
    setError('');
    setCalibrationMessage('');
    setStep(nextStep);
  };

  const handleNext = async () => {
    setError('');
    setSaving(true);

    try {
      if (step === 1) {
        // Business description is optional. It improves matching when present.
        goToStep(2);
      } else if (step === 2) {
        // Validate: at least one industry or NAICS code
        if (getAllNaicsCodes().length === 0) {
          setError('Please select at least one industry or enter NAICS codes');
          setSaving(false);
          return;
        }
        goToStep(3);
      } else if (step === 3) {
        // Agencies are optional
        goToStep(4);
      } else if (step === 4) {
        // Geography is optional
        goToStep(5);
      } else if (step === 5) {
        // Final step - save everything
        const res = await fetch('/api/alerts/save-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.toLowerCase().trim(),
            businessDescription: businessDescription.trim() || null,
            naicsCodes: getAllNaicsCodes(),
            businessType: businessType || null,
            targetAgencies: getAllAgencies(),
            locationStates: selectedStates,
            alertFrequency: frequency,
            source: inviteToken ? 'paid_existing' : 'free-signup',
            inviteToken: inviteToken || undefined,
            stripeCustomerId: inviteData?.customerId || undefined,
            alertsEnabled: true,
            briefingsEnabled: !!inviteToken, // Only for paid subscribers
            isActive: true,
          }),
        });

        // Mark invitation as used if signup successful
        if (inviteToken && res.ok) {
          fetch('/api/invitations/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: inviteToken, email: email.toLowerCase().trim() }),
          }).catch(() => {}); // Fire and forget
        }

        const data = await res.json();

        if (data.success) {
          setSuccess(true);
        } else {
          setError(data.error || 'Failed to save profile. Please try again.');
        }
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => {
    setError('');
    if (step > 1) setStep(step - 1);
    else if (step === 1) setStep(0);
  };

  const toggleIndustry = (industry: string) => {
    setSelectedIndustries(prev =>
      prev.includes(industry)
        ? prev.filter(i => i !== industry)
        : [...prev, industry]
    );
  };

  const toggleAgency = (agency: string) => {
    setSelectedAgencies(prev =>
      prev.includes(agency)
        ? prev.filter(a => a !== agency)
        : [...prev, agency]
    );
  };

  const toggleState = (state: string) => {
    setSelectedStates(prev =>
      prev.includes(state)
        ? prev.filter(s => s !== state)
        : [...prev, state]
    );
  };

  const setRegion = (regionName: string) => {
    const states = REGION_PRESETS[regionName] || [];
    setSelectedStates(states);
  };

  const handleProfileExtracted = (profile: ExtractedProfile) => {
    const extractedCodes = profile.naicsCodes.map(item => item.code).filter(Boolean);
    if (extractedCodes.length > 0) {
      const existingCodes = customNaics.split(/[,\s]+/).map(c => c.trim()).filter(Boolean);
      setCustomNaics([...new Set([...existingCodes, ...extractedCodes])].join(', '));

      const matchedIndustries = INDUSTRY_PRESETS
        .filter(preset => preset.codes.some(prefix => extractedCodes.some(code => code.startsWith(prefix))))
        .map(preset => preset.label);
      if (matchedIndustries.length > 0) {
        setSelectedIndustries(prev => [...new Set([...prev, ...matchedIndustries])]);
      }
    }

    if (profile.agencies.length > 0) {
      const agencyNames = profile.agencies.slice(0, 6).map(agency => {
        const normalized = agency.name.toLowerCase();
        const matchedQuick = QUICK_AGENCIES.find(quick =>
          normalized.includes(quick.toLowerCase()) ||
          quick.toLowerCase().includes(agency.name.split(' ')[0].toLowerCase())
        );
        return matchedQuick || agency.name.split(',')[0].split(' ').slice(0, 3).join(' ');
      });

      const quickMatches = agencyNames.filter(agency => QUICK_AGENCIES.includes(agency));
      const customMatches = agencyNames.filter(agency => !QUICK_AGENCIES.includes(agency));

      if (quickMatches.length > 0) {
        setSelectedAgencies(prev => [...new Set([...prev, ...quickMatches])]);
      }
      if (customMatches.length > 0) {
        const existing = customAgencies.split(/[,]+/).map(a => a.trim()).filter(Boolean);
        setCustomAgencies([...new Set([...existing, ...customMatches])].join(', '));
      }
    }

    setCalibrationMessage('Profile calibrated from your opportunity selections. Review the suggested codes and agencies before finishing.');
    setShowSamplePicker(false);
    setStep(2);
  };

  // Paid subscriber success - redirect to briefings dashboard
  if (success && inviteToken) {
    return (
      <div className="min-h-screen bg-slate-950">
        <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-red-700 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">GC</span>
              </div>
              <span className="text-white font-semibold">GovCon Giants</span>
            </Link>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-4 py-16">
          <div className="text-center">
            <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-white mb-4">You&apos;re All Set!</h1>
            <p className="text-slate-400 text-lg mb-8">
              Your Market Intelligence profile is saved for <span className="text-white font-medium">{email}</span>.
            </p>

            <div className="bg-gradient-to-br from-slate-900 to-emerald-950/30 border border-emerald-500/40 rounded-xl p-6 mb-8 text-left">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Your Subscription Includes
              </h3>
              <ul className="text-slate-400 text-sm space-y-3 mb-6">
                <li className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <div>
                    <strong className="text-white">Daily Market Intel</strong>
                    <p className="text-slate-500">Ranked opportunities matched to your profile, delivered every morning</p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <div>
                    <strong className="text-white">Weekly Deep Dive</strong>
                    <p className="text-slate-500">Market analysis, teaming opportunities, and recompete intelligence</p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <div>
                    <strong className="text-white">Pursuit Briefs</strong>
                    <p className="text-slate-500">Your top 3 opportunity targets with specific pursuit guidance</p>
                  </div>
                </li>
              </ul>
              <Link
                href="/briefings"
                className="inline-flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-green-700 hover:from-emerald-500 hover:to-green-600 text-white font-semibold py-3 px-6 rounded-lg transition-all"
              >
                Go to Your Dashboard
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
            </div>

            <p className="text-slate-500 text-sm">
              Your first briefing will arrive tomorrow morning. Questions?{' '}
              <a href="mailto:service@govcongiants.com" className="text-emerald-400 hover:text-emerald-300">
                Reply to any email
              </a>
            </p>
          </div>
        </main>
      </div>
    );
  }

  // Free signup success
  if (success) {
    return (
      <div className="min-h-screen bg-slate-950">
        <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-red-700 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">GC</span>
              </div>
              <span className="text-white font-semibold">GovCon Giants</span>
            </Link>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-4 py-16">
          <div className="text-center">
            <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-white mb-4">You&apos;re Signed Up!</h1>
            <p className="text-slate-400 text-lg mb-8">
              Your profile is saved for <span className="text-white font-medium">{email}</span>.
              {frequency === 'daily' ? ' Daily' : ' Weekly'} alerts will start arriving soon.
            </p>

            {/* Upsell to Daily Briefings */}
            <div className="bg-gradient-to-br from-slate-900 to-purple-950/30 border border-purple-500/30 rounded-xl p-6 mb-8 text-left">
              <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
                <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Want More Than Just Alerts?
              </h3>
              <p className="text-slate-400 text-sm mb-4">
                <strong className="text-white">Market Intelligence</strong> turns your matches into ranked priorities, weekly market analysis, and pursuit guidance.
              </p>
              <Link
                href="/market-intelligence"
                className="inline-flex items-center gap-2 bg-gradient-to-r from-purple-600 to-blue-700 hover:from-purple-500 hover:to-blue-600 text-white font-semibold py-2 px-4 rounded-lg transition-all text-sm"
              >
                Upgrade to Market Intelligence
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
              <p className="text-slate-500 text-sm mt-2">$49/mo or $497/yr</p>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/opportunity-hunter"
                className="text-slate-400 hover:text-white text-sm flex items-center justify-center gap-1 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                Search opportunities now
              </Link>
              <Link
                href="/briefings"
                className="text-slate-400 hover:text-white text-sm flex items-center justify-center gap-1 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Manage preferences
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Email entry (step 0)
  if (step === 0) {
    return (
      <div className="min-h-screen bg-slate-950">
        <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-50">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-red-700 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">GC</span>
              </div>
              <span className="text-white font-semibold">GovCon Giants</span>
            </Link>
            <Link href="/briefings" className="text-slate-400 hover:text-white text-sm">
              Already signed up?
            </Link>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-4 py-12">
          {/* Verified Subscriber Banner */}
          {verifyingInvite && (
            <div className="bg-slate-900/80 border border-slate-700 rounded-xl p-6 mb-8 text-center">
              <div className="flex items-center justify-center gap-3 text-slate-400">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Verifying your subscription...
              </div>
            </div>
          )}

          {inviteError && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-6 mb-8">
              <div className="flex items-center gap-3">
                <svg className="w-6 h-6 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <p className="text-amber-300 font-medium">Invitation Link Issue</p>
                  <p className="text-amber-400/80 text-sm">{inviteError}. You can still sign up normally below.</p>
                </div>
              </div>
            </div>
          )}

          {inviteData && !verifyingInvite && (
            <div className="bg-gradient-to-br from-emerald-500/10 to-green-600/10 border border-emerald-500/40 rounded-xl p-6 mb-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-emerald-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-emerald-300 font-semibold text-lg mb-1">
                    Welcome back{inviteData.firstName ? `, ${inviteData.firstName}` : ''}!
                  </h3>
                  <p className="text-emerald-400/80 text-sm mb-2">
                    Your <span className="text-white font-medium">{inviteData.productName || 'GovCon subscription'}</span> includes full Market Intelligence access.
                  </p>
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-500/20 rounded-full text-emerald-300 text-sm">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Verified Subscriber
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Hero */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-sm mb-4">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {inviteData ? 'Market Intelligence' : 'Daily Alerts'}
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">
              {inviteData ? 'Activate Your Briefings' : 'Get SAM.gov Opportunities Delivered'}
            </h1>
            <p className="text-slate-400 text-lg">
              {inviteData
                ? 'Set up your profile in 2 minutes to receive personalized market intelligence.'
                : 'Configure your profile once. Get matching opportunities delivered to your inbox.'}
            </p>
          </div>

          {/* Features grid */}
          <div className="grid sm:grid-cols-3 gap-4 mb-10">
            <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4 text-center">
              <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center mx-auto mb-3">
                <span className="text-xl">🎯</span>
              </div>
              <h3 className="text-white font-medium mb-1">NAICS Matched</h3>
              <p className="text-slate-500 text-sm">Your industries only</p>
            </div>
            <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4 text-center">
              <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center mx-auto mb-3">
                <span className="text-xl">🏛️</span>
              </div>
              <h3 className="text-white font-medium mb-1">Agency Targeted</h3>
              <p className="text-slate-500 text-sm">Focus where you win</p>
            </div>
            <div className="bg-slate-900/50 border border-slate-800 rounded-lg p-4 text-center">
              <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center mx-auto mb-3">
                <span className="text-xl">📍</span>
              </div>
              <h3 className="text-white font-medium mb-1">Location Filtered</h3>
              <p className="text-slate-500 text-sm">Where you perform</p>
            </div>
          </div>

          {/* Email Form */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 md:p-8">
            <form onSubmit={handleEmailSubmit} className="space-y-6">
              {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg p-4 flex items-center gap-3">
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-2">
                  Email Address
                  {inviteData?.email && (
                    <span className="ml-2 text-emerald-400 text-xs">(verified from subscription)</span>
                  )}
                </label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className={`w-full bg-slate-800 border rounded-lg px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent ${
                    inviteData?.email ? 'border-emerald-500/50 bg-emerald-950/20' : 'border-slate-700'
                  }`}
                  required
                  readOnly={!!inviteData?.email}
                />
              </div>

              <button
                type="submit"
                className="w-full bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white font-semibold py-4 px-6 rounded-lg transition-all text-lg"
              >
                Continue to Profile Setup
                <svg className="w-5 h-5 inline-block ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </button>
            </form>
          </div>

          {/* Footer */}
          <div className="mt-12 text-center">
            <p className="text-slate-500 text-sm">
              Questions?{' '}
              <a href="mailto:service@govcongiants.com" className="text-purple-400 hover:text-purple-300">
                service@govcongiants.com
              </a>
            </p>
          </div>
        </main>
      </div>
    );
  }

  // Wizard steps 1-5
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4 py-12">
      <div className="max-w-2xl w-full">
        {/* Header with branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-600 to-purple-800 flex items-center justify-center">
              <span className="text-white font-bold text-xl">{inviteData ? 'MI' : 'DA'}</span>
            </div>
            <div className="text-left">
              <h1 className="text-2xl font-bold text-white">
                {inviteData ? 'Market Intelligence' : 'Daily Alerts'}
              </h1>
              <p className="text-purple-400 text-sm">Configure your profile</p>
            </div>
          </div>
          <p className="text-gray-400 max-w-md mx-auto">
            Setting up for <span className="text-white">{email}</span>
          </p>
        </div>

        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            {[1, 2, 3, 4, 5].map(s => (
              <div
                key={s}
                className={`flex items-center justify-center w-10 h-10 rounded-full font-semibold text-sm transition-colors ${
                  s < step
                    ? 'bg-purple-600 text-white'
                    : s === step
                    ? 'bg-purple-600 text-white ring-4 ring-purple-600/30'
                    : 'bg-gray-800 text-gray-500'
                }`}
              >
                {s < step ? '✓' : s}
              </div>
            ))}
          </div>
          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-purple-600 to-purple-500 transition-all duration-300"
              style={{ width: `${((step - 1) / (totalSteps - 1)) * 100}%` }}
            />
          </div>
          <div className="flex justify-between mt-2 text-xs text-gray-500">
            <span>Match</span>
            <span>Industries</span>
            <span>Geography</span>
            <span>Agencies</span>
            <span>Delivery</span>
          </div>
        </div>

        {/* Step content */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 md:p-8">
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}
          {calibrationMessage && (
            <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-300 text-sm">
              {calibrationMessage}
            </div>
          )}

          {/* Step 1: Business description + real-opportunity calibration */}
          {step === 1 && (
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">Find examples that fit your business</h2>
              <p className="text-gray-400 text-sm mb-6">
                Describe what your company does in 1-2 sentences. We&apos;ll show real opportunities so you can pick what looks right.
              </p>

              <textarea
                value={businessDescription}
                onChange={e => {
                  setError('');
                  setBusinessDescription(e.target.value);
                }}
                placeholder="Example: We provide cybersecurity consulting, cloud security assessments, and compliance support for federal agencies."
                rows={5}
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none text-sm resize-none"
              />
              <p className="text-xs text-gray-500 mt-2">
                Optional, but this lets us suggest NAICS codes and agencies from real opportunity data instead of making you guess.
              </p>
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setShowSamplePicker(true);
                }}
                disabled={businessDescription.trim().length < 10}
                className="mt-4 w-full py-3 px-6 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all"
              >
                Show me matching opportunities
              </button>
              <p className="text-xs text-gray-500 mt-2 text-center">
                Pick a few examples and we&apos;ll pre-fill the rest of setup for review.
              </p>
            </div>
          )}

          {/* Step 2: Industries/NAICS */}
          {step === 2 && (
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">What industries do you serve?</h2>
              <p className="text-gray-400 text-sm mb-6">
                Select your primary industries. This determines which opportunities appear in your alerts.
              </p>

              <div className="grid grid-cols-2 gap-3 mb-6">
                {INDUSTRY_PRESETS.map(preset => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => toggleIndustry(preset.label)}
                    className={`text-left p-4 rounded-xl border transition-all ${
                      selectedIndustries.includes(preset.label)
                        ? 'bg-purple-600/20 border-purple-500/50 ring-2 ring-purple-500/30'
                        : 'bg-gray-800/50 border-gray-700 hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{preset.icon}</span>
                      <span className="font-medium text-white text-sm">{preset.label}</span>
                    </div>
                    <p className="text-xs text-gray-500">{preset.description}</p>
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Additional NAICS codes (optional)
                </label>
                <input
                  type="text"
                  value={customNaics}
                  onChange={e => setCustomNaics(e.target.value)}
                  placeholder="541512, 236220"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none font-mono text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Use short codes like &quot;236&quot; to match all codes starting with 236.
                </p>
              </div>

              {getAllNaicsCodes().length > 0 && (
                <div className="mt-4 p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                  <p className="text-xs text-purple-400 font-medium mb-1">Selected NAICS codes:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {getAllNaicsCodes().slice(0, 12).map(code => (
                      <span key={code} className="px-2 py-0.5 bg-purple-600/30 rounded text-xs text-purple-300 font-mono">
                        {code}
                      </span>
                    ))}
                    {getAllNaicsCodes().length > 12 && (
                      <span className="text-xs text-gray-500">+{getAllNaicsCodes().length - 12} more</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 4: Agencies */}
          {step === 4 && (
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">Review target agencies</h2>
              <p className="text-gray-400 text-sm mb-6">
                We pre-fill agencies when your opportunity selections suggest them. Keep the ones that fit or leave blank for all agencies.
              </p>

              <div className="flex flex-wrap gap-2 mb-6">
                {QUICK_AGENCIES.map(agency => (
                  <button
                    key={agency}
                    type="button"
                    onClick={() => toggleAgency(agency)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                      selectedAgencies.includes(agency)
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                    }`}
                  >
                    {agency}
                  </button>
                ))}
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Other agencies (optional)
                </label>
                <textarea
                  value={customAgencies}
                  onChange={e => setCustomAgencies(e.target.value)}
                  placeholder="Army Corps of Engineers, USPS, FBI"
                  rows={2}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none text-sm"
                />
              </div>

              {/* Business type / Set-aside */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Business Type / Set-Aside (optional)
                </label>
                <select
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:border-purple-500 focus:outline-none"
                >
                  {BUSINESS_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              {getAllAgencies().length > 0 && (
                <div className="mt-4 p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                  <p className="text-xs text-purple-400 font-medium mb-1">Selected agencies:</p>
                  <p className="text-sm text-gray-300">{getAllAgencies().join(', ')}</p>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Geography */}
          {step === 3 && (
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">Where do you perform work?</h2>
              <p className="text-gray-400 text-sm mb-6">
                Select states for place of performance filtering. Leave empty for nationwide.
              </p>

              {/* Region quick-select */}
              <div className="flex flex-wrap gap-2 mb-4">
                {Object.keys(REGION_PRESETS).map(region => (
                  <button
                    key={region}
                    type="button"
                    onClick={() => setRegion(region)}
                    className="px-3 py-1.5 rounded-full text-xs font-medium bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                  >
                    {region}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setSelectedStates([])}
                  className="px-3 py-1.5 rounded-full text-xs font-medium bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                >
                  Clear all
                </button>
              </div>

              {/* State grid */}
              <div className="max-h-64 overflow-y-auto border border-gray-800 rounded-xl p-3 mb-4">
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-1">
                  {US_STATES.map(state => (
                    <button
                      key={state.value}
                      type="button"
                      onClick={() => toggleState(state.value)}
                      className={`px-2 py-1.5 rounded text-xs font-medium transition-all ${
                        selectedStates.includes(state.value)
                          ? 'bg-purple-600 text-white'
                          : 'bg-gray-800/50 text-gray-400 hover:text-white hover:bg-gray-800'
                      }`}
                    >
                      {state.value}
                    </button>
                  ))}
                </div>
              </div>

              {selectedStates.length > 0 ? (
                <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                  <p className="text-xs text-purple-400 font-medium mb-1">
                    {selectedStates.length} states selected (+ auto-expanded bordering states + DC)
                  </p>
                  <p className="text-sm text-gray-300">{selectedStates.join(', ')}</p>
                </div>
              ) : (
                <div className="p-3 bg-gray-800/50 border border-gray-700 rounded-lg">
                  <p className="text-xs text-gray-400">
                    No states selected = Nationwide coverage
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Step 5: Delivery preferences */}
          {step === 5 && (
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">How often should we alert you?</h2>
              <p className="text-gray-400 text-sm mb-6">
                Choose your preferred delivery frequency. You can change this anytime.
              </p>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setFrequency('daily')}
                  className={`w-full text-left p-4 rounded-xl border transition-all ${
                    frequency === 'daily'
                      ? 'bg-purple-600/20 border-purple-500/50 ring-2 ring-purple-500/30'
                      : 'bg-gray-800/50 border-gray-700 hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      frequency === 'daily' ? 'border-purple-500' : 'border-gray-600'
                    }`}>
                      {frequency === 'daily' && <div className="w-2.5 h-2.5 rounded-full bg-purple-500" />}
                    </div>
                    <div>
                      <span className="font-medium text-white">Daily</span>
                      <p className="text-sm text-gray-400">Every morning at 7 AM your time</p>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setFrequency('weekly')}
                  className={`w-full text-left p-4 rounded-xl border transition-all ${
                    frequency === 'weekly'
                      ? 'bg-purple-600/20 border-purple-500/50 ring-2 ring-purple-500/30'
                      : 'bg-gray-800/50 border-gray-700 hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      frequency === 'weekly' ? 'border-purple-500' : 'border-gray-600'
                    }`}>
                      {frequency === 'weekly' && <div className="w-2.5 h-2.5 rounded-full bg-purple-500" />}
                    </div>
                    <div>
                      <span className="font-medium text-white">Weekly</span>
                      <p className="text-sm text-gray-400">Sunday digest with the week&apos;s opportunities</p>
                    </div>
                  </div>
                </button>
              </div>

              {inviteData && (
                <div className="mt-6 p-4 bg-gradient-to-r from-purple-900/30 to-purple-800/20 border border-purple-500/30 rounded-xl">
                  <h3 className="font-medium text-white mb-2">What you&apos;ll receive:</h3>
                  <ul className="space-y-2 text-sm text-gray-300">
                    <li className="flex items-center gap-2">
                      <span className="text-purple-400">✓</span> Daily Brief — prioritized opportunities and deadlines
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-purple-400">✓</span> Weekly Deep Dive — strategic analysis and teaming
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="text-purple-400">✓</span> Pursuit Briefs — capture guidance for targets
                    </li>
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-800">
            <button
              type="button"
              onClick={handleBack}
              className="px-6 py-2.5 text-gray-400 hover:text-white transition-colors"
            >
              Back
            </button>
            {step === 1 && (
              <button
                type="button"
                onClick={() => {
                  setBusinessDescription('');
                  goToStep(2);
                }}
                className="px-6 py-2.5 text-gray-400 hover:text-white transition-colors"
              >
                Skip for now
              </button>
            )}
            <button
              type="button"
              onClick={handleNext}
              disabled={saving}
              className="px-8 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving...' : step === totalSteps ? 'Complete Setup' : 'Continue'}
            </button>
          </div>
        </div>

        {showSamplePicker && (
          <SampleOpportunitiesPicker
            email={email}
            initialDescription={businessDescription}
            autoFetch={businessDescription.trim().length >= 10}
            onProfileExtracted={handleProfileExtracted}
            onClose={() => setShowSamplePicker(false)}
          />
        )}

        {/* Footer */}
        <p className="text-center text-gray-500 text-xs mt-6">
          Setting up for {email}
        </p>
      </div>
    </div>
  );
}
