const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** 0–99 in words ('Seventy-Three'). */
function twoDigits(n: number): string {
  if (n < 20) return ONES[n]!;
  return TENS[Math.floor(n / 10)]! + (n % 10 ? `-${ONES[n % 10]}` : '');
}

/** 0–999 in words ('Two Hundred Fifteen'). */
function threeDigits(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : '', rest ? twoDigits(rest) : ''].filter(Boolean).join(' ');
}

/** A whole number in the Indian system: crore, lakh, thousand ('One Lakh Forty-One Thousand Seven Hundred Fifty'). */
export function integerInWords(n: bigint): string {
  if (n === 0n) return 'Zero';
  const parts: string[] = [];
  const crore = n / 10_000_000n;
  let rest = Number(n % 10_000_000n);
  if (crore > 0n) parts.push(`${integerInWords(crore)} Crore`);
  const lakh = Math.floor(rest / 100_000);
  rest %= 100_000;
  const thousand = Math.floor(rest / 1000);
  rest %= 1000;
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));
  return parts.join(' ');
}

/** An amount in paise as it is written on an invoice: 'Rupees Seventy-Three Thousand Two Hundred Fifteen Only'. */
export function rupeesInWords(paise: bigint): string {
  const rupees = paise / 100n;
  const p = Number(paise % 100n);
  return `Rupees ${integerInWords(rupees)}${p ? ` and ${twoDigits(p)} Paise` : ''} Only`;
}
