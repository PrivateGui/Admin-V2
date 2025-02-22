const TelegramBot = require('node-telegram-bot-api');

// Bot token (no dotenv)
const token = '7397893630:AAH3DSRm-rXUyq1JfkEfA_0_GApeZiXi8UQ';

// Create bot instance
const bot = new TelegramBot(token, { polling: true });

// Store chat IDs for broadcasts
const broadcastTargets = new Set();

// Admin username
const ADMIN_USERNAME = 'zonercm';

// Track user state for admin
const userState = {
  waitingForGlobalMessage: false,
  waitingForImage: false,
  waitingForImageCaption: false,
  waitingForAudio: false,
  lastBotMessageId: null,
  lastChatId: null,
  tempImageFileId: null
};

// Persian strings with formatting
const strings = {
  panelTitle: '🔰 *به پنل مدیریت خوش آمدید*\n\n📌 یک گزینه را از پایین انتخاب کنید:',
  sendGlobalMessage: '📢 ارسال پیام سراسری',
  sendGlobalImage: '🖼 ارسال تصویر سراسری',
  sendGlobalImageCaption: '🖼 ارسال تصویر با کپشن سراسری',
  sendGlobalAudio: '🎵 ارسال فایل صوتی سراسری',
  back: '⬅️ بازگشت',
  enterMessage: '✏️ *لطفا پیام خود را برای ارسال سراسری وارد کنید:*',
  sendImage: '🖼 *لطفا تصویر خود را برای ارسال سراسری ارسال کنید:*',
  sendImageCaption: '✏️ *لطفا کپشن تصویر را وارد کنید:*',
  sendAudio: '🎵 *لطفا فایل صوتی خود را برای ارسال سراسری ارسال کنید:*',
  messageSent: '✅ *موفق* | پیام شما با موفقیت ارسال شد به',
  sending: '🔄 *در حال ارسال...*'
};

// Initialize: Get all existing chats
async function initializeBroadcastTargets() {
  try {
    const updates = await bot.getUpdates(0, 100, -1);
    if (updates && updates.length) {
      updates.forEach(update => {
        if (update.message?.chat?.type === 'group' || 
            update.message?.chat?.type === 'supergroup' || 
            update.message?.chat?.type === 'channel') {
          broadcastTargets.add(update.message.chat.id);
          console.log(`🟢 Added ${update.message.chat.title} (${update.message.chat.id})`);
        }
      });
      console.log(`📋 Initial broadcast list count: ${broadcastTargets.size}`);
    }
  } catch (error) {
    console.error('❌ Initialization error:', error);
  }
}

// Track chat membership changes
bot.on('my_chat_member', (msg) => {
  if (!msg?.chat) return;
  
  const chatId = msg.chat.id;
  const newStatus = msg.new_chat_member?.status;
  
  if (msg.chat.type === 'group' || msg.chat.type === 'supergroup' || msg.chat.type === 'channel') {
    if (newStatus === 'member' || newStatus === 'administrator') {
      broadcastTargets.add(chatId);
      console.log(`🟢 Added ${msg.chat.title} (${chatId})`);
    } else if (newStatus === 'kicked' || newStatus === 'left') {
      broadcastTargets.delete(chatId);
      console.log(`🔴 Removed ${msg.chat.title} (${chatId})`);
    }
  }
});

// Create admin panel keyboard
function getAdminKeyboard() {
  return {
    inline_keyboard: [
      [{ text: strings.sendGlobalMessage, callback_data: 'send_global' }],
      [{ text: strings.sendGlobalImage, callback_data: 'send_image' }],
      [{ text: strings.sendGlobalImageCaption, callback_data: 'send_image_caption' }],
      [{ text: strings.sendGlobalAudio, callback_data: 'send_audio' }]
    ]
  };
}

// Check if user is admin
function isAdmin(username) {
  return username === ADMIN_USERNAME;
}

