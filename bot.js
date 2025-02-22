const TelegramBot = require('node-telegram-bot-api');

// Bot token directly in the code (no dotenv)
const token = '7151280338:AAGf5-CPmnhvmFEaRFEPuRP1PD3qY79fsOY';

// Create a bot instance
const bot = new TelegramBot(token, { polling: true });

// Store chat IDs for broadcasts (groups and channels, not DMs)
const broadcastTargets = new Set();

// Track user state for the admin
const userState = {
  waitingForGlobalMessage: false,
  waitingForGlobalImage: false,
  waitingForImageCaption: false,
  waitingForGlobalAudio: false,
  lastBotMessageId: null,  // Track last bot message ID for editing
  lastChatId: null,        // Track last chat ID for editing
  tempMediaFileId: null,   // Store file ID for media with caption
  retryCount: 0,           // Track retry attempts for failed broadcasts
  maxRetries: 3            // Maximum number of retry attempts
};

// Persian strings with emojis and formatting
const strings = {
  panelTitle: '🔰 *به پنل مدیریت خوش آمدید*\n\n📌 یک گزینه را از پایین انتخاب کنید:',
  sendGlobalMessage: '📢 ارسال پیام سراسری',
  sendGlobalImage: '🖼️ ارسال تصویر سراسری',
  sendGlobalImageCaption: '🏞️ ارسال تصویر با کپشن سراسری',
  sendGlobalAudio: '🎵 ارسال فایل صوتی سراسری',
  back: '⬅️ بازگشت',
  enterMessage: '✏️ *لطفا پیام خود را برای ارسال سراسری وارد کنید:*',
  enterImage: '🖼️ *لطفا تصویر خود را برای ارسال سراسری ارسال کنید:*',
  enterImageCaption: '🏞️ *لطفا تصویر خود را ارسال کنید، سپس کپشن آن را وارد کنید:*',
  enterCaption: '✏️ *لطفا کپشن تصویر را وارد کنید:*',
  enterAudio: '🎵 *لطفا فایل صوتی خود را برای ارسال سراسری ارسال کنید:*',
  messageSent: '✅ *موفق* | پیام شما با موفقیت به همه گروه‌ها و کانال‌ها ارسال شد',
  sending: '🔄 *در حال ارسال...*',
  retrying: '🔁 *تلاش مجدد برای ارسال...*'
};

// Improved initialization: Get all chats that the bot is in
async function initializeBroadcastTargets() {
  try {
    const updates = await bot.getUpdates(0, 100, -1);
    if (updates && updates.length) {
      updates.forEach(update => {
        if (update.message && 
          (update.message.chat.type === 'group' || 
           update.message.chat.type === 'supergroup' || 
           update.message.chat.type === 'channel')) {
          broadcastTargets.add(update.message.chat.id);
          console.log(`🟢 Added ${update.message.chat.title} (${update.message.chat.id}) to broadcast list`);
        }
      });
      console.log(`📋 Initial broadcast list count: ${broadcastTargets.size}`);
    }
  } catch (error) {
    console.error(`❌ Error getting updates: ${error.message}`);
    // Retry initialization after delay
    setTimeout(initializeBroadcastTargets, 30000);
  }
}

// Call initialization
initializeBroadcastTargets();

// Add chats to broadcast list when the bot is added
bot.on('my_chat_member', (msg) => {
  if (!msg || !msg.chat) return;
  
  const chatId = msg.chat.id;
  const newStatus = msg.new_chat_member && msg.new_chat_member.status;
  
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
  if (!msg || !msg.chat || !msg.from || !msg.from.username) return;
  
  const chatId = msg.chat.id;
  const username = msg.from.username;
  
  // Check if the message is from the admin in a private chat
  if (username === 'zonercm' && msg.chat.type === 'private') {
    // Reset all waiting states
    resetUserState();
    
    // Create enhanced inline keyboard with new options
    const inlineKeyboard = {
      inline_keyboard: [
        [{ text: strings.sendGlobalMessage, callback_data: 'send_global' }],
        [{ text: strings.sendGlobalImage, callback_data: 'send_global_image' }],
        [{ text: strings.sendGlobalImageCaption, callback_data: 'send_global_image_caption' }],
        [{ text: strings.sendGlobalAudio, callback_data: 'send_global_audio' }]
      ]
    };
    
    try {
      // Send admin panel message
      const sentMsg = await bot.sendMessage(chatId, strings.panelTitle, {
        parse_mode: 'Markdown',
        reply_markup: inlineKeyboard
      });
      
      // Store message ID for future editing
      userState.lastBotMessageId = sentMsg.message_id;
      userState.lastChatId = chatId;
    } catch (error) {
      console.error(`❌ Error sending panel message: ${error.message}`);
    }
  }
});

