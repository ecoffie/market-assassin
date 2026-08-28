export type ZipMember =
  | { kind: 'contracts'; path: string }
  | { kind: 'idv'; path: string; reason: 'unsupported_weekly_merge_schema' }
  | { kind: 'assistance'; path: string; reason: 'unsupported_award_family' }
  | { kind: 'irrelevant'; path: string; reason: 'non_csv' | 'documentation' | 'directory' }
  | { kind: 'unknown'; path: string; reason: 'unrecognized_csv' };

type MemberRule = {
  kind: ZipMember['kind'];
  matches: (path: string) => boolean;
  build: (path: string) => ZipMember;
};

const MEMBER_RULES: MemberRule[] = [
  {
    kind: 'irrelevant',
    matches: (path) => path.endsWith('/'),
    build: (path) => ({ kind: 'irrelevant', path, reason: 'directory' }),
  },
  {
    kind: 'irrelevant',
    matches: (path) => /(^|\/)(readme|manifest|metadata)([._-]|$)/i.test(path),
    build: (path) => ({ kind: 'irrelevant', path, reason: 'documentation' }),
  },
  {
    kind: 'irrelevant',
    matches: (path) => !/\.csv$/i.test(path),
    build: (path) => ({ kind: 'irrelevant', path, reason: 'non_csv' }),
  },
  {
    kind: 'idv',
    matches: (path) => /(^|[/_.\s-])IDV(?:[/_.\s-]|Contracts|Awards|$)/i.test(path),
    build: (path) => ({ kind: 'idv', path, reason: 'unsupported_weekly_merge_schema' }),
  },
  {
    kind: 'assistance',
    matches: (path) => /(assistance|grant|loan|direct.?payment|other.?financial)/i.test(path),
    build: (path) => ({ kind: 'assistance', path, reason: 'unsupported_award_family' }),
  },
  {
    kind: 'contracts',
    matches: (path) => /contracts/i.test(path),
    build: (path) => ({ kind: 'contracts', path }),
  },
];

export function classifyZipMember(path: string): ZipMember {
  const rule = MEMBER_RULES.find((candidate) => candidate.matches(path));
  return rule?.build(path) ?? { kind: 'unknown', path, reason: 'unrecognized_csv' };
}
