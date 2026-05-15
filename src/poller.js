const avito = require('./avito');
const { sendNotification } = require('./bot');

const POLL_INTERVAL = 30_000;
const notifiedChats = new Map(); // chat_id -> last message timestamp
let initialized = false;

async function poll() {
  try {
    const chats = await avito.getChats(10);
    const myUserId = String(process.env.AVITO_USER_ID);

    for (const chat of chats) {
      const lastMsg = chat.last_message;
      if (!lastMsg) continue;
      if (String(lastMsg.author_id) === myUserId) continue;

      const msgTime = lastMsg.created * 1000;
      const lastNotified = notifiedChats.get(chat.id);

      if (!initialized) {
        notifiedChats.set(chat.id, msgTime);
        continue;
      }

      if (lastNotified && lastNotified >= msgTime) continue;

      notifiedChats.set(chat.id, msgTime);
      sendAvitoNotification(chat).catch(err =>
        console.error('Poller notify error:', err.message)
      );
    }
  } catch (err) {
    console.error('Poll error:', err.message);
  }

  initialized = true;
}

function escapeMarkdown(text) {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

async function sendAvitoNotification(chat) {
  const item = chat.context?.value;
  const myUserId = String(process.env.AVITO_USER_ID);
  const buyer = chat.users?.find(u => String(u.id) !== myUserId);

  const buyerName = escapeMarkdown(buyer?.name || 'Покупатель');
  const itemTitle = item ? escapeMarkdown(item.title) : null;
  const itemPrice = item ? escapeMarkdown(item.price_string || '') : null;
  const itemUrl = item?.url ? `https://avito.ru${item.url.replace('https://avito.ru', '')}` : null;

  let text = `💬 *Новое сообщение на Авито*\n\n`;
  text += `👤 *Покупатель:* ${buyerName}\n`;

  if (itemTitle) {
    text += `📦 *Товар:* ${itemTitle}`;
    if (itemPrice) text += ` — ${itemPrice}`;
    text += '\n';
  }

  if (itemUrl) {
    text += `🔗 [Открыть объявление](${itemUrl})\n`;
  }

  const lastMsgText = chat.last_message?.content?.text;
  if (lastMsgText) {
    text += `\n💬 *Сообщение:*\n${escapeMarkdown(lastMsgText)}\n`;
  }

  text += `\n↩️ /reply ${chat.id} текст`;

  // Пробуем получить фото товара (этот эндпоинт не требует подписки)
  let photoUrl = null;
  if (item?.id) {
    try {
      const fullItem = await avito.getItemInfo(item.id);
      photoUrl = fullItem?.images?.[0]?.url || null;
    } catch {
      // Фото недоступно — не критично
    }
  }

  await sendNotification(text, photoUrl);
}

function startPolling() {
  console.log('🔄 Polling Авито каждые 30 секунд...');
  poll();
  setInterval(poll, POLL_INTERVAL);
}

module.exports = { startPolling };
