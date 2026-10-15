import { statisticsMessage } from '../statistics.mjs';
import nodemailer from 'nodemailer';
import { normalizeEmail } from './identity.mjs';
import { appendFile, mkdir } from 'node:fs/promises';
import { isAbsolute, dirname } from 'node:path';
import { UUID } from '../../src/base-record.mjs';

function reportMessage(message) {
  const {recipient,id,userId,createdAt,text,section,page}=message;
  if (!UUID.test(id||'') || !UUID.test(userId||'') || typeof text!=='string' || [...text].length>2000 ||
      !['collection','wishlist'].includes(section) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt||'')) throw Error('Invalid report notification');
  const to=normalizeEmail(recipient).emailNormalized;
  return {from:'Vinyl Collection <no-reply@vinyl-collection.ru>',to,
    subject:'Vinyl Collection: отчёт об ошибке',messageId:`<bug-report.${id}@vinyl-collection.ru>`,
    text:`Отчёт: ${id}\nДата и время (UTC): ${createdAt}\nПользователь: ${userId}\nРаздел: ${section}\nСтраница: ${page||'не указана'}\n\nОписание проблемы:\n${text}`};
}
export function createEmailService(env, { createTransport = options => nodemailer.createTransport(options) } = {}) {
  if (env.EMAIL_ADAPTER === 'capture') {
    if (env.NODE_ENV !== 'development' || !isAbsolute(env.EMAIL_CAPTURE_FILE || '')) throw Error('Capture mail requires explicit local development file');
    const capture=async message=>{
      await mkdir(dirname(env.EMAIL_CAPTURE_FILE), { recursive: true, mode: 0o700 });
      await appendFile(env.EMAIL_CAPTURE_FILE, JSON.stringify({ ...message, capturedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
      return 'accepted';
    };
    return {check:async()=>true,send:capture,sendReport:message=>capture(reportMessage(message)),sendStatistics:message=>capture(statisticsMessage(message))};
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
  const deliver=async message=>{
    if (testRecipient && normalizeEmail(message.to).emailNormalized!==testRecipient) return 'failed';
    try {
      const result = await transport.sendMail(message);
      return result.accepted?.length ? 'accepted' : 'failed';
    } catch (error) {
      // Do not expose provider responses: they may contain recipients or credentials.
      return Number.isInteger(error.responseCode) && error.responseCode >= 400 ? 'failed' : 'unknown';
    }
  };
  return {minIntervalMs:1000,check,sendReport:message=>deliver(reportMessage(message)),sendStatistics:message=>deliver(statisticsMessage(message)),async send({email,code,purpose}){
    const action=purpose==='PASSWORD_RESET'?'восстановления пароля':'подтверждения email';
    return deliver({from:'Vinyl Collection <no-reply@vinyl-collection.ru>',to:email,
      subject:`Vinyl Collection: код ${action}`,text:`Код ${action}: ${code}\n\nКод действует 10 минут. Используйте последний запрошенный код.\nЕсли вы не отправляли запрос, проигнорируйте это письмо.`});
  }};
}
