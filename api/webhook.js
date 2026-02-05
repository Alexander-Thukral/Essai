// Vercel Serverless Function - Self-contained webhook handler
import TelegramBot from 'node-telegram-bot-api';
import { createClient } from '@supabase/supabase-js';
import Groq from 'groq-sdk';
import axios from 'axios';

// ============ CONFIGURATION ============
const config = {
    telegram: {
        token: process.env.TELEGRAM_BOT_TOKEN,
        ownerId: process.env.ALLOWED_TELEGRAM_IDS
            ? parseInt(process.env.ALLOWED_TELEGRAM_IDS.split(',')[0].trim(), 10)
            : null,
    },
    supabase: {
        url: process.env.SUPABASE_URL,
        anonKey: process.env.SUPABASE_ANON_KEY,
    },
    groq: {
        apiKey: process.env.GROQ_API_KEY,
    },
};

// ============ CLIENTS ============
const bot = new TelegramBot(config.telegram.token, { polling: false, filepath: false });
const supabase = createClient(config.supabase.url, config.supabase.anonKey);

// ============ DATABASE HELPERS ============
async function getUser(telegramId) {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId)
        .single();
    if (error && error.code !== 'PGRST116') console.error('getUser error:', error);
    return data;
}

async function createUser(telegramId, username, isAdmin = false) {
    const status = isAdmin ? 'approved' : 'pending';
    const { data, error } = await supabase
        .from('users')
        .upsert({ telegram_id: telegramId, telegram_username: username, status }, { onConflict: 'telegram_id' })
        .select()
        .single();
    if (error) {
        console.error('createUser error:', error);
        throw new Error(`DB Error (createUser): ${error.message}`);
    }
    return data;
}

async function approveUser(telegramId) {
    const { error } = await supabase
        .from('users')
        .update({ status: 'approved' })
        .eq('telegram_id', telegramId);
    if (error) console.error('approveUser error:', error);
}

async function blockUser(telegramId) {
    const { error } = await supabase
        .from('users')
        .update({ status: 'blocked' })
        .eq('telegram_id', telegramId);
    if (error) console.error('blockUser error:', error);
}

async function getTopPreferences(userId, limit = 5) {
    const { data, error } = await supabase
        .from('user_preferences')
        .select('tag, weight')
        .eq('user_id', userId)
        .order('weight', { ascending: false })
        .limit(limit);
    if (error) console.error('getTopPreferences error:', error);
    return data || [];
}

async function getExistingUrls(userId) {
    const { data, error } = await supabase
        .from('user_recommendations')
        .select('recommendations(url)')
        .eq('user_id', userId);
    if (error) return [];
    return data?.map(r => r.recommendations?.url).filter(Boolean) || [];
}

async function saveRecommendation(article) {
    const { data, error } = await supabase
        .from('recommendations')
        .upsert({
            url: article.url,
            title: article.title,
            author: article.author,
            description: article.description,
            tags: article.tags || [],
        }, { onConflict: 'url' })
        .select()
        .single();
    if (error) {
        console.error('saveRecommendation error:', error);
        throw new Error(`DB Error (saveRecommendation): ${error.message}`);
    }
    return data;
}

async function saveUserRecommendation(userId, recId, messageId) {
    const { error } = await supabase
        .from('user_recommendations')
        .insert({ user_id: userId, recommendation_id: recId, message_id: messageId });
    if (error) console.error('saveUserRecommendation error:', error);
}

async function updateRating(userId, recId, rating) {
    const { data, error } = await supabase
        .from('user_recommendations')
        .update({ rating })
        .eq('user_id', userId)
        .eq('recommendation_id', recId)
        .select('*, recommendations(*)')
        .single();
    if (error) console.error('updateRating error:', error);
    return data;
}

async function updateUserScheduleStatus(telegramId, receiveScheduled) {
    const { error } = await supabase
        .from('users')
        .update({ receive_scheduled: receiveScheduled })
        .eq('telegram_id', telegramId);
    if (error) console.error('updateUserScheduleStatus error:', error);
}

async function setUserPreference(userId, tag, weight) {
    const clampedWeight = Math.max(0, Math.min(100, weight));
    const { error } = await supabase
        .from('user_preferences')
        .upsert({
            user_id: userId,
            tag,
            weight: clampedWeight,
            sample_count: 1,
        }, { onConflict: 'user_id,tag' });
    if (error) console.error('setUserPreference error:', error);
}