// Reset all user state flags
function resetUserState() {
  userState.waitingForGlobalMessage = false;
  userState.waitingForGlobalImage = false;
  userState.waitingForImageCaption = false;
  userState.waitingForGlobalAudio = false;
  userState.tempMediaFileId = null;
  userState.retryCount = 0;
}

// Handle inline keyboard callback
bot.on('callback_query', async (callbackQuery) => {
  try {
    if (!callbackQuery || !callbackQuery.from || !callbackQuery.message || !callbackQuery.message.chat) {
      return;
    }
    
    const username = callbackQuery.from.username;
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    
    // Check if the callback is from the admin
    if (username === 'zonercm') {
      // Create back button as reply keyboard
      const replyKeyboard = {
        keyboard: [[{ text: strings.back }]],
        resize_keyboard: true,
        one_time_keyboard: false
      };
      
      // Reset all waiting states
      resetUserState();
      
      // Handle different callback data
      switch (callbackQuery.data) {
        case 'send_global':
          userState.waitingForGlobalMessage = true;
          await handleCallbackAndUpdateUI(chatId, messageId, strings.enterMessage, replyKeyboard);
          break;
          
        case 'send_global_image':
          userState.waitingForGlobalImage = true;
          await handleCallbackAndUpdateUI(chatId, messageId, strings.enterImage, replyKeyboard);
          break;
          
        case 'send_global_image_caption':
          userState.waitingForImageCaption = true;
          await handleCallbackAndUpdateUI(chatId, messageId, strings.enterImageCaption, replyKeyboard);
          break;
          
        case 'send_global_audio':
          userState.waitingForGlobalAudio = true;
          await handleCallbackAndUpdateUI(chatId, messageId, strings.enterAudio, replyKeyboard);
          break;
      }
    }
    
    // Always answer callback query to remove loading state
    if (callbackQuery.id) {
      await bot.answerCallbackQuery(callbackQuery.id);
    }
  } catch (error) {
    console.error(`❌ Error in callback handler: ${error.message}`);
    // Attempt to answer the callback query anyway to prevent hanging UI
    if (callbackQuery && callbackQuery.id) {
      await bot.answerCallbackQuery(callbackQuery.id).catch(() => {});
    }
  }
});

// Helper function to update UI after a callback
async function handleCallbackAndUpdateUI(chatId, messageId, promptText, replyKeyboard) {
  try {
    // Edit message to prompt for action
    await bot.editMessageText(promptText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [] }
    });
    
    // Update stored message ID
    userState.lastBotMessageId = messageId;
    userState.lastChatId = chatId;
    
    // Send keyboard separately
    await bot.sendMessage(chatId, '👇', {
      reply_markup: replyKeyboard
    });
  } catch (error) {
    console.error(`❌ Error handling callback UI: ${error.message}`);
    // Attempt to send as new message if edit fails
    try {
      const sentMsg = await bot.sendMessage(chatId, promptText, {
        parse_mode: 'Markdown'
      });
      userState.lastBotMessageId = sentMsg.message_id;
      userState.lastChatId = chatId;
      
      // Send keyboard
      await bot.sendMessage(chatId, '👇', {
        reply_markup: replyKeyboard
      });
    } catch (innerError) {
      console.error(`❌ Fatal error in UI handler: ${innerError.message}`);
    }
  }
}