// Handle 'پنل' command
bot.onText(/پنل/, async (msg) => {
  if (!msg?.from?.username || !isAdmin(msg.from.username) || msg.chat.type !== 'private') return;
  
  resetUserState();
  
  try {
    const sentMsg = await bot.sendMessage(msg.chat.id, strings.panelTitle, {
      parse_mode: 'Markdown',
      reply_markup: getAdminKeyboard()
    });
    
    userState.lastBotMessageId = sentMsg.message_id;
    userState.lastChatId = msg.chat.id;
  } catch (error) {
    console.error('❌ Panel error:', error);
  }
});

// Reset user state
function resetUserState() {
  Object.keys(userState).forEach(key => {
    if (typeof userState[key] === 'boolean') userState[key] = false;
  });
}

// Handle inline keyboard callbacks
bot.on('callback_query', async (callbackQuery) => {
  if (!callbackQuery?.from?.username || !isAdmin(callbackQuery.from.username)) return;
  
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  
  try {
    switch (callbackQuery.data) {
      case 'send_global':
        userState.waitingForGlobalMessage = true;
        break;
      case 'send_image':
        userState.waitingForImage = true;
        break;
      case 'send_image_caption':
        userState.waitingForImage = true;
        userState.waitingForImageCaption = true;
        break;
      case 'send_audio':
        userState.waitingForAudio = true;
        break;
    }
    
    // Create back button keyboard
    const backKeyboard = {
      keyboard: [[{ text: strings.back }]],
      resize_keyboard: true
    };
    
    const promptMessage = userState.waitingForImage ? strings.sendImage :
                         userState.waitingForAudio ? strings.sendAudio :
                         strings.enterMessage;
    
    // First edit the message text
    await bot.editMessageText(promptMessage, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown'
    });
    
    // Then send the keyboard separately
    await bot.sendMessage(chatId, '👇', {
      reply_markup: backKeyboard
    });
    
    userState.lastBotMessageId = messageId;
    userState.lastChatId = chatId;
    
  } catch (error) {
    console.error('❌ Callback error:', error);
  }
  
  await bot.answerCallbackQuery(callbackQuery.id);
});

// Handle back button
bot.onText(new RegExp(strings.back), async (msg) => {
  if (!msg?.from?.username || !isAdmin(msg.from.username) || msg.chat.type !== 'private') return;
  
  try {
    resetUserState();
    
    if (userState.lastBotMessageId && userState.lastChatId) {
      await bot.editMessageText(strings.panelTitle, {
        chat_id: userState.lastChatId,
        message_id: userState.lastBotMessageId,
        parse_mode: 'Markdown',
        reply_markup: getAdminKeyboard()
      });
    } else {
      const sentMsg = await bot.sendMessage(msg.chat.id, strings.panelTitle, {
        parse_mode: 'Markdown',
        reply_markup: getAdminKeyboard()
      });
      userState.lastBotMessageId = sentMsg.message_id;
      userState.lastChatId = msg.chat.id;
    }
    
    await bot.sendMessage(msg.chat.id, '⌨️ *کیبورد حذف شد*', {
      parse_mode: 'Markdown',
      reply_markup: { remove_keyboard: true }
    });
  } catch (error) {
    console.error('❌ Back button error:', error);
  }
});

// Handle messages
bot.on('message', async (msg) => {
  if (!msg?.from?.username || !isAdmin(msg.from.username) || msg.chat.type !== 'private') return;
  
  // Skip commands
  if (msg.text === 'پنل' || msg.text === strings.back) return;
  
  try {
    // Handle image upload
    if ((userState.waitingForImage || userState.waitingForImageCaption) && msg.photo) {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      userState.tempImageFileId = fileId;
      
      if (userState.waitingForImageCaption) {
        await bot.editMessageText(strings.sendImageCaption, {
          chat_id: userState.lastChatId,
          message_id: userState.lastBotMessageId,
          parse_mode: 'Markdown'
        });
        userState.waitingForImage = false;
        return;
      }
      
      await broadcastMedia('photo', fileId);
      return;
    }
    
    // Handle audio upload
    if (userState.waitingForAudio && (msg.audio || msg.voice)) {
      const fileId = msg.audio?.file_id || msg.voice?.file_id;
      await broadcastMedia(msg.audio ? 'audio' : 'voice', fileId);
      return;
    }
    
    // Handle image caption
    if (userState.waitingForImageCaption && !msg.photo && msg.text) {
      await broadcastMedia('photo', userState.tempImageFileId, msg.text);
      return;
    }
    
    // Handle text message
    if (userState.waitingForGlobalMessage && msg.text) {
      await broadcastText(msg.text);
    }
  } catch (error) {
    console.error('❌ Message handling error:', error);
  }
});

