/**
 * Scheduled Push Job
 * Run this via Windows Task Scheduler every 2 days
 * Command: node src/jobs/scheduledPush.js
 */

import TelegramBot from 'node-telegram-bot-api';
import config from '../config.js';
import {
    getScheduledUsers,
    getUserPreferences,
    getExistingUrls,
    saveRecommendation,
    saveUserRecommendation,
    updateRecommendationVerification
} from '../services/supabase.js';
import { generateRecommendation } from '../services/gemini.js';
import { verifyLink } from '../services/linkVerifier.js';

// Create bot instance (no polling, just for sending)
const bot = new TelegramBot(config.telegram.token, { polling: false });

async function sendRecommendationToUser(user) {
    try {
        console.log(`📤 Sending to: ${user.telegram_username || user.telegram_id}`);

        // Get user preferences and existing URLs
        const [preferences, existingUrls] = await Promise.all([
            getUserPreferences(user.id),
            getExistingUrls(user.id)
        ]);

        // Generate recommendation
        const article = await generateRecommendation(preferences, existingUrls);

        // Verify link
        const verification = await verifyLink(article.url);
        article.isVerified = verification.isValid;

        // Save to database
        const savedRec = await saveRecommendation(article);
        await updateRecommendationVerification(savedRec.id, verification.isValid);

        // Format and send
        const verifiedEmoji = verification.isValid ? '✅' : '⚠️';
        const tagsFormatted = article.tags.map(t => `#${t.replace(/\s+/g, '')}`).join(' ');

        const message = `
📚 **${article.title}**
*by ${article.author}*

${article.description}

💡 **Why this?** ${article.reason}

${tagsFormatted}

🔗 [Read article](${article.url}) ${verifiedEmoji}
    `.trim();

        const sentMsg = await bot.sendMessage(user.telegram_id, message, {
            parse_mode: 'Markdown',
            disable_web_page_preview: false,
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '⭐1', callback_data: `rate:${savedRec.id}:1` },
                        { text: '⭐2', callback_data: `rate:${savedRec.id}:2` },
                        { text: '⭐3', callback_data: `rate:${savedRec.id}:3` },
                        { text: '⭐4', callback_data: `rate:${savedRec.id}:4` },
                        { text: '⭐5', callback_data: `rate:${savedRec.id}:5` },
                    ],
                    [
                        { text: '⏭️ Skip', callback_data: `rate:${savedRec.id}:0` },
                    ]
                ]
            }
        });

        // Save mapping
        await saveUserRecommendation(user.id, savedRec.id, sentMsg.message_id);

        console.log(`  ✅ Sent: ${article.title}`);
        return { success: true, userId: user.id };
    } catch (error) {
        console.error(`  ❌ Failed for ${user.telegram_id}:`, error.message);
        return { success: false, userId: user.id, error: error.message };
    }
}

async function main() {
    console.log('🚀 Starting scheduled push...');
    console.log(`📅 ${new Date().toISOString()}`);

    try {
        // Get all users who want scheduled recommendations
        const users = await getScheduledUsers();
        console.log(`📋 Found ${users.length} users to notify`);

        if (users.length === 0) {
            console.log('No users to notify. Exiting.');
            process.exit(0);
        }

        // Process users sequentially to avoid rate limits
        const results = [];
        for (const user of users) {
            const result = await sendRecommendationToUser(user);
            results.push(result);

            // Small delay between users
            await new Promise(r => setTimeout(r, 2000));
        }

        // Summary
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        console.log('\n📊 Summary:');
        console.log(`  ✅ Successful: ${successful}`);
        console.log(`  ❌ Failed: ${failed}`);

        process.exit(failed > 0 ? 1 : 0);
    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
}

main();
