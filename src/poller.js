const fs = require('fs');
const path = require('path');
const avito = require('./avito');
const { sendNotification, deleteCard, editCard } = require('./bot');

const POLL_INTERVAL = 30_000;
const STATE_FILE = path.join(__dirname, '..', 'cards.json');

// chat_id -> { messageId, lastMsgTime, count, isPhoto }
// Одна карточка на неотвеченный чат в общем чате. Каждое новое сообщение
// клиента ОБНОВЛЯЕТ ту же карточку (edit-in-place) + счётчик. Ты ответил в
// Авито → карточка удаляется. Персистим, чтобы переживать рестарт.
let cards = loadCards();
let firstPoll = true;

function loadCards() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

function persistCards() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(cards));
  } catch (err) {
    console.error('cards persist error:', err.message);
  }
}

async function poll() {
  try {
    const chats = await avito.getChats(50);
    const myUserId = String(process.env.AVITO_USER_ID);

    for (const chat of chats) {
      const lastMsg = chat.last_message;
      if (!lastMsg) continue;

      const isFromMe = String(lastMsg.author_id) === myUserId;
      const msgTime = lastMsg.created * 1000;
      const card = cards[chat.id];

      if (isFromMe) {
        // Ты ответил в Авито → удалить карточку (диалог обработан)
        if (card) await clearCard(chat.id);
        continue;
      }

      // Обновляем карточку каждый раз, когда двинулось последнее сообщение клиента.
      if (card && card.lastMsgTime >= msgTime) continue;

      await refreshCard(chat, msgTime, firstPoll || Boolean(card));
    }
  } catch (err) {
    console.error('Poll error:', err.message);
  }
  firstPoll = false;
}

// Первое сообщение → новая карточка; каждое следующее → обновляем ту же (edit),
// увеличивая счётчик. Карточку не двигаем и не пересоздаём.
async function refreshCard(chat, msgTime, silent) {
  const old = cards[chat.id];
  const count = old ? old.count + 1 : 1;
  const { text, replyMarkup } = await buildCard(chat, count);

  if (old) {
    const ok = await editCard(old.messageId, text, replyMarkup, old.isPhoto);
    if (ok) {
      cards[chat.id] = { ...old, lastMsgTime: msgTime, count };
      persistCards();
      return;
    }
    // Не удалось отредактировать (сообщение слишком старое / удалено) →
    // упадём в отправку новой карточки ниже.
  }

  const photo = await loadPhoto(chat);
  const res = await sendNotification(text, photo, replyMarkup, { silent });
  if (res && res.messageId) {
    if (old && old.messageId !== res.messageId) deleteCard(old.messageId).catch(() => {});
    cards[chat.id] = { messageId: res.messageId, lastMsgTime: msgTime, count, isPhoto: res.isPhoto };
    persistCards();
  }
}

// Ты ответил → удаляем карточку чата
async function clearCard(chatId) {
  const card = cards[chatId];
  if (!card) return;
  await deleteCard(card.messageId);
  delete cards[chatId];
  persistCards();
}

// Фото товара из превью чата (Telegram сам с CDN Авито не тянет — качаем сами)
async function loadPhoto(chat) {
  const url = pickPhoto(chat.context?.value?.images);
  if (!url) return null;
  try {
    return await avito.downloadImage(url);
  } catch {
    return null;
  }
}

