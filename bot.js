const TelegramBot = require('node-telegram-bot-api');

// Replace with your bot token
const token = '8181091358:AAHje9osJeCxXaP1vcACF-lqrMpz5pUxVaE'; // Replace this with your actual token

// Create a bot instance
const bot = new TelegramBot(token, { polling: true });

// Store chat IDs for broadcasts (groups and channels, not DMs)
const broadcastTargets = new Set();

// Track user state for the admin
const userState = {
  waitingForGlobalMessage: false
};

// Persian strings with emojis and formatting
const strings = {
  panelTitle: '🔰 *به پنل مدیریت خوش آمدید*\n\n📌 یک گزینه را از پایین انتخاب کنید:',
  sendGlobalMessage: '📢 ارسال پیام سراسری',
  back: '⬅️ بازگشت',
  enterMessage: '✏️ *لطفا پیام خود را برای ارسال سراسری وارد کنید:*',
  messageSent: '✅ *موفق* | پیام شما با موفقیت به همه گروه‌ها و کانال‌ها ارسال شد'
};

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
    await bot.sendMessage(chatId, strings.panelTitle, {
      parse_mode: 'Markdown',
      reply_markup: inlineKeyboard
    });
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
      
      // Send back button as reply keyboard
      await bot.sendMessage(chatId, '👇 *منتظر پیام شما هستم...*', {
        parse_mode: 'Markdown',
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
    
    // Send the panel message again
    await bot.sendMessage(chatId, strings.panelTitle, {
      parse_mode: 'Markdown',
      reply_markup: inlineKeyboard
    });
  }
});

// Handle incoming messages for global broadcast
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username;
  
  // Skip handling of command messages
  if (msg.text === 'پنل' || msg.text === strings.back) {
    return;
  }
  
  // Check if admin is in global message input mode
  if (username === 'zonercm' && 
      msg.chat.type === 'private' && 
      userState.waitingForGlobalMessage) {
    
    // Reset state
    userState.waitingForGlobalMessage = false;
    
    // Show sending status
    const statusMsg = await bot.sendMessage(chatId, '🔄 *در حال ارسال پیام...*', {
      parse_mode: 'Markdown'
    });
    
    // Send the message to all groups and channels
    let successCount = 0;
    for (const targetId of broadcastTargets) {
      try {
        await bot.sendMessage(targetId, msg.text);
        successCount++;
      } catch (error) {
        console.error(`❌ Failed to send message to ${targetId}: ${error.message}`);
        // If we can't send to this chat, it might be because we were kicked/removed
        broadcastTargets.delete(targetId);
      }
    }
    
    // Create inline keyboard for panel
    const inlineKeyboard = {
      inline_keyboard: [
        [{ text: strings.sendGlobalMessage, callback_data: 'send_global' }]
      ]
    };
    
    // Edit status message to show completion
    await bot.editMessageText(`${strings.messageSent} (${successCount} مورد)`, {
      chat_id: chatId,
      message_id: statusMsg.message_id,
      parse_mode: 'Markdown'
    });
    
    // Send panel again
    setTimeout(async () => {
      await bot.sendMessage(chatId, strings.panelTitle, {
        parse_mode: 'Markdown',
        reply_markup: inlineKeyboard
      });
    }, 1000);
    
    // Remove keyboard
    await bot.sendMessage(chatId, '⌨️ *کیبورد حذف شد*', {
      parse_mode: 'Markdown',
      reply_markup: { remove_keyboard: true }
    });
  }
});

// Log errors
bot.on('polling_error', (error) => {
  console.error(`🚫 Polling error: ${error.message}`);
});

console.log('🚀 Bot is running...');

// Helper function to add existing chats to broadcast list
// You can call this function manually with chatIds you want to add
function addExistingChats(chatIds) {
  for (const id of chatIds) {
    broadcastTargets.add(id);
  }
  console.log(`📋 Added ${chatIds.length} existing chats to broadcast list.`);
}

// Example usage:
// addExistingChats([-1001234567890, -1009876543210]);
