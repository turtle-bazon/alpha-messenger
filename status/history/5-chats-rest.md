# 5. Чаты (REST)

Реализованы чаты: GET /chats, POST /chats (direct с дедупликацией, group), GET /chats/{chatId} с проверкой участия. Общий вид чата (loadChat) с participants/lastMessage/unreadCount; при создании эмитится chat.created. Покрыто тестом test/chats.test.ts.
