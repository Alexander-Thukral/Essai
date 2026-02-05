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
    if (error) console.error('createUser error:', error);
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
    if (error) console.error('saveRecommendation error:', error);
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

// ============ GROQ RECOMMENDATION ============
async function generateRecommendation(preferences, existingUrls = []) {
    const groq = new Groq({ apiKey: config.groq.apiKey });

    const prefList = preferences.map(p => `${p.tag} (${Math.round(p.weight * 100)}%)`).join(', ');
    const excludeList = existingUrls.slice(0, 20).join('\n');

    const prompt = `You are an elite reading curator. Search the web and recommend 2-3 exceptional essays or articles.

USER INTERESTS: ${prefList || 'Philosophy, Essays, Ideas'}

ALREADY RECOMMENDED (avoid these): 
${excludeList || 'None'}

REQUIREMENTS:
- Prioritize PDF links from academic sources, journals, or archives
- Mix classic authors (Montaigne, Orwell, Didion) with hidden gems (niche blogs, preprints)
- Return ONLY valid, accessible URLs

OUTPUT FORMAT (JSON only):
{
  "recommendations": [
    {
      "title": "Article Title",
      "author": "Author Name",
      "url": "https://...",
      "description": "2-3 sentence summary",
      "reason": "Why this matches user interests",
      "tags": ["Tag1", "Tag2"],
      "is_pdf": true/false,
      "category": "classic" or "gem"
    }
  ]
}`;

    const response = await groq.chat.completions.create({
        model: 'compound-beta',
        messages: [{ role: 'user', content: prompt }],
    });

    const content = response.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const parsed = JSON.parse(jsonMatch[0]);
    const recs = parsed.recommendations || [parsed];

    const primary = recs[0];
    primary.alternatives = recs.slice(1);
    return primary;
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
    await bot.sendMessage(chatId, `📚 **Welcome to Essai!**\n\nI'm your personal reading curator.\n\nCommands:\n• /recommend - Get a reading recommendation\n• /preferences - See your taste profile`, { parse_mode: 'Markdown' });
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
        const tags = (article.tags || []).map(t => `#${t.replace(/\s+/g, '')}`).join(' ');

        let message = `${categoryEmoji} **${article.title}**\n*by ${article.author}*\n\n${article.description}\n\n💡 **Why this?** ${article.reason}\n\n${tags}\n\n🔗 [Read](${article.url}) ${verifiedEmoji}`;

        if (article.alternatives?.length > 0) {
            message += `\n\n📚 **Alternatives:**`;
            article.alternatives.forEach(r => {
                message += `\n• [${r.title}](${r.url}) - _${r.author}_`;
            });
        }

        const sentMsg = await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
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
        await bot.sendMessage(chatId, '❌ Failed to generate recommendation. Please try again.');
    }
}

async function handlePreferences(chatId, userId) {
    const prefs = await getTopPreferences(userId, 7);
    if (!prefs.length) {
        await bot.sendMessage(chatId, '📊 No preferences yet. Rate some articles!');
        return;
    }
    const list = prefs.map(p => `• ${p.tag}: ${Math.round(p.weight * 100)}%`).join('\n');
    await bot.sendMessage(chatId, `📊 **Your Taste Profile:**\n\n${list}`, { parse_mode: 'Markdown' });
}

// ============ ACCESS CONTROL ============
async function processMessage(msg) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    const text = msg.text || '';

    let user = await getUser(telegramId);
    const isAdmin = telegramId === config.telegram.ownerId;

    if (!user) {
        user = await createUser(telegramId, username, isAdmin);
    }

    // Commands that don't need approval
    if (text.startsWith('/start')) {
        return handleStart(chatId, telegramId, username);
    }

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

    // Approved users
    if (text.startsWith('/recommend')) {
        return handleRecommend(chatId, telegramId, user);
    }
    if (text.startsWith('/preferences')) {
        return handlePreferences(chatId, user.id);
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
