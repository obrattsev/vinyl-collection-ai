import { REPORT_MAX_LENGTH, reportLength, validReport } from '../src/bug-report.mjs';

export function bindBugReport({ document, fetch, section, canOpen }) {
  const get = id => document.querySelector(`#${id}`);
  const dialog = get('report-dialog'), text = get('report-text'), form = get('report-form');
  const status = get('report-status'), counter = get('report-counter'), submit = get('send-report');
  const success = get('report-success');
  let sending = false, successTimer;
  function clearSuccess() { clearTimeout(successTimer); success.textContent = ''; }
  function count() {
    const length = reportLength(text.value);
    counter.textContent = `${length} / ${REPORT_MAX_LENGTH}`;
    text.setAttribute('aria-invalid', String(length > REPORT_MAX_LENGTH));
    submit.disabled = sending || !validReport({ text: text.value, section });
  }
  text.addEventListener('input', count);
  get('open-report').addEventListener('click', () => {
    if (!canOpen()) return;
    clearSuccess(); status.textContent = ''; count(); dialog.showModal(); text.focus();
  });
  get('close-report').addEventListener('click', () => { if (!sending) dialog.close(); });
  get('clear-report').addEventListener('click', () => {
    if (sending) return;
    text.value = ''; status.textContent = ''; count(); text.focus();
  });
  dialog.addEventListener('cancel', event => { if (sending) event.preventDefault(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending || !validReport({ text: text.value, section })) { count(); return; }
    sending = true; text.disabled = true; get('clear-report').disabled = get('close-report').disabled = true; count();
    status.textContent = 'Отправка…';
    try {
      const response = await fetch('/api/bug-reports', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.value, section }) });
      const result = await response.json();
      if (response.status === 201 && typeof result.id === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(result.id)) {
        text.value = ''; status.textContent = ''; dialog.close();
        clearSuccess(); success.textContent = 'Сообщение отправлено';
        successTimer = setTimeout(clearSuccess, 5000);
      } else if (response.status === 429) {
        const retry = Number(response.headers?.get('Retry-After'));
        status.textContent = `Слишком много попыток. ${Number.isFinite(retry) && retry > 0 ? `Повторите через ${Math.ceil(retry)} сек.` : 'Попробуйте позже.'} Текст сохранён.`;
      } else if (result.error === 'REPORT_NOT_CONFIGURED') {
        status.textContent = 'Отправка сообщений пока не подключена. Текст сохранён.';
      } else {
        status.textContent = 'Сохранение не подтверждено. Текст сохранён в форме; повторная отправка может создать ещё одно сообщение.';
      }
    } catch {
      status.textContent = 'Сохранение не подтверждено. Текст сохранён в форме; повторная отправка может создать ещё одно сообщение.';
    } finally { sending = false; text.disabled = false; get('clear-report').disabled = get('close-report').disabled = false; count(); }
  });
  count();
}
