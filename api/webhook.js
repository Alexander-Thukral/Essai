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
            reason: article.reason,
            tags: article.tags || [],
            is_verified: article.isVerified || false,
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
        .insert({ user_id: userId, recommendation_id: recId, telegram_message_id: messageId });
    if (error) console.error('saveUserRecommendation error:', error);
}

async function updateRating(userId, recId, rating) {
    const { data, error } = await supabase
        .from('user_recommendations')
        .update({ rating, rated_at: new Date().toISOString() })
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

async function updateUserPreference(userId, tag, weightDelta) {
    const { data: existing } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', userId)
        .eq('tag', tag)
        .single();
    const currentWeight = existing?.weight ?? 50;
    const currentCount = existing?.sample_count ?? 0;
    // Clamp current weight first (fix corrupt data), then apply delta
    const newWeight = Math.max(0, Math.min(100, Math.max(0, Math.min(100, currentWeight)) + weightDelta));
    const { error } = await supabase
        .from('user_preferences')
        .upsert({
            user_id: userId, tag,
            weight: newWeight,
            sample_count: currentCount + 1,
        }, { onConflict: 'user_id,tag' });
    if (error) console.error('updateUserPreference error:', error);
    return newWeight;
}

// ============ TASTE LEARNING ============
function calculateImpact(rating) {
    return (rating - 3) * 2;
}

async function updateTasteFromRating(userId, tags, rating) {
    const impact = calculateImpact(rating);
    if (impact === 0) return;
    for (const tag of tags) {
        await updateUserPreference(userId, tag, impact);
    }
}

// ============ TWO-STEP CURATOR ============

const CURATION_PROMPT = `You are an elite reading curator — a blend of university professor, Arts & Letters Daily editor, and librarian with encyclopedic knowledge.

# USER INTERESTS
[USER_INTERESTS]

# TASK
Recommend exactly 3 pieces of exceptional reading material (essays, articles, papers — NOT books, videos, or podcasts).

# WHAT TO RECOMMEND
## Mix Required:
- 1-2 TIMELESS CLASSICS: Montaigne, Orwell, Woolf, Didion, Baldwin, Sontag, Seneca, Emerson, Berlin, Arendt, Kahneman, Coase, etc. OR major journal longform (New Yorker, Paris Review, Granta, Harper's)
- 1-2 HIDDEN GEMS: Paul Graham, Gwern, Scott Alexander, Tyler Cowen, Robin Hanson, or niche journals (Aeon, The New Atlantis, Works in Progress, N+1), or academic preprints (ArXiv, SSRN, NBER)

## Prefer:
- Open access articles (no login required)
- Academic PDFs when available
- Depth and analysis over news

# CRITICAL RULES
- Do NOT include URLs — I will find them separately
- Do NOT recommend books, videos, podcasts, or short news
- Each recommendation MUST be a specific, real, existing article or essay — not something you invented
- Include the publication/website where this was originally published

# OUTPUT FORMAT
Respond with ONLY this JSON (no markdown, no backticks):
{"recommendations": [{"title": "Exact title of the article", "author": "Author name", "publication": "Where it was published", "description": "2-3 sentence summary", "reason": "Why this matches the user's interests", "tags": ["Tag1", "Tag2"], "category": "classic" or "gem"}]}`;

const URL_FINDER_PROMPT = `Find the exact, working URL for this specific article. Search the web for it.

Article: "[TITLE]" by [AUTHOR]
Published in/on: [PUBLICATION]

Rules:
- Return ONLY the direct URL to this article (not a search results page)
- Prefer: direct PDF links > original publication page > mirrors/archives
- The URL must be the actual article, not a book listing, review, or summary
- If you cannot find this exact article, find the closest matching article by the same author on a similar topic

Respond with ONLY this JSON (no markdown):
{"url": "https://...", "found_title": "actual title found", "source": "domain.com"}`;

async function retryWithBackoff(fn, maxRetries = 2, initialDelayMs = 2000) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try { return await fn(); }
        catch (error) {
            lastError = error;
            if ((error.status === 429 || error.message?.includes('rate')) && attempt < maxRetries) {
                await new Promise(r => setTimeout(r, initialDelayMs * Math.pow(2, attempt - 1)));
            } else throw error;
        }
    }
    throw lastError;
}

function parseJSON(content) {
    try {
        const trimmed = content.trim();
        const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
        const jsonStr = fenced ? fenced[1].trim() : trimmed;
        const parsed = JSON.parse(jsonStr);
        if (parsed.recommendations) return parsed.recommendations;
        if (Array.isArray(parsed)) return parsed;
        return [parsed];
    } catch {
        const obj = content.match(/\{[\s\S]*\}/);
        if (obj) {
            try {
                const p = JSON.parse(obj[0]);
                return p.recommendations || [p];
            } catch { /* fall through */ }
        }
        throw new Error('JSON parse failed');
    }
}

