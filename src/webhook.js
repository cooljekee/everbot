const express = require('express');
const avito = require('./avito');
const { sendNotification } = require('./bot');
const { formatAvitoNotification } = require('./formatter');

const router = express.Router();

// Хранилище недавних уведомлений чтобы не дублировать
const notifiedChats = new Map();

router.post('/avito', async (req, res) => {
  // Авито ждёт 200 быстро, обрабатываем асинхронно
  res.sendStatus(200);

  try {
    const { payload } = req.body;
    if (!payload) return;

    for (const event of payload) {
      if (event.type !== 'message') continue;

      const { chat_id, author_id } = event.value;
      const myUserId = process.env.AVITO_USER_ID;

      // Пропускаем собственные сообщения
      if (String(author_id) === String(myUserId)) continue;

      // Дедупликация: не спамим если в течение 30 секунд уже отправили
      const lastNotified = notifiedChats.get(chat_id);
      if (lastNotified && Date.now() - lastNotified < 30_000) continue;
      notifiedChats.set(chat_id, Date.now());

      await handleNewMessage(chat_id);
    }
  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

async function handleNewMessage(chatId) {
  const [chat, messages] = await Promise.all([
    avito.getChat(chatId),
    avito.getChatMessages(chatId, 5),
  ]);

  // Пробуем получить информацию о товаре из контекста чата
  const itemId = chat.context?.value?.id;
  let item = null;
  let photoUrl = null;

  if (itemId) {
    try {
      item = await avito.getItemInfo(itemId);
      photoUrl = item?.images?.[0]?.url || null;
    } catch {
      // Объявление могло быть удалено — не критично
    }
  }

  const text = formatAvitoNotification(chat, messages, item);
  await sendNotification(text, photoUrl);
}

module.exports = router;
