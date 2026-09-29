export const REPORT_MAX_LENGTH = 2000;
export const reportLength = text => [...text].length;
export function validReport(input) {
  return input !== null && typeof input === 'object' && !Array.isArray(input) &&
    Object.keys(input).length === 2 && Object.hasOwn(input, 'text') && Object.hasOwn(input, 'section') &&
    typeof input.text === 'string' && Boolean(input.text.trim()) && reportLength(input.text) <= REPORT_MAX_LENGTH &&
    input.text.isWellFormed() && ['collection', 'wishlist'].includes(input.section);
}
