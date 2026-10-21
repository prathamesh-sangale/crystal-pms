// ISO 6346 container-number validation — shape (4 letters + 6-digit serial + 1 check digit)
// plus the check digit itself, so a typo'd digit doesn't pass as a real container number.
// Algorithm verified against the standard's own reference number, CSQU3054383 (check digit 3).
const ISO_CONTAINER_NO = /^[A-Z]{4}\d{7}$/;

const LETTER_VALUES: Record<string, number> = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20,
  K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31,
  U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};

function iso6346CheckDigit(first10: string): number | null {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = first10[i]!;
    const value = ch >= '0' && ch <= '9' ? Number(ch) : LETTER_VALUES[ch];
    if (value === undefined) return null;
    sum += value * Math.pow(2, i);
  }
  const remainder = sum % 11;
  return remainder === 10 ? 0 : remainder;
}

export function isValidContainerNo(no: string | null | undefined): boolean {
  const s = String(no == null ? '' : no).trim().toUpperCase();
  if (!ISO_CONTAINER_NO.test(s)) return false;
  const expected = iso6346CheckDigit(s.slice(0, 10));
  return expected !== null && expected === Number(s[10]);
}
