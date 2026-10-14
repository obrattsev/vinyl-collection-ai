# Stage 4C: Postbox owner setup

> Актуализация 12.10.2026: функциональность и UI Stage 4C приняты владельцем. Разрешена локальная Postbox-проверка на ранее согласованный адрес; прежний запрет реальных локальных отправок заменён этим разрешением. SMTP TLS/auth проверены; владелец подтвердил реальную доставку, регистрацию и recovery с отзывом прежней сессии. Production readiness gates остаются в отчёте. Stage 4C открыт; Git finalization и deployment запрещены. [Текущий отчёт и checkpoint](stage-4c-release-readiness.md).

Проверено по официальной документации Yandex Cloud 11.10.2026. Реальная доставка ещё не проверена. Локальный стенд продолжает использовать capture; production, DNS, Cloud и реальные данные не изменялись.

## Действия владельца

1. Открыть [Yandex Cloud Console](https://console.yandex.cloud/). Выбрать облако и каталог с активным платёжным аккаунтом. В каталоге создать сервисный аккаунт `vinyl-postbox`, назначить ему роль `postbox.sender`.
2. В сервисном аккаунте создать **API-ключ** с областью действия `yc.postbox.send`. Получить ID и секретную часть. Для выбранного SMTP-способа нужен именно API-ключ, а не статический S3-ключ. Секрет сохранить локально; в чат не отправлять.
3. В **том же каталоге** открыть Cloud Postbox → «Создать адрес». Домен: `vinyl-collection.ru`. DKIM: «Простая». Получить две CNAME-записи, которые покажет Postbox. Имена/значения не придумывать. Отправитель приложения: `no-reply@vinyl-collection.ru`.
4. В Timeweb открыть управление DNS домена. Добавить две CNAME точно из Postbox. Обновить существующую единственную SPF TXT-запись корня на `v=spf1 include:_spf.timeweb.ru include:spf.postbox.yandexcloud.net ~all`. Не создавать второй SPF; MX, NS, A/AAAA и действующие почтовые записи оставить. Сначала сверить текущий SPF: если он отличается от указанного ниже снимка, не заменять его вслепую. DMARC рекомендуется; его политику согласовать отдельно, не включать reject при этой проверке.
5. В Postbox дождаться DKIM/проверки домена **Success**. Заполнить локальный файл `/Users/obrattsev/vinyl-collection-config/stage4c-postbox.env` в текстовом редакторе. Он создан вне репозитория с правами 0600:
   - `EMAIL_ADAPTER=smtp`
   - `POSTBOX_KEY_ID` — ID API-ключа;
   - `POSTBOX_KEY_SECRET` — секретная часть API-ключа;
   - `POSTBOX_TEST_EMAIL` — один принадлежащий вам адрес, согласованный для двух тестовых писем: регистрации и восстановления.
   Не вставлять содержимое файла в чат, Git или shell-команду. Сообщить только «параметры сохранены, адрес разрешён для тестов». Не запускать production и не менять production env.
6. После подтверждения Codex подключит файл только к локальному стенду и проверит регистрацию → письмо/код → пароль → свой URL; затем восстановление → письмо/код → новый пароль → отзыв старых сессий. Владелец проверяет фактическое получение обоих писем, папку «Спам» и результаты DKIM/SPF в заголовках. OTP и секреты не публиковать. SMTP accepted означает только приём провайдером, а не подтверждённую доставку в ящик. При необходимости проверить bounce/complaint сведения в Postbox.

## Техническая фиксация

- Существующий Nodemailer adapter сохранён. SMTP `postbox.cloud.yandex.net:465`, implicit TLS, minimum TLS 1.2, проверка сертификата обязательна; альтернативный документированный порт 587/STARTTLS не используется.
- API key ID передаётся как SMTP username, secret как password. Логи/debug Nodemailer выключены; transport errors не выходят в HTTP/UI. SMTP отказ → `failed`, неопределённый сетевой исход → `unknown`; отсутствие accepted recipient → `failed`. Provider acceptance не приравнивается к доставке.
- В development/test SMTP требует `POSTBOX_TEST_EMAIL` и не отправляет на другие адреса. Capture не изменён. Не расширять список получателей без разрешения.
- Auth flow остаётся enumeration-resistant: UI не раскрывает наличие аккаунта и внутренний SMTP ответ; объясняет проверку Spam и повторный запрос после таймера. `send_state` сохраняется в существующей auth_challenges; schema не менялась.
- Свежий read-only DNS snapshot: NS Timeweb; MX `10 mx1.timeweb.ru`, `20 mx2.timeweb.ru`; SPF `v=spf1 include:_spf.timeweb.ru ~all`; TXT для `_dmarc` запрос не вернул. Домен совместим с Postbox при добавлении DKIM и расширении SPF; переноса входящей почты не требуется. Фактическая DKIM verification ещё ожидается.

Источники: [начало работы](https://yandex.cloud/ru/docs/postbox/quickstart), [отправка SMTP](https://yandex.cloud/ru/docs/postbox/operations/send-email), [DKIM/SPF/DMARC](https://yandex.cloud/ru/docs/postbox/concepts/dns-records).
