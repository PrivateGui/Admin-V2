const TelegramBot = require('node-telegram-bot-api');

// Replace with your bot token
const token = '8181091358:AAHje9osJeCxXaP1vcACF-lqrMpz5pUxVaE'; // Replace this with your actual token

// Create a bot instance
const bot = new TelegramBot(token, { polling: true });

// Store chat IDs for broadcasts (groups and channels, not DMs)
const broadcastTargets = new Set();

// Track user state for the admin
const userState = {
  waitingForGlobalMessage: false,
  lastBotMessageId: null,  // Track last bot message ID for editing
  lastChatId: null         // Track last chat ID for editing
};

// Persian strings with emojis and formatting
const strings = {
  panelTitle: '🔰 *به پنل مدیریت خوش آمدید*\n\n📌 یک گزینه را از پایین انتخاب کنید:',
  sendGlobalMessage: '📢 ارسال پیام سراسری',
  back: '⬅️ بازگشت',
  enterMessage: '✏️ *لطفا پیام خود را برای ارسال سراسری وارد کنید:*',
  messageSent: '✅ *موفق* | پیام شما با موفقیت به همه گروه‌ها و کانال‌ها ارسال شد',
  sending: '🔄 *در حال ارسال پیام...*'
};

// Initialize: Get all chats that the bot is in
bot.getUpdates(0, 100, -1).then(updates => {
  updates.forEach(update => {
    if (update.message && 
      (update.message.chat.type === 'group' || 
       update.message.chat.type === 'supergroup' || 
       update.message.chat.type === 'channel')) {
      broadcastTargets.add(update.message.chat.id);
      console.log(`🟢 Added ${update.message.chat.title} (${update.message.chat.id}) to broadcast list`);
    }
  });
}).catch(error => {
  console.error(`❌ Error getting updates: ${error.message}`);
});

// Add chats to broadcast list when the bot is added
bot.on('my_chat_member', (msg) => {
  const chatId = msg.chat.id;
  const newStatus = msg.new_chat_member.status;
  
  // Only add groups and channels (not private chats)
  if (msg.chat.type === 'group' || msg.chat.type === 'supergroup' || msg.chat.type === 'channel') {
    if (newStatus === 'member' || newStatus === 'administrator') {
      broadcastTargets.add(chatId);
      console.log(`🟢 Added ${msg.chat.title} (${chatId}) to broadcast list`);
    } else if (newStatus === 'kicked' || newStatus === 'left') {
      broadcastTargets.delete(chatId);
      console.log(`🔴 Removed ${msg.chat.title} (${chatId}) from broadcast list`);
    }
  }
});

// Handle 'پنل' command from admin
bot.onText(/پنل/, async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username;
  
  // Check if the message is from the admin in a private chat
  if (username === 'zonercm' && msg.chat.type === 'private') {
    userState.waitingForGlobalMessage = false;
    
    // Create inline keyboard
    const inlineKeyboard = {
      inline_keyboard: [
        [{ text: strings.sendGlobalMessage, callback_data: 'send_global' }]
      ]
    };
    
    // Send admin panel message
    const sentMsg = await bot.sendMessage(chatId, strings.panelTitle, {
      parse_mode: 'Markdown',
      reply_markup: inlineKeyboard
    });
    
    // Store message ID for future editing
    userState.lastBotMessageId = sentMsg.message_id;
    userState.lastChatId = chatId;
  }
});

// Handle inline keyboard callback
bot.on('callback_query', async (callbackQuery) => {
  const username = callbackQuery.from.username;
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  
  // Check if the callback is from the admin
  if (username === 'zonercm') {
    if (callbackQuery.data === 'send_global') {
      userState.waitingForGlobalMessage = true;
      
      // Create back button as reply keyboard
      const replyKeyboard = {
        keyboard: [[{ text: strings.back }]],
        resize_keyboard: true,
        one_time_keyboard: false
      };
      
      // Edit message to prompt for global message text
      await bot.editMessageText(strings.enterMessage, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [] }
      });
      
      // Update stored message ID
      userState.lastBotMessageId = messageId;
      userState.lastChatId = chatId;
      
      // Send keyboard separately (can't add reply_markup when editing)
      const keyboardMsg = await bot.sendMessage(chatId, '👇', {
        reply_markup: replyKeyboard
      });
    }
  }
  
  // Always answer callback query to remove loading state
  await bot.answerCallbackQuery(callbackQuery.id);
});

