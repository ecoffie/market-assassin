import { basename } from 'node:path';
import { writeFileSync } from 'node:fs';
import { readBoundedCsvFirstRecord } from './csv-first-record';
import { StagingLoadError, stagingLoadErrorFromUnknown } from './staging-errors';
import {
  classifySplitExportMemberLead,
  parseCsvHeaderColumns,
  type SplitMemberLeadKind,
} from './split-member-lead';
import { buildStringStagingSchema, type BqStringField } from './staging-schema';

export type StagingLoadJob = {
  csvPath: string;
  memberBasename: string;
  replace: boolean;
  skipLeadingRows: 0 | 1;
  leadKind: SplitMemberLeadKind;
};

export type StagingLoadPlan = {
  schema: BqStringField[];
  authoritativeMemberBasename: string;
  jobs: StagingLoadJob[];
};

export type ReadFirstRecordFn = (csvPath: string, memberBasename: string) => string;

export const defaultReadFirstRecord: ReadFirstRecordFn = (csvPath, memberBasename) =>
  readBoundedCsvFirstRecord(csvPath, memberBasename);

export function buildStagingLoadPlan(
  csvPaths: string[],
  readFirstRecord: ReadFirstRecordFn = defaultReadFirstRecord,
): StagingLoadPlan {
  if (csvPaths.length === 0) {
    throw new StagingLoadError('staging_plan_empty', '(none)', 'no CSV paths for staging load');
  }

  const firstBasename = basename(csvPaths[0]);
  let authoritativeRecord: string;
  try {
    authoritativeRecord = readFirstRecord(csvPaths[0], firstBasename);
  } catch (error) {
    if (error instanceof StagingLoadError) throw error;
    throw stagingLoadErrorFromUnknown('staging_header_read_truncated', firstBasename, error);
  }

  let authoritativeHeader: string[];
  try {
    authoritativeHeader = parseCsvHeaderColumns(authoritativeRecord);
  } catch (error) {
    throw new StagingLoadError(
      'staging_header_invalid',
      firstBasename,
      error instanceof Error ? error.message : 'invalid header',
      { cause: error },
    );
  }

  const jobs: StagingLoadJob[] = [{
    csvPath: csvPaths[0],
    memberBasename: firstBasename,
    replace: true,
    skipLeadingRows: 1,
    leadKind: 'matching_header',
  }];

  for (let index = 1; index < csvPaths.length; index++) {
    const csvPath = csvPaths[index];
    const memberBasename = basename(csvPath);
    let firstRecord: string;
    try {
      firstRecord = readFirstRecord(csvPath, memberBasename);
    } catch (error) {
      if (error instanceof StagingLoadError) throw error;
      throw stagingLoadErrorFromUnknown('staging_header_read_truncated', memberBasename, error);
    }

    const lead = classifySplitExportMemberLead(authoritativeHeader, firstRecord, memberBasename);
    jobs.push({
      csvPath,
      memberBasename,
      replace: false,
      skipLeadingRows: lead.skipLeadingRows,
      leadKind: lead.kind,
    });
  }

  return {
    schema: buildStringStagingSchema(authoritativeRecord),
    authoritativeMemberBasename: firstBasename,
    jobs,
  };
}

export function buildBqLoadArgs(input: {
  projectId: string;
  stagingTarget: string;
  schemaPath: string;
  job: StagingLoadJob;
}): string[] {
  return [
    `--project_id=${input.projectId}`,
    'load',
    '--source_format=CSV',
    `--skip_leading_rows=${input.job.skipLeadingRows}`,
    '--allow_quoted_newlines',
    input.job.replace ? '--replace' : '--noreplace',
    input.stagingTarget,
    input.job.csvPath,
    input.schemaPath,
  ];
}

export function writeStagingSchemaFile(schemaPath: string, schema: BqStringField[]): void {
  writeFileSync(schemaPath, JSON.stringify(schema));
}

export function loadCsvsIntoStaging(input: {
  projectId: string;
  dataset: string;
  stagingTable: string;
  csvPaths: string[];
  schemaFilePath: string;
  readFirstRecord?: ReadFirstRecordFn;
  execLoad: (args: string[], job: StagingLoadJob) => void;
  log?: (message: string) => void;
}): StagingLoadPlan {
  const plan = buildStagingLoadPlan(input.csvPaths, input.readFirstRecord);
  writeStagingSchemaFile(input.schemaFilePath, plan.schema);
  const stagingTarget = `${input.dataset}.${input.stagingTable}`;

  for (let index = 0; index < plan.jobs.length; index++) {
    const job = plan.jobs[index];
    input.log?.(
      `bq load → staging (${index + 1}/${plan.jobs.length}) `
      + `member=${job.memberBasename} skip_leading_rows=${job.skipLeadingRows} `
      + `lead=${job.leadKind}…`,
    );
    try {
      input.execLoad(buildBqLoadArgs({
        projectId: input.projectId,
        stagingTarget,
        schemaPath: input.schemaFilePath,
        job,
      }), job);
    } catch (error) {
      throw stagingLoadErrorFromUnknown('staging_bq_load_failed', job.memberBasename, error);
    }
  }

  return plan;
}
