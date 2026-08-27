export * from './clocks';
export * from './csv-validate';
export * from './pipeline';
export * from './zip-members';

export function shouldFailWhenEmailFails(input: {
  staleCount: number;
  notify: boolean;
  emailOk: boolean;
}): boolean {
  return input.staleCount > 0 && input.notify && !input.emailOk;
}
