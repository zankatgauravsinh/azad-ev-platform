import { RETURN_DISPOSITIONS, RETURN_STATUSES } from '@azad/shared';
import { dispositionLabel, dispositionTone, returnStatusLabel, returnStatusTone } from './meta';

describe('returns meta', () => {
  it('has a label and tone for every return status', () => {
    for (const s of RETURN_STATUSES) {
      expect(returnStatusLabel[s]).toBeTruthy();
      expect(returnStatusTone[s]).toBeTruthy();
    }
  });

  it('has a label and tone for every disposition', () => {
    for (const d of RETURN_DISPOSITIONS) {
      expect(dispositionLabel[d]).toBeTruthy();
      expect(dispositionTone[d]).toBeTruthy();
    }
  });
});