async function removeUserPreference(userId, tag) {
    const { error } = await supabase
        .from('user_preferences')
        .delete()
        .eq('user_id', userId)
        .ilike('tag', tag);
    if (error) console.error('removeUserPreference error:', error);
}

async function resetUserPreferences(userId) {
    const { error } = await supabase
        .from('user_preferences')
        .delete()
        .eq('user_id', userId);
    if (error) console.error('resetUserPreferences error:', error);
}

// ============ GROQ RECOMMENDATION ============
const CURATOR_PROMPT = `# ROLE
You are an elite reading curator—a blend of university professor, editor of "Arts & Letters Daily", and librarian with encyclopedic knowledge spanning both canonical classics and hidden gems.

# USER PROFILE
- **Weighted Interests**: [USER_INTERESTS]
- **Intellectual Appetite**: High. Prefers complexity, nuance, original sources, and interdisciplinary synthesis.
- **Experience Level**: Sophisticated reader who appreciates both timeless classics AND unexpected discoveries.

# YOUR TASK
Search the web and recommend 2-3 pieces of exceptional reading material.

# THE CURATOR'S COMPASS: Balance & Depth

Your recommendations should reflect the FULL SPECTRUM of great writing:

## 🏛️ TIMELESS CLASSICS (Include at least one)
The essays and works that have shaped intellectual discourse:
- **The Great Essayists**: Montaigne, Francis Bacon, Virginia Woolf, George Orwell, Joan Didion, James Baldwin, Susan Sontag, Christopher Hitchens, David Foster Wallace, Zadie Smith
- **Philosophical Foundations**: Seneca's letters, Marcus Aurelius, Emerson, Thoreau, William James, Bertrand Russell, Isaiah Berlin, Hannah Arendt
- **Literary Journalism**: New Yorker longform, Paris Review interviews, Granta, Harper's deep dives
- **Canonical Academic Papers**: Seminal works in psychology (Kahneman, Tversky), economics (Coase, Akerlof), game theory (Schelling)

## 💎 HIDDEN GEMS (Include at least one)
The overlooked treasures and modern depth:
- **Independent Thinkers**: Gwern, Scott Alexander (Astral Codex Ten), Paul Graham, Robin Hanson, Tyler Cowen
- **Niche Journals**: Aeon, The New Atlantis, Inference Review, Works in Progress, Quillette, N+1
- **Academic Preprints**: ArXiv, SSRN, PhilPapers, NBER working papers
- **Forgotten Classics**: Out-of-print essays, rehabilitated ideas, historical primary sources

# LINK PRIORITIES
1. **PDFs** - Direct PDF links from academic sources (HIGHEST PRIORITY)
2. **Open Access** - Fully accessible without login (Substack, Medium, Blogs)
3. **Soft Paywall** - Acceptable if content is exceptional (New Yorker, Atlantic)

# EXCLUSIONS (Do NOT Recommend)
- **Full Books** (Amazon, Goodreads, etc.) - The user wants *articles* and *essays* to read now.
- **Videos** (YouTube)
- **Podcasts** (Spotify)
- **Short News** (Reuters, AP) - User wants *analysis* and *depth*.

# OUTPUT FORMAT
Respond with ONLY a JSON object:
{
  "recommendations": [
    {
      "title": "Title of article/essay",
      "author": "Author name",
      "url": "Direct URL (prefer PDF)",
      "description": "2-3 sentence summary of the key insight",
      "reason": "Why this matches user interests + why it's worth reading",
      "tags": ["Tag1", "Tag2"],
      "is_pdf": true/false,
      "category": "classic" or "gem"
    }
  ]
}

Provide 2-3 recommendations. LEAN SLIGHTLY towards 'Hidden Gems' (e.g. 2 Gems, 1 Classic), but keep a mix. Make at least one a PDF if possible. Ensure they are ARTICLES or ESSAYS, not books.`;