// Handle back button
bot.onText(new RegExp(strings.back), async (msg) => {
  try {
    if (!msg || !msg.chat || !msg.from || !msg.from.username) return;
    
    const chatId = msg.chat.id;
    const username = msg.from.username;
    
    // Check if the message is from the admin
    if (username === 'zonercm' && msg.chat.type === 'private') {
      // Reset all waiting states
      resetUserState();
      
      // Create enhanced inline keyboard with all options
      const inlineKeyboard = {
        inline_keyboard: [
          [{ text: strings.sendGlobalMessage, callback_data: 'send_global' }],
          [{ text: strings.sendGlobalImage, callback_data: 'send_global_image' }],
          [{ text: strings.sendGlobalImageCaption, callback_data: 'send_global_image_caption' }],
          [{ text: strings.sendGlobalAudio, callback_data: 'send_global_audio' }]
        ]
      };
      
      // Attempt to edit the last bot message back to panel
      await updatePanelUI(chatId, inlineKeyboard);
      
      // Remove keyboard
      await bot.sendMessage(chatId, '⌨️ *کیبورد حذف شد*', {
        parse_mode: 'Markdown',
        reply_markup: { remove_keyboard: true }
      });
    }
  } catch (error) {
    console.error(`❌ Error handling back button: ${error.message}`);
  }
});

// Helper function to update panel UI
async function updatePanelUI(chatId, inlineKeyboard) {
  try {
    // Edit the last bot message back to panel if possible
    if (userState.lastBotMessageId && userState.lastChatId) {
      try {
        await bot.editMessageText(strings.panelTitle, {
          chat_id: userState.lastChatId,
          message_id: userState.lastBotMessageId,
          parse_mode: 'Markdown',
          reply_markup: inlineKeyboard
        });
      } catch (err) {
        console.error('Error editing message:', err.message);
        // If edit fails, send a new message
        const sentMsg = await bot.sendMessage(chatId, strings.panelTitle, {
          parse_mode: 'Markdown',
          reply_markup: inlineKeyboard
        });
        userState.lastBotMessageId = sentMsg.message_id;
        userState.lastChatId = chatId;
      }
    } else {
      // If we don't have a stored message ID, send a new message
      const sentMsg = await bot.sendMessage(chatId, strings.panelTitle, {
        parse_mode: 'Markdown',
        reply_markup: inlineKeyboard
      });
      userState.lastBotMessageId = sentMsg.message_id;
      userState.lastChatId = chatId;
    }
  } catch (error) {
    console.error(`❌ Error updating panel UI: ${error.message}`);
  }
}

// Handle incoming messages, images, and audio for global broadcast
bot.on('message', async (msg) => {
  try {
    if (!msg || !msg.from || !msg.chat) return;
    
    const chatId = msg.chat.id;
    const username = msg.from.username;
    
    // Skip if not admin or not in private chat
    if (username !== 'zonercm' || msg.chat.type !== 'private') return;
    
    // Skip handling of command messages
    if (msg.text === 'پنل' || (msg.text && msg.text === strings.back)) {
      return;
    }
    
    // Handle text message for global broadcast
    if (userState.waitingForGlobalMessage && msg.text) {
      await handleGlobalTextBroadcast(chatId, msg.text);
    }
    
    // Handle image for global broadcast (without caption)
    else if (userState.waitingForGlobalImage && msg.photo) {
      await handleGlobalImageBroadcast(chatId, msg.photo);
    }
    
    // Handle the first part of image with caption flow (receiving image)
    else if (userState.waitingForImageCaption && msg.photo) {
      // Store the file ID of the largest image version and prompt for caption
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      userState.tempMediaFileId = fileId;
      userState.waitingForImageCaption = false;
      userState.waitingForImageCaption = true;
      
      await bot.sendMessage(chatId, strings.enterCaption, {
        parse_mode: 'Markdown'
      });
    }
    
    // Handle the second part of image with caption flow (receiving caption)
    else if (userState.waitingForImageCaption && userState.tempMediaFileId && msg.text) {
      await handleGlobalImageCaptionBroadcast(chatId, userState.tempMediaFileId, msg.text);
    }
    
    // Handle audio for global broadcast
    else if (userState.waitingForGlobalAudio && (msg.audio || msg.voice)) {
      await handleGlobalAudioBroadcast(chatId, msg.audio || msg.voice);
    }
  } catch (error) {
    console.error(`❌ Error handling message: ${error.message}`);
  }
});

