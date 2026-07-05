// Форматирует уведомление о новом сообщении с Авито
function formatAvitoNotification(chat, messages, item) {
  const lastMessages = messages.slice(0, 5).reverse();
  const buyerName = chat.users?.find(u => u.id !== Number(process.env.AVITO_USER_ID))?.name || 'Покупатель';
  const itemTitle = item?.title || chat.context?.value?.title || 'Товар';
  const itemPrice = item?.price ? `${item.price.toLocaleString('ru-RU')} ₽` : '';
  const itemUrl = item?.id ? `https://avito.ru/${item.id}` : '';

  // Без подписки на messenger-API Авито отдаёт вместо текста заглушку —
  // отбрасываем такие «сообщения», чтобы не показывать мусор.
  const msgLines = lastMessages
    .filter(msg => !(msg.content?.text || '').includes('Перейдите на подписку'))
    .map(msg => formatMessage(msg, process.env.AVITO_USER_ID));

  const lines = [
    `🛍 *Новое сообщение с Авито*`,
    ``,
    `👤 *Покупатель:* ${escapeMarkdown(buyerName)}`,
    `📦 *Товар:* ${escapeMarkdown(itemTitle)}${itemPrice ? ` — ${itemPrice}` : ''}`,
    itemUrl ? `🔗 [Открыть объявление](${itemUrl})` : '',
    ...(msgLines.length ? ['', `💬 *Последние сообщения:*`, ...msgLines] : []),
  ];

  return lines.filter(l => l !== '').join('\n');
}

function formatMessage(msg, myUserId) {
  const isMe = String(msg.author_id) === String(myUserId);
  const author = isMe ? '🏪 Магазин' : '👤 Клиент';
  const text = msg.content?.text || '[изображение]';
  const time = msg.created ? new Date(msg.created * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
  return `${author} ${time}: ${escapeMarkdown(text)}`;
}

function escapeMarkdown(text) {
  if (!text) return '';
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

module.exports = { formatAvitoNotification };