async function generateRecommendation(preferences, existingUrls = []) {
    const groq = new Groq({ apiKey: config.groq.apiKey });

    const topInterests = preferences
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 5)
        .map(w => `${w.tag} (${Math.round(w.weight)})% `)
        .join(', ') || 'Philosophy, Psychology, Economics, History, Essays';

    const existingList = existingUrls.length > 0
        ? existingUrls.slice(0, 20).map(url => `- ${url} `).join('\n')
        : '(None yet)';

    const prompt = CURATOR_PROMPT
        .replace('[USER_INTERESTS]', topInterests)
        .replace('[EXISTING_URLS]', existingList);

    console.log(`🧠 Generating recommendations for: ${topInterests} `);

    try {
        const response = await groq.chat.completions.create({
            model: 'groq/compound-mini', // Better for rate limits
            messages: [{ role: 'user', content: prompt }],
        });

        const content = response.choices[0]?.message?.content || '';

        // Robust JSON parsing
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.error('Groq Response Content:', content);
            throw new Error('No JSON found in Groq response');
        }

        const parsed = JSON.parse(jsonMatch[0]);
        const recs = parsed.recommendations || (Array.isArray(parsed) ? parsed : [parsed]);

        if (!recs || recs.length === 0) throw new Error('No recommendations found');

        // Sort: PDFs first
        recs.sort((a, b) => (a.is_pdf === b.is_pdf) ? 0 : a.is_pdf ? -1 : 1);

        const primary = recs[0];
        primary.alternatives = recs.slice(1);

        if (!primary.url || !primary.title) throw new Error('Invalid recommendation structure');

        return primary;
    } catch (error) {
        console.error('Groq Generation Error:', error);
        throw error; // Re-throw to be caught by caller
    }
}

// ============ LINK VERIFIER ============
async function verifyLink(url) {
    try {
        const resp = await axios.get(url, {
            timeout: 8000,
            maxRedirects: 5,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            validateStatus: () => true,
        });
        return { isValid: resp.status >= 200 && resp.status < 400, status: resp.status };
    } catch (e) {
        return { isValid: false, reason: e.message };
    }
}

// ============ COMMAND HANDLERS ============
async function handleStart(chatId, telegramId, username) {
    await createUser(telegramId, username, telegramId === config.telegram.ownerId);

    const message = `📚 ** Welcome to Essai! **

    I'm your personal reading curator. I find intellectually stimulating essays, papers, and articles tailored to your interests.

        ** Commands:**
• /recommend - Get a reading recommendation
• /preferences - See your taste profile
• /settag \`tag\` \`weight\` - Set a tag weight (0-100)
• /addtag \`tag\` - Add new interest
• /removetag \`tag\` - Remove a tag
• /resettaste - Reset all preferences
• /pause / / resume - Toggle scheduled pushes
• /help - Show this list again

Start with /preferences to see your interests, then /recommend!`;

    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

async function handleHelp(chatId) {
    const message = `
** Available Commands:**

• /recommend - Get a reading recommendation
• /preferences - See your taste profile
• /settag <tag> <weight> - Set a tag weight (0-100)
• /addtag <tag> - Add new interest (default 50%)
• /removetag <tag> - Remove a tag
• /resettaste - Reset all preferences
• /pause - Pause scheduled recommendations
• /resume - Resume scheduled recommendations
`;
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

async function handleRecommend(chatId, telegramId, user) {
    const loadingMsg = await bot.sendMessage(chatId, '🧠 **Curating recommendations...**', { parse_mode: 'Markdown' });

    try {
        const existingUrls = await getExistingUrls(user.id);
        const topPrefs = await getTopPreferences(user.id, 5);
        const article = await generateRecommendation(topPrefs, existingUrls);
        const verification = await verifyLink(article.url);

        await bot.deleteMessage(chatId, loadingMsg.message_id);

        const savedRec = await saveRecommendation(article);
        const verifiedEmoji = verification.isValid ? '✅' : '❓';
        const categoryEmoji = article.category === 'classic' ? '🏛️' : '💎';
        const tags = (article.tags || []).map(t => `#${t.replace(/\s+/g, '')} `).join(' ');

        let message = `${categoryEmoji} ** ${article.title}**\n * by ${article.author}*\n\n${article.description} \n\n💡 ** Why this ?** ${article.reason} \n\n${tags} \n\n🔗[Read](${article.url}) ${verifiedEmoji} `;

        if (article.alternatives?.length > 0) {
            message += `\n\n📚 ** Alternatives:** `;
            article.alternatives.forEach(r => {
                message += `\n•[${r.title}](${r.url}) - _${r.author} _`;
            });
        }

        const sentMsg = await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '⭐1', callback_data: `rate:${savedRec.id}: 1` },
                        { text: '⭐2', callback_data: `rate:${savedRec.id}: 2` },
                        { text: '⭐3', callback_data: `rate:${savedRec.id}: 3` },
                        { text: '⭐4', callback_data: `rate:${savedRec.id}: 4` },
                        { text: '⭐5', callback_data: `rate:${savedRec.id}: 5` },
                    ],
                    [{ text: '🎲 Recommend Something Else', callback_data: `rate:${savedRec.id}: 0: reroll` }]
                ]
            }
        });

        await saveUserRecommendation(user.id, savedRec.id, sentMsg.message_id);
    } catch (error) {
        console.error('Recommend error:', error);
        await bot.deleteMessage(chatId, loadingMsg.message_id).catch(() => { });
        console.error('Full Error Object:', JSON.stringify(error, Object.getOwnPropertyNames(error)));

        let errorMsg = '❌ Failed to generate recommendation.';
        if (error.message.includes('JSON')) errorMsg += ' (AI Response Formatting Error)';
        if (error.message.includes('tim')) errorMsg += ' (Timeout)';
        errorMsg += `\n\nDebug: ${error.message.slice(0, 100)} `;

        await bot.sendMessage(chatId, errorMsg);
    }
}

