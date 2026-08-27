const STALE_DAYS_BY_CADENCE: Readonly<Record<string, number>> = {
  weekly: 10,
  quarterly: 100,
  annual: 380,
  'as-published': 120,
};

export function staleDaysForCadence(cadence: string | null | undefined): number {
  return cadence ? STALE_DAYS_BY_CADENCE[cadence] ?? 120 : 120;
}

export function isSourceStale(input: {
  lastBuilt: string;
  cadence: string | null | undefined;
  now?: string;
}): boolean {
  const builtAt = Date.parse(input.lastBuilt);
  const now = Date.parse(input.now ?? new Date().toISOString());
  if (!Number.isFinite(builtAt) || !Number.isFinite(now)) return true;
  return (now - builtAt) / 86_400_000 > staleDaysForCadence(input.cadence);
}
