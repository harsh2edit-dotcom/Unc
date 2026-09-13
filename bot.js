require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ============ CONFIG ============
const BOT_TOKEN = process.env.BOT_TOKEN || '8639978539:AAE3rkrUMELtU74Gn7XidLbz_z1lIp_vBX8';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '8969622561';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'xyven_admin_2024';
const UPI_ID = process.env.UPI_ID || 'harshsinghs@fam';
const CHANNEL = 'https://t.me/XyvenUCstore';
const MIN_DEPOSIT = 200;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ============ STORAGE ============
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const DEPOSITS_FILE = path.join(DATA_DIR, 'deposits.json');
const COUPON_FILE = path.join(DATA_DIR, 'coupon_usage.json');

const readJSON = (f, d = {}) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJSON = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

// ============ SESSIONS ============
const sessions = {};
const getSession = (id) => sessions[id] || (sessions[id] = { state: 'idle', data: {} });
const clearSession = (id) => { sessions[id] = { state: 'idle', data: {} }; };

// ============ PLANS ============
const PLANS = [
  { uc: 349,  price: 99   },
  { uc: 749,  price: 209  },
  { uc: 1499, price: 399  },
  { uc: 2999, price: 749  },
  { uc: 5000, price: 1199 },
];

// ============ COUPONS ============
const COUPONS = {
  'XYVEN500':  { value: 500,  maxUses: 10 },
  'XYVEN1000': { value: 1000, maxUses: 10 },
  'VIP200':    { value: 200,  maxUses: 10 },
  'TEAM100':   { value: 100,  maxUses: 10 },
};

// ============ HELPERS ============
const isAdmin = (chatId) => String(chatId) === String(ADMIN_CHAT_ID);

function ensureUser(chatId, username) {
  const users = readJSON(USERS_FILE, {});
  if (!users[chatId]) {
    users[chatId] = { username: username || 'User', balance: 0, createdAt: new Date().toISOString() };
    writeJSON(USERS_FILE, users);
  } else if (username && users[chatId].username !== username) {
    users[chatId].username = username;
    writeJSON(USERS_FILE, users);
  }
  return users[chatId];
}

function updateBalance(chatId, delta) {
  const users = readJSON(USERS_FILE, {});
  if (!users[chatId]) return 0;
  users[chatId].balance = Math.max(0, (users[chatId].balance || 0) + delta);
  writeJSON(USERS_FILE, users);
  return users[chatId].balance;
}

function genId(prefix) {
  return prefix + '-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5).toUpperCase();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============ LOADING HELPER ============
async function showLoading(chatId, msgId, text) {
  try {
    await bot.editMessageText(
      `✦ ━━━━━━━━━━━━━━━━━━━ ✦\n` +
      `   ⏳ LOADING...\n` +
      `✦ ━━━━━━━━━━━━━━━━━━━ ✦\n\n` +
      `⟡ ${text} ⟡\n\n` +
      `▓▓▓▓▓▓▓▓░░░░░░░░`,
      { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } }
    );
    await sleep(600);
  } catch (e) {}
}

// ============ KEYBOARDS (COLORFUL) ============
const mainMenu = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '🟢 ◈ BUY UC ◈', callback_data: 'buy_uc' }],
      [{ text: '🔵 ✦ DEPOSIT ✦', callback_data: 'deposit' }, { text: '🟡 ⚝ COUPON ⚝', callback_data: 'coupon' }],
      [{ text: '🟣 ⟡ MY ORDERS ⟡', callback_data: 'my_orders' }],
      [{ text: '🔴 𖤐 JOIN CHANNEL 𖤐', url: CHANNEL }]
    ]
  }
};

const backMenu = {
  reply_markup: {
    inline_keyboard: [[{ text: '🟠 ⟣ BACK ⟢', callback_data: 'main_menu' }]]
  }
};

// ============ TEXT TEMPLATES ============
function mainMenuText(user) {
  return `✦ ━━━━━━━━━━━━━━━━━━━ ✦\n` +
    `   𖤐 XYVEN UC STORE 𖤐\n` +
    `✦ ━━━━━━━━━━━━━━━━━━━ ✦\n\n` +
    `𓆩♡𓆪 Welcome, <b>${user.username}</b>\n\n` +
    `🟢 Wallet: <b>₹${user.balance}</b>\n` +
    `🔵 Status: <b>Active</b>\n\n` +
    `⟡ Select an option below ⟡`;
}

