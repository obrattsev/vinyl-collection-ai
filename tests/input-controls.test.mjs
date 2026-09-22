import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDateInput, formatPriceInput, formatYearInput, bindInputConstraint } from '../prototype/input-controls.mjs';

class Input extends EventTarget {
  value = '';
  selectionStart = 0;
  selectionEnd = 0;
  form = new EventTarget();
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  send(type, properties = {}) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, properties);
    this.dispatchEvent(event);
    return event;
  }
  type(text) {
    const event = this.send('beforeinput', { data: text, inputType: 'insertText' });
    if (event.defaultPrevented) return;
    const start = this.selectionStart;
    this.value = this.value.slice(0, start) + text + this.value.slice(this.selectionEnd);
    this.setSelectionRange(start + text.length, start + text.length);
    this.send('input');
  }
  paste(text) { this.send('paste', { clipboardData: { getData: () => text } }); }
}

test('date formatting supports partial digit entry and ISO paste with an eight-digit limit', () => {
  for (const [value, expected] of [['', ''], ['2026', '2026'], ['20260', '2026-0'], ['20260921', '2026-09-21'], ['2026-09-21', '2026-09-21']]) {
    assert.equal(formatDateInput(value), expected);
  }
  for (const value of ['202609211', 'a20260921', '2026/09/21', '+20260921', '2026.09.21']) assert.equal(formatDateInput(value), null);
});

test('price input supports rubles and two kopeck digits, rejects non-monetary syntax', () => {
  for (const [value, expected] of [['', ''], ['0', '0'], ['12', '12'], ['12.', '12.'], ['12,50', '12.50'], ['.5', '0.5']]) {
    assert.equal(formatPriceInput(value), expected);
  }
  for (const value of ['1.234', '1,234', '1.2.3', '1,2.3', 'a', '1e3', '+1', '-1', '0x10', '12 ₽', ' 12']) assert.equal(formatPriceInput(value), null);
});

test('date typing blocks letters and excess digits; valid paste formats, invalid paste preserves value', () => {
  const input = new Input(); bindInputConstraint(input, formatDateInput);
  for (const digit of '20260921') input.type(digit);
  assert.equal(input.value, '2026-09-21');
  input.type('9'); input.type('x'); assert.equal(input.value, '2026-09-21');
  input.setSelectionRange(0, input.value.length);
  input.paste('not a date'); assert.equal(input.value, '2026-09-21');
  input.paste('20241231'); assert.equal(input.value, '2024-12-31');
  input.setSelectionRange(0, input.value.length);
  input.paste('202401011'); assert.equal(input.value, '2024-12-31');
});

test('price typing and paste reject signs, exponent, second separator and extra precision', () => {
  const input = new Input(); bindInputConstraint(input, formatPriceInput);
  for (const character of '12,50') input.type(character);
  assert.equal(input.value, '12.50');
  for (const character of ['0', '.', ',', '+', '-', 'e', 'x']) input.type(character);
  assert.equal(input.value, '12.50');
  input.setSelectionRange(0, input.value.length);
  for (const invalid of ['1e3', '-20', '20.001', '20..1', 'abc']) input.paste(invalid);
  assert.equal(input.value, '12.50');
  input.paste('0,99'); assert.equal(input.value, '0.99');
});

test('fallback input events reject invalid autofill and reset forgets the previous value', () => {
  const input = new Input(); bindInputConstraint(input, formatPriceInput);
  input.type('10'); input.value = '1e9'; input.send('input'); assert.equal(input.value, '10');
  input.form.dispatchEvent(new Event('reset')); input.value = '';
  input.value = '-1'; input.send('input'); assert.equal(input.value, '');
});

test('date separators do not trap Backspace or Delete; caret edits keep the mask', () => {
  const input = new Input(); bindInputConstraint(input, formatDateInput);
  input.paste('20260921'); input.setSelectionRange(5, 5);
  const backspace = input.send('beforeinput', { inputType: 'deleteContentBackward', data: null });
  assert.equal(backspace.defaultPrevented, true); assert.equal(input.value, '2020-92-1');
  input.setSelectionRange(0, input.value.length); input.paste('20260921');
  input.setSelectionRange(4, 4);
  input.send('beforeinput', { inputType: 'deleteContentForward', data: null });
  assert.equal(input.value, '2026-92-1');
});

test('year typing and paste accept only four ASCII digits, including selection replacement', () => {
  const input = new Input(); bindInputConstraint(input, formatYearInput);
  for (const digit of '1979') input.type(digit);
  for (const invalid of ['0', 'x', '.', '-', 'e']) input.type(invalid);
  assert.equal(input.value, '1979');
  input.setSelectionRange(0, 4);
  for (const invalid of ['19860', '19x6', ' 1986', '１９８６', '1e03']) input.paste(invalid);
  assert.equal(input.value, '1979');
  input.paste('1986'); assert.equal(input.value, '1986');
  input.setSelectionRange(2, 4); input.paste('99'); assert.equal(input.value, '1999');
  input.value = '19999'; input.send('input'); assert.equal(input.value, '1999');
  input.form.dispatchEvent(new Event('reset')); input.value = 'bad'; input.send('input'); assert.equal(input.value, '');
  input.setSelectionRange(0, 0); input.type('2'); assert.equal(input.value, '2');
});