async function handlePreferences(chatId, userId) {
    const prefs = await getTopPreferences(userId, 7);
    if (!prefs.length) {
        await bot.sendMessage(chatId, '📊 No preferences yet. Rate some articles!');
        return;
    }
    const list = prefs.map(p => `• ${p.tag}: ${Math.round(p.weight * 100)}% `).join('\n');
    await bot.sendMessage(chatId, `📊 ** Your Taste Profile:**\n\n${list} `, { parse_mode: 'Markdown' });
}

async function handleSetTag(chatId, userId, args) {
    if (!args) return bot.sendMessage(chatId, '⚠️ Usage: /settag <Tag Name> <Weight>');

    // Split on last space to get weight
    const lastSpaceIndex = args.lastIndexOf(' ');
    if (lastSpaceIndex === -1) return bot.sendMessage(chatId, '⚠️ Usage: /settag <Tag Name> <Weight>');

    const tag = args.substring(0, lastSpaceIndex).trim();
    const weight = parseInt(args.substring(lastSpaceIndex + 1), 10);

    if (isNaN(weight) || weight < 0 || weight > 100) return bot.sendMessage(chatId, '⚠️ Weight must be 0-100');

    await setUserPreference(userId, tag, weight);
    await bot.sendMessage(chatId, `✅ Set ** ${tag}** to ${weight}% `, { parse_mode: 'Markdown' });
}

async function handleAddTag(chatId, userId, tag) {
    if (!tag) return bot.sendMessage(chatId, '⚠️ Usage: /addtag <Tag Name>');
    await setUserPreference(userId, tag, 50);
    await bot.sendMessage(chatId, `✅ Added interest: ** ${tag}** `, { parse_mode: 'Markdown' });
}

async function handleRemoveTag(chatId, userId, tag) {
    if (!tag) return bot.sendMessage(chatId, '⚠️ Usage: /removetag <Tag Name>');
    await removeUserPreference(userId, tag);
    await bot.sendMessage(chatId, `🗑️ Removed interest: ** ${tag}** `, { parse_mode: 'Markdown' });
}

async function handleResetTaste(chatId, userId) {
    await resetUserPreferences(userId);
    await bot.sendMessage(chatId, '🔄 Taste profile reset to defaults.');
}

async function handlePause(chatId, telegramId) {
    await updateUserScheduleStatus(telegramId, false);
    await bot.sendMessage(chatId, '⏸️ Scheduled recommendations paused.');
}

async function handleResume(chatId, telegramId) {
    await updateUserScheduleStatus(telegramId, true);
    await bot.sendMessage(chatId, '▶️ Scheduled recommendations resumed!');
}

async function handleDebug(chatId, telegramId) {
    const user = await getUser(telegramId);
    const status = user ? user.status : 'Unknown';
    await bot.sendMessage(chatId, `🔧 ** Debug Info **\n\n• User ID: \`${telegramId}\`\n• Status: ${status}\n• Mode: Serverless (Vercel)`, { parse_mode: 'Markdown' });
}


