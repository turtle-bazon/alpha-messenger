# 7. WebSocket /ws с resume

Реализован WebSocket /ws (@fastify/websocket): hello+lastSeq делает replay из outbox, живая доставка через pg_notify→LISTEN→in-process хаб (catch-up по seq), приём typing (транзиентно) и read (общий markRead). Тот же hello/replay закрывает досинхронизацию после офлайна/пуша. Общие хелперы вынесены в chat-helpers.ts. Покрыто test/ws.test.ts.
