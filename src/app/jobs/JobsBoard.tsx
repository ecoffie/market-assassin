/**
 * Presentation for /jobs. Takes already-read data; no I/O. Server component.
 */
import {
  Breadcrumbs,
  Chip,
  Container,
  Eyebrow,
  Heading,
  Meta,
  Panel,
  Section,
  Standfirst,
  Stat,
  StatRow,
  Table,
} from '@/components/public-site/ui';
import { JOB_ROLES, roleName } from '@/lib/jobs/categories';
import { ACTIVE_DAYS, ROLLUP_SAMPLE, type JobBoardData, type JobBoardFilters, type JobListing } from '@/lib/jobs/read';

const fmtCount = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-US'));

function salary(j: JobListing): string | null {
  const k = (n: number) => `$${Math.round(n / 1000)}K`;
  if (j.salary_min && j.salary_max) return `${k(j.salary_min)}–${k(j.salary_max)}`;
  if (j.salary_min) return `${k(j.salary_min)}+`;
  if (j.salary_max) return `up to ${k(j.salary_max)}`;
  return null;
}

function ago(iso: string | null, now: Date): string {
  if (!iso) return '';
  const d = Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  if (d < 30) return `${Math.floor(d / 7)} wk ago`;
  return `${Math.floor(d / 30)} mo ago`;
}

function place(j: JobListing): string {
  if (j.remote) return 'Remote';
  return [j.city, j.state].filter(Boolean).join(', ') || 'Location not listed';
}

function href(current: JobBoardFilters, patch: Partial<Record<keyof JobBoardFilters, string | undefined>>): string {
  const next = { ...current, ...patch } as Record<string, string | undefined>;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) if (v && v !== 'any') qs.set(k, v);
  const s = qs.toString();
  return s ? `/jobs?${s}` : '/jobs';
}

function FilterLink({ on, to, children }: { on: boolean; to: string; children: React.ReactNode }) {
  return (
    <a href={to} className="mp-chip" aria-current={on ? 'true' : undefined} style={on ? { color: 'var(--mp-ink)', borderColor: 'var(--mp-ink)', fontWeight: 700 } : undefined}>
      {children}
    </a>
  );
}

