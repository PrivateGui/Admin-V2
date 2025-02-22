const TelegramBot = require('node-telegram-bot-api');

// Bot configuration
const token = '7151280338:AAGf5-CPmnhvmFEaRFEPuRP1PD3qY79fsOY';
const ADMIN_USERNAME = 'zonercm';

// Initialize bot with proper error handling
let bot;
try {
    bot = new TelegramBot(token, { polling: true });
    console.log('🤖 Bot started successfully');
} catch (error) {
    console.error('❌ Failed to initialize bot:', error);
    process.exit(1);
}

// Broadcast targets storage
const broadcastTargets = new Set();

// Admin state management
const adminState = {
    awaitingMessage: false,
    awaitingImage: false,
    awaitingImageCaption: false,
    awaitingAudio: false,
    tempImageId: null,
    lastMessageId: null,
    lastChatId: null
};

// UI strings
const strings = {
    welcome: '🔰 *به پنل مدیریت خوش آمدید*\n\n📌 یک گزینه را انتخاب کنید:',
    options: {
        broadcast: '📢 ارسال پیام سراسری',
        image: '🖼️ ارسال تصویر سراسری',
        imageWithCaption: '🏞️ ارسال تصویر با متن',
        audio: '🎵 ارسال فایل صوتی',
        back: '⬅️ بازگشت'
    },
    prompts: {
        message: '✏️ *پیام خود را وارد کنید:*',
        image: '🖼️ *تصویر را ارسال کنید:*',
        imageCaption: '✏️ *متن تصویر را وارد کنید:*',
        audio: '🎵 *فایل صوتی را ارسال کنید:*'
    },
    status: {
        sending: '📤 *در حال ارسال...*',
        success: '✅ *ارسال با موفقیت انجام شد*',
        error: '❌ *خطا در ارسال*'
    }
};

// Error handler wrapper
const errorHandler = (fn) => {
    return async (...args) => {
        try {
            await fn(...args);
        } catch (error) {
            console.error(`Error in ${fn.name}:`, error);
            const chatId = args[0]?.chat?.id || args[0];
            if (chatId) {
                await bot.sendMessage(chatId, strings.status.error).catch(() => {});
            }
        }
    };
};

// Command handler for admin panel
bot.onText(/\/panel|پنل/, errorHandler(async (msg) => {
    const { id: chatId, type } = msg.chat;
    const { username } = msg.from;

    if (username !== ADMIN_USERNAME || type !== 'private') return;

    resetAdminState();
    await showAdminPanel(chatId);
}));

// Show admin panel
async function showAdminPanel(chatId) {
    const keyboard = {
        inline_keyboard: [
            [{ text: strings.options.broadcast, callback_data: 'broadcast' }],
            [{ text: strings.options.image, callback_data: 'image' }],
            [{ text: strings.options.imageWithCaption, callback_data: 'image_caption' }],
            [{ text: strings.options.audio, callback_data: 'audio' }]
        ]
    };

    const msg = await bot.sendMessage(chatId, strings.welcome, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
    });

    adminState.lastMessageId = msg.message_id;
    adminState.lastChatId = chatId;
}

// Handle callback queries
bot.on('callback_query', errorHandler(async (query) => {
    const { username } = query.from;
    const chatId = query.message.chat.id;

    if (username !== ADMIN_USERNAME) return;

    const actions = {
        'broadcast': () => handleBroadcastRequest(chatId, 'awaitingMessage', strings.prompts.message),
        'image': () => handleBroadcastRequest(chatId, 'awaitingImage', strings.prompts.image),
        'image_caption': () => handleBroadcastRequest(chatId, 'awaitingImageCaption', strings.prompts.image),
        'audio': () => handleBroadcastRequest(chatId, 'awaitingAudio', strings.prompts.audio)
    };

    await actions[query.data]?.();
    await bot.answerCallbackQuery(query.id);
}));

// Handle broadcast requests
async function handleBroadcastRequest(chatId, stateKey, prompt) {
    resetAdminState();
    adminState[stateKey] = true;

    const keyboard = {
        keyboard: [[{ text: strings.options.back }]],
        resize_keyboard: true
    };

    await bot.editMessageText(prompt, {
        chat_id: chatId,
        message_id: adminState.lastMessageId,
        parse_mode: 'Markdown'
    });

    await bot.sendMessage(chatId, '⌨️', {
        reply_markup: keyboard
    });
}

