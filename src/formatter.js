// Форматирует уведомление о новом сообщении с Авито
function formatAvitoNotification(chat, messages, item) {
  const lastMessages = messages.slice(0, 5).reverse();
  const buyerName = chat.users?.find(u => u.id !== Number(process.env.AVITO_USER_ID))?.name || 'Покупатель';
  const itemTitle = item?.title || chat.context?.value?.title || 'Товар';
  const itemPrice = item?.price ? `${item.price.toLocaleString('ru-RU')} ₽` : '';
  const itemUrl = item?.id ? `https://avito.ru/${item.id}` : '';

  const lines = [
    `🛍 *Новое сообщение с Авито*`,
    ``,
    `👤 *Покупатель:* ${escapeMarkdown(buyerName)}`,
    `📦 *Товар:* ${escapeMarkdown(itemTitle)}${itemPrice ? ` — ${itemPrice}` : ''}`,
    itemUrl ? `🔗 [Открыть объявление](${itemUrl})` : '',
    ``,
    `💬 *Последние сообщения:*`,
    ...lastMessages.map(msg => formatMessage(msg, process.env.AVITO_USER_ID)),
    ``,
    `↩️ Чтобы ответить, напиши: \`/reply ${chat.id} текст ответа\``,
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