// ============ ACCESS CONTROL ============
async function processMessage(msg) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    const text = msg.text || '';

    // Parse command and args
    const match = text.match(/^\/(\w+)(?:\s+(.+))?$/);
    if (!match) return; // Not a command

    const command = match[1];
    const args = match[2];

    let user = await getUser(telegramId);
    const isAdmin = telegramId === config.telegram.ownerId;

    if (!user) {
        user = await createUser(telegramId, username, isAdmin);
    }

    // Public Commands
    if (command === 'start') return handleStart(chatId, telegramId, username);
    if (command === 'help') return handleHelp(chatId);

    // Check access
    if (!isAdmin && user.status === 'blocked') {
        return bot.sendMessage(chatId, '⛔ Access denied.');
    }

    if (!isAdmin && user.status === 'pending') {
        await bot.sendMessage(chatId, '🔒 **Access Pending**\n\nI have sent a request to the owner.', { parse_mode: 'Markdown' });
        if (config.telegram.ownerId) {
            await bot.sendMessage(config.telegram.ownerId, `👤 **New Access Request**\n\nUser: ${username} (ID: \`${telegramId}\`)`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✅ Allow', callback_data: `approve:${telegramId}` },
                        { text: '❌ Deny', callback_data: `deny:${telegramId}` }
                    ]]
                }
            });
        }
        return;
    }

    // Approved User Commands
    switch (command) {
        case 'recommend': return handleRecommend(chatId, telegramId, user);
        case 'preferences': return handlePreferences(chatId, user.id);
        case 'settag': return handleSetTag(chatId, user.id, args);
        case 'addtag': return handleAddTag(chatId, user.id, args);
        case 'removetag': return handleRemoveTag(chatId, user.id, args);
        case 'resettaste': return handleResetTaste(chatId, user.id);
        case 'pause': return handlePause(chatId, telegramId);
        case 'resume': return handleResume(chatId, telegramId);
        case 'debug': return handleDebug(chatId, telegramId);
        default: break; // Unknown command
    }
}

async function processCallback(query) {
    const telegramId = query.from.id;
    const data = query.data;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    // Approval callbacks
    if (data.startsWith('approve:')) {
        if (telegramId !== config.telegram.ownerId) {
            return bot.answerCallbackQuery(query.id, { text: '🔒 Admin only' });
        }
        const targetId = parseInt(data.split(':')[1], 10);
        await approveUser(targetId);
        await bot.answerCallbackQuery(query.id, { text: 'User approved!' });
        await bot.editMessageText(`✅ Approved user ${targetId}`, { chat_id: chatId, message_id: messageId });
        await bot.sendMessage(targetId, '🎉 **Access Granted!**\n\nTap /start to begin.', { parse_mode: 'Markdown' });
        return;
    }

    if (data.startsWith('deny:')) {
        if (telegramId !== config.telegram.ownerId) {
            return bot.answerCallbackQuery(query.id, { text: '🔒 Admin only' });
        }
        const targetId = parseInt(data.split(':')[1], 10);
        await blockUser(targetId);
        await bot.answerCallbackQuery(query.id, { text: 'User blocked' });
        await bot.editMessageText(`🚫 Denied user ${targetId}`, { chat_id: chatId, message_id: messageId });
        return;
    }

    // Rating callbacks
    if (data.startsWith('rate:')) {
        const parts = data.split(':');
        const recId = parts[1];
        const rating = parseInt(parts[2], 10);
        const flag = parts[3];

        const user = await getUser(telegramId);
        if (!user) return bot.answerCallbackQuery(query.id, { text: 'Please /start first' });

        await updateRating(user.id, recId, rating);

        if (flag === 'reroll') {
            await bot.answerCallbackQuery(query.id, { text: 'Finding something else... 🎲' });
            await bot.editMessageText(`${query.message.text}\n\n⏭️ _Skipped_`, {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] }
            });
            return handleRecommend(chatId, telegramId, user);
        }

        const ratingEmoji = rating === 0 ? '⏭️ Skipped' : '⭐'.repeat(rating);
        await bot.editMessageText(`${query.message.text}\n\n${ratingEmoji}`, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [] }
        });
        await bot.answerCallbackQuery(query.id, { text: rating === 0 ? 'Skipped!' : `Rated ${rating}/5!` });
    }
}

// ============ VERCEL HANDLER ============
export default async function handler(req, res) {
    console.log('📩 Webhook called:', req.method);

    if (req.method === 'GET') {
        return res.status(200).json({ status: 'Essai Bot is active', mode: 'webhook' });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const update = req.body;
        console.log('📩 Update:', JSON.stringify(update).slice(0, 200));

        if (update.message) {
            await processMessage(update.message);
        } else if (update.callback_query) {
            await processCallback(update.callback_query);
        }

        res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(200).json({ ok: true, error: error.message }); // Return 200 to prevent Telegram retries
    }
}
