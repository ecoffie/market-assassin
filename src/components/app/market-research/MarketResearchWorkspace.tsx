'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Download,
  FileSearch,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';
import { authedFetch, getMIApiHeaders } from '@/components/app/authHeaders';
import type { MrrRunJobDto } from '@/lib/mrr/run-store';
import type { Phase1ReviewDto, ReviewFinding, ReviewState } from '@/lib/mrr/workspace-dto';
import type { DecisionBrief } from '@/lib/mrr/decision-brief';
import type { EvidenceBuckets } from '@/lib/mrr/evidence-buckets';
import type { InterpretMarketResult, MarketConfirmation } from '@/lib/mrr/interpret-market';
import { geographyDisplayName } from '@/lib/mrr/interpret-market';

const PROTOTYPE_BANNER = 'PROTOTYPE — PUBLIC-DATA DEMO — NOT FOR SIGNATURE';
const RUN_KEY = 'mrr_workspace_run_id';

type Intake = {
  sam_url: string;
  notice_id: string;
  solicitation_number: string;
  title: string;
  agency: string;
  sub_agency: string;
  office: string;
  description: string;
  naics: string;
  psc: string;
  keyword: string;
  est_value: string;
  pop_start: string;
  pop_end: string;
  place_of_performance_state: string;
  installation: string;
  public_data_only_confirmed: boolean;
};

const EMPTY_INTAKE: Intake = {
  sam_url: '',
  notice_id: '',
  solicitation_number: '',
  title: '',
  agency: '',
  sub_agency: '',
  office: '',
  description: '',
  naics: '',
  psc: '',
  keyword: '',
  est_value: '',
  pop_start: '',
  pop_end: '',
  place_of_performance_state: '',
  installation: '',
  public_data_only_confirmed: false,
};

const DHA_PRESET: Intake = {
  ...EMPTY_INTAKE,
  notice_id: '213a2fe3a447465e8f30699c9f056ec4',
  solicitation_number: 'DHA_JOMIS_JMP_20260813',
  title: 'JOMIS Joint Medical Planning, Modeling and Simulation Capabilities',
  agency: 'Defense Health Agency',
  sub_agency: 'Department of Defense',
  office: 'JOMIS Program Management Office',
  description:
    'The Defense Health Agency (DHA), Joint Operational Medicine Information Systems (JOMIS) Program Management Office is conducting market research on joint medical planning, modeling and simulation capabilities. Sources sought notice; responses due 2026-09-13.',
  naics: '541512',
  psc: 'DA01',
  keyword: 'modeling and simulation',
};

type ApiResponse = {
  success: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  deduplicated?: boolean;
  job?: MrrRunJobDto;
};

const STATE_STYLE: Record<ReviewState, string> = {
  Sourced: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  Unknown: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  Degraded: 'border-orange-500/30 bg-orange-500/10 text-orange-200',
  'Measured zero': 'border-sky-500/30 bg-sky-500/10 text-sky-200',
};