// Handle global text message broadcast
async function handleGlobalTextBroadcast(chatId, messageText) {
  // Update status to sending
  await updateStatusMessage(strings.sending);
  
  // Send the message to all targets
  const result = await broadcastContent(async (targetId) => {
    await bot.sendMessage(targetId, messageText);
  });
  
  // Return to panel with results
  await finalizeBroadcast(chatId, result.successCount);
}

// Handle global image broadcast
async function handleGlobalImageBroadcast(chatId, photoArray) {
  // Get the file ID of the largest image version
  const fileId = photoArray[photoArray.length - 1].file_id;
  
  // Update status to sending
  await updateStatusMessage(strings.sending);
  
  // Send the image to all targets
  const result = await broadcastContent(async (targetId) => {
    await bot.sendPhoto(targetId, fileId);
  });
  
  // Return to panel with results
  await finalizeBroadcast(chatId, result.successCount);
}

// Handle global image with caption broadcast
async function handleGlobalImageCaptionBroadcast(chatId, fileId, caption) {
  // Update status to sending
  await updateStatusMessage(strings.sending);
  
  // Send the image with caption to all targets
  const result = await broadcastContent(async (targetId) => {
    await bot.sendPhoto(targetId, fileId, { caption: caption });
  });
  
  // Reset the stored file ID
  userState.tempMediaFileId = null;
  
  // Return to panel with results
  await finalizeBroadcast(chatId, result.successCount);
}

// Handle global audio broadcast
async function handleGlobalAudioBroadcast(chatId, audioObject) {
  // Get the file ID of the audio
  const fileId = audioObject.file_id;
  
  // Update status to sending
  await updateStatusMessage(strings.sending);
  
  // Send the audio to all targets
  const result = await broadcastContent(async (targetId) => {
    // Check if it's voice or audio and send accordingly
    if (audioObject.duration) { // It's an audio file
      await bot.sendAudio(targetId, fileId);
    } else { // It's a voice message
      await bot.sendVoice(targetId, fileId);
    }
  });
  
  // Return to panel with results
  await finalizeBroadcast(chatId, result.successCount);
}

// Helper to update status message
async function updateStatusMessage(statusText) {
  if (userState.lastBotMessageId && userState.lastChatId) {
    try {
      await bot.editMessageText(statusText, {
        chat_id: userState.lastChatId, 
        message_id: userState.lastBotMessageId,
        parse_mode: 'Markdown'
      });
    } catch (err) {
      console.error('Error editing status message:', err.message);
    }
  }
}

// Improved broadcast function with retry logic
async function broadcastContent(sendFn) {
  let successCount = 0;
  let failedTargets = [];
  const promises = [];
  
  // Check if we have any targets
  if (broadcastTargets.size === 0) {
    console.log('⚠️ No broadcast targets available');
    return { successCount, failedTargets };
  }
  
  // First attempt
  for (const targetId of broadcastTargets) {
    promises.push(
      sendFn(targetId)
        .then(() => {
          successCount++;
          return true;
        })
        .catch(error => {
          console.error(`❌ Failed to send to ${targetId}: ${error.message}`);
          failedTargets.push(targetId);
          
          // Handle forbidden errors by removing target
          if (error.response && error.response.statusCode === 403) {
            broadcastTargets.delete(targetId);
          }
          return false;
        })
    );
  }
  
  // Wait for all broadcasts to complete
  await Promise.allSettled(promises);
  
  // Retry logic for failed targets
  if (failedTargets.length > 0 && userState.retryCount < userState.maxRetries) {
    // Increment retry counter
    userState.retryCount++;
    
    // Update status to retrying
    await updateStatusMessage(`${strings.retrying} (${userState.retryCount}/${userState.maxRetries})`);
    
    // Small delay before retry
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Prepare retry promises
    const retryPromises = [];
    const stillFailedTargets = [];
    
    for (const targetId of failedTargets) {
      if (broadcastTargets.has(targetId)) { // Only retry if target still in list
        retryPromises.push(
          sendFn(targetId)
            .then(() => {
              successCount++;
              return true;
            })
            .catch(error => {
              console.error(`❌ Retry failed for ${targetId}: ${error.message}`);
              stillFailedTargets.push(targetId);
              return false;
            })
        );
      }
    }
    
    // Wait for all retries to complete
    await Promise.allSettled(retryPromises);
    failedTargets = stillFailedTargets;
  }
  
  // Reset retry counter
  userState.retryCount = 0;
  
  return { successCount, failedTargets };
}