function escapeMarkdown(text) {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

// Дата вида «12 мая»
function formatDate(sec) {
  return new Date(sec * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

// Русское склонение: plural(3, 'день', 'дня', 'дней') → «3 дня»
function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  let form = many;
  if (m10 === 1 && m100 !== 11) form = one;
  else if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) form = few;
  return `${n} ${form}`;
}

// Относительно: «только что» / «5 мин назад» / «2 ч назад» / «3 дн назад»
function relativeAgo(sec) {
  const min = Math.max(0, Math.round((Date.now() - sec * 1000) / 60000));
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.round(h / 24)} дн назад`;
}

// Абсолютно: «сегодня 14:20» / «вчера 09:15» / «12 мая 14:20»
function absoluteTime(sec) {
  const d = new Date(sec * 1000);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `сегодня ${time}`;
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `вчера ${time}`;
  return `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} ${time}`;
}

// Длительность диалога от даты старта: «3 дня» / «5 часов» / «20 минут»
function formatDuration(fromSec) {
  const min = Math.max(0, Math.round((Date.now() - fromSec * 1000) / 60000));
  if (min < 60) return plural(min, 'минуту', 'минуты', 'минут');
  const h = Math.round(min / 60);
  if (h < 24) return plural(h, 'час', 'часа', 'часов');
  return plural(Math.round(h / 24), 'день', 'дня', 'дней');
}

// Самая крупная картинка из превью чата (getItemInfo фото не отдаёт)
function pickPhoto(images) {
  const main = images && images.main;
  if (!main || typeof main !== 'object') return null;
  let best = null;
  let bestArea = -1;
  for (const [size, url] of Object.entries(main)) {
    const m = /^(\d+)x(\d+)$/.exec(size);
    const area = m ? Number(m[1]) * Number(m[2]) : 0;
    if (area > bestArea) { bestArea = area; best = url; }
  }
  return best;
}

// Человекочитаемый статус объявления (getItemInfo.status — строка)
const STATUS_LABELS = {
  active: '🟢 активно',
  old: '⚪️ в архиве',
  removed: '🗑 снято',
  blocked: '⛔ заблокировано',
  rejected: '🚫 отклонено',
  closed: '✅ продано',
};
function statusLabel(status) {
  if (!status) return null;
  return STATUS_LABELS[status] || status;
}

// Собирает текст+кнопку карточки. count — сколько сообщений клиента без ответа.
async function buildCard(chat, count = 1) {
  const item = chat.context?.value;
  const myUserId = String(process.env.AVITO_USER_ID);
  const buyer = chat.users?.find(u => String(u.id) !== myUserId);

  const buyerName = escapeMarkdown(buyer?.name || 'Покупатель');
  const itemTitle = item ? escapeMarkdown(item.title) : null;
  const itemPrice = item ? escapeMarkdown(item.price_string || '') : null;
  const itemUrl = item?.url ? `https://avito.ru${item.url.replace('https://avito.ru', '')}` : null;

  let text = `💬 *Новое сообщение на Авито*\n`;
  if (count > 1) {
    text += `📨 *Без ответа:* ${plural(count, 'сообщение', 'сообщения', 'сообщений')}\n`;
  }
  text += `\n👤 *Покупатель:* ${buyerName}\n`;

  if (itemTitle) {
    text += `📦 *Товар:* ${itemTitle}`;
    if (itemPrice) text += ` — ${itemPrice}`;
    text += '\n';
  }

  // Статус объявления — из getItemInfo (строка «active»/«old»/…), без подписки
  let statusText = null;
  if (item?.id) {
    try {
      const fullItem = await avito.getItemInfo(item.id);
      statusText = statusLabel(fullItem?.status);
    } catch {
      // статус недоступен — не критично
    }
  }

  const city = item?.location?.title;
  if (city) text += `📍 *Город:* ${escapeMarkdown(city)}\n`;
  if (statusText) text += `🏷 *Объявление:* ${escapeMarkdown(statusText)}\n`;
  if (chat.created) {
    text += `🗓 *Диалог начат:* ${escapeMarkdown(formatDate(chat.created))} \\(идёт ${escapeMarkdown(formatDuration(chat.created))}\\)\n`;
  }
  if (chat.last_message?.created) {
    const t = chat.last_message.created;
    text += `🕐 *Последнее сообщение:* ${escapeMarkdown(relativeAgo(t))} · ${escapeMarkdown(absoluteTime(t))}\n`;
  }

  if (itemUrl) {
    text += `🔗 [Открыть объявление](${itemUrl})\n`;
  }

  const lastMsgText = chat.last_message?.content?.text;
  // Без подписки Авито вместо текста отдаёт заглушку — не показываем её.
  if (lastMsgText && !lastMsgText.includes('Перейдите на подписку')) {
    text += `\n💬 *Сообщение:*\n${escapeMarkdown(lastMsgText)}\n`;
  }

  const chatUrl = `https://www.avito.ru/profile/messenger/channel/${chat.id}`;
  const replyMarkup = {
    inline_keyboard: [[{ text: '↩️ Ответить на Авито', url: chatUrl }]],
  };

  return { text, replyMarkup };
}

// Совместимость с тестами: вручную положить/обновить карточку по чату
async function sendAvitoNotification(chat) {
  const msgTime = (chat.last_message?.created || 0) * 1000 || Date.now();
  await refreshCard(chat, msgTime, false);
}

function startPolling() {
  console.log('🔄 Polling Авито каждые 30 секунд...');
  poll();
  setInterval(poll, POLL_INTERVAL);
}

module.exports = { startPolling, sendAvitoNotification };
