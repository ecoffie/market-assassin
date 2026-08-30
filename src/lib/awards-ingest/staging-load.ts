import { writeFileSync } from 'node:fs';
import {
  assertCsvHeadersMatch,
  buildStringStagingSchema,
  readCsvHeaderLineFromFile,
  type BqStringField,
} from './staging-schema';

export type StagingLoadJob = {
  csvPath: string;
  replace: boolean;
};

export type StagingLoadPlan = {
  schema: BqStringField[];
  jobs: StagingLoadJob[];
};

export function buildStagingLoadPlan(
  csvPaths: string[],
  readFirstLine: (path: string) => string,
): StagingLoadPlan {
  if (csvPaths.length === 0) {
    throw new Error('no CSV paths for staging load');
  }

  const headerLines = csvPaths.map((path) => readCsvHeaderLineFromFile(readFirstLine, path));
  for (let index = 1; index < headerLines.length; index++) {
    assertCsvHeadersMatch(headerLines[0], headerLines[index]);
  }

  return {
    schema: buildStringStagingSchema(headerLines[0]),
    jobs: csvPaths.map((csvPath, index) => ({
      csvPath,
      replace: index === 0,
    })),
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
    '--skip_leading_rows=1',
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
  readFirstLine: (path: string) => string;
  execLoad: (args: string[]) => void;
  log?: (message: string) => void;
}): StagingLoadPlan {
  const plan = buildStagingLoadPlan(input.csvPaths, input.readFirstLine);
  writeStagingSchemaFile(input.schemaFilePath, plan.schema);
  const stagingTarget = `${input.dataset}.${input.stagingTable}`;

  for (let index = 0; index < plan.jobs.length; index++) {
    const job = plan.jobs[index];
    input.log?.(`bq load → staging (${index + 1}/${plan.jobs.length})…`);
    input.execLoad(buildBqLoadArgs({
      projectId: input.projectId,
      stagingTarget,
      schemaPath: input.schemaFilePath,
      job,
    }));
  }

  return plan;
}
