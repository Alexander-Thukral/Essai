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
} from '../services/supabase.js';
import { generateRecommendation } from '../services/curator.js';
import { verifyLink } from '../services/linkVerifier.js';
import { getTopPreferences, formatPreferences, initializeDefaultTags } from '../services/tasteLearner.js';

export async function handleStart(bot, msg) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;

    // Create user if not exists
    const user = await getUser(telegramId) || await createUser(telegramId, username, false);

    // Initialize default preferences if new user
    let prefs = await getTopPreferences(user.id, 100);
    if (!prefs.length) {
        await initializeDefaultTags(user.id);
        prefs = await getTopPreferences(user.id, 100);
    }

    // Format preference bars for display (show ALL)
    const prefDisplay = formatPreferences(prefs);

    const message = `📚 **Welcome to Essai!**

I'm your personal reading curator. I find intellectually stimulating essays, papers, and articles tailored to your interests.

📊 **Your Starting Interests:**
${prefDisplay}

_All topics start at 50%. As you rate recommendations (⭐1-5), I'll learn what you enjoy!_

**Quick Start:**
1️⃣ Try /recommend to get your first article
2️⃣ Rate it ⭐1-5 to teach me your taste
3️⃣ Use /addtag or /removetag to customize topics

**All Commands:**
• /recommend - Get a reading recommendation
• /preferences - See your taste profile
• /addtag \`topic\` - Add an interest
• /removetag \`topic\` - Remove an interest  
• /settag \`topic\` \`0-100\` - Set exact weight
• /resettaste - Reset to defaults
• /pause / /resume - Toggle scheduled pushes`;

    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

// ============ /recommend ============
export async function handleRecommend(bot, msg) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    const loadingMsg = await bot.sendMessage(chatId,
        '🧠 **Curating recommendations...**\n\n_Step 1: Selecting articles from the canon..._',
        { parse_mode: 'Markdown' }
    );

    try {
        const user = await getUser(telegramId);
        if (!user) throw new Error('User not found');

        const existingUrls = await getExistingUrls(user.id);
        const topPrefs = await getTopPreferences(user.id, 5);

        // Two-step curator: ideas → URLs (parallel)
        const article = await generateRecommendation(topPrefs, existingUrls);

        // Verify primary link
        const verification = await verifyLink(article.url, article.title);
        article.isVerified = verification.isValid;

        // If primary fails verification, try alternatives
        let deliveredArticle = article;
        let deliveredVerification = verification;

        if (!verification.isValid && article.alternatives?.length > 0) {
            console.log(`⚠️ Primary link invalid, trying alternatives...`);
            for (const alt of article.alternatives) {
                const altVerify = await verifyLink(alt.url, alt.title);
                if (altVerify.isValid) {
                    deliveredArticle = { ...alt, alternatives: article.alternatives.filter(a => a !== alt) };
                    deliveredVerification = altVerify;
                    console.log(`✅ Alternative found: "${alt.title}"`);
                    break;
                }
            }
        }

        await bot.deleteMessage(chatId, loadingMsg.message_id);

        // Save to database
        const savedRec = await saveRecommendation(deliveredArticle);

        // Build message — ALWAYS deliver, never error
        const categoryEmoji = deliveredArticle.category === 'classic' ? '🏛️' : '💎';
        const tags = (deliveredArticle.tags || []).map(t => `#${t.replace(/\s+/g, '')}`).join(' ');

        // Status emoji based on verification confidence
        let statusEmoji = '✅';
        let statusNote = '';
        if (deliveredVerification.isSearchFallback || deliveredArticle.is_search_fallback) {
            statusEmoji = '🔎';
            statusNote = '\n_Link goes to Google Search — look for the article there_';
        } else if (deliveredVerification.isPaywall) {
            statusEmoji = '⚠️';
            statusNote = '\n_May require subscription_';
        } else if (!deliveredVerification.isValid) {
            statusEmoji = '❓';
            statusNote = '\n_Link not verified — may not work_';
        }

        let message = `${categoryEmoji} **${deliveredArticle.title}**\n_by ${deliveredArticle.author}_`;
        if (deliveredArticle.publication) {
            message += ` — _${deliveredArticle.publication}_`;
        }
        message += `\n\n${deliveredArticle.description}`;
        message += `\n\n💡 **Why this?** ${deliveredArticle.reason}`;
        message += `\n\n${tags}`;
        message += `\n\n🔗 [Read](${deliveredArticle.url}) ${statusEmoji}${statusNote}`;

        // Add alternatives
        if (deliveredArticle.alternatives?.length > 0) {
            message += `\n\n📚 **Also recommended:**`;
            deliveredArticle.alternatives.forEach(r => {
                const altEmoji = r.is_search_fallback ? '🔎' : '';
                message += `\n• [${r.title}](${r.url}) ${altEmoji} — _${r.author}_`;
            });
        }

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
                    [{ text: '🎲 Recommend Something Else', callback_data: `rate:${savedRec.id}:0:reroll` }]
                ]
            }
        });

        await saveUserRecommendation(user.id, savedRec.id, sentMsg.message_id);
    } catch (error) {
        console.error('Recommend error:', error);
        await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => { });
        await bot.sendMessage(chatId, `❌ Failed to generate recommendation. Please try /recommend again.\n\n_Debug: ${error.message?.slice(0, 80)}_`, { parse_mode: 'Markdown' });
    }
}