// ============ COMMANDS ============
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  clearSession(chatId);
  const user = ensureUser(chatId, msg.from.first_name || msg.from.username);
  bot.sendMessage(chatId, mainMenuText(user), { parse_mode: 'HTML', ...mainMenu });
});

bot.onText(/\/menu/, (msg) => {
  const chatId = msg.chat.id;
  clearSession(chatId);
  const user = ensureUser(chatId, msg.from.first_name || msg.from.username);
  bot.sendMessage(chatId, mainMenuText(user), { parse_mode: 'HTML', ...mainMenu });
});

bot.onText(/\/admin/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return bot.sendMessage(chatId, '❌ Unauthorized.');
  const s = getSession(chatId);
  s.state = 'awaiting_admin_password';
  bot.sendMessage(chatId, `✦ ━━━━━━━━━━━━━━━━━━━ ✦\n   🔐 ADMIN LOGIN\n✦ ━━━━━━━━━━━━━━━━━━━ ✦\n\n⟡ Enter admin password ⟡`);
});

// ============ CALLBACK HANDLER ============
bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  const msgId = q.message.message_id;
  const data = q.data;
  const user = ensureUser(chatId, q.from.first_name || q.from.username);

  bot.answerCallbackQuery(q.id);

  // ============ MAIN MENU ============
  if (data === 'main_menu') {
    clearSession(chatId);
    await showLoading(chatId, msgId, 'Returning to menu');
    bot.editMessageText(mainMenuText(user), { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', ...mainMenu });
    return;
  }

  // ============ BUY UC ============
  if (data === 'buy_uc') {
    const s = getSession(chatId);
    s.state = 'selecting_plan';
    await showLoading(chatId, msgId, 'Loading plans');
    const kb = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🟢 ◈ 349 UC ⟡ ₹99', callback_data: 'plan_0' }],
          [{ text: '🔵 ◈ 749 UC ⟡ ₹209', callback_data: 'plan_1' }],
          [{ text: '🟡 ◈ 1,499 UC ⟡ ₹399', callback_data: 'plan_2' }],
          [{ text: '🟣 ◈ 2,999 UC ⟡ ₹749', callback_data: 'plan_3' }],
          [{ text: '🔴 ◈ 5,000 UC ⟡ ₹1,199', callback_data: 'plan_4' }],
          [{ text: '🟠 ⟣ BACK ⟢', callback_data: 'main_menu' }]
        ]
      }
    };
    bot.editMessageText(
      `✦ ━━━━━━━━━━━━━━━━━━━ ✦\n   ◈ CHOOSE YOUR PLAN ◈\n✦ ━━━━━━━━━━━━━━━━━━━ ✦\n\n⟡ Tap a plan to continue ⟡`,
      { chat_id: chatId, message_id: msgId, ...kb }
    );
    return;
  }

  // ============ PLAN SELECTED ============
  if (data.startsWith('plan_')) {
    const idx = parseInt(data.split('_')[1]);
    const plan = PLANS[idx];
    const s = getSession(chatId);

    await showLoading(chatId, msgId, `Checking balance for ${plan.uc} UC`);
    const fresh = ensureUser(chatId, q.from.first_name || q.from.username);

    if (fresh.balance < plan.price) {
      const short = plan.price - fresh.balance;
      bot.editMessageText(
        `✦ ━━━━━━━━━━━━━━━━━━━ ✦\n   ⚠ INSUFFICIENT BALANCE\n✦ ━━━━━━━━━━━━━━━━━━━ ✦\n\n` +
        `🔵 Plan: <b>${plan.uc} UC</b> (₹${plan.price})\n` +
        `🟢 Balance: <b>₹${fresh.balance}</b>\n` +
        `🔴 Need: <b>₹${short} more</b>\n\n` +
        `⟡ Please deposit first ⟡`,
        {
          chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [
            [{ text: '🔵 ✦ DEPOSIT NOW ✦', callback_data: 'deposit' }],
            [{ text: '🟠 ⟣ BACK ⟢', callback_data: 'buy_uc' }]
          ]}
        }
      );
      return;
    }

    s.state = 'awaiting_uid';
    s.data.plan = plan;
    bot.editMessageText(
      `✦ ━━━━━━━━━━━━━━━━━━━ ✦\n   ◈ ENTER DETAILS ◈\n✦ ━━━━━━━━━━━━━━━━━━━ ✦\n\n` +
      `🟢 Plan: <b>${plan.uc} UC</b> (₹${plan.price})\n\n` +
      `⟡ Send your BGMI UID (8-12 digits) ⟡`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '🟠 ⟣ CANCEL ⟢', callback_data: 'main_menu' }]] } }
    );
    return;
  }

  // ============ DEPOSIT ============
  if (data === 'deposit') {
    const s = getSession(chatId);
    s.state = 'awaiting_deposit_amount';
    await showLoading(chatId, msgId, 'Opening deposit');
    bot.editMessageText(
      `✦ ━━━━━━━━━━━━━━━━━━━ ✦\n   ◈ DEPOSIT FUNDS ◈\n✦ ━━━━━━━━━━━━━━━━━━━ ✦\n\n` +
      `🟢 Minimum: <b>₹${MIN_DEPOSIT}</b>\n` +
      `🟡 UPI: <code>${UPI_ID}</code>\n\n` +
      `⟡ Enter amount to deposit ⟡`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '🟠 ⟣ BACK ⟢', callback_data: 'main_menu' }]] } }
    );
    return;
  }

  // ============ COUPON ============
  if (data === 'coupon') {
    const s = getSession(chatId);
    s.state = 'awaiting_coupon';
    await showLoading(chatId, msgId, 'Opening coupon');
    bot.editMessageText(
      `✦ ━━━━━━━━━━━━━━━━━━━ ✦\n   ◈ CLAIM COUPON ◈\n✦ ━━━━━━━━━━━━━━━━━━━ ✦\n\n` +
      `🟡 Enter your exclusive coupon code\n\n` +
      `⟡ Type the code and send ⟡`,
      { chat_id: chatId, message_id: msgId, parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '🟠 ⟣ BACK ⟢', callback_data: 'main_menu' }]] } }
    );
    return;
  }

  // ============ MY ORDERS ============
  if (data === 'my_orders') {
    await showLoading(chatId, msgId, 'Fetching your activity');
    const orders = readJSON(ORDERS_FILE, []).filter(o => String(o.chatId) === String(chatId)).reverse();
    const deps = readJSON(DEPOSITS_FILE, []).filter(d => String(d.chatId) === String(chatId)).reverse();
    const fresh = ensureUser(chatId, q.from.first_name || q.from.username);

    let txt = `✦ ━━━━━━━━━━━━━━━━━━━ ✦\n   ◈ MY ACTIVITY ◈\n✦ ━━━━━━━━━━━━━━━━━━━ ✦\n\n`;
    txt += `🟢 Balance: <b>₹${fresh.balance}</b>\n\n`;

    if (orders.length === 0 && deps.length === 0) {
      txt += `⟡ No orders or deposits yet ⟡`;
    } else {
      if (orders.length) {
        txt += `🟣 <b>ORDERS</b>\n`;
        orders.slice(0, 5).forEach(o => {
          const ic = o.status === 'approved' ? '🟢' : o.status === 'rejected' ? '🔴' : '🟡';
          txt += `${ic} #${o.orderId} · ${o.plan.uc} UC · ₹${o.plan.price} · ${o.status.toUpperCase()}\n`;
        });
        txt += `\n`;
      }
      if (deps.length) {
        txt += `🔵 <b>DEPOSITS</b>\n`;
        deps.slice(0, 5).forEach(d => {
          const ic = d.status === 'approved' ? '🟢' : d.status === 'rejected' ? '🔴' : '🟡';
          txt += `${ic} ₹${d.amount} · UTR: ${d.utr.slice(0, 8)}... · ${d.status.toUpperCase()}\n`;
        });
      }
    }

    bot.editMessageText(txt, { chat_id: chatId, message_id: msgId, parse_mode: 'HTML', ...backMenu });
    return;
  }

  // ============ ADMIN CALLBACKS ============
  if (data.startsWith('adm_')) {
    if (!isAdmin(chatId)) return;
    const parts = data.split('_');
    const action = parts[1];
    const id = parts.slice(2).join('_');

    await showLoading(chatId, msgId, 'Processing');

    if (action === 'approve_order') {
      const orders = readJSON(ORDERS_FILE, []);
      const o = orders.find(x => x.orderId === id);
      if (o) { o.status = 'approved'; writeJSON(ORDERS_FILE, orders); }
      bot.editMessageText(`🟢 ✅ Order ${id} APPROVED`, { chat_id: chatId, message_id: msgId });
      if (o) bot.sendMessage(o.chatId,
        `✦ ━━━━━━━━━━━━━━━━━━━ ✦\n   🟢 ORDER APPROVED\n✦ ━━━━━━━━━━━━━━━━━━━ ✦\n\n` +
        `◈ Order: #${id}\n◈ Plan: ${o.plan.uc} UC\n\n⟡ UC will be delivered shortly ⟡`);
      return;
    }

    if (action === 'reject_order') {
      const orders = readJSON(ORDERS_FILE, []);
      const o = orders.find(x => x.orderId === id);
      if (o && o.status !== 'rejected') {
        updateBalance(o.chatId, o.plan.price);
        o.status = 'rejected';
        writeJSON(ORDERS_FILE, orders);
      }
      bot.editMessageText(`🔴 ❌ Order ${id} REJECTED + ₹${o?.plan.price} refunded`, { chat_id: chatId, message_id: msgId });
      if (o) bot.sendMessage(o.chatId,
        `✦ ━━━━━━━━━━━━━━━━━━━ ✦\n   🔴 ORDER REJECTED\n✦ ━━━━━━━━━━━━━━━━━━━ ✦\n\n` +
        `◈ Order: #${id}\n◈ Refund: ₹${o.plan.price}\n\n⟡ Amount credited back ⟡`);
      return;
    }

    if (action === 'approve_dep') {
      const deps = readJSON(DEPOSITS_FILE, []);
      const d = deps.find(x => x.id === id);
      if (d && d.status !== 'approved') {
        updateBalance(d.chatId, d.amount);
        d.status = 'approved';
        writeJSON(DEPOSITS_FILE, deps);
      }
      bot.editMessageText(`🟢 ✅ Deposit ${id} APPROVED + ₹${d?.amount} credited`, { chat_id: chatId, message_id: msgId });
      if (d) bot.sendMessage(d.chatId,
        `✦ ━━━━━━━━━━━━━━━━━━━ ✦\n   🟢 DEPOSIT APPROVED\n✦ ━━━━━━━━━━━━━━━━━━━ ✦\n\n` +
        `◈ Amount: ₹${d.amount}\n\n⟡ Balance credited ⟡`);
      return;
    }

    if (action === 'reject_dep') {
      const deps = readJSON(DEPOSITS_FILE, []);
      const d = deps.find(x => x.id === id);
      if (d) { d.status = 'rejected'; writeJSON(DEPOSITS_FILE, deps); }
      bot.editMessageText(`🔴 ❌ Deposit ${id} REJECTED`, { chat_id: chatId, message_id: msgId });
      if (d) bot.sendMessage(d.chatId,
        `✦ ━━━━━━━━━━━━━━━━━━━ ✦\n   🔴 DEPOSIT REJECTED\n✦ ━━━━━━━━━━━━━━━━━━━ ✦\n\n` +
        `◈ Amount: ₹${d.amount}\n\n⟡ Contact support ⟡`);
      return;
    }
  }
});