function parseURLResponse(content) {
    try {
        const trimmed = content.trim();
        const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
        const jsonStr = fenced ? fenced[1].trim() : trimmed;
        try { return JSON.parse(jsonStr); } catch { /* try extraction */ }
        const obj = content.match(/\{[\s\S]*?\}/);
        if (obj) return JSON.parse(obj[0]);
        const urlMatch = content.match(/https?:\/\/[^\s"<>]+/);
        return urlMatch ? { url: urlMatch[0] } : null;
    } catch {
        const urlMatch = content.match(/https?:\/\/[^\s"<>]+/);
        return urlMatch ? { url: urlMatch[0] } : null;
    }
}

function isValidUrl(url) {
    try { const p = new URL(url); return p.protocol === 'http:' || p.protocol === 'https:'; }
    catch { return false; }
}

async function curateIdeas(preferences, existingUrls = []) {
    const groq = new Groq({ apiKey: config.groq.apiKey });
    const topInterests = preferences
        .sort((a, b) => b.weight - a.weight).slice(0, 5)
        .map(w => `${w.tag} (${Math.round(w.weight)}%)`).join(', ')
        || 'Philosophy, Psychology, Economics, History, Essays';

    const prompt = CURATION_PROMPT.replace('[USER_INTERESTS]', topInterests);
    console.log(`🧠 Step 1: Curating ideas for: ${topInterests}`);

    const response = await retryWithBackoff(() =>
        groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7, max_tokens: 2000,
        })
    );

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('Empty response from Groq (Step 1)');
    return parseJSON(content);
}

async function findUrlForArticle(idea) {
    const groq = new Groq({ apiKey: config.groq.apiKey });
    const prompt = URL_FINDER_PROMPT
        .replace('[TITLE]', idea.title)
        .replace('[AUTHOR]', idea.author)
        .replace('[PUBLICATION]', idea.publication || 'unknown');
    try {
        const response = await retryWithBackoff(() =>
            groq.chat.completions.create({
                model: 'groq/compound-mini',
                messages: [{ role: 'user', content: prompt }],
            })
        );
        const content = response.choices[0]?.message?.content;
        if (!content) return null;
        const result = parseURLResponse(content);
        if (result?.url && isValidUrl(result.url)) {
            return { ...idea, url: result.url, source: result.source || '' };
        }
        return null;
    } catch (error) {
        console.warn(`⚠️ URL search failed for "${idea.title}": ${error.message}`);
        return null;
    }
}

async function generateRecommendation(preferences, existingUrls = []) {
    const ideas = await curateIdeas(preferences, existingUrls);
    if (!ideas.length) throw new Error('No ideas generated');
    console.log(`📚 Step 1: ${ideas.length} ideas`);

    // Step 2: Find URLs in parallel
    console.log(`🔍 Step 2: Finding URLs (parallel)...`);
    const results = await Promise.allSettled(ideas.map(i => findUrlForArticle(i)));

    const articles = [];
    results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value) {
            articles.push(r.value);
        } else {
            const idea = ideas[i];
            const q = encodeURIComponent(`${idea.title} ${idea.author} ${idea.publication || ''}`);
            articles.push({ ...idea, url: `https://www.google.com/search?q=${q}`, is_search_fallback: true });
        }
    });

    const primary = articles[0];
    primary.alternatives = articles.slice(1);
    primary.backup_urls = [];
    console.log(`✅ Primary: "${primary.title}" — ${primary.url}`);
    return primary;
}

// ============ LINK VERIFIER ============

const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
};

const TRUSTED_DOMAINS = [
    'aeon.co', 'paulgraham.com', 'gwern.net', 'substack.com', 'arxiv.org', 'ssrn.com',
    'nber.org', 'jstor.org', 'plato.stanford.edu', 'medium.com', 'wikipedia.org',
    'theatlantic.com', 'newyorker.com', 'econlib.org', 'gutenberg.org', 'archive.org',
    'lesswrong.com', 'marginalrevolution.com', 'nautil.us', 'quillette.com',
    'thenewatlantis.com', 'worksinprogress.co', 'theguardian.com', 'researchgate.net',
];

const PAYWALL_DOMAINS = ['nytimes.com', 'wsj.com', 'ft.com', 'economist.com', 'wired.com', 'hbr.org'];

function isDomainInList(url, list) {
    try { const h = new URL(url).hostname.toLowerCase(); return list.some(d => h.includes(d)); }
    catch { return false; }
}

