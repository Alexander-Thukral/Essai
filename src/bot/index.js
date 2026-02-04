import TelegramBot from 'node-telegram-bot-api';
import config from '../config.js';
import {
    handleStart,
    handleRecommend,
    handlePreferences,
    handleDebug,
    handlePause,
    handleResume,
    handleSetTag,
    handleAddTag,
    handleRemoveTag,
    handleResetTaste
} from './commands.js';
import { handleRatingCallback, handleApprovalCallback } from './callbacks.js';
import { getUser, createUser } from '../services/supabase.js';

// Create bot instance
// If running on Vercel, disable polling (use webhooks)
// Also 'filepath: false' improves performance in serverless by disabling file download support which we don't use
const isVercel = process.env.VERCEL === '1';
const bot = new TelegramBot(config.telegram.token, { polling: !isVercel, filepath: false });

if (!isVercel) {
    console.log('📚 Essai Bot starting (Polling Mode)...');
} else {
    console.log('🚀 Essai Bot initialized (Serverless Mode)');
}

// ============ ACCESS CONTROL WRAPPER ============

/**
 * Check if user is approved. If not, request approval from Admin.
 */
function withAccessControl(handler) {
    return async (msg, match) => {
        const telegramId = msg.from.id;
        const username = msg.from.username || msg.from.first_name;

        try {
            // Get or create user
            let user = await getUser(telegramId);
            const isAdmin = telegramId === config.telegram.ownerId;

            if (!user) {
                // Determine initial status based on admin match
                user = await createUser(telegramId, username, isAdmin);
            }

            // If Admin, always allow
            if (isAdmin) {
                return handler(bot, msg, match);
            }

            // Check db status
            if (user.status === 'blocked') {
                await bot.sendMessage(msg.chat.id, '⛔ Access denied.');
                return;
            }

            if (user.status === 'pending') {
                await bot.sendMessage(msg.chat.id, '🔒 **Access Pending**\n\nThis is a private bot. I have sent a request to the owner to approve your access.', { parse_mode: 'Markdown' });

                // Notify Owner
                if (config.telegram.ownerId) {
                    await bot.sendMessage(config.telegram.ownerId, `👤 **New Access Request**\n\nUser: ${username} (ID: \`${telegramId}\`)\n\nAllow access?`, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '✅ Allow', callback_data: `approve:${telegramId}` },
                                    { text: '❌ Deny', callback_data: `deny:${telegramId}` }
                                ]
                            ]
                        }
                    });
                } else {
                    console.warn('⚠️ No ownerId configured to approve requests!');
                }
                return;
            }

            // If approved, proceed
            if (user.status === 'approved') {
                return handler(bot, msg, match);
            }

        } catch (error) {
            console.error('Access control error:', error);
            await bot.sendMessage(msg.chat.id, '❌ Server error checking access.');
        }
    };
}

// ============ COMMAND HANDLERS ============

bot.onText(/\/start/, withAccessControl(handleStart));
bot.onText(/\/recommend/, withAccessControl(handleRecommend));
bot.onText(/\/preferences/, withAccessControl(handlePreferences));
bot.onText(/\/debug/, withAccessControl(handleDebug));
bot.onText(/\/pause/, withAccessControl(handlePause));
bot.onText(/\/resume/, withAccessControl(handleResume));
bot.onText(/\/settag(?:\s+(.+))?/, withAccessControl(handleSetTag));
bot.onText(/\/addtag(?:\s+(.+))?/, withAccessControl(handleAddTag));
bot.onText(/\/removetag(?:\s+(.+))?/, withAccessControl(handleRemoveTag));
bot.onText(/\/resettaste/, withAccessControl(handleResetTaste));

// ============ CALLBACK HANDLERS ============

bot.on('callback_query', async (query) => {
    const telegramId = query.from.id;
    const data = query.data;

    try {
        // Approval callbacks (Admin only)
        if (data.startsWith('approve:') || data.startsWith('deny:')) {
            if (telegramId === config.telegram.ownerId) {
                await handleApprovalCallback(bot, query);
            } else {
                await bot.answerCallbackQuery(query.id, { text: '🔒 Admin only' });
            }
            return;
        }

        // Rating callbacks (Approved users only)
        const user = await getUser(telegramId);
        if (!user || user.status !== 'approved') {
            // Allow admin to rate too
            if (telegramId !== config.telegram.ownerId) {
                await bot.answerCallbackQuery(query.id, { text: '🔒 Pending approval' });
                return;
            }
        }

        if (data.startsWith('rate:')) {
            await handleRatingCallback(bot, query);
        }
    } catch (error) {
        console.error('Unhandled callback error:', error);
    }
});

// ============ ERROR HANDLING ============

// Only attach polling error handler if polling
if (!isVercel) {
    bot.on('polling_error', (error) => {
        console.error('Polling error:', error.code, error.message);
    });
}

bot.on('error', (error) => {
    console.error('Bot error:', error);
});

// Graceful shutdown (only needed for polling)
if (!isVercel) {
    process.on('SIGINT', () => {
        console.log('\n👋 Shutting down bot...');
        bot.stopPolling();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('\n👋 Shutting down bot...');
        bot.stopPolling();
        process.exit(0);
    });

    console.log('✅ Essai Bot is running!');
    console.log('📌 Commands: /start, /recommend, /preferences, /settag, /addtag, /removetag, /resettaste, /pause, /resume, /debug');
}

export default bot;
