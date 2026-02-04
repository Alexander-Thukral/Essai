import {
    createUser,
    getUser,
    saveRecommendation,
    saveUserRecommendation,
    getExistingUrls,
    getUserPreferences,
    updateUserScheduleStatus,
    setUserPreference,
    removeUserPreference,
    resetUserPreferences,
    updateRecommendationVerification
} from '../services/supabase.js';
import { generateRecommendation } from '../services/gemini.js';
import { verifyLink } from '../services/linkVerifier.js';
import { getTopPreferences, formatPreferences } from '../services/tasteLearner.js';

// Store last debug info per user
const debugStore = new Map();

/**
 * Handle /start command - Register user
 */
export async function handleStart(bot, msg) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;

    try {
        const user = await createUser(telegramId, username);

        const welcomeMessage = `
📚 **Welcome to Essai!**

I'm your personal reading curator. I find intellectually stimulating essays, papers, and articles tailored to your interests.

**Commands:**
• /recommend - Get a reading recommendation
• /preferences - See your taste profile
• /settag \`tag\` \`weight\` - Set a tag weight (0-100)
• /addtag \`tag\` - Add new interest
• /removetag \`tag\` - Remove a tag
• /resettaste - Reset all preferences
• /pause / /resume - Toggle scheduled pushes
• /debug - Show last recommendation details

Start with /preferences to see your interests, then /recommend!
    `.trim();

        await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
        console.log(`✅ User registered: ${username} (${telegramId})`);
    } catch (error) {
        console.error('Error in /start:', error);
        await bot.sendMessage(chatId, '❌ Something went wrong. Please try again.');
    }
}

/**
 * Handle /recommend command - Get a reading suggestion
 */
export async function handleRecommend(bot, msg) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    try {
        const user = await getUser(telegramId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Please /start first.');
            return;
        }

        // Send "thinking" status
        const loadingMsg = await bot.sendMessage(chatId, '🧠 **Curating detailed recommendations...**\n\n_Exploring libraries, journals, and archives_ 🏛️', { parse_mode: 'Markdown' });

        // Get recent recommendations to avoid duplicates
        const existingUrls = await getExistingUrls(user.id);

        // Get user preferences
        const topPrefs = await getTopPreferences(user.id, 5);

        let article = null;
        let verification = null;

        // Generate recommendation (returns primary + alternatives)
        // Groq API call incorporates search, so reliability is high
        article = await generateRecommendation(topPrefs, existingUrls);

        // Verify PRIMARY link
        verification = await verifyLink(article.url);

        // Delete loading message
        await bot.deleteMessage(chatId, loadingMsg.message_id);

        if (!article) {
            await bot.sendMessage(chatId, '❌ Could not find a suitable recommendation. Please try again.');
            return;
        }

        article.isVerified = verification.isValid;

        // Save primary to database
        const savedRec = await saveRecommendation(article);
        await updateRecommendationVerification(savedRec.id, verification.isValid);

        // Store debug info
        debugStore.set(telegramId, {
            article,
            verification,
            timestamp: new Date().toISOString()
        });

        // Format primary recommendation
        const verifiedEmoji = verification.isPaywall ? '⚠️' : (verification.isValid ? '✅' : '❓');
        const categoryEmoji = article.category === 'classic' ? '🏛️' : '💎';
        const pdfEmoji = article.is_pdf ? '📄' : '';
        // Handle tags safely
        const tagsList = Array.isArray(article.tags) ? article.tags : [];
        const tagsFormatted = tagsList.map(t => `#${t.replace(/\s+/g, '')}`).join(' ');

        let message = `
${categoryEmoji} **${article.title}** ${pdfEmoji}
*by ${article.author}*

${article.description}

💡 **Why this?** ${article.reason}

${tagsFormatted}

🔗 [Read Primary Selection](${article.url}) ${verifiedEmoji}
`.trim();

        // Add alternatives if available
        if (article.alternatives && article.alternatives.length > 0) {
            message += `\n\n📚 **Alternative Readings:**\n`;

            article.alternatives.forEach(rec => {
                const recPdf = rec.is_pdf ? '📄 ' : '';
                message += `\n• [${rec.title}](${rec.url}) ${recPdf}- _${rec.author}_`;
            });
        }

        // Send with rating buttons
        const sentMsg = await bot.sendMessage(chatId, message, {
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
                        { text: '🎲 Recommend Something Else', callback_data: `rate:${savedRec.id}:0:reroll` },
                    ]
                ]
            }
        });

        // Save user-recommendation mapping
        await saveUserRecommendation(user.id, savedRec.id, sentMsg.message_id);

        console.log(`📚 Sent recommendations to ${telegramId}: ${article.title}`);
    } catch (error) {
        console.error('Error in /recommend:', error);
        await bot.sendMessage(chatId, '❌ Failed to generate recommendation. Please try again.');
    }
}

/**
 * Handle /preferences command - Show taste profile
 */