// ============ /preferences ============
export async function handlePreferences(bot, msg) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const user = await getUser(telegramId);
    if (!user) return bot.sendMessage(chatId, '❌ Please /start first');

    let prefs = await getTopPreferences(user.id, 100);
    if (!prefs.length) {
        await initializeDefaultTags(user.id);
        prefs = await getTopPreferences(user.id, 100);
    }
    const display = formatPreferences(prefs);
    await bot.sendMessage(chatId, `📊 **Your Interests:**\n\n${display}\n\n_Weights adjust as you rate recommendations ⭐1-5_\n_Use /addtag, /removetag, /settag to customize_`, { parse_mode: 'Markdown' });
}

// ============ /debug ============
export async function handleDebug(bot, msg) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    await bot.sendMessage(chatId, `🔧 **Debug Info**\n\n• User ID: \`${telegramId}\`\n• Mode: Polling\n• Curator: Two-step (llama-3.3 + compound-mini)`, { parse_mode: 'Markdown' });
}

// ============ /pause, /resume ============
export async function handlePause(bot, msg) {
    const telegramId = msg.from.id;
    await updateUserScheduleStatus(telegramId, false);
    await bot.sendMessage(msg.chat.id, '⏸️ Scheduled recommendations paused.');
}

export async function handleResume(bot, msg) {
    const telegramId = msg.from.id;
    await updateUserScheduleStatus(telegramId, true);
    await bot.sendMessage(msg.chat.id, '▶️ Scheduled recommendations resumed!');
}

// ============ /settag, /addtag, /removetag, /resettaste ============
export async function handleSetTag(bot, msg, match) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const user = await getUser(telegramId);
    if (!user) return bot.sendMessage(chatId, '❌ Please /start first');

    const args = match?.[1];
    if (!args) return bot.sendMessage(chatId, '⚠️ Usage: /settag <Tag Name> <Weight>');

    const lastSpace = args.lastIndexOf(' ');
    if (lastSpace === -1) return bot.sendMessage(chatId, '⚠️ Usage: /settag <Tag Name> <Weight>');

    const tag = args.substring(0, lastSpace).trim();
    const weight = parseInt(args.substring(lastSpace + 1), 10);

    if (isNaN(weight) || weight < 0 || weight > 100) return bot.sendMessage(chatId, '⚠️ Weight must be 0-100');

    await setUserPreference(user.id, tag, weight);
    await bot.sendMessage(chatId, `✅ Set **${tag}** to ${weight}%`, { parse_mode: 'Markdown' });
}

export async function handleAddTag(bot, msg, match) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const user = await getUser(telegramId);
    if (!user) return bot.sendMessage(chatId, '❌ Please /start first');

    const tag = match?.[1];
    if (!tag) return bot.sendMessage(chatId, '⚠️ Usage: /addtag <Tag Name>');

    await setUserPreference(user.id, tag.trim(), 50);
    await bot.sendMessage(chatId, `✅ Added interest: **${tag.trim()}**`, { parse_mode: 'Markdown' });
}

export async function handleRemoveTag(bot, msg, match) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const user = await getUser(telegramId);
    if (!user) return bot.sendMessage(chatId, '❌ Please /start first');

    const tag = match?.[1];
    if (!tag) return bot.sendMessage(chatId, '⚠️ Usage: /removetag <Tag Name>');

    await removeUserPreference(user.id, tag.trim());
    await bot.sendMessage(chatId, `🗑️ Removed interest: **${tag.trim()}**`, { parse_mode: 'Markdown' });
}

export async function handleResetTaste(bot, msg) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const user = await getUser(telegramId);
    if (!user) return bot.sendMessage(chatId, '❌ Please /start first');

    await resetUserPreferences(user.id);
    await bot.sendMessage(chatId, '🔄 Taste profile reset. Use /preferences to see defaults.');
}
