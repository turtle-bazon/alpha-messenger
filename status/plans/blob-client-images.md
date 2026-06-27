# Вложения в клиенте — этап 1: изображения через блобы

**Статус: СДЕЛАНО** (шаги 1–10). Реализация и итог — в issue #31, раздел
«Сделано (этап 2 — клиент: изображения)».

Серверная часть блобов готова (issue #31, коммит d9b4729): `POST /api/blobs`,
`GET /api/blobs/{id}`, `blobIds[]` в сообщениях. Здесь — клиентская часть.

## Зафиксированные решения

- **Модель — `attachments[]`, а не «типы сообщений».** Сообщение = текст +
  массив вложений, у каждого `kind: image | video | file`. Ложится на серверный
  `blobIds[]` (до 16), даёт «текст+файл» и «несколько медиа» одним путём
  рендера/отправки. Видео/картинка/файл — это `kind` вложения, не тип сообщения.
- **Единообразно через блобы.** Новые отправки всегда: блоб (полный файл) +
  крошечный inline-thumbnail для мгновенного превью. Полный inline-путь
  (128 KB в теле) для новых сообщений убираем. Старые inline-картинки
  продолжают читаться легаси-декодером (`decodeContent`, read-only).
- **Этап 1 — только изображения.** Файлы, видео, drag&drop/буфер/мультизагрузка —
  отдельными шагами (см. «Дальше»).

## Технический нюанс

`GET /api/blobs/{id}` требует `Authorization: Bearer`, а `<img src>` заголовки
слать не умеет. Поэтому полный файл тянем через `fetch` (с токеном) → `Blob` →
`URL.createObjectURL`, с кешем и revoke. В пузыре показываем inline-thumbnail
(без запроса), полноразмер грузим по клику. Presigned-URL — на будущее (#31).

## Формат тела сообщения (новый)

`encodeContent` пишет: `{ t:'msg', text?: string, atts?: Attachment[] }`.
`Attachment` (метаданные внутри ciphertext, т.е. в будущем шифруются):
```
{ kind:'image', blob:<blobId>, mime, w, h, size, thumb:<tiny b64 jpeg>,
  cap?:string, key?:<future blob decryption key> }
```
`blobId` дублируется в открытом `blobIds[]` тела запроса — сервер из ciphertext
ссылку не прочтёт, она нужна ему для авторизации скачивания и refcount.
`decodeContent` понимает новый `t:'msg'`, легаси `t:'image'` (inline) и `t:'text'`.

## Шаги

1. **Контент-конверт** (`util/content.ts`): новый тип `Attachment`, формат
   `t:'msg'` с `text?` и `atts?`. `encodeContent`/`decodeContent` — запись нового,
   чтение нового + легаси. `previewText` — 📷 для image-вложения.
2. **Тип Message** (`api/types.ts`): добавить `blobIds: string[]`. Прокинуть в
   парсинге `getMessages`, `sendMessage`-ответа и события `message.new`.
3. **API-клиент** (`api/rest.ts`):
   - `uploadBlob(bytes): Promise<{blobId,size}>` — POST /api/blobs,
     `Content-Type: application/octet-stream`, Bearer.
   - `sendMessage(...)` — добавить параметр `blobIds` в тело.
   - `fetchBlob(blobId): Promise<Blob>` — GET с Bearer → Blob.
4. **Кеш object-URL** (`util/blobUrl.ts`, новый): `blobId → ObjectURL` (Map),
   `fetchBlob` с авторизацией, revoke по размонтированию/LRU. Для полноразмера.
5. **Подготовка изображения** (`util/image.ts`):
   - `produceImageBlob(img, rotation)` → полноразмерный (умеренно ужатый под
     `MAX_BLOB_SIZE`) JPEG `Blob` + `mime,w,h,size`.
   - `produceThumb(img, rotation)` → крошечный JPEG (≤256px, несколько КБ) b64.
   - старый `produceImageContent` (inline-путь) убрать из отправки.
6. **Отправка** (`chats/Conversation.tsx`): в потоке ImageEditor → `produceImageBlob`
   + `produceThumb` → `uploadBlob(full)` → собрать `Attachment{kind:image,...}` →
   `encodeContent` → `sendMessage(chatId, clientMessageId, ciphertext, [blobId])`.
   Оптимистичный UI: локальный thumb + статус «загрузка…», ошибка upload —
   пометка + ретрай (очередь `sendQueueRef` уже последовательная).
7. **Рендер** (`chats/Conversation.tsx` + новый `chats/MediaViewer.tsx`): пузырь
   показывает inline-thumb сразу; клик → lightbox тянет полный блоб через
   `blobUrl`-кеш. Легаси inline-картинки — как раньше.
8. **WS** (`api/ws.ts`): `message.new` уже несёт `blobIds` — прокинуть в стор.
9. **E2e** (`web_client`, playwright): сценарий — выбрать картинку → редактор →
   отправить → thumb в пузыре → клик открывает полноразмер → второй участник
   видит. Регресс остальных сценариев.
10. **Док**: отметить переход на блобы для изображений (architecture.md/api.md);
    в #31 — продвижение клиентской части.

## Дальше (вне этапа 1)

- Файлы (`kind:file`): карточка имя/размер/иконка + скачивание.
- Видео (`kind:video`): poster-кадр inline + стрим; на сервере — range-запросы
  к `GET /blobs/{id}` (сейчас стримит целиком).
- Вставка из буфера (issue #17), drag&drop, мультивложения (до 16), прогресс-бар.
- Presigned-URL вместо object-URL; GC/refcount блобов (follow-up из #31).