function isSearchFallbackUrl(url) {
    try { return new URL(url).hostname.includes('google.com') && url.includes('/search?'); }
    catch { return false; }
}

async function verifyLink(url, expectedTitle = '') {
    if (isSearchFallbackUrl(url)) {
        return { isValid: true, confidence: 'low', isSearchFallback: true, isPaywall: false };
    }

    const isTrusted = isDomainInList(url, TRUSTED_DOMAINS);
    const isPaywall = isDomainInList(url, PAYWALL_DOMAINS);

    try {
        const response = await axios.get(url, {
            timeout: 8000, maxRedirects: 5,
            headers: BROWSER_HEADERS,
            validateStatus: () => true,
            maxContentLength: 500000,
            responseType: 'text',
        });

        const status = response.status;
        if (status === 404 || status === 410) {
            return { isValid: false, confidence: 'high', status, reason: 'Page not found', isPaywall: false };
        }
        if (status >= 200 && status < 400) {
            return { isValid: true, confidence: isTrusted ? 'high' : 'medium', status, isPaywall };
        }
        if (status === 401 || status === 403) {
            return { isValid: true, confidence: 'medium', status, isPaywall: true, reason: 'Login required' };
        }
        return { isValid: false, confidence: 'low', status, reason: `HTTP ${status}`, isPaywall: false };
    } catch (error) {
        const code = error.code || '';
        if (code === 'ENOTFOUND') return { isValid: false, confidence: 'high', reason: 'Domain not found', isPaywall: false };
        if (isTrusted || isPaywall) return { isValid: true, confidence: 'low', reason: 'Trusted domain (check blocked)', isPaywall };
        return { isValid: false, confidence: 'low', reason: code || error.message, isPaywall: false };
    }
}

// ============ COMMAND HANDLERS ============
async function handleStart(chatId, telegramId, username) {
    const user = await createUser(telegramId, username, telegramId === config.telegram.ownerId);

    // Initialize default preferences if new user
    const defaultTags = ['Psychology', 'Philosophy', 'Economics', 'Physics', 'History', 'Essays', 'Game Theory', 'Biology', 'Sociology', 'Mathematics', 'Computer Science', 'Geopolitics'];
    let prefs = await getTopPreferences(user.id, 12);
    if (!prefs.length) {
        for (const tag of defaultTags) await setUserPreference(user.id, tag, 50);
        prefs = await getTopPreferences(user.id, 12);
    }

    // Format preference bars for display
    const getBar = (w) => {
        const clamped = Math.max(0, Math.min(100, Math.round(w)));
        return '█'.repeat(Math.round(clamped / 10)) + '░'.repeat(10 - Math.round(clamped / 10));
    };
    const prefList = prefs.slice(0, 7).map((p, i) => {
        const w = Math.max(0, Math.min(100, Math.round(p.weight)));
        return `${i + 1}. **${p.tag}** ${getBar(w)} ${w}%`;
    }).join('\n');

    const message = `📚 **Welcome to Essai!**

I'm your personal reading curator. I find intellectually stimulating essays, papers, and articles tailored to your interests.

📊 **Your Starting Interests:**
${prefList}

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

async function handleHelp(chatId) {
    const message = `**Available Commands:**

• /recommend - Get a reading recommendation
• /preferences - See your taste profile
• /settag <tag> <weight> - Set a tag weight (0-100)
• /addtag <tag> - Add new interest (default 50%)
• /removetag <tag> - Remove a tag
• /resettaste - Reset all preferences
• /pause - Pause scheduled recommendations
• /resume - Resume scheduled recommendations`;
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

async function handleRecommend(chatId, telegramId, user) {
    const loadingMsg = await bot.sendMessage(chatId,
        '🧠 **Curating recommendations...**\n\n_Step 1: Selecting articles from the canon..._',
        { parse_mode: 'Markdown' }
    );

    try {
        const existingUrls = await getExistingUrls(user.id);
        const topPrefs = await getTopPreferences(user.id, 5);

        // Two-step curator: ideas → URL finding (parallel)
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

async function handlePreferences(chatId, userId) {
    let prefs = await getTopPreferences(userId, 12);
    if (!prefs.length) {
        const defaults = ['Psychology', 'Philosophy', 'Economics', 'Physics', 'History', 'Essays', 'Game Theory', 'Biology', 'Sociology', 'Mathematics', 'Computer Science', 'Geopolitics'];
        for (const tag of defaults) await setUserPreference(userId, tag, 50);
        prefs = await getTopPreferences(userId, 12);
    }
    const getBar = (w) => {
        const clamped = Math.max(0, Math.min(100, Math.round(w)));
        return '█'.repeat(Math.round(clamped / 10)) + '░'.repeat(10 - Math.round(clamped / 10));
    };
    const list = prefs.map((p, i) => {
        const w = Math.max(0, Math.min(100, Math.round(p.weight)));
        return `${i + 1}. **${p.tag}** ${getBar(w)} ${w}%`;
    }).join('\n');
    await bot.sendMessage(chatId, `📊 **Your Interests:**\n\n${list}\n\n_Weights adjust as you rate recommendations ⭐1-5_\n_Use /addtag, /removetag, /settag to customize_`, { parse_mode: 'Markdown' });
}

async function handleSetTag(chatId, userId, args) {
    if (!args) return bot.sendMessage(chatId, '⚠️ Usage: /settag <Tag Name> <Weight>');
    const lastSpaceIndex = args.lastIndexOf(' ');
    if (lastSpaceIndex === -1) return bot.sendMessage(chatId, '⚠️ Usage: /settag <Tag Name> <Weight>');
    const tag = args.substring(0, lastSpaceIndex).trim();
    const weight = parseInt(args.substring(lastSpaceIndex + 1), 10);
    if (isNaN(weight) || weight < 0 || weight > 100) return bot.sendMessage(chatId, '⚠️ Weight must be 0-100');
    await setUserPreference(userId, tag, weight);
    await bot.sendMessage(chatId, `✅ Set **${tag}** to ${weight}%`, { parse_mode: 'Markdown' });
}

async function handleAddTag(chatId, userId, tag) {
    if (!tag) return bot.sendMessage(chatId, '⚠️ Usage: /addtag <Tag Name>');
    await setUserPreference(userId, tag, 50);
    await bot.sendMessage(chatId, `✅ Added interest: **${tag}**`, { parse_mode: 'Markdown' });
}

async function handleRemoveTag(chatId, userId, tag) {
    if (!tag) return bot.sendMessage(chatId, '⚠️ Usage: /removetag <Tag Name>');
    await removeUserPreference(userId, tag);
    await bot.sendMessage(chatId, `🗑️ Removed interest: **${tag}**`, { parse_mode: 'Markdown' });
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
    await bot.sendMessage(chatId, `🔧 **Debug Info**\n\n• User ID: \`${telegramId}\`\n• Status: ${status}\n• Mode: Serverless (Vercel)\n• Curator: Two-step (llama-3.3 + compound-mini)`, { parse_mode: 'Markdown' });
}

