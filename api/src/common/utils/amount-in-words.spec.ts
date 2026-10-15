import { integerInWords, rupeesInWords } from './amount-in-words';

describe('amount in words (Indian system)', () => {
  it('writes the reference invoice total', () => {
    expect(rupeesInWords(7_321_500n)).toBe('Rupees Seventy-Three Thousand Two Hundred Fifteen Only');
  });
  it('uses lakh and crore', () => {
    expect(rupeesInWords(14_175_000n)).toBe('Rupees One Lakh Forty-One Thousand Seven Hundred Fifty Only');
    expect(integerInWords(12_34_56_789n)).toBe('Twelve Crore Thirty-Four Lakh Fifty-Six Thousand Seven Hundred Eighty-Nine');
    expect(integerInWords(1_00_00_000n)).toBe('One Crore');
    expect(integerInWords(1_00_000n)).toBe('One Lakh');
  });
  it('small numbers and paise', () => {
    expect(integerInWords(0n)).toBe('Zero');
    expect(integerInWords(19n)).toBe('Nineteen');
    expect(integerInWords(100n)).toBe('One Hundred');
    expect(integerInWords(1_011n)).toBe('One Thousand Eleven');
    expect(rupeesInWords(10_050n)).toBe('Rupees One Hundred and Fifty Paise Only');
    expect(rupeesInWords(5n)).toBe('Rupees Zero and Five Paise Only');
  });
});