// Handle back button
bot.onText(new RegExp(strings.back), async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username;
  
  // Check if the message is from the admin
  if (username === 'zonercm' && msg.chat.type === 'private') {
    userState.waitingForGlobalMessage = false;
    
    // Create inline keyboard again
    const inlineKeyboard = {
      inline_keyboard: [
        [{ text: strings.sendGlobalMessage, callback_data: 'send_global' }]
      ]
    };
    
    // Edit the last bot message back to panel
    if (userState.lastBotMessageId) {
      await bot.editMessageText(strings.panelTitle, {
        chat_id: userState.lastChatId,
        message_id: userState.lastBotMessageId,
        parse_mode: 'Markdown',
        reply_markup: inlineKeyboard
      }).catch(err => {
        console.error('Error editing message:', err.message);
      });
    }
    
    // Remove keyboard
    await bot.sendMessage(chatId, '⌨️ *کیبورد حذف شد*', {
      parse_mode: 'Markdown',
      reply_markup: { remove_keyboard: true }
    });
  }
});

// Handle incoming messages for global broadcast
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username;
  
  // Skip handling of command messages
  if (msg.text === 'پنل' || (msg.text && msg.text === strings.back)) {
    return;
  }
  
  // Check if admin is in global message input mode
  if (username === 'zonercm' && 
      msg.chat.type === 'private' && 
      userState.waitingForGlobalMessage) {
    
    // Edit last bot message to show sending status
    if (userState.lastBotMessageId) {
      await bot.editMessageText(strings.sending, {
        chat_id: userState.lastChatId, 
        message_id: userState.lastBotMessageId,
        parse_mode: 'Markdown'
      }).catch(err => {
        console.error('Error editing message:', err.message);
      });
    }
    
    // Get all chats the bot is in (refresh list)
    const chats = await bot.getChats();
    if (chats && chats.length) {
      chats.forEach(chat => {
        if (chat.type === 'group' || chat.type === 'supergroup' || chat.type === 'channel') {
          broadcastTargets.add(chat.id);
        }
      });
    }
    
    // Send the message to all groups and channels
    let successCount = 0;
    const targetPromises = [];
    
    // Capture all broadcast promises
    for (const targetId of broadcastTargets) {
      try {
        const promise = bot.sendMessage(targetId, msg.text)
          .then(() => {
            successCount++;
            return true;
          })
          .catch(error => {
            console.error(`❌ Failed to send message to ${targetId}: ${error.message}`);
            // If we can't send to this chat, it might be because we were kicked/removed
            if (error.response && error.response.statusCode === 403) {
              broadcastTargets.delete(targetId);
            }
            return false;
          });
        
        targetPromises.push(promise);
      } catch (error) {
        console.error(`❌ Error creating promise for ${targetId}: ${error.message}`);
      }
    }
    
    // Wait for all broadcasts to complete
    await Promise.allSettled(targetPromises);
    
    // Edit message to show completion
    if (userState.lastBotMessageId) {
      await bot.editMessageText(`${strings.messageSent} (${successCount} مورد)`, {
        chat_id: userState.lastChatId,
        message_id: userState.lastBotMessageId,
        parse_mode: 'Markdown'
      }).catch(err => {
        console.error('Error editing message:', err.message);
      });
    }
    
    // Wait for a moment and then edit back to panel
    setTimeout(async () => {
      // Create inline keyboard for panel
      const inlineKeyboard = {
        inline_keyboard: [
          [{ text: strings.sendGlobalMessage, callback_data: 'send_global' }]
        ]
      };
      
      if (userState.lastBotMessageId) {
        await bot.editMessageText(strings.panelTitle, {
          chat_id: userState.lastChatId,
          message_id: userState.lastBotMessageId,
          parse_mode: 'Markdown',
          reply_markup: inlineKeyboard
        }).catch(err => {
          console.error('Error editing message:', err.message);
        });
      }
      
      // Reset waiting state
      userState.waitingForGlobalMessage = false;
      
      // Remove keyboard
      await bot.sendMessage(chatId, '⌨️ *کیبورد حذف شد*', {
        parse_mode: 'Markdown',
        reply_markup: { remove_keyboard: true }
      });
    }, 3000);
  }
});

// Get chat list periodically (every hour)
setInterval(async () => {
  try {
    const updates = await bot.getUpdates(0, 100, -1);
    updates.forEach(update => {
      if (update.message && 
        (update.message.chat.type === 'group' || 
         update.message.chat.type === 'supergroup' || 
         update.message.chat.type === 'channel')) {
        if (!broadcastTargets.has(update.message.chat.id)) {
          broadcastTargets.add(update.message.chat.id);
          console.log(`🟢 Added ${update.message.chat.title} (${update.message.chat.id}) to broadcast list`);
        }
      }
    });
    console.log(`📋 Refreshed broadcast list. Current count: ${broadcastTargets.size}`);
  } catch (error) {
    console.error(`❌ Error refreshing chat list: ${error.message}`);
  }
}, 3600000); // Every hour

// Log errors
bot.on('polling_error', (error) => {
  console.error(`🚫 Polling error: ${error.message}`);
});

console.log('🚀 Bot is running...');

// Debug helper: List all broadcast targets
function listBroadcastTargets() {
  console.log(`📊 Current broadcast targets (${broadcastTargets.size}):`);
  broadcastTargets.forEach(id => console.log(` - ${id}`));
}
