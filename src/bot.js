const { Telegraf } = require('telegraf');
const avito = require('./avito');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// /reply <chat_id> <текст> — ответить покупателю на Авито
bot.command('reply', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  if (parts.length < 3) {
    return ctx.reply('Формат: /reply <chat_id> <текст сообщения>');
  }
  const chatId = parts[1];
  const text = parts.slice(2).join(' ');

  try {
    await avito.sendMessage(chatId, text);
    await ctx.reply(`✅ Ответ отправлен покупателю`);
  } catch (err) {
    console.error('Ошибка отправки на Авито:', err.message);
    await ctx.reply(`❌ Не удалось отправить: ${err.message}`);
  }
});

// /status — проверить что бот живой
bot.command('status', (ctx) => {
  ctx.reply('✅ EverBot работает. Слушаю Авито.');
});

// Возвращает message_id отправленной карточки (или null). opts.silent — без звука.
async function sendNotification(text, photo = null, replyMarkup = null, opts = {}) {
  const markup = replyMarkup ? { reply_markup: replyMarkup } : {};
  const silent = opts.silent ? { disable_notification: true } : {};
  const thread = opts.threadId ? { message_thread_id: opts.threadId } : {};
  try {
    let msg;
    if (photo) {
      const media = Buffer.isBuffer(photo) ? { source: photo } : photo;
      msg = await bot.telegram.sendPhoto(CHAT_ID, media, {
        caption: text,
        parse_mode: 'MarkdownV2',
        ...markup,
        ...silent,
        ...thread,
      });
    } else {
      msg = await bot.telegram.sendMessage(CHAT_ID, text, {
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
        ...markup,
        ...silent,
        ...thread,
      });
    }
    return msg && msg.message_id ? msg.message_id : null;
  } catch (err) {
    console.error('Ошибка отправки в Telegram:', err.message);
    // Фолбэк: фото не ушло или битая разметка — шлём текстом, чтобы
    // уведомление не потерялось.
    const parseErr = err.message.includes('parse');
    try {
      const msg = await bot.telegram.sendMessage(CHAT_ID, parseErr ? text.replace(/[*_`[\]]/g, '') : text, {
        ...(parseErr ? {} : { parse_mode: 'MarkdownV2' }),
        disable_web_page_preview: true,
        ...markup,
        ...silent,
        ...thread,
      });
      return msg && msg.message_id ? msg.message_id : null;
    } catch (err2) {
      console.error('Повторная отправка тоже упала:', err2.message);
      return null;
    }
  }
}

// Удаляем карточку из Telegram. Свои сообщения бот удаляет как админ, ≤48ч.
async function deleteCard(messageId) {
  if (!messageId) return;
  try {
    await bot.telegram.deleteMessage(CHAT_ID, messageId);
  } catch (err) {
    // старше 48ч / уже удалено / нет прав — не критично
  }
}

// --- Forum topics (подгруппы) ---

async function createTopic(name) {
  try {
    const t = await bot.telegram.createForumTopic(CHAT_ID, name);
    return t && t.message_thread_id ? t.message_thread_id : null;
  } catch (err) {
    console.error('createForumTopic error:', err.message);
    return null;
  }
}

async function closeTopic(threadId) {
  if (!threadId) return;
  try {
    await bot.telegram.closeForumTopic(CHAT_ID, threadId);
  } catch (err) {
    // уже закрыта / нет прав — не критично
  }
}

async function reopenTopic(threadId) {
  if (!threadId) return;
  try {
    await bot.telegram.reopenForumTopic(CHAT_ID, threadId);
  } catch (err) {
    // уже открыта — не критично
  }
}

module.exports = { bot, sendNotification, deleteCard, createTopic, closeTopic, reopenTopic };
