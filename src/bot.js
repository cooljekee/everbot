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

async function sendNotification(text, photo = null, replyMarkup = null) {
  const markup = replyMarkup ? { reply_markup: replyMarkup } : {};
  try {
    if (photo) {
      const media = Buffer.isBuffer(photo) ? { source: photo } : photo;
      await bot.telegram.sendPhoto(CHAT_ID, media, {
        caption: text,
        parse_mode: 'MarkdownV2',
        ...markup,
      });
    } else {
      await bot.telegram.sendMessage(CHAT_ID, text, {
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
        ...markup,
      });
    }
  } catch (err) {
    console.error('Ошибка отправки в Telegram:', err.message);
    // Фолбэк: фото не ушло или битая разметка — шлём текстом, чтобы
    // уведомление не потерялось.
    const parseErr = err.message.includes('parse');
    try {
      await bot.telegram.sendMessage(CHAT_ID, parseErr ? text.replace(/[*_`[\]]/g, '') : text, {
        ...(parseErr ? {} : { parse_mode: 'MarkdownV2' }),
        disable_web_page_preview: true,
        ...markup,
      });
    } catch (err2) {
      console.error('Повторная отправка тоже упала:', err2.message);
    }
  }
}

module.exports = { bot, sendNotification };
