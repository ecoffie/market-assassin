import { describe, expect, it } from 'vitest';
import { directoryOfficeName } from './directory-office-name';

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
});
