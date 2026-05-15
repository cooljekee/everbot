const axios = require('axios');

const BASE_URL = 'https://api.avito.ru';
let accessToken = null;
let tokenExpiresAt = 0;

async function getToken() {
  if (accessToken && Date.now() < tokenExpiresAt) return accessToken;

  const res = await axios.post(`${BASE_URL}/token`, null, {
    params: {
      client_id: process.env.AVITO_CLIENT_ID,
      client_secret: process.env.AVITO_CLIENT_SECRET,
      grant_type: 'client_credentials',
    },
  });

  accessToken = res.data.access_token;
  tokenExpiresAt = Date.now() + (res.data.expires_in - 60) * 1000;
  return accessToken;
}

function api() {
  return axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

async function getChatMessages(chatId, limit = 5) {
  await getToken();
  const userId = process.env.AVITO_USER_ID;
  const res = await api().get(
    `/messenger/v3/accounts/${userId}/chats/${chatId}/messages/`,
    { params: { limit } }
  );
  return res.data.messages || [];
}

async function getChat(chatId) {
  await getToken();
  const userId = process.env.AVITO_USER_ID;
  const res = await api().get(
    `/messenger/v3/accounts/${userId}/chats/${chatId}/`
  );
  return res.data;
}

async function getItemInfo(itemId) {
  await getToken();
  const userId = process.env.AVITO_USER_ID;
  const res = await api().get(
    `/core/v1/accounts/${userId}/items/${itemId}/`
  );
  return res.data;
}

async function getChats(limit = 10) {
  await getToken();
  const userId = process.env.AVITO_USER_ID;
  const res = await api().get(
    `/messenger/v2/accounts/${userId}/chats/`,
    { params: { limit } }
  );
  return res.data.chats || [];
}

async function sendMessage(chatId, text) {
  await getToken();
  const userId = process.env.AVITO_USER_ID;
  await api().post(
    `/messenger/v3/accounts/${userId}/chats/${chatId}/messages/`,
    { message: { text }, type: 'text' }
  );
}

async function subscribeWebhook(webhookUrl) {
  await getToken();
  const res = await api().post('/messenger/v3/webhook', {
    url: webhookUrl,
  });
  return res.data;
}

module.exports = { getChatMessages, getChat, getChats, getItemInfo, sendMessage, subscribeWebhook };