// ============ TEXT MESSAGE HANDLER (STATE MACHINE) ============
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith('/')) return;

  const s = getSession(chatId);
  const user = ensureUser(chatId, msg.from.first_name || msg.from.username);

  // ADMIN LOGIN
  if (s.state === 'awaiting_admin_password') {
    if (text === ADMIN_PASSWORD) {
      s.state = 'admin';
      bot.sendMessage(chatId,
        `✦ ━━━━━━━━━━━━━━━━━━━ ✦\n   𖤐 ADMIN PANEL 𖤐\n✦ ━━━━━━━━━━━━━━━━━━━ ✦\n\n` +
        `🟢 /pending — Pending orders\n` +
        `🔵 /pendingdep — Pending deposits\n` +
        `🟣 /users — Users list\n` +
        `🔴 /exit — Exit admin`);
    } else {
      bot.sendMessage(chatId, '🔴 ❌ Wrong password.');
      clearSession(chatId);
    }
    return;
  }

  // ADMIN COMMANDS
  if (s.state === 'admin') {
    if            (text === '/ {exit') { clearSession(chatId text); bot.sendMessage(chat:Id, '🟠 ⟣ Exited ' admin mode'); return; }
    if🟢 (text === '/pending') { sendPendingOrders(chatId); return; }
    if (text === '/pendingdep') { sendPendingDeposits(chatId); return; }
    if (text === '/users') { sendUsersList(chatId); return; }
    return;
  }

  // BGMI UID
  if (s.state === 'awaiting_uid') {
    if (!/^\d{8,12}$/.test(text.trim())) {
      bot.sendMessage(chatId, '🔴 ❌ Invalid UID. Send 8-12 digits.');
      return;
    }
    s.data.uid = text.trim();
    s.state = 'awaiting_gmail';
    bot.sendMessage(chatId, `✦ 🟢 UID Saved\n\n📧 Send your Gmail address:`);
    return;
  }

  // GMAIL
  if (s.state === 'awaiting_gmail') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim())) {
      bot.sendMessage(chatId, '🔴 ❌ Invalid email. Try again.');
      return;
    }
    s.data.gmail = text.trim();
    s.state = 'awaiting_wp';
    bot.sendMessage(chatId, `✦ 🟢 Gmail Saved\n\n📱 Send your 10-digit WhatsApp number:`);
    return;
  }

  // WHATSAPP
  if (s.state === 'awaiting_wp') {
    if (!/^\d{10}$/.test(text.trim())) {
      bot.sendMessage(chatId, '🔴 ❌ Invalid number. Send 10 digits.');
      return;
    }
    s.data.wp = text.trim();

    // Send loading
    const loadingMsg = await bot.sendMessage(chatId,
      `✦ ━━━━━━━━━━━━━━━━━━━ ✦\n   ⏳ PLACING ORDER...\n✦ ━━━━━━━━━━━━━━━━━━━ ✦\n\n▓▓▓▓▓▓▓▓░░░░░░░░`
    );

    await sleep(800);

    const orderId = genId('XYV');
    const order = {
      orderId, chatId, username: user.username,
      plan: s.data.plan, uid: s.data.uid,
      gmail: s.data.gmail, wp: s.data.wp,
      status: 'pending', createdAt: new Date().toISOString()
    };
    const orders = readJSON(ORDERS_FILE, []);
    orders.push(order);
    writeJSON(ORDERS_FILE, orders);

    const newBal = updateBalance(chatId, -s.data.plan.price);

    // Delete loading, send result
    bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
    bot.sendMessage(chatId,
      `✦ ━━━━━━━━━━━━━━━━━━━ ✦\n   🟢 ✅ ORDER PLACED\n✦ ━━━━━━━━━━━━━━━━━━━ ✦\n\n` +
      `🟢 Order ID: <b>#${orderId}</b>\n` +
      `🔵 Plan: <b>${s.data.plan.uc} UC</b> (₹${s.data.plan.price})\n` +
      `🟡 UID: <code>${s.data.uid}</code>\n` +
      `🟣 Gmail: <code>${s.data.gmail}</code>\n` +
      `🔴 WP: <code>${s.data.wp}</code>\n\n` +
      `◈ New Balance: <b>₹${newBal}</b>\n\n` +
      `🟡 ⏳ Status: <b>PENDING</b>`,
      { parse_mode: 'HTML', ...mainMenu }
    );

    // Notify admin
    bot.sendMessage(ADMIN_CHAT_ID,
      `🎮 <b>NEW ORDER</b>\n\n` +
      `◈ User: <b>${user.username}</b>\n` +
      `◈ Order: <b>#${orderId}</b>\n` +
      `◈ Plan: ${s.data.plan.uc} UC (₹${s.data.plan.price})\n` +
      `◈ UID: <code>${s.data.uid}</code>\n` +
      `◈ Gmail: <code>${s.data.gmail}</code>\n` +
      `◈ WP: <code>${s.data.wp}</code>`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
 ✅ APPROVE', callback_data: `adm_approve_order_${orderId}` },
            { text: '🔴 ❌ REJECT', callback_data: `adm_reject_order_${orderId}` }
          ]]
        }
      }
    );

    clearSession(chatId);
    return;
  }

  // DEPOSIT AMOUNT
  if (s.state === 'awaiting_deposit_amount') {
    const amt = parseInt(text.trim(), 10);
    if (!amt || amt < MIN_DEPOSIT) {
      bot.sendMessage(chatId, `🔴 ❌ Minimum ₹${MIN_DEPOSIT}. Try again.`);
      return;
    }
    s.data.amount = amt;
    s.state = 'awaiting_utr';
    bot.sendMessage(chatId,
      `✦ ━━━━━━━━━━━━━━━━━━━ ✦\n   ◈ PAYMENT DETAILS ◈\n✦ ━━━━━━━━━━━━━━━━━━━ ✦\n\n` +
      `🟢 Amount: <b>₹${amt}</b>\n` +
      `🔵 UPI: <code>${UPI_ID}</code>\n\n` +
      `⟡ Pay to above UPI and send UTR / Transaction ID ⟡`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  // UTR
  if (s.state === 'awaiting_utr') {
    if (text.trim().length < 8) {
      bot.sendMessage(chatId, '🔴 ❌ UTR too short. Min 8 chars.');
      return;
    }
    const loadingMsg = await bot.sendMessage(chatId,
      `✦ ━━━━━━━━━━━━━━━━━━━ ✦\n   ⏳ SUBMITTING...\n✦ ━━━━━━━━━━━━━━━━━━━ ✦\n\n▓▓▓▓▓▓▓▓░░░░░░░░`
    );
    await sleep(800);

    const depId = genId('DEP');
    const dep = {
      id: depId, chatId, username: user.username,
      amount: s.data.amount, upi: UPI_ID,
      utr: text.trim().toUpperCase(),
      status: 'pending', createdAt: new Date().toISOString()
    };
    const deps = readJSON(DEPOSITS_FILE, []);
    deps.push(dep);
    writeJSON(DEPOSITS_FILE, deps);

    bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
    bot.sendMessage(chatId,
      `✦ ━━━━━━━━━━━━━━━━━━━ ✦\n   🟢 ✅ SUBMITTED\n✦ ━━━━━━━━━━━━━━━━━━━ ✦\n\n` +
      `🟢 Deposit ID: <b>#${depId}</b>\n` +
      `🔵 Amount: <b>₹${s.data.amount}</b>\n` +
      `🟡 UTR: <code>${dep.utr}</code>\n\n` +
      `🟡 ⏳ Status: <b>PENDING VERIFICATION</b>\n\n` +
      `⟡ Admin will verify shortly ⟡`,
      { parse_mode: 'HTML', ...mainMenu }
    );

    bot.sendMessage(ADMIN_CHAT_ID,
      `💰 <b>NEW DEPOSIT</b>\n\n` +
      `◈ User: <b>${user.username}</b>\n` +
      `◈ Deposit: <b>#${depId}</b>\n` +
      `◈ Amount: <b>₹${s.data.amount}</b>\n` +
      `◈ UTR: <code>${dep.utr}</code>\n` +
      `◈ UPI: <code>${UPI_ID}</code>`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '🟢 ✅ APPROVE', callback_data: `adm_approve_dep_${depId}` },
            { text: '🔴 ❌ REJECT', callback_data: `adm_reject_dep_${depId}` }
          ]]
        }
      }
    );

    clearSession(chatId);
    return;
  }

  // COUPON
  if (s.state === 'awaiting_coupon') {
    const code = text.trim().toUpperCase();
    if (!COUPONS[code]) {
      bot.sendMessage(chatId, '🔴 ❌ Invalid coupon code.', mainMenu);
      clearSession(chatId);
      return;
    }
    const usage = readJSON(COUPON_FILE, {});
    const used = usage[code] || 0;
    if (used >= COUPONS[code].maxUses) {
      bot.sendMessage(chatId, '🔴 ❌ Coupon usage limit reached.', mainMenu);
      clearSession(chatId);
      return;
    }
    usage[code] = used + 1;
    writeJSON(COUPON_FILE, usage);

    const value = COUPONS[code].value;
    const newBal = updateBalance(_mchatId, value);

    bot.sendMessage(chatId,
      `✦ ━━━━━━━━━━━━━━━━━━━ ✦\n   🎉 COUPON APPLIED\n✦ ━━━━━━━━━━━━━━━━━━━ ✦\n\n` +
      `🟢 Added: <b>₹${value}</b>\n` +
      `🔵 New Balance: <b>₹${newBal}</b>\n\n` +
      `⟡ Enjoy your purchase ⟡`,
      { parse_mode: 'HTML', ...mainMenu }
    );
    clearSession(chatId);
    return;
  }
});

