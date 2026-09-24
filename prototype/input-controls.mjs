export const formatYearInput = value => /^[0-9]{0,4}$/.test(value) ? value : null;

// Input constraints only; calendar validity and record rules remain in the model.
export function formatDateInput(value) {
  if (!/^[0-9-]*$/.test(value)) return null;
  const digits = value.replaceAll('-', '');
  if (digits.length > 8) return null;
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join('-');
}

export function formatPriceInput(value) {
  if (!/^[0-9]*(?:[.,][0-9]{0,2})?$/.test(value)) return null;
  const normalized = value.replace(',', '.');
  return normalized.startsWith('.') ? `0${normalized}` : normalized;
}

export function bindInputConstraint(input, format) {
  let previous = input.value;
  input.addEventListener('change', () => { previous = input.value; });
  function apply(value, caret) {
    const formatted = format(value);
    input.value = formatted ?? previous;
    const position = formatted === null ? Math.min(caret, previous.length)
      : Math.min((format(value.slice(0, caret)) ?? formatted).length, formatted.length);
    input.setSelectionRange(position, position);
    previous = input.value;
  }
  input.addEventListener('beforeinput', event => {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    if (event.data != null) {
      const next = input.value.slice(0, start) + event.data + input.value.slice(end);
      if (format(next) === null) event.preventDefault();
    }
    // Backspace/Delete across an automatic date separator must remove a digit too.
    if (start === end && format === formatDateInput) {
      const backward = event.inputType === 'deleteContentBackward' && input.value[start - 1] === '-';
      const forward = event.inputType === 'deleteContentForward' && input.value[start] === '-';
      if (backward || forward) {
        event.preventDefault();
        const from = backward ? start - 2 : start;
        const to = backward ? start : start + 2;
        apply(input.value.slice(0, from) + input.value.slice(to), from);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  });
  input.addEventListener('paste', event => {
    event.preventDefault();
    const text = event.clipboardData.getData('text');
    const start = input.selectionStart;
    const next = input.value.slice(0, start) + text + input.value.slice(input.selectionEnd);
    if (format(next) === null) return;
    apply(next, start + text.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // Covers mobile keyboards, autofill, drag/drop and browsers without beforeinput.
  input.addEventListener('input', () => apply(input.value, input.selectionStart ?? input.value.length));
  input.form?.addEventListener('reset', () => { previous = ''; });
}
