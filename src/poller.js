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

// Дата вида «12 мая»
function formatDate(sec) {
  return new Date(sec * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

// Относительное время: «только что» / «5 мин назад» / «сегодня 14:20» / «вчера 09:15» / «12 мая 14:20»
function formatWhen(sec) {
  const then = sec * 1000;
  const diffMin = Math.round((Date.now() - then) / 60000);
  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${diffMin} мин назад`;
  const d = new Date(then);
  const today = new Date();
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `сегодня ${time}`;
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `вчера ${time}`;
  return `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} ${time}`;
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

  // Мета диалога — всё это доступно без подписки на messenger-API
  const city = item?.location?.title;
  if (city) text += `📍 *Город:* ${escapeMarkdown(city)}\n`;
  if (chat.created) text += `🗓 *Диалог начат:* ${escapeMarkdown(formatDate(chat.created))}\n`;
  if (chat.last_message?.created) {
    text += `🕐 *Последнее сообщение:* ${escapeMarkdown(formatWhen(chat.last_message.created))}\n`;
  }

  if (itemUrl) {
    text += `🔗 [Открыть объявление](${itemUrl})\n`;
  }

  const lastMsgText = chat.last_message?.content?.text;
  // Без подписки на messenger-API Авито вместо текста сообщения отдаёт
  // заглушку «Перейдите на подписку…» — не засоряем ей уведомление.
  if (lastMsgText && !lastMsgText.includes('Перейдите на подписку')) {
    text += `\n💬 *Сообщение:*\n${escapeMarkdown(lastMsgText)}\n`;
  }

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

  // Кнопка «Ответить» ведёт прямо в чат на Авито. Отвечать через API нельзя
  // без подписки на messenger, поэтому редиректим в веб-мессенджер Авито.
  const chatUrl = `https://www.avito.ru/profile/messenger/channel/${chat.id}`;
  const replyMarkup = {
    inline_keyboard: [[{ text: '↩️ Ответить на Авито', url: chatUrl }]],
  };

  await sendNotification(text, photoUrl, replyMarkup);
}

function startPolling() {
  console.log('🔄 Polling Авито каждые 30 секунд...');
  poll();
  setInterval(poll, POLL_INTERVAL);
}

module.exports = { startPolling, sendAvitoNotification };