// ============ ADMIN HELPERS ============
function sendPendingOrders(chatId) {
  const orders = readJSON(ORDERS_FILE, []).filter(o => o.status === 'pending');
  if (orders.length === 0) return bot.sendMessage(chatId, '⟡ No pending orders ⟡');
  orders.forEach(o => {
    bot.sendMessage(chatId,
      `🎮 <b>PENDING ORDER</b>\n\n◈ User: ${o.username}\n◈ Order: #${o.orderId}\n◈ Plan: ${o.plan.uc} UC (₹${o.plan.price})\n◈ UID: <code>${o.uid}</code>\n◈ Gmail: <code>${o.gmail}</code>\n◈ WP: <code>${o.wp}</code>`,
      {
        parse_mode: 'HTML',
        replyarkup: {
          inline_keyboard: [[
            { text: '🟢 ✅ APPROVE', callback_data: `adm_approve_order_${o.orderId}` },
            { text: '🔴 ❌ REJECT', callback_data: `adm_reject_order_${o.orderId}` }
          ]]
        }
      }
    );
  });
}

function sendPendingDeposits(chatId) {
  const deps = readJSON(DEPOSITS_FILE, []).filter(d => d.status === 'pending');
  if (deps.length === 0) return bot.sendMessage(chatId, '⟡ No pending deposits ⟡');
  deps.forEach(d => {
    bot.sendMessage(chatId,
      `💰 <b>PENDING DEPOSIT</b>\n\n◈ User: ${d.username}\n◈ ID: #${d.id}\n◈ Amount: ₹${d.amount}\n◈ UTR: <code>${d.utr}</code>`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '🟢 ✅ APPROVE', callback_data: `adm_approve_dep_${d.id}` },
            { text: '🔴 ❌ REJECT', callback_data: `adm_reject_dep_${d.id}` }
          ]]
        }
      }
    );
  });
}

function sendUsersList(chatId) {
  const users = readJSON(USERS_FILE, {});
  const list = Object.entries(users);
  if (list.length === 0) return bot.sendMessage(chatId, '⟡ No users yet ⟡');
  let txt = `✦ ━━━━━━━━━━━━━━━━━━━ ✦\n   ◈ USERS (${list.length}) ◈\n✦ ━━━━━━━━━━━━━━━━━━━ ✦\n\n`;
  list.slice(0, 30).forEach(([id, u]) => {
    txt += `🟢 ${u.username} · ₹${u.balance}\n`;
  });
  bot.sendMessage(chatId, txt, { parse_mode: 'HTML' });
}

// ============ KEEP-ALIVE SERVER ============
const app = express();
app.get('/', (req, res) => res.send('XYVEN UC Bot running 𖤐'));
app.get('/healthz', (req, res) => res.status(200).send('OK'));
app.listen(process.env.PORT || 3000, () => console.log('✅ Keep-alive server started on port', process.env.PORT || 3000));

console.log('🤖 XYVEN UC Bot started 𖤐');