// Handle incoming messages
bot.on('message', errorHandler(async (msg) => {
    const { username } = msg.from;
    const chatId = msg.chat.id;

    if (username !== ADMIN_USERNAME || msg.chat.type !== 'private') return;

    // Handle back button
    if (msg.text === strings.options.back) {
        resetAdminState();
        await showAdminPanel(chatId);
        await bot.sendMessage(chatId, '⌨️ *کیبورد حذف شد*', {
            parse_mode: 'Markdown',
            reply_markup: { remove_keyboard: true }
        });
        return;
    }

    // Handle broadcast content
    if (adminState.awaitingMessage && msg.text) {
        await broadcastText(chatId, msg.text);
    } else if (adminState.awaitingImage && msg.photo) {
        await broadcastImage(chatId, msg.photo[msg.photo.length - 1].file_id);
    } else if (adminState.awaitingImageCaption) {
        if (msg.photo) {
            adminState.tempImageId = msg.photo[msg.photo.length - 1].file_id;
            await bot.sendMessage(chatId, strings.prompts.imageCaption, {
                parse_mode: 'Markdown'
            });
        } else if (msg.text && adminState.tempImageId) {
            await broadcastImageWithCaption(chatId, adminState.tempImageId, msg.text);
        }
    } else if (adminState.awaitingAudio && (msg.audio || msg.voice)) {
        await broadcastAudio(chatId, msg.audio || msg.voice);
    }
}));

// Broadcast handlers
async function broadcastText(chatId, text) {
    await updateStatus(chatId, strings.status.sending);
    for (const targetId of broadcastTargets) {
        try {
            await bot.sendMessage(targetId, text);
        } catch (error) {
            handleBroadcastError(targetId, error);
        }
    }
    await finalizeBroadcast(chatId);
}

async function broadcastImage(chatId, fileId) {
    await updateStatus(chatId, strings.status.sending);
    for (const targetId of broadcastTargets) {
        try {
            await bot.sendPhoto(targetId, fileId);
        } catch (error) {
            handleBroadcastError(targetId, error);
        }
    }
    await finalizeBroadcast(chatId);
}

async function broadcastImageWithCaption(chatId, fileId, caption) {
    await updateStatus(chatId, strings.status.sending);
    for (const targetId of broadcastTargets) {
        try {
            await bot.sendPhoto(targetId, fileId, { caption });
        } catch (error) {
            handleBroadcastError(targetId, error);
        }
    }
    await finalizeBroadcast(chatId);
}

async function broadcastAudio(chatId, audio) {
    await updateStatus(chatId, strings.status.sending);
    const sendMethod = audio.duration ? bot.sendAudio : bot.sendVoice;
    for (const targetId of broadcastTargets) {
        try {
            await sendMethod.call(bot, targetId, audio.file_id);
        } catch (error) {
            handleBroadcastError(targetId, error);
        }
    }
    await finalizeBroadcast(chatId);
}

// Helper functions
function resetAdminState() {
    Object.keys(adminState).forEach(key => {
        adminState[key] = typeof adminState[key] === 'boolean' ? false : null;
    });
}

async function updateStatus(chatId, status) {
    try {
        await bot.editMessageText(status, {
            chat_id: chatId,
            message_id: adminState.lastMessageId,
            parse_mode: 'Markdown'
        });
    } catch (error) {
        console.error('Status update failed:', error);
    }
}

function handleBroadcastError(targetId, error) {
    console.error(`Broadcast failed for ${targetId}:`, error.message);
    if (error.code === 403) {
        broadcastTargets.delete(targetId);
    }
}

async function finalizeBroadcast(chatId) {
    await bot.editMessageText(strings.status.success, {
        chat_id: chatId,
        message_id: adminState.lastMessageId,
        parse_mode: 'Markdown'
    });
    
    setTimeout(() => showAdminPanel(chatId), 2000);
}

// Handle new chats
bot.on('my_chat_member', (msg) => {
    const { id: chatId, type } = msg.chat;
    const status = msg.new_chat_member?.status;

    if (type === 'private') return;

    if (status === 'member' || status === 'administrator') {
        broadcastTargets.add(chatId);
        console.log(`✅ Added chat: ${chatId}`);
    } else if (status === 'kicked' || status === 'left') {
        broadcastTargets.delete(chatId);
        console.log(`❌ Removed chat: ${chatId}`);
    }
});

// Error handler for unhandled rejections
process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

console.log('🤖 Bot is running...');