export async function handlePreferences(bot, msg) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    try {
        const user = await getUser(telegramId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Please /start first.');
            return;
        }

        const topPrefs = await getTopPreferences(user.id, 7);
        const formatted = formatPreferences(topPrefs);

        await bot.sendMessage(chatId, formatted, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Error in /preferences:', error);
        await bot.sendMessage(chatId, '❌ Failed to load preferences.');
    }
}

/**
 * Handle /debug command - Show last recommendation details
 */
export async function handleDebug(bot, msg) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    try {
        const debugInfo = debugStore.get(telegramId);

        if (!debugInfo) {
            await bot.sendMessage(chatId, '🔍 No recent recommendations to debug.');
            return;
        }

        const message = `
🔧 **Debug Info**

**Last Request:** ${debugInfo.timestamp}

**Article:**
• Title: ${debugInfo.article.title}
• Author: ${debugInfo.article.author}
• URL: ${debugInfo.article.url}

**Verification:**
• Valid: ${debugInfo.verification.isValid ? 'Yes ✅' : 'No ❌'}
• Status: ${debugInfo.verification.status || 'N/A'}
${debugInfo.verification.reason ? `• Reason: ${debugInfo.verification.reason}` : ''}

**Tags:** ${Array.isArray(debugInfo.article.tags) ? debugInfo.article.tags.join(', ') : ''}

**Alternatives:** ${debugInfo.article.alternatives ? debugInfo.article.alternatives.length : 0}
    `.trim();

        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Error in /debug:', error);
        await bot.sendMessage(chatId, '❌ Failed to load debug info.');
    }
}

/**
 * Handle /pause command - Stop scheduled recommendations
 */
export async function handlePause(bot, msg) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    try {
        await updateUserScheduleStatus(telegramId, false);
        await bot.sendMessage(chatId, '⏸️ Scheduled recommendations paused. Use /resume to continue.');
    } catch (error) {
        console.error('Error in /pause:', error);
        await bot.sendMessage(chatId, '❌ Failed to pause.');
    }
}

/**
 * Handle /resume command - Resume scheduled recommendations
 */
export async function handleResume(bot, msg) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    try {
        await updateUserScheduleStatus(telegramId, true);
        await bot.sendMessage(chatId, '▶️ Scheduled recommendations resumed!');
    } catch (error) {
        console.error('Error in /resume:', error);
        await bot.sendMessage(chatId, '❌ Failed to resume.');
    }
}

/**
 * Handle /settag command - Manually set tag weight
 */
export async function handleSetTag(bot, msg, match) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const input = match[1]; // "TagName 80"

    try {
        const user = await getUser(telegramId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Please /start first.');
            return;
        }

        if (!input) {
            await bot.sendMessage(chatId, '⚠️ Usage: /settag <TagName> <Weight(0-100)>');
            return;
        }

        const parts = input.split(' ');
        const weight = parseInt(parts.pop(), 10);
        const tag = parts.join(' ');

        if (isNaN(weight) || weight < 0 || weight > 100) {
            await bot.sendMessage(chatId, '⚠️ Weight must be a number between 0 and 100.');
            return;
        }

        await setUserPreference(user.id, tag, weight / 100); // Normalize to 0-1
        await bot.sendMessage(chatId, `✅ Set **${tag}** to ${weight}%`, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error in /settag:', error);
        await bot.sendMessage(chatId, '❌ Failed to set tag.');
    }
}

/**
 * Handle /addtag command - Add interest (default 50%)
 */
export async function handleAddTag(bot, msg, match) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const tag = match[1];

    try {
        const user = await getUser(telegramId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Please /start first.');
            return;
        }

        if (!tag) {
            await bot.sendMessage(chatId, '⚠️ Usage: /addtag <TagName>');
            return;
        }

        await setUserPreference(user.id, tag, 0.5);
        await bot.sendMessage(chatId, `✅ Added interest: **${tag}**`, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error in /addtag:', error);
        await bot.sendMessage(chatId, '❌ Failed to add tag.');
    }
}

/**
 * Handle /removetag command - Remove interest
 */
export async function handleRemoveTag(bot, msg, match) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const tag = match[1];

    try {
        const user = await getUser(telegramId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Please /start first.');
            return;
        }

        if (!tag) {
            await bot.sendMessage(chatId, '⚠️ Usage: /removetag <TagName>');
            return;
        }

        await removeUserPreference(user.id, tag);
        await bot.sendMessage(chatId, `🗑️ Removed interest: **${tag}**`, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error in /removetag:', error);
        await bot.sendMessage(chatId, '❌ Failed to remove tag.');
    }
}

/**
 * Handle /resettaste command - Reset all preferences
 */
export async function handleResetTaste(bot, msg) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    try {
        const user = await getUser(telegramId);
        if (!user) return;

        await resetUserPreferences(user.id);
        await bot.sendMessage(chatId, '🔄 Taste profile reset to defaults.');

    } catch (error) {
        console.error('Error in /resettaste:', error);
        await bot.sendMessage(chatId, '❌ Failed to reset taste.');
    }
}
