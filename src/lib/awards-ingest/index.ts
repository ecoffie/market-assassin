export * from './acquisition-poll';
export * from './clocks';
export * from './csv-validate';
export * from './merge-sql';
export * from './pipeline';
export * from './post-apply-verify';
export * from './staging-load';
export * from './staging-schema';
export * from './workflow-control';
export * from './zip-members';

export function shouldFailWhenEmailFails(input: {
  staleCount: number;
  notify: boolean;
  emailOk: boolean;
}): boolean {
  return input.staleCount > 0 && input.notify && !input.emailOk;
}
