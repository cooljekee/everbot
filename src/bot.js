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

async function sendNotification(text, photoUrl = null, replyMarkup = null) {
  const markup = replyMarkup ? { reply_markup: replyMarkup } : {};
  try {
    if (photoUrl) {
      await bot.telegram.sendPhoto(CHAT_ID, photoUrl, {
        caption: text,
        parse_mode: 'MarkdownV2',
        ...markup,
      });
    } else {
      await bot.telegram.sendMessage(CHAT_ID, text, {
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: false,
        ...markup,
      });
    }
  } catch (err) {
    console.error('Ошибка отправки в Telegram:', err.message);
    // Повторная попытка без markdown если ошибка парсинга
    if (err.message.includes('parse')) {
      await bot.telegram.sendMessage(CHAT_ID, text.replace(/[*_`[\]]/g, ''), {
        disable_web_page_preview: false,
        ...markup,
      });
    }
  }
}

module.exports = { bot, sendNotification };