// ============ ACCESS CONTROL ============
async function processMessage(msg) {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    const text = msg.text || '';

    const match = text.match(/^\/(\w+)(?:\s+(.+))?$/);
    if (!match) return;

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
        default: break;
    }
}

async function processCallback(query) {
    const telegramId = query.from.id;
    const data = query.data;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    if (data.startsWith('approve:')) {
        if (telegramId !== config.telegram.ownerId) return bot.answerCallbackQuery(query.id, { text: '🔒 Admin only' });
        const targetId = parseInt(data.split(':')[1], 10);
        await approveUser(targetId);
        await bot.answerCallbackQuery(query.id, { text: 'User approved!' });
        await bot.editMessageText(`✅ Approved user ${targetId}`, { chat_id: chatId, message_id: messageId });
        await bot.sendMessage(targetId, '🎉 **Access Granted!**\n\nTap /start to begin.', { parse_mode: 'Markdown' });
        return;
    }

    if (data.startsWith('deny:')) {
        if (telegramId !== config.telegram.ownerId) return bot.answerCallbackQuery(query.id, { text: '🔒 Admin only' });
        const targetId = parseInt(data.split(':')[1], 10);
        await blockUser(targetId);
        await bot.answerCallbackQuery(query.id, { text: 'User blocked' });
        await bot.editMessageText(`🚫 Denied user ${targetId}`, { chat_id: chatId, message_id: messageId });
        return;
    }

    if (data.startsWith('rate:')) {
        const parts = data.split(':');
        const recId = parts[1];
        const rating = parseInt(parts[2], 10);
        const flag = parts[3];

        const user = await getUser(telegramId);
        if (!user) return bot.answerCallbackQuery(query.id, { text: 'Please /start first' });

        const userRec = await updateRating(user.id, recId, rating);

        // Taste learning
        if (rating > 0 && userRec?.recommendations?.tags) {
            await updateTasteFromRating(user.id, userRec.recommendations.tags, rating);
        }

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
        return res.status(200).json({ status: 'Essai Bot is active', mode: 'webhook', curator: 'two-step' });
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
        res.status(200).json({ ok: true, error: error.message });
    }
}
