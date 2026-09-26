import { describe, it, expect } from 'vitest';
import { classifyLeaderboardMovement, type RankRow } from './observation';

const r = (slug: string, uei: string, rank: number): RankRow => ({ slug, recipient_uei: uei, recipient_name: uei, rank });

describe('classifyLeaderboardMovement', () => {
  it('classifies gained / declined / stable / entered / exited within a list', () => {
    const prev = [r('a', 'X', 1), r('a', 'Y', 2), r('a', 'Z', 3), r('a', 'Q', 4)];
    const latest = [r('a', 'Y', 1), r('a', 'X', 2), r('a', 'Z', 3), r('a', 'N', 4)];
    const m = classifyLeaderboardMovement(prev, latest);
    expect(m.counts).toEqual({ gained: 1, declined: 1, stable: 1, entered: 1, exited: 1 });
    expect(m.topGainers[0]).toMatchObject({ uei: 'Y', from: 2, to: 1, delta: 1 });
    expect(m.topDecliners[0]).toMatchObject({ uei: 'X', from: 1, to: 2, delta: -1 });
  });

  it('a list present in only one snapshot is not turned into entries or exits', () => {
    const prev = [r('old-list', 'A', 1)];
    const latest = [r('new-list', 'B', 1)];
    const m = classifyLeaderboardMovement(prev, latest);
    expect(m.comparedLists).toBe(0);
    expect(m.counts).toEqual({ gained: 0, declined: 0, stable: 0, entered: 0, exited: 0 });
  });

  it('the same contractor on two lists is compared per list, never across lists', () => {
    const prev = [r('a', 'X', 5), r('b', 'X', 1)];
    const latest = [r('a', 'X', 1), r('b', 'X', 1)];
    const m = classifyLeaderboardMovement(prev, latest);
    expect(m.counts.gained).toBe(1);
    expect(m.counts.stable).toBe(1);
  });
});