function StateBadge({ state }: { state: ReviewState }) {
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${STATE_STYLE[state]}`}>
      {state}
    </span>
  );
}

function Provenance({ finding }: { finding: ReviewFinding }) {
  if (finding.evidence.length === 0 && !finding.reason) return null;
  return (
    <details className="group rounded-lg border border-white/8 bg-black/15">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-xs font-medium text-gray-400">
        Provenance and limitations
        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-3 border-t border-white/8 px-3 py-3 text-xs text-gray-400">
        {finding.reason && <p><span className="text-gray-500">Boundary:</span> {finding.reason}</p>}
        {finding.evidence.map((item, index) => (
          <div key={`${item.source}-${item.retrievedAt}-${index}`} className="space-y-1">
            <p><span className="text-gray-500">Source:</span> {item.source}</p>
            <p><span className="text-gray-500">Retrieved:</span> {new Date(item.retrievedAt).toLocaleString()}</p>
            {Object.keys(item.query).length > 0 && (
              <dl className="grid gap-1 rounded bg-black/20 p-2 sm:grid-cols-2">
                {Object.entries(item.query).map(([key, value]) => (
                  <div key={key} className="min-w-0">
                    <dt className="text-gray-600">{key}</dt>
                    <dd className="break-words text-gray-300">{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {item.url && (
              <a className="text-emerald-300 hover:text-emerald-200" href={item.url} target="_blank" rel="noreferrer">
                Open source ↗
              </a>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

const DECISION_STYLE: Record<DecisionBrief['state'], string> = {
  SUPPORTED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  'MORE RESEARCH NEEDED': 'border-amber-500/30 bg-amber-500/10 text-amber-100',
  'CONFLICTING EVIDENCE': 'border-orange-500/30 bg-orange-500/10 text-orange-100',
  'DATA UNAVAILABLE': 'border-sky-500/30 bg-sky-500/10 text-sky-100',
};

function DecisionCard({ decision }: { decision: DecisionBrief }) {
  return (
    <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-6">
      <p className="text-xs uppercase tracking-[0.18em] text-emerald-300">Decision</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${DECISION_STYLE[decision.state]}`}>
          {decision.state}
        </span>
        <p className="text-sm text-gray-300">{decision.stateLabel}</p>
      </div>
      <dl className="mt-5 grid gap-4 lg:grid-cols-2">
        {[
          ['What Ralph found', decision.found],
          ['What the evidence supports', decision.supports],
          ['What it does not support', decision.doesNotSupport],
          ['What to do next', decision.nextAction],
        ].map(([label, text]) => (
          <div key={label} className="rounded-xl border border-white/8 bg-black/15 p-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
            <dd className="mt-2 text-sm leading-6 text-gray-200">{text}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function BucketSection({ buckets }: { buckets: EvidenceBuckets }) {
  const items = [
    { title: 'Buyer history', bucket: buckets.buyerHistory },
    { title: 'Installation / mission context', bucket: buckets.installationContext },
    { title: 'Broader market capacity', bucket: buckets.broaderMarketCapacity },
  ] as const;
  return (
    <section className="grid gap-4 lg:grid-cols-3">
      {items.map(({ title, bucket }) => (
        <article key={title} className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-200">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-gray-400">{bucket.summary}</p>
          {bucket.rows.length === 0 ? (
            bucket.emptyReason ? (
              <p className="mt-3 text-sm text-gray-500">{bucket.emptyReason}</p>
            ) : null
          ) : (
            <ul className="mt-3 space-y-2 text-sm text-gray-200">
              {bucket.rows.slice(0, 8).map((row, index) => (
                <li key={`${row.contractNumber ?? 'row'}-${index}`} className="rounded-lg bg-black/20 p-3">
                  <p className="font-medium">{row.contractNumber ?? 'Unidentified record'}</p>
                  {row.recipient && <p className="text-gray-400">{row.recipient}</p>}
                  {row.awardingAgency && <p className="text-xs text-gray-500">{row.awardingAgency}</p>}
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </section>
  );
}

function Finding({ finding }: { finding: ReviewFinding }) {
  return (
    <div className="space-y-2 rounded-xl border border-white/8 bg-white/[0.025] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{finding.label}</p>
        <StateBadge state={finding.state} />
      </div>
      <p className="whitespace-pre-wrap text-sm leading-6 text-gray-200">{finding.text}</p>
      <Provenance finding={finding} />
    </div>
  );
}

function ReviewScreen({
  review,
  email,
}: {
  review: Phase1ReviewDto;
  email: string;
}) {
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const download = async (href: string, kind: string) => {
    setDownloading(kind);
    setDownloadError(null);
    try {
      const response = await authedFetch(href, email);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || 'Download failed');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || `mrr-${review.runId}`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Download failed');
    } finally {
      setDownloading(null);
    }
  };

  const populations = [
    review.suppliers.eligiblePopulation,
    review.suppliers.matchingUeis,
    review.suppliers.boundedSampleReturned,
    review.suppliers.capableActiveUeis,
    review.suppliers.evaluatedUeis,
    review.suppliers.resolvedCorporateFamilies,
    review.suppliers.ambiguousOrUnresolvedParents,
    review.suppliers.displayedVendorRows,
  ];

  return (
    <div className="space-y-6">
      {review.decision && <DecisionCard decision={review.decision} />}
      {review.evidenceBuckets && <BucketSection buckets={review.evidenceBuckets} />}

      <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-gray-500">One evidence identity</p>
            <p className="mt-1 font-mono text-xs text-gray-300">Run {review.runId}</p>
            <p className="mt-1 break-all font-mono text-[11px] text-gray-500">Intake hash {review.intakeHash}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {review.downloads.map((item) => (
              <button
                key={item.kind}
                type="button"
                onClick={() => download(item.href, item.kind)}
                disabled={downloading !== null}
                className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/15 disabled:opacity-50"
              >
                {downloading === item.kind ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {item.label}
              </button>
            ))}
          </div>
        </div>
        {downloadError && <p className="mt-3 text-sm text-red-300">{downloadError}</p>}
      </section>

      <details className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
        <summary className="cursor-pointer text-lg font-semibold text-white">Evidence & methodology</summary>
        <div className="mt-5 space-y-6">
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-5">
          <h2 className="flex items-center gap-2 font-semibold text-emerald-200">
            <CheckCircle2 className="h-5 w-5" /> What Mindy completed
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-gray-300">
            {review.summary.mindyCompleted.map((item) => <li key={item}>• {item}</li>)}
          </ul>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-5">
          <h2 className="flex items-center gap-2 font-semibold text-amber-200">
            <AlertTriangle className="h-5 w-5" /> What the KO must complete
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-gray-300">
            {review.summary.koMustComplete.map((item) => <li key={item}>• {item}</li>)}
          </ul>
        </div>
      </section>
      <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
        <h2 className="text-lg font-semibold text-white">§11 supplier populations</h2>
        <p className="mt-1 text-sm leading-6 text-amber-100/80">{review.suppliers.completenessWarning}</p>
        {review.suppliers.exclusionNote && (
          <p className="mt-2 text-sm leading-6 text-gray-200">{review.suppliers.exclusionNote}</p>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {populations.map((finding) => <Finding key={finding.label} finding={finding} />)}
        </div>
        <div className="mt-4 grid gap-3 text-sm text-gray-300 md:grid-cols-3">
          <p className="rounded-lg bg-black/20 p-3">Matching coverage: {review.suppliers.matchingCoverageRatio ?? 'Unknown / Insufficient evidence'}</p>
          <p className="rounded-lg bg-black/20 p-3">Family-resolution coverage: {review.suppliers.familyResolutionCoverageRatio ?? 'Unknown / Insufficient evidence'}</p>
          <p className="rounded-lg bg-black/20 p-3">Sample coverage: {review.suppliers.sampleToMatchingRatio ?? 'Unknown / Insufficient evidence'}</p>
        </div>
      </section>

      <section className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.05] p-5">
        <h2 className="text-lg font-semibold text-amber-100">§12 evidence boundary</h2>
        <p className="mt-2 text-sm leading-6 text-gray-300">{review.ruleOfTwo.evidenceBoundary}</p>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <Finding finding={review.ruleOfTwo.determination} />
          <Finding finding={review.ruleOfTwo.recommendation} />
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">{review.pricing.label}</h2>
          <span className="rounded-full border border-sky-500/25 bg-sky-500/10 px-3 py-1 text-xs font-semibold text-sky-200">
            Not an IGE
          </span>
        </div>
        <Finding finding={review.pricing.finding} />
      </section>

      <section className="space-y-4">
        {review.sections.map((section) => (
          <article key={section.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">{section.title}</h2>
              <StateBadge state={section.state} />
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {section.keyFindings.map((finding) => <Finding key={finding.label} finding={finding} />)}
            </div>
            <details className="mt-4 rounded-xl border border-white/8 bg-black/15">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-300">
                All provenance ({section.provenance.length} fields)
              </summary>
              <div className="grid gap-3 border-t border-white/8 p-4 lg:grid-cols-2">
                {section.provenance.map((finding) => <Finding key={finding.label} finding={finding} />)}
              </div>
            </details>
            {section.limitations.length > 0 && (
              <div className="mt-4 rounded-xl border border-amber-500/15 bg-amber-500/[0.04] p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">Limitations</p>
                <ul className="mt-2 space-y-1 text-sm leading-6 text-gray-400">
                  {section.limitations.map((item, index) => <li key={`${section.id}-${index}`}>• {item}</li>)}
                </ul>
              </div>
            )}
          </article>
        ))}
      </section>
        </div>
      </details>
    </div>
  );
}

const EXAMPLE_QUESTIONS = [
  'I want to understand the small-business market for construction / SABER-type work at Vandenberg Space Force Base.',
  'I want to understand the small-business market for shipbuilding awarded by NAVSEA HQ.',
  'I want to understand the small-business market for soybean farming products awarded by DLA Aviation for Wyoming performance.',
];

function confirmationToIntake(question: string, confirmation: MarketConfirmation, extra?: Partial<Intake>): Intake {
  return {
    ...EMPTY_INTAKE,
    title: question,
    agency: confirmation.buyerDepartment ?? '',
    sub_agency: confirmation.service ?? '',
    office: [confirmation.contractingOfficeCode, confirmation.contractingOffice].filter(Boolean).join(' '),
    description: question,
    naics: confirmation.naics ?? '',
    psc: confirmation.psc ?? '',
    keyword: confirmation.keyword,
    place_of_performance_state: confirmation.geography ?? '',
    installation: confirmation.installation ?? '',
    public_data_only_confirmed: extra?.public_data_only_confirmed ?? false,
    ...extra,
  };
}

export default function MarketResearchWorkspace() {
  const [email, setEmail] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [question, setQuestion] = useState('');
  const [interpreted, setInterpreted] = useState<InterpretMarketResult | null>(null);
  const [clarificationValue, setClarificationValue] = useState('');
  const [showCodes, setShowCodes] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [intake, setIntake] = useState<Intake>(EMPTY_INTAKE);
  const [job, setJob] = useState<MrrRunJobDto | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [deduplicated, setDeduplicated] = useState(false);

  const fetchJob = useCallback(async (runId: string, ownerEmail: string) => {
    const response = await authedFetch(`/api/app/market-research?id=${encodeURIComponent(runId)}`, ownerEmail, {
      cache: 'no-store',
    });
    const payload = (await response.json().catch(() => null)) as ApiResponse | null;
    if (response.status === 404) {
      localStorage.removeItem(RUN_KEY);
      return null;
    }
    if (!response.ok || !payload?.success || !payload.job) {
      throw new Error(payload?.error || 'Could not load market research run');
    }
    setJob(payload.job);
    return payload.job;
  }, []);

  useEffect(() => {
    const storedEmail = window.localStorage.getItem('mi_beta_email');
    const token = window.localStorage.getItem('mi_beta_auth_token');
    if (!storedEmail || !token) {
      window.location.replace('/app?next=%2Fapp%2Fmarket-research');
      return;
    }
    setEmail(storedEmail);
    setAuthReady(true);
    const fromUrl = new URLSearchParams(window.location.search).get('id');
    const runId = fromUrl || window.localStorage.getItem(RUN_KEY);
    if (runId) {
      void fetchJob(runId, storedEmail).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Could not restore run');
      });
    }
  }, [fetchJob]);

  useEffect(() => {
    if (!email || !job || (job.status !== 'queued' && job.status !== 'running')) return;
    const timer = window.setTimeout(() => {
      void fetchJob(job.id, email).catch((pollError) => {
        setError(pollError instanceof Error ? pollError.message : 'Status polling failed');
      });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [email, fetchJob, job]);

  const interpret = async (clarification?: { dimension: string; value: string }) => {
    if (!email || !question.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const headers = getMIApiHeaders(email);
      headers.set('Content-Type', 'application/json');
      const response = await authedFetch('/api/app/market-research/interpret', email, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          question,
          ...(clarification ? { clarification } : {}),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { success?: boolean; error?: string; interpreted?: InterpretMarketResult }
        | null;
      if (!response.ok || !payload?.success || !payload.interpreted) {
        throw new Error(payload?.error || 'Could not interpret the market question');
      }
      setInterpreted(payload.interpreted);
      setClarificationValue('');
      if (payload.interpreted.status === 'ready' && payload.interpreted.confirmation) {
        setIntake((current) =>
          confirmationToIntake(question, payload.interpreted!.confirmation!, {
            public_data_only_confirmed: current.public_data_only_confirmed,
          }),
        );
      }
    } catch (interpretError) {
      setError(interpretError instanceof Error ? interpretError.message : 'Could not interpret the market question');
    } finally {
      setSubmitting(false);
    }
  };

  const update = (key: keyof Intake, value: string | boolean) => {
    setIntake((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email) return;
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const headers = getMIApiHeaders(email);
      headers.set('Content-Type', 'application/json');
      const response = await authedFetch('/api/app/market-research', email, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...intake,
          est_value: intake.est_value || undefined,
        }),
      });
      const payload = (await response.json().catch(() => null)) as ApiResponse | null;
      if (!response.ok || !payload?.success || !payload.job) {
        setFieldErrors(payload?.fieldErrors ?? {});
        throw new Error(payload?.error || 'Could not start market research');
      }
      setJob(payload.job);
      setDeduplicated(payload.deduplicated === true);
      window.localStorage.setItem(RUN_KEY, payload.job.id);
      const url = new URL(window.location.href);
      url.searchParams.set('id', payload.job.id);
      window.history.replaceState({}, '', url);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not start market research');
    } finally {
      setSubmitting(false);
    }
  };

  const progressSteps = useMemo(
    () => [
      'running_section_5',
      'running_section_9',
      'running_section_11',
      'running_section_12',
      'running_section_15',
      'assembling_documents',
      'complete',
    ],
    [],
  );
  const progressIndex = job ? progressSteps.indexOf(job.progress) : -1;

  if (!authReady) {
    return (
      <div className="min-h-screen bg-ground-deep text-white flex items-center justify-center">
        <LoaderCircle className="h-8 w-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ground-deep text-white">
      <div className="border-b border-amber-400/25 bg-amber-400/10 px-4 py-2 text-center text-xs font-bold tracking-[0.12em] text-amber-100">
        {PROTOTYPE_BANNER}
      </div>
      <header className="border-b border-white/8 bg-ground-deep/95">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700">
              <FileSearch className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-emerald-300">Government buyer workspace</p>
              <h1 className="text-xl font-semibold">Ralph market research</h1>
            </div>
          </div>
          <Link href="/app" className="rounded-lg border border-white/10 px-3 py-2 text-sm text-gray-300 hover:bg-white/5">
            ← Back to Mindy
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8">
        <section className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.08] to-navy-900/10 p-6">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-emerald-300" />
            <div>
              <h2 className="text-lg font-semibold">Public information only</h2>
              <p className="mt-1 max-w-4xl text-sm leading-6 text-gray-300">
                Enter a public requirement. Mindy assembles sourced evidence for §5, §9, §11, §12, and §15.
                Do not submit CUI, proprietary requirements, source-selection information, or government estimates.
                Mindy does not generate signatures, certifications, or contracting-officer judgments.
              </p>
            </div>
          </div>
        </section>

        {!job && (
          <div className="space-y-6">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void interpret();
              }}
              className="rounded-2xl border border-white/10 bg-white/[0.035] p-6"
            >
              <h2 className="text-lg font-semibold">What market are you researching?</h2>
              <p className="mt-1 text-sm text-gray-400">
                One question is enough. Ralph resolves the buyer, office, location, and requirement.
                You do not need NAICS, PSC, or office codes.
              </p>
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                rows={4}
                className="mt-4 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-white outline-none placeholder:text-gray-600 focus:border-emerald-500/50"
                placeholder='I want to understand the small-business market for construction / SABER-type work at Vandenberg Space Force Base.'
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {EXAMPLE_QUESTIONS.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setQuestion(example)}
                    className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-left text-xs text-gray-300 hover:bg-white/5"
                  >
                    {example.replace('I want to understand the small-business market for ', '')}
                  </button>
                ))}
              </div>
              {error && <p className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
              <div className="mt-5 flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((current) => !current)}
                  className="rounded-lg border border-white/10 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5"
                >
                  Advanced / Edit research scope
                </button>
                <button
                  type="submit"
                  disabled={submitting || !question.trim()}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
                >
                  {submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
                  Interpret market
                </button>
              </div>
            </form>

            {interpreted?.status === 'needs_clarification' && interpreted.clarification && (
              <section className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.05] p-6">
                <h2 className="text-lg font-semibold text-amber-100">One clarification</h2>
                <p className="mt-2 text-sm leading-6 text-gray-300">{interpreted.clarification.prompt}</p>
                {interpreted.clarification.options && interpreted.clarification.options.length > 8 ? (
                  <form
                    className="mt-4 flex flex-col gap-3 sm:flex-row"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!clarificationValue) return;
                      void interpret({
                        dimension: interpreted.clarification!.dimension,
                        value: clarificationValue,
                      });
                    }}
                  >
                    <select
                      value={clarificationValue}
                      onChange={(event) => setClarificationValue(event.target.value)}
                      className="flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-white outline-none focus:border-emerald-500/50"
                    >
                      <option value="">Select the contracting office</option>
                      {interpreted.clarification.options.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button type="submit" disabled={!clarificationValue} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-50">
                      Continue
                    </button>
                  </form>
                ) : interpreted.clarification.options && interpreted.clarification.options.length > 0 ? (
                  <div className="mt-4 grid gap-2">
                    {interpreted.clarification.options.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => void interpret({ dimension: interpreted.clarification!.dimension, value: option.id })}
                        className="rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-left text-sm text-gray-200 hover:bg-white/5"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <form
                    className="mt-4 flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void interpret({
                        dimension: interpreted.clarification!.dimension,
                        value: clarificationValue,
                      });
                    }}
                  >
                    <input
                      value={clarificationValue}
                      onChange={(event) => setClarificationValue(event.target.value)}
                      className="flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-white outline-none focus:border-emerald-500/50"
                    />
                    <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold">
                      Continue
                    </button>
                  </form>
                )}
              </section>
            )}

            {interpreted?.status === 'ready' && interpreted.confirmation && (
              <form onSubmit={submit} className="rounded-2xl border border-white/10 bg-white/[0.035] p-6">
                <h2 className="text-lg font-semibold">Here&apos;s the market I&apos;ll research</h2>
                <p className="mt-1 text-sm text-gray-400">Correct this before research if Ralph misread the question.</p>
                <dl className="mt-4 grid gap-3 md:grid-cols-2">
                  {[
                    ['Buyer / department', interpreted.confirmation.buyerDepartment],
                    ['Service', interpreted.confirmation.service],
                    ['Installation / location', interpreted.confirmation.installation],
                    ['Contracting office', interpreted.confirmation.contractingOffice],
                    ['Requirement', interpreted.confirmation.requirementLabel],
                    ['Place of performance', geographyDisplayName(interpreted.confirmation.geography) ?? interpreted.confirmation.geography],
                  ].map(([label, value]) => (
                    value ? (
                      <div key={label} className="rounded-xl border border-white/8 bg-black/15 p-3">
                        <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
                        <dd className="mt-1 text-sm text-gray-200">{value}</dd>
                      </div>
                    ) : null
                  ))}
                </dl>
                <button
                  type="button"
                  onClick={() => setShowCodes((current) => !current)}
                  className="mt-4 text-sm text-emerald-300 hover:text-emerald-200"
                >
                  {showCodes ? 'Hide research details' : 'Show research details'}
                </button>
                {showCodes && (
                  <dl className="mt-3 grid gap-3 md:grid-cols-3 text-sm text-gray-400">
                    <div>NAICS: {interpreted.confirmation.naics || 'not established'}</div>
                    <div>PSC: {interpreted.confirmation.psc || 'not established'}</div>
                    <div>Office code: {interpreted.confirmation.contractingOfficeCode || 'not established'}</div>
                  </dl>
                )}

                <label className="mt-5 flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={intake.public_data_only_confirmed}
                    onChange={(event) => update('public_data_only_confirmed', event.target.checked)}
                    className="mt-1 h-4 w-4 accent-emerald-500"
                  />
                  <span>
                    I confirm this intake contains public information only and contains no CUI, proprietary requirements,
                    source-selection information, or government estimates.
                    {fieldErrors.public_data_only_confirmed && <span className="mt-1 block text-xs text-red-300">{fieldErrors.public_data_only_confirmed}</span>}
                  </span>
                </label>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced((current) => !current)}
                    className="text-sm text-gray-400 hover:text-gray-200"
                  >
                    {showAdvanced ? 'Hide' : 'Advanced / Edit research scope'}
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
                    Run Research
                  </button>
                </div>
              </form>
            )}

            {showAdvanced && !job && (
              <form onSubmit={submit} className="rounded-2xl border border-white/10 bg-white/[0.035] p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Advanced / Edit research scope</h2>
                <p className="mt-1 text-sm text-gray-400">Structured fields stay available. They are not required for the demo path.</p>
              </div>
              <button
                type="button"
                onClick={() => setIntake(DHA_PRESET)}
                className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/15"
              >
                Load DHA JOMIS demo inputs
              </button>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {[
                ['sam_url', 'SAM notice URL', 'https://sam.gov/opp/...'],
                ['notice_id', 'SAM notice ID', 'Public SAM notice UUID'],
                ['solicitation_number', 'Solicitation number', 'e.g. DHA_JOMIS_JMP_20260813'],
                ['title', 'Requirement title *', 'Public requirement title'],
                ['agency', 'Agency *', 'Requiring activity'],
                ['sub_agency', 'Department / sub-agency', 'Optional'],
                ['office', 'Office', 'Optional'],
                ['installation', 'Installation', 'Optional'],
                ['naics', 'NAICS', '2–6 digits'],
                ['psc', 'PSC', '4 characters'],
                ['keyword', 'Market keyword *', 'Exact market phrase'],
                ['est_value', 'Operator-supplied estimated value', 'Optional; supporting input only'],
                ['place_of_performance_state', 'Place of performance state', '2-letter code'],
                ['pop_start', 'Period start', 'YYYY-MM-DD'],
                ['pop_end', 'Period end', 'YYYY-MM-DD'],
              ].map(([key, label, placeholder]) => (
                <label key={key} className="space-y-1.5 text-sm">
                  <span className="text-gray-300">{label}</span>
                  <input
                    type={key === 'est_value' ? 'number' : key.startsWith('pop_') ? 'date' : 'text'}
                    value={String(intake[key as keyof Intake])}
                    onChange={(event) => update(key as keyof Intake, event.target.value)}
                    placeholder={placeholder}
                    className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-white outline-none placeholder:text-gray-600 focus:border-emerald-500/50"
                  />
                  {fieldErrors[key] && <span className="text-xs text-red-300">{fieldErrors[key]}</span>}
                </label>
              ))}
              <label className="space-y-1.5 text-sm md:col-span-2">
                <span className="text-gray-300">Public requirement description *</span>
                <textarea
                  value={intake.description}
                  onChange={(event) => update('description', event.target.value)}
                  rows={6}
                  className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-white outline-none placeholder:text-gray-600 focus:border-emerald-500/50"
                  placeholder="Paste only the public requirement description."
                />
                {fieldErrors.description && <span className="text-xs text-red-300">{fieldErrors.description}</span>}
              </label>
            </div>

            <label className="mt-5 flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={intake.public_data_only_confirmed}
                onChange={(event) => update('public_data_only_confirmed', event.target.checked)}
                className="mt-1 h-4 w-4 accent-emerald-500"
              />
              <span>
                I confirm this intake contains public information only and contains no CUI, proprietary requirements,
                source-selection information, or government estimates.
                {fieldErrors.public_data_only_confirmed && <span className="mt-1 block text-xs text-red-300">{fieldErrors.public_data_only_confirmed}</span>}
              </span>
            </label>

            {error && <p className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
            <div className="mt-5 flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
              >
                {submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
                Start Phase 1 research
              </button>
            </div>
          </form>
            )}
          </div>
        )}

        {job && job.status !== 'done' && (
          <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-6">
            <div className="flex items-start gap-3">
              {job.status === 'error' ? <AlertTriangle className="h-6 w-6 text-red-300" /> : <LoaderCircle className="h-6 w-6 animate-spin text-emerald-300" />}
              <div className="flex-1">
                <h2 className="font-semibold">{job.status === 'error' ? 'Research failed' : job.progressLabel}</h2>
                <p className="mt-1 text-sm text-gray-400">
                  {job.status === 'error' ? job.error : 'The server is building one sourced run. Refreshing this page will not start another run.'}
                </p>
                <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {progressSteps.map((step, index) => (
                    <div key={step} className={`rounded-lg border px-3 py-2 text-xs ${index <= progressIndex ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-white/8 bg-black/15 text-gray-600'}`}>
                      {step.replace('running_', '').replaceAll('_', ' ').replace('section ', '§')}
                    </div>
                  ))}
                </div>
                {deduplicated && <p className="mt-3 text-xs text-sky-300">Reused the existing run for this normalized intake; no second research job was started.</p>}
              </div>
            </div>
            {job.status === 'error' && (
              <button
                type="button"
                onClick={() => {
                  setJob(null);
                  localStorage.removeItem(RUN_KEY);
                }}
                className="mt-4 rounded-lg border border-white/10 px-3 py-2 text-sm text-gray-300 hover:bg-white/5"
              >
                Return to intake
              </button>
            )}
          </section>
        )}

        {job?.status === 'done' && job.review && (
          <>
            {deduplicated && (
              <p className="rounded-lg border border-sky-500/20 bg-sky-500/10 p-3 text-sm text-sky-200">
                Reused the existing run for this normalized intake. No duplicate research was started.
              </p>
            )}
            <ReviewScreen review={job.review} email={email!} />
            <button
              type="button"
              onClick={() => {
                setJob(null);
                setDeduplicated(false);
                setInterpreted(null);
                localStorage.removeItem(RUN_KEY);
                const url = new URL(window.location.href);
                url.searchParams.delete('id');
                window.history.replaceState({}, '', url);
              }}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/5"
            >
              Start a different requirement
            </button>
          </>
        )}
      </main>
    </div>
  );
}
