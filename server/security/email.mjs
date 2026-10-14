import nodemailer from 'nodemailer';
import { normalizeEmail } from './identity.mjs';
import { appendFile, mkdir } from 'node:fs/promises';
import { isAbsolute, dirname } from 'node:path';
export function createEmailService(env, { createTransport = options => nodemailer.createTransport(options) } = {}) {
  if (env.EMAIL_ADAPTER === 'capture') {
    if (env.NODE_ENV !== 'development' || !isAbsolute(env.EMAIL_CAPTURE_FILE || '')) throw Error('Capture mail requires explicit local development file');
    return { check: async () => true, async send(message) {
      await mkdir(dirname(env.EMAIL_CAPTURE_FILE), { recursive: true, mode: 0o700 });
      await appendFile(env.EMAIL_CAPTURE_FILE, JSON.stringify({ ...message, capturedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
      return 'accepted';
    } };
  }
  if (env.EMAIL_ADAPTER !== 'smtp' || !env.POSTBOX_KEY_ID || !env.POSTBOX_KEY_SECRET) throw Error('Explicit email adapter and credentials required');
  const testRecipient = env.NODE_ENV === 'production' ? null : normalizeEmail(env.POSTBOX_TEST_EMAIL).emailNormalized;
  // SMTP credentials are the API key ID and secret (scope yc.postbox.send).
  const transport = createTransport({ host: 'postbox.cloud.yandex.net', port: 465, secure: true,
    auth: { user: env.POSTBOX_KEY_ID, pass: env.POSTBOX_KEY_SECRET }, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000, logger: false, debug: false,
    disableFileAccess: true, disableUrlAccess: true });
  let probe;
  const check = () => {
    if(probe)return probe;
    let timer;
    const verification=Promise.resolve().then(()=>transport.verify()).then(()=>true,()=>false);
    const result=Promise.race([verification,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),10000);})]);
    probe=result;
    // Keep admission closed if a timed-out transport has not actually finished.
    // Concurrent requests share this address-independent probe.
    verification.finally(()=>{clearTimeout(timer);if(probe===result)probe=undefined;});
    return result;
  };
  return { minIntervalMs: 1000, check, async send({ email, code, purpose }) {
    if (testRecipient && normalizeEmail(email).emailNormalized !== testRecipient) return 'failed';
    const action = purpose === 'PASSWORD_RESET' ? 'восстановления пароля' : 'подтверждения email';
    try {
      const result = await transport.sendMail({ from: 'Vinyl Collection <no-reply@vinyl-collection.ru>', to: email,
        subject: `Vinyl Collection: код ${action}`, text: `Код ${action}: ${code}\n\nКод действует 10 минут. Используйте последний запрошенный код.\nЕсли вы не отправляли запрос, проигнорируйте это письмо.` });
      return result.accepted?.length ? 'accepted' : 'failed';
    } catch (error) {
      // Do not expose provider responses: they may contain recipients or credentials.
      return Number.isInteger(error.responseCode) && error.responseCode >= 400 ? 'failed' : 'unknown';
    }
  } };
}