export default function JobsBoard({ data, filters, now = new Date() }: { data: JobBoardData; filters: JobBoardFilters; now?: Date }) {
  const t = data.totals;
  const role = filters.role ? roleName(filters.role) : null;

  return (
    <>
      <Section>
        <Container>
          <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Jobs' }]} />
          <Eyebrow accent style={{ marginTop: 20 }}>GovCon jobs</Eyebrow>
          <Heading as="h1" variant="display" style={{ marginTop: 10 }}>
            Who&apos;s hiring in government contracting
          </Heading>
          <Standfirst>
            Business development, capture, proposal and contracts jobs at government contractors, plus contract-specialist
            openings at federal agencies. Updated daily from public job posts.
          </Standfirst>
        </Container>
      </Section>

      {data.state === 'unavailable' ? (
        <Section>
          <Container>
            <Panel role="status">
              <p className="mp-label">Jobs can&apos;t load right now</p>
              <p className="mp-meta" style={{ marginTop: 8 }}>
                The job list didn&apos;t load. This is a problem on our side, not a sign that nobody is hiring. Try again in a few minutes.
              </p>
            </Panel>
          </Container>
        </Section>
      ) : (
        <>
          <Section>
            <Container>
              <StatRow>
                <Stat
                  value={fmtCount(t.active)}
                  label={data.source === 'mindy' ? `Open postings (seen in the last ${ACTIVE_DAYS} days)` : data.source === 'usajobs' ? 'Posted in the last 30 days' : 'Open postings right now'}
                />
                <Stat
                  value={t.contractor == null ? 'Soon' : fmtCount(t.contractor)}
                  label="At contractors"
                  href={t.contractor == null ? undefined : href(filters, { source: 'jsearch' })}
                />
                <Stat
                  value={t.federal == null ? 'Soon' : fmtCount(t.federal)}
                  label="At federal agencies"
                  href={t.federal == null ? undefined : href(filters, { source: 'usajobs' })}
                />
                {t.contingent != null && <Stat value={fmtCount(t.contingent)} label="Waiting on a contract win" />}
              </StatRow>
            </Container>
          </Section>

          <Section>
            <Container>
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <Meta style={{ minWidth: 70 }}>Employer</Meta>
                  <FilterLink on={!filters.source} to={href(filters, { source: undefined })}>All</FilterLink>
                  {data.totals.contractor != null && (
                    <FilterLink on={filters.source === 'jsearch'} to={href(filters, { source: 'jsearch' })}>Contractors</FilterLink>
                  )}
                  {data.totals.federal != null && (
                    <FilterLink on={filters.source === 'usajobs'} to={href(filters, { source: 'usajobs' })}>Federal agencies</FilterLink>
                  )}
                </div>
                {/* Role chips are contractor BD roles; the USAJobs-only view is all contract specialists. */}
                {data.source !== 'usajobs' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <Meta style={{ minWidth: 70 }}>Role</Meta>
                  <FilterLink on={!filters.role} to={href(filters, { role: undefined })}>All roles</FilterLink>
                  {JOB_ROLES.map((r) => (
                    <FilterLink key={r.slug} on={filters.role === r.slug} to={href(filters, { role: r.slug })}>
                      {r.name}
                    </FilterLink>
                  ))}
                </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <Meta style={{ minWidth: 70 }}>Clearance</Meta>
                  <FilterLink on={!filters.clearance || filters.clearance === 'any'} to={href(filters, { clearance: undefined })}>Any</FilterLink>
                  <FilterLink on={filters.clearance === 'required'} to={href(filters, { clearance: 'required' })}>Clearance listed</FilterLink>
                  <FilterLink on={filters.clearance === 'none-stated'} to={href(filters, { clearance: 'none-stated' })}>None listed</FilterLink>
                </div>
              </div>
            </Container>
          </Section>

          <Section>
            <Container width="wide">
              <div className="mp-jobs-grid" style={{ display: 'grid', gap: 32, gridTemplateColumns: 'minmax(0, 2.2fr) minmax(0, 1fr)' }}>
                <div style={{ minWidth: 0 }}>
                  <Heading as="h2" variant="title">
                    {role ? `${role} jobs` : 'Latest postings'}
                  </Heading>
                  {data.listings.length === 0 ? (
                    <p className="mp-meta" style={{ marginTop: 14 }}>
                      No postings match these filters in the last {ACTIVE_DAYS} days. Try a broader filter.
                    </p>
                  ) : (
                    <div style={{ overflowX: 'auto', marginTop: 14 }}>
                      <Table>
                        <thead>
                          <tr>
                            <th>Job</th>
                            <th>Where</th>
                            <th>Pay</th>
                            <th>Posted</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.listings.map((j) => (
                            <tr key={j.id}>
                              <td>
                                {j.apply_url ? (
                                  <a href={j.apply_url} className="mp-link" target="_blank" rel="noopener noreferrer nofollow">
                                    {j.title}
                                  </a>
                                ) : (
                                  j.title
                                )}
                                <div className="mp-meta" style={{ marginTop: 3 }}>
                                  {j.employer_name}
                                  {j.source === 'usajobs' && j.department && j.department !== j.employer_name ? ` · ${j.department}` : ''}
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                                  {j.source === 'usajobs' && <Chip>Federal</Chip>}
                                  {j.clearance && <Chip>{j.clearance}</Chip>}
                                  {j.contingent_on_award && <Chip tone="warn">Contingent on award</Chip>}
                                  {j.role !== 'other' && <Chip>{roleName(j.role)}</Chip>}
                                </div>
                              </td>
                              <td>{place(j)}</td>
                              <td className="mp-num">{salary(j) ?? <span className="mp-meta">not listed</span>}</td>
                              <td className="mp-meta" style={{ whiteSpace: 'nowrap' }}>{ago(j.posted_at ?? j.first_seen_at, now)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  )}
                </div>

                <aside style={{ display: 'grid', gap: 24, alignContent: 'start', minWidth: 0 }}>
                  {data.topEmployers.length > 0 && (
                  <Panel>
                    <p className="mp-label">Contractors hiring the most</p>
                    <p className="mp-meta" style={{ marginTop: 4 }}>In the latest {ROLLUP_SAMPLE.toLocaleString('en-US')} postings</p>
                    <ol style={{ margin: '14px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
                      {data.topEmployers.length === 0 && <li className="mp-meta">No contractor postings yet.</li>}
                      {data.topEmployers.map((e) => (
                        <li key={e.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                          <span>{e.name}</span>
                          <span className="mp-num">{e.count}</span>
                        </li>
                      ))}
                    </ol>
                  </Panel>
                  )}
                  {data.agenciesHiring.length > 0 && (
                  <Panel>
                    <p className="mp-label">{data.source === 'govcongiants' ? 'Federal agencies hiring' : 'Agencies hiring contract specialists'}</p>
                    <p className="mp-meta" style={{ marginTop: 4 }}>
                      {data.source === 'govcongiants' ? 'From the federal jobs on the GovCon Giants board.' : 'An office adding buyers usually plans to buy more.'}
                    </p>
                    <ol style={{ margin: '14px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
                      {data.agenciesHiring.length === 0 && <li className="mp-meta">No agency postings yet.</li>}
                      {data.agenciesHiring.map((a) => (
                        <li key={a.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                          <span>
                            {a.name}
                            {a.department && a.department !== a.name && <span className="mp-meta" style={{ display: 'block' }}>{a.department}</span>}
                          </span>
                          <span className="mp-num">{a.count}</span>
                        </li>
                      ))}
                    </ol>
                  </Panel>
                  )}
                </aside>
              </div>
              <p className="mp-meta" style={{ marginTop: 20 }}>
                {data.source === 'mindy'
                  ? 'Sources: JSearch (LinkedIn, Indeed, Glassdoor, ZipRecruiter) and USAJobs.'
                  : data.source === 'usajobs'
                    ? 'Source: USAJobs, contracting jobs (series 1102) at federal agencies. Contractor jobs are coming soon.'
                    : 'Source: the GovCon Giants job board (USAJobs, plus LinkedIn, Indeed, Glassdoor and ZipRecruiter when available).'}
                {data.lastSyncedAt ? ` Last updated ${new Date(data.lastSyncedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.` : ''}
                {' '}Clearance shows only when the post names one.
              </p>
            </Container>
          </Section>
        </>
      )}
      <style>{'@media(max-width:900px){.mp-jobs-grid{grid-template-columns:minmax(0,1fr)!important}}'}</style>
    </>
  );
}
