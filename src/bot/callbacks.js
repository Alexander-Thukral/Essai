import {
    getUser,
    updateRating,
    getUserRecommendationByMessageId,
    approveUser,
    blockUser
} from '../services/supabase.js';
import { updateTasteFromRating } from '../services/tasteLearner.js';
import { handleRecommend } from './commands.js';

/**
 * Handle approval callback (Admin only)
 * Callback data formats: 
 * - approve:{telegramId}
 * - deny:{telegramId}
 */
export async function handleApprovalCallback(bot, query) {
    const data = query.data;
    const [action, targetIdStr] = data.split(':');
    const targetId = parseInt(targetIdStr, 10);
    const adminId = query.from.id;

    try {
        if (action === 'approve') {
            await approveUser(targetId, adminId);
            await bot.answerCallbackQuery(query.id, { text: 'User approved!' });

            // Notify Admin
            await bot.editMessageText(`✅ **Access Granted** to user ${targetId}\nApproved by you.`, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                parse_mode: 'Markdown'
            });

            // Notify User
            await bot.sendMessage(targetId, '🎉 **Access Granted!**\n\nYou have been approved to use Essai.\nTap /start to begin your journey.');

        } else if (action === 'deny') {
            await blockUser(targetId);
            await bot.answerCallbackQuery(query.id, { text: 'User blocked' });

            // Notify Admin
            await bot.editMessageText(`🚫 **Access Denied** for user ${targetId}`, {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id,
                parse_mode: 'Markdown'
            });

            // Notify User (Optional, maybe silence is better?)
            await bot.sendMessage(targetId, '❌ Your request for access was declined.');
        }

    } catch (error) {
        console.error('Error in approval callback:', error);
        await bot.answerCallbackQuery(query.id, { text: 'Failed to process request', show_alert: true });
    }
}

/**
 * Handle rating button callback
 * Callback data format: rate:{recommendationId}:{rating}:{flags?}
 */
export async function handleRatingCallback(bot, query) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const telegramId = query.from.id;
    const data = query.data;

    try {
        // Parse callback data: rate:123:0:reroll
        const parts = data.split(':');
        const action = parts[0];
        const recommendationId = parts[1];
        const ratingStr = parts[2];
        const flag = parts[3]; // 'reroll' or undefined

        if (action !== 'rate') {
            await bot.answerCallbackQuery(query.id, { text: 'Unknown action' });
            return;
        }

        const rating = parseInt(ratingStr, 10);

        // Get user
        const user = await getUser(telegramId);
        if (!user) {
            await bot.answerCallbackQuery(query.id, { text: 'Please /start first' });
            return;
        }

        // Update rating in database
        const userRec = await updateRating(user.id, recommendationId, rating);

        if (!userRec) {
            await bot.answerCallbackQuery(query.id, { text: 'Recommendation not found' });
            return;
        }

        // Update taste profile based on rating
        if (rating > 0 && userRec.recommendations?.tags) {
            await updateTasteFromRating(user.id, userRec.recommendations.tags, rating);
        }

        // Handle Reroll
        if (flag === 'reroll') {
            await bot.answerCallbackQuery(query.id, { text: 'Finding something else... 🎲' });

            // Edit previous message to say "Skipped"
            const originalText = query.message.text || '';
            await bot.editMessageText(`${originalText}\n\n⏭️ _Skipped - finding another_`, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
                reply_markup: { inline_keyboard: [] }
            });

            // Trigger new recommendation
            // We need to construct a fake message object that matches what handleRecommend expects
            const fakeMsg = {
                chat: { id: chatId },
                from: { id: telegramId, username: user.telegram_username, first_name: query.from.first_name }
            };

            // Call handleRecommend asynchronously
            handleRecommend(bot, fakeMsg).catch(err => console.error('Reroll error:', err));
            return;
        }

        // Normal Rating handling
        const ratingEmoji = rating === 0 ? '⏭️ Skipped' : '⭐'.repeat(rating);
        const feedbackText = rating === 0
            ? 'Skipped - won\'t affect your preferences'
            : `Rated ${rating}/5 - taste profile updated!`;

        // Edit the message to remove buttons and show rating
        const originalText = query.message.text || '';
        const updatedText = `${originalText}\n\n${ratingEmoji} _${feedbackText}_`;

        await bot.editMessageText(updatedText, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            disable_web_page_preview: false,
            reply_markup: { inline_keyboard: [] } // Remove buttons
        });

        await bot.answerCallbackQuery(query.id, {
            text: rating === 0 ? 'Skipped!' : `Rated ${rating}/5!`
        });

        console.log(`⭐ User ${telegramId} rated recommendation ${recommendationId}: ${rating}/5`);
    } catch (error) {
        console.error('Error in rating callback:', error);
        await bot.answerCallbackQuery(query.id, {
            text: '❌ Failed to save rating',
            show_alert: true
        });
    }
}

export default { handleRatingCallback, handleApprovalCallback };
