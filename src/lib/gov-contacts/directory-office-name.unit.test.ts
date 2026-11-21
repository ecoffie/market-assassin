import { describe, expect, it } from 'vitest';
import { directoryOfficeName, directoryRefreshOutcome, nameThatIsNotTheCode } from './directory-office-name';

describe('buying-office directory names', () => {
  it('prefers the SAM current name and falls back to the FPDS historical name', () => {
    expect(directoryOfficeName({
      sam_office_name: 'NAVSUP FLT LOG CTR NORFOLK',
      office_name: 'FLEET LOGISTICS CENTER',
    })).toEqual({ name: 'NAVSUP FLT LOG CTR NORFOLK', source: 'sam_office_name' });
    expect(directoryOfficeName({
      sam_office_name: '  ',
      office_name: 'W07V ENDIST MEMPHIS',
    })).toEqual({ name: 'W07V ENDIST MEMPHIS', source: 'fpds_office_name' });
  });

  it('stays unnamed when the directory row has no name', () => {
    expect(directoryOfficeName({ sam_office_name: null, office_name: '' })).toBeNull();
    expect(directoryOfficeName(null)).toBeNull();
  });

  it('does not treat the office code as a name', () => {
    expect(nameThatIsNotTheCode('FA7000', 'FA7000')).toBe('');
    expect(nameThatIsNotTheCode('FA7000', '10 CONS LGC')).toBe('10 CONS LGC');
    expect(directoryOfficeName({
      dodaac: 'FA7000',
      sam_office_name: 'FA7000',
      office_name: 'FA7000',
    })).toBeNull();
    expect(directoryOfficeName({
      dodaac: 'FA7000',
      sam_office_name: 'fa7000',
      office_name: '10 CONS LGC',
    })).toEqual({ name: '10 CONS LGC', source: 'fpds_office_name' });
  });

  it('a failed current-name pass is not a successful refresh', () => {
    const failed = directoryRefreshOutcome({ samNamesError: 'sam read failed' });
    expect(failed.success).toBe(false);
    expect(failed.httpStatus).toBe(500);
    expect(failed.cronOutcome).toBe('partial');
    expect(directoryRefreshOutcome({ samNamesError: null }).success).toBe(true);
  });
});
