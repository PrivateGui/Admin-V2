const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot('8181091358:AAHje9osJeCxXaP1vcACF-lqrMpz5pUxVaE', { polling: true });

const authorizedUserHandle = '@zonercm'; // The user handle we're looking for
let globalMessage = ''; // This will hold the global message

// The back button and the option to send the global message
const backButton = { text: 'Back', callback_data: 'back' };
const sendMessageButton = { text: 'ارسال پیام جهانی', callback_data: 'send_global_message' };

// Listen for incoming messages
bot.onText(/پنل/, async (msg) => {
  // Check if the sender's handle is @zonercm
  const senderHandle = `@${msg.from.username}`;
  if (senderHandle === authorizedUserHandle) {
    // Send a message with an inline keyboard when the user sends "پنل"
    const options = {
      reply_markup: {
        inline_keyboard: [[sendMessageButton]],
      },
    };

    await bot.sendMessage(msg.chat.id, 'Choose an option below', options);
  }
});

// Handle inline button presses
bot.on('callback_query', async (query) => {
  const { message, data, from } = query;

  // Check if the user is authorized
  if (`@${from.username}` !== authorizedUserHandle) {
    return bot.answerCallbackQuery(query.id, { text: 'You are not authorized to perform this action.', show_alert: true });
  }

  if (data === 'send_global_message') {
    // Prompt the user to enter the message they want to send globally
    await bot.sendMessage(message.chat.id, 'Please enter the message you want to send globally.');

    // Set a listener to capture the global message
    bot.once('message', async (msg) => {
      if (msg.text) {
        globalMessage = msg.text;
        await bot.sendMessage(message.chat.id, `Global message set to: ${globalMessage}`);

        // Loop through all chat groups and send the global message (you need to manually add groups to this list)
        const chatIds = ['your_group_or_channel_id_1', 'your_group_or_channel_id_2']; // Replace with actual group/channel IDs

        for (const chatId of chatIds) {
          try {
            await bot.sendMessage(chatId, globalMessage);
          } catch (err) {
            console.error(`Failed to send message to ${chatId}`, err);
          }
        }
      }
    });
  } else if (data === 'back') {
    // Edit the previous message to reset to the "پنل" message
    await bot.editMessageText('Choose an option below', {
      chat_id: message.chat.id,
      message_id: message.message_id,
      reply_markup: {
        inline_keyboard: [[sendMessageButton]],
      },
    });
  }

  // Acknowledge the callback query
  await bot.answerCallbackQuery(query.id);
});
