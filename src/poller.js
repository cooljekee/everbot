const fs = require('fs');
const path = require('path');
const avito = require('./avito');
const { sendNotification, createTopic, closeTopic, reopenTopic } = require('./bot');

const POLL_INTERVAL = 30_000;
const TOPICS_FILE = path.join(__dirname, '..', 'topics.json');

// chat_id -> { threadId, name, closed, lastMsgTime }
// Персистим на диск, чтобы переживать рестарт (не пересоздавать темы).
const topicByChat = loadTopics();
let firstPoll = true;

function loadTopics() {
  try {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf8'))));
  } catch {
    return new Map();
  }
}

function persistTopics() {
  try {
    fs.writeFileSync(TOPICS_FILE, JSON.stringify(Object.fromEntries(topicByChat)));
  } catch (err) {
    console.error('topics persist error:', err.message);
  }
}

async function poll() {
  try {
    const chats = await avito.getChats(10);
    const myUserId = String(process.env.AVITO_USER_ID);

    for (const chat of chats) {
      const lastMsg = chat.last_message;
      if (!lastMsg) continue;

      const isFromMe = String(lastMsg.author_id) === myUserId;
      const msgTime = lastMsg.created * 1000;
      const topic = topicByChat.get(chat.id);

      if (isFromMe) {
        // Ты ответил в Авито → закрыть тему (диалог обработан)
        if (topic && !topic.closed) await closeChatTopic(chat.id);
        continue;
      }

      // Сообщение от клиента. Пропускаем, если это же сообщение уже обработано.
      if (topic && topic.lastMsgTime >= msgTime) continue;

      await handleClientMessage(chat, msgTime);
    }
  } catch (err) {
    console.error('Poll error:', err.message);
  }
  firstPoll = false;
}

// Новое сообщение клиента → в его тему (создаём/переоткрываем при необходимости)
async function handleClientMessage(chat, msgTime) {
  let topic = topicByChat.get(chat.id);

  if (!topic) {
    const name = buildTopicName(chat);
    const threadId = await createTopic(name);
    topic = { threadId, name, closed: false, lastMsgTime: 0 };
    topicByChat.set(chat.id, topic);
  }

  // Новая тема или возврат клиента после твоего ответа → полная карточка + звук.
  const wasClosedOrNew = topic.closed || topic.lastMsgTime === 0;

  if (topic.closed && topic.threadId) {
    await reopenTopic(topic.threadId);
    topic.closed = false;
  }

  if (wasClosedOrNew) {
    const { text, photo, replyMarkup } = await buildCard(chat);
    await sendNotification(text, photo, replyMarkup, {
      threadId: topic.threadId,
      silent: firstPoll, // популяция при старте — тихо; обычный новый диалог — со звуком
    });
  } else {
    // Идущий диалог — короткий тихий бамп в ту же тему
    const when = chat.last_message?.created ? absoluteTime(chat.last_message.created) : '';
    const line = `💬 *Ещё сообщение*${when ? ` · ${escapeMarkdown(when)}` : ''}`;
    await sendNotification(line, null, null, { threadId: topic.threadId, silent: true });
  }

  topic.lastMsgTime = msgTime;
  persistTopics();
}

// Ты ответил → закрываем тему чата
async function closeChatTopic(chatId) {
  const topic = topicByChat.get(chatId);
  if (!topic || topic.closed) return;
  if (topic.threadId) await closeTopic(topic.threadId);
  topic.closed = true;
  persistTopics();
}

// Имя темы: «Павел · Кардиган-куртка» (обычный текст, ≤128 символов)
function buildTopicName(chat) {
  const myUserId = String(process.env.AVITO_USER_ID);
  const buyer = chat.users?.find(u => String(u.id) !== myUserId);
  const item = chat.context?.value;
  let name = `${buyer?.name || 'Покупатель'} · ${item?.title || 'Товар'}`;
  if (name.length > 100) name = `${name.slice(0, 99)}…`;
  return name;
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

// Собирает карточку диалога: { text, photo, replyMarkup }
async function buildCard(chat) {
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

  // Мета диалога — всё доступно без подписки на messenger-API
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

  // Фото товара берём из превью чата (getItemInfo картинок не отдаёт).
  // Telegram сам не тянет картинку с CDN Авито — качаем байты сами и шлём файлом.
  const photoUrl = pickPhoto(item?.images);
  let photo = null;
  if (photoUrl) {
    try {
      photo = await avito.downloadImage(photoUrl);
    } catch {
      photo = null; // фото не критично — уйдёт текстом
    }
  }

  const chatUrl = `https://www.avito.ru/profile/messenger/channel/${chat.id}`;
  const replyMarkup = {
    inline_keyboard: [[{ text: '↩️ Ответить на Авито', url: chatUrl }]],
  };

  return { text, photo, replyMarkup };
}

// Совместимость с тестами: отправить карточку по чату вручную
async function sendAvitoNotification(chat) {
  const msgTime = (chat.last_message?.created || 0) * 1000 || Date.now();
  await handleClientMessage(chat, msgTime);
}

function startPolling() {
  console.log('🔄 Polling Авито каждые 30 секунд...');
  poll();
  setInterval(poll, POLL_INTERVAL);
}

module.exports = { startPolling, sendAvitoNotification };