// Helper to finalize broadcast and return to panel
async function finalizeBroadcast(chatId, successCount) {
  try {
    // Show success message
    if (userState.lastBotMessageId && userState.lastChatId) {
      await bot.editMessageText(`${strings.messageSent} (${successCount} مورد)`, {
        chat_id: userState.lastChatId,
        message_id: userState.lastBotMessageId,
        parse_mode: 'Markdown'
      });
    }
    
    // Reset all waiting states
    resetUserState();
    
    // Wait a moment and return to panel
    setTimeout(async () => {
      // Create enhanced inline keyboard
      const inlineKeyboard = {
        inline_keyboard: [
          [{ text: strings.sendGlobalMessage, callback_data: 'send_global' }],
          [{ text: strings.sendGlobalImage, callback_data: 'send_global_image' }],
          [{ text: strings.sendGlobalImageCaption, callback_data: 'send_global_image_caption' }],
          [{ text: strings.sendGlobalAudio, callback_data: 'send_global_audio' }]
        ]
      };
      
      // Update panel UI
      await updatePanelUI(chatId, inlineKeyboard);
      
      // Remove keyboard
      await bot.sendMessage(chatId, '⌨️ *کیبورد حذف شد*', {
        parse_mode: 'Markdown',
        reply_markup: { remove_keyboard: true }
      });
    }, 3000);
  } catch (error) {
    console.error(`❌ Error finalizing broadcast: ${error.message}`);
  }
}

// Improved chat list refresh with error handling
async function refreshBroadcastTargets() {
  try {
    const updates = await bot.getUpdates(0, 100, -1);
    const initialCount = broadcastTargets.size;
    let newCount = 0;
    
    if (updates && updates.length) {
      updates.forEach(update => {
        if (update.message && 
          (update.message.chat.type === 'group' || 
           update.message.chat.type === 'supergroup' || 
           update.message.chat.type === 'channel')) {
          if (!broadcastTargets.has(update.message.chat.id)) {
            broadcastTargets.add(update.message.chat.id);
            newCount++;
            console.log(`🟢 Added ${update.message.chat.title} (${update.message.chat.id}) to broadcast list`);
          }
        }
      });
    }
    
    if (newCount > 0) {
      console.log(`📋 Refreshed broadcast list. Added ${newCount} new targets. Total: ${broadcastTargets.size}`);
    } else {
      console.log(`📋 Broadcast list refresh completed. No new targets. Total: ${broadcastTargets.size}`);
    }
    
    // Verify if any targets were removed (chat no longer exists)
    if (initialCount > broadcastTargets.size) {
      console.log(`🔴 Removed ${initialCount - broadcastTargets.size} invalid targets during refresh`);
    }
  } catch (error) {
    console.error(`❌ Error refreshing chat list: ${error.message}`);
  } finally {
    // Schedule next refresh regardless of success/failure
    setTimeout(refreshBroadcastTargets, 3600000); // Every hour
  }
}

// Get chat list periodically (schedule first refresh after bot startup)
setTimeout(refreshBroadcastTargets, 60000);

// Log errors
bot.on('polling_error', (error) => {
  console.error(`🚫 Polling error: ${error.message}`);
});

// Enhanced error handling for unhandled rejections
process.on('unhandledRejection', error => {
  console.error('🚨 Unhandled Promise rejection:', error);
});

// Debug helper: List all broadcast targets
function listBroadcastTargets() {
  console.log(`📊 Current broadcast targets (${broadcastTargets.size}):`);
  broadcastTargets.forEach(id => console.log(` - ${id}`));
  return broadcastTargets.size;
}

console.log('🚀 Bot is running with enhanced media broadcast capabilities...');