// Broadcast text message
async function broadcastText(text) {
  await updateStatus(strings.sending);
  
  let successCount = 0;
  const promises = [];
  
  for (const targetId of broadcastTargets) {
    promises.push(
      bot.sendMessage(targetId, text)
        .then(() => successCount++)
        .catch(error => handleBroadcastError(error, targetId))
    );
  }
  
  await Promise.allSettled(promises);
  await showResults(successCount);
}

// Broadcast media
async function broadcastMedia(type, fileId, caption = '') {
  await updateStatus(strings.sending);
  
  let successCount = 0;
  const promises = [];
  
  for (const targetId of broadcastTargets) {
    const promise = type === 'photo' ?
      bot.sendPhoto(targetId, fileId, { caption }) :
      type === 'audio' ?
        bot.sendAudio(targetId, fileId, { caption }) :
        bot.sendVoice(targetId, fileId, { caption });
    
    promises.push(
      promise
        .then(() => successCount++)
        .catch(error => handleBroadcastError(error, targetId))
    );
  }
  
  await Promise.allSettled(promises);
  await showResults(successCount);
}

// Update status message
async function updateStatus(message) {
  if (userState.lastBotMessageId && userState.lastChatId) {
    try {
      await bot.editMessageText(message, {
        chat_id: userState.lastChatId,
        message_id: userState.lastBotMessageId,
        parse_mode: 'Markdown'
      });
    } catch (error) {
      console.error('❌ Status update error:', error);
    }
  }
}

// Handle broadcast errors
function handleBroadcastError(error, targetId) {
  console.error(`❌ Broadcast error to ${targetId}:`, error.message);
  if (error.response?.statusCode === 403) {
    broadcastTargets.delete(targetId);
  }
}

// Show broadcast results
async function showResults(successCount) {
  try {
    await updateStatus(`${strings.messageSent} ${successCount} گروه`);
    
    setTimeout(async () => {
      resetUserState();
      
      if (userState.lastBotMessageId && userState.lastChatId) {
        await bot.editMessageText(strings.panelTitle, {
          chat_id: userState.lastChatId,
          message_id: userState.lastBotMessageId,
          parse_mode: 'Markdown',
          reply_markup: getAdminKeyboard()
        });
      }
      
      await bot.sendMessage(userState.lastChatId, '⌨️ *کیبورد حذف شد*', {
        parse_mode: 'Markdown',
        reply_markup: { remove_keyboard: true }
      });
    }, 3000);
  } catch (error) {
    console.error('❌ Results display error:', error);
  }
}

// Refresh broadcast targets periodically
async function refreshBroadcastTargets() {
  try {
    const updates = await bot.getUpdates(0, 100, -1);
    if (updates && updates.length) {
      updates.forEach(update => {
        const chat = update.message?.chat;
        if (chat?.type === 'group' || chat?.type === 'supergroup' || chat?.type === 'channel') {
          broadcastTargets.add(chat.id);
        }
      });
    }
    console.log(`📋 Refreshed targets: ${broadcastTargets.size}`);
  } catch (error) {
    console.error('❌ Refresh error:', error);
  }
}

// Initialize and set up periodic refresh
initializeBroadcastTargets();
setInterval(refreshBroadcastTargets, 3600000); // Every hour
setTimeout(refreshBroadcastTargets, 60000); // After 1 minute

// Error handling
bot.on('polling_error', error => {
  console.error('🚫 Polling error:', error.message);
});

process.on('unhandledRejection', error => {
  console.error('❌ Unhandled rejection:', error);
});

console.log('🚀 Bot is running...');
