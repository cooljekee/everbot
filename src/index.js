require('dotenv').config();
const express = require('express');
const { bot } = require('./bot');
const webhookRouter = require('./webhook');
const avito = require('./avito');
const { startPolling } = require('./poller');

const app = express();
app.use(express.json());
app.use('/webhook', webhookRouter);

// Healthcheck
app.get('/', (req, res) => res.json({ status: 'ok', name: 'EverBot' }));

const PORT = process.env.PORT || 3000;

async function start() {
  // Запускаем Telegram бот в long-polling режиме
  bot.launch();
  console.log('✅ Telegram бот запущен');

  // Регистрируем webhook на Авито (если указан URL)
  if (process.env.WEBHOOK_URL) {
    try {
      await avito.subscribeWebhook(process.env.WEBHOOK_URL);
      console.log('✅ Авито webhook зарегистрирован:', process.env.WEBHOOK_URL);
    } catch (err) {
      console.warn('⚠️  Не удалось зарегистрировать Авито webhook:', err.message);
    }
  }

  // Polling как резервный механизм
  startPolling();

  app.listen(PORT, () => {
    console.log(`✅ Сервер запущен на порту ${PORT}`);
  });
}

start().catch(console.error);

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
