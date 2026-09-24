import { normalize } from '../src/collection-rules.mjs';

export const SORT_FIELDS = Object.freeze(['artist', 'album', 'genre', 'additionalGenre', 'label', 'albumYear', 'recordYear', 'editionType']);
const collator = new Intl.Collator('ru', { sensitivity: 'accent', numeric: false });
function compareField(a, b, field, direction = 'asc') {
  const left = normalize(a[field]); const right = normalize(b[field]);
  if (!left || !right) return left ? -1 : right ? 1 : 0;
  const result = field.endsWith('Year') ? Number(left) - Number(right) : collator.compare(left, right);
  return direction === 'desc' ? -result : result;
}
// Artist is the primary group; chronology only orders albums inside that group.
// Stable sort preserves source order when both keys compare equal.
export function sortRecords(records, sort = null) {
  return [...records].sort((a, b) =>
    (sort && SORT_FIELDS.includes(sort.field) ? compareField(a, b, sort.field, sort.direction) : 0) ||
    compareField(a, b, 'artist') || compareField(a, b, 'albumYear'));
}
export function displayDate(value) {
  if (value == null || value === '') return '';
  return value.split('-').reverse().join('-');
}
export function inputDate(value) {
  if (value == null || value === '') return null;
  // Invalid/partial input must fail the existing ISO calendar validator.
  return /^\d{2}-\d{2}-\d{4}$/.test(value) ? value.split('-').reverse().join('-') : 'invalid';
}
export function displayValue(field, value) {
  return field === 'purchaseDate' ? displayDate(value) : value ?? '';
}
function csvCell(value) {
  let text = String(value ?? '');
  // Prefix risky text, including formulas hidden behind whitespace/control characters.
  if (typeof value === 'string' && (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text))) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function recordsCsv(records, columns) {
  return '\uFEFF' + [columns.map(([, title]) => csvCell(title)).join(';'),
    ...records.map(record => columns.map(([field]) => csvCell(displayValue(field, record[field]))).join(';'))].join('\r\n') + '\r\n';
}
