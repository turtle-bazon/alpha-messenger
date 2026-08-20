# Голосовые и видео сообщения (#34)

Статус: В РАБОТЕ — код готов, сборка зелёная; E2E написан, но не прогнан
(в среде разработки нет docker/postgres — стек не поднять). Прогнать
`npx playwright test e2e/voice-video.spec.ts` против поднятого run/dev.

## Зафиксированные решения

- **Без колонок в messages.** Спека писалась до attachments-модели — вместо
  `media_type`/`media_duration` расширяем union вложений в конверте содержимого
  (`util/content.ts`). Сервер не меняется вообще (блобы уже универсальные).
- **AudioAttachment**: `{ kind:'audio', blobId, mime, duration, wave:number[], size }`
  — wave это 32–64 пика громкости 0..1, собираются при записи (AnalyserNode),
  хранятся в теле сообщения (ciphertext). Рендер waveform без расшифровки аудио.
- **VideoAttachment**: `{ kind:'video', blobId, mime, duration, width, height,
  thumb, size }` — thumb как у картинок (крошечный inline JPEG).
- **Форматы**: голосовое — webm/opus (MediaRecorder default), лимит 5 мин;
  видео — webm (VP8/9 + opus), лимит 60 сек с автостопом. mp4-транскодинг на
  клиенте без ffmpeg.wasm не делаем (браузерные ограничения); контейнер webm
  играется везде, где пишется.
- **Композер**: пустой ввод → кнопка 🎙 на месте серой «Отправить». Клик —
  toggle 🎙/🎥 (анимация поворота). Долгое нажатие 🎙 — запись голосового
  (hold): таймер + живой waveform над композером, свайп влево — отмена,
  отпускание — стоп+отправка. Долгое нажатие 🎥 — модалка камеры с немедленной
  записью. Текст в поле → кнопка отправки возвращается.

## Шаги

1. **Контент-модель** (`util/content.ts`): Audio/VideoAttachment, encode/decode
   (k:'audio' / k:'video'), previewText («🎤 Голосовое», «🎥 Видео»). — СДЕЛАНО
2. **Хук записи голоса** (`chats/useVoiceRecorder.ts`): getUserMedia({audio}) →
   MediaRecorder + AnalyserNode; отдаёт { state, seconds, levels[], blob, mime,
   start, stop, cancel }; автостоп 300с; сбор пиков ~20/сек в кольцо из 48. — СДЕЛАНО
3. **Модалка записи видео** (`chats/VideoRecorderModal.tsx`): зеркальный
   preview, запись сразу по открытию, таймер, автостоп 60с, после стопа —
   превью <video> + Отправить/Перезаписать. — СДЕЛАНО
4. **Композер** (`Conversation.tsx`): кнопка mic/cam toggle вместо disabled
   send при пустом вводе; hold-запись голосового с UI (таймер, полоски,
   cancel по свайпу влево >80px); интеграция отправки через очередь
   (enqueueSend c audio/video вложением). — СДЕЛАНО
5. **Плеер голосового** (`chats/VoiceBubble.tsx`): play/pause, статичный
   waveform из wave[] с прогресс-заливкой, клик по волне — seek, длительность,
   скорость 1x→1.5x→2x; playlist: по ended — следующий voice в чате. — СДЕЛАНО
6. **Видео-пузырь + плеер**: thumb + ▶ + длительность; клик — MediaViewer
   с <video controls> (расширить до медиа-общего). — СДЕЛАНО
7. **CSS**: conv-mic-btn, rec-bar (панель записи), voice-bubble, video-bubble,
   анимации пульсации/поворота. — СДЕЛАНО
8. **E2E** (`e2e/voice-video.spec.ts`): chromium с --use-fake-device-for-media-stream
   + --use-fake-ui-for-media-stream; A записывает голосовое (hold мыши),
   B получает, play/pause; видео-модалка: запись fake-video, отправка,
   воспроизведение у B. Регресс остальных сценариев. — СДЕЛАНО
