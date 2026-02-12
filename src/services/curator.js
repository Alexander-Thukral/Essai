import Groq from 'groq-sdk';
import config from '../config.js';

/**
 * Two-Step Curator Service
 * 
 * Step 1: Use llama-3.3-70b-versatile (free, fast) to curate article IDEAS
 *         — no URLs, just creative recommendation
 * Step 2: Use compound-mini (web search) to find REAL URLs for each idea
 *         — all lookups run in parallel for speed
 */

// ============ STEP 1: IDEA CURATION PROMPT ============

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
- Articles for which no subscription is required

# CRITICAL RULES
- Do NOT include URLs — I will find them separately
- Do NOT recommend books, videos, podcasts, or short news
- Each recommendation MUST be a specific, real, existing article or essay — not something you invented
- Include the publication/website where this was originally published
- Do NOT recommend any of the articles in the ALREADY READ list below — those have already been sent
- Prioritize VARIETY — try uncommon, surprising, or less-obvious picks

[ALREADY_READ]

# OUTPUT FORMAT
Respond with ONLY this JSON (no markdown, no backticks):
{"recommendations": [{"title": "Exact title of the article", "author": "Author name", "publication": "Where it was published (e.g. Aeon, Paul Graham's blog, NBER, The New Yorker)", "description": "2-3 sentence summary", "reason": "Why this matches the user's interests", "tags": ["Tag1", "Tag2"], "category": "classic" or "gem"}]}`;

// ============ STEP 2: URL FINDER PROMPT ============

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

// ============ GROQ CLIENT ============

function createGroqClient() {
    return new Groq({ apiKey: config.groq.apiKey });
}

// ============ RETRY LOGIC ============

async function retryWithBackoff(fn, maxRetries = 2, initialDelayMs = 2000) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            const isRateLimit = error.status === 429 ||
                error.message?.includes('rate') ||
                error.message?.includes('quota');
            if (isRateLimit && attempt < maxRetries) {
                const delay = initialDelayMs * Math.pow(2, attempt - 1);
                console.log(`⏳ Rate limited. Waiting ${delay / 1000}s...`);
                await new Promise(r => setTimeout(r, delay));
            } else {
                throw error;
            }
        }
    }
    throw lastError;
}

// ============ STEP 1: CURATE IDEAS ============

/**
 * Generate article ideas (no URLs) using llama-3.3-70b-versatile
 */
async function curateIdeas(preferences, existingTitles = []) {
    const groq = createGroqClient();

    const topInterests = preferences
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 5)
        .map(w => `${w.tag} (${Math.round(w.weight)}%)`)
        .join(', ') || 'Philosophy, Psychology, Economics, History, Essays';

    // Build exclusion list from previously recommended titles
    let alreadyReadSection = '';
    if (existingTitles.length > 0) {
        const titleList = existingTitles.slice(0, 30).map(t => `- "${t}"`).join('\n');
        alreadyReadSection = `\n# ALREADY READ (do NOT recommend these again):\n${titleList}`;
    } else {
        alreadyReadSection = '\n# ALREADY READ: None yet — this is their first recommendation!';
    }

    const prompt = CURATION_PROMPT
        .replace('[USER_INTERESTS]', topInterests)
        .replace('[ALREADY_READ]', alreadyReadSection);

    console.log(`🧠 Step 1: Curating ideas for: ${topInterests} (excluding ${existingTitles.length} already read)`);

    const response = await retryWithBackoff(async () => {
        return await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.9,
            max_tokens: 2000,
        });
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('Empty response from Groq (Step 1)');

    return parseJSON(content, 'Step 1');
}

// ============ STEP 2: FIND URLs (PARALLEL) ============

/**
 * Find a real URL for a single article idea using compound-mini web search
 */
async function findUrlForArticle(idea) {
    const groq = createGroqClient();

    const prompt = URL_FINDER_PROMPT
        .replace('[TITLE]', idea.title)
        .replace('[AUTHOR]', idea.author)
        .replace('[PUBLICATION]', idea.publication || 'unknown');

    try {
        const response = await retryWithBackoff(async () => {
            return await groq.chat.completions.create({
                model: 'groq/compound-mini',
                messages: [{ role: 'user', content: prompt }],
            });
        });

        const content = response.choices[0]?.message?.content;
        if (!content) return null;

        const result = parseURLResponse(content);
        if (result?.url && isValidUrl(result.url)) {
            console.log(`  🔗 Found: ${result.url}`);
            return {
                ...idea,
                url: result.url,
                found_title: result.found_title || idea.title,
                source: result.source || extractDomain(result.url),
            };
        }

        return null;
    } catch (error) {
        console.warn(`  ⚠️ URL search failed for "${idea.title}": ${error.message}`);
        return null;
    }
}

/**
 * Find URLs for all ideas IN PARALLEL (key latency optimization)
 */
async function findUrlsForIdeas(ideas) {
    console.log(`🔍 Step 2: Finding URLs for ${ideas.length} articles (parallel)...`);

    const results = await Promise.allSettled(
        ideas.map(idea => findUrlForArticle(idea))
    );

    const articlesWithUrls = [];
    const articlesWithoutUrls = [];

    results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
            articlesWithUrls.push(result.value);
        } else {
            // Build a Google Search fallback URL
            const idea = ideas[index];
            const searchQuery = encodeURIComponent(`${idea.title} ${idea.author} ${idea.publication || ''}`);
            articlesWithoutUrls.push({
                ...idea,
                url: `https://www.google.com/search?q=${searchQuery}`,
                is_search_fallback: true,
                source: 'google.com (search)',
            });
        }
    });

    return { articlesWithUrls, articlesWithoutUrls };
}

// ============ MAIN EXPORT ============

/**
 * Generate reading recommendations using two-step pipeline.
 * 
 * @param {Array<{tag: string, weight: number}>} preferences - User's weighted interests
 * @param {string[]} existingUrls - URLs to avoid (used for title dedup)
 * @returns {Promise<Object>} Primary article with alternatives array
 */
export async function generateRecommendation(preferences, existingUrls = [], existingTitles = []) {
    // Step 1: Curate ideas (fast, free, no URLs)
    const ideas = await curateIdeas(preferences, existingTitles);

    if (!ideas.length) {
        throw new Error('No ideas generated in Step 1');
    }

    console.log(`📚 Step 1 complete: ${ideas.length} ideas curated`);
    ideas.forEach((idea, i) => {
        console.log(`  ${i + 1}. "${idea.title}" by ${idea.author} [${idea.category}]`);
    });

    // Filter out any ideas that match existing titles (safety net)
    const existingTitleSet = new Set(existingTitles.map(t => t.toLowerCase().trim()));
    const freshIdeas = ideas.filter(idea => {
        const titleLower = idea.title?.toLowerCase().trim();
        if (existingTitleSet.has(titleLower)) {
            console.log(`  ⏭️ Skipping duplicate: "${idea.title}"`);
            return false;
        }
        return true;
    });
    const ideasToUse = freshIdeas.length > 0 ? freshIdeas : ideas;

    // Step 2: Find real URLs (parallel, uses web search)
    const { articlesWithUrls, articlesWithoutUrls } = await findUrlsForIdeas(ideasToUse);

    // Filter out duplicate URLs
    const allArticles = [...articlesWithUrls, ...articlesWithoutUrls].filter(a => {
        if (existingUrls.includes(a.url)) {
            console.log(`  ⏭️ Skipping duplicate URL: ${a.url}`);
            return false;
        }
        return true;
    });

    if (allArticles.length === 0) {
        throw new Error('No articles found after deduplication');
    }

    // Primary is the first article with a real URL, or first fallback
    const primary = allArticles[0];
    primary.alternatives = allArticles.slice(1);
    primary.backup_urls = [];

    const urlType = primary.is_search_fallback ? '🔎 (search fallback)' : '✅';
    console.log(`✅ Primary: "${primary.title}" by ${primary.author} ${urlType}`);
    console.log(`🔗 URL: ${primary.url}`);
    if (primary.alternatives.length > 0) {
        console.log(`📎 ${primary.alternatives.length} alternatives`);
    }

    return primary;
}

// ============ PARSING HELPERS ============

function parseJSON(content, step) {
    try {
        // Try direct parse first
        const trimmed = content.trim();

        // Remove markdown code fences if present
        const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
        const jsonStr = jsonMatch ? jsonMatch[1].trim() : trimmed;

        const parsed = JSON.parse(jsonStr);

        if (parsed.recommendations && Array.isArray(parsed.recommendations)) {
            return parsed.recommendations;
        } else if (Array.isArray(parsed)) {
            return parsed;
        } else {
            return [parsed];
        }
    } catch (error) {
        // Try to find JSON object in freeform text
        const objectMatch = content.match(/\{[\s\S]*\}/);
        if (objectMatch) {
            try {
                const parsed = JSON.parse(objectMatch[0]);
                if (parsed.recommendations) return parsed.recommendations;
                return [parsed];
            } catch {
                // fall through
            }
        }
        console.error(`❌ ${step} JSON parse failed:`, content.slice(0, 300));
        throw new Error(`Failed to parse ${step} response`);
    }
}

function parseURLResponse(content) {
    try {
        const trimmed = content.trim();
        const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
        const jsonStr = jsonMatch ? jsonMatch[1].trim() : trimmed;

        // Try direct JSON parse
        try {
            return JSON.parse(jsonStr);
        } catch {
            // Try to find a JSON object
            const objectMatch = content.match(/\{[\s\S]*?\}/);
            if (objectMatch) return JSON.parse(objectMatch[0]);
        }

        // Last resort: extract URL from text
        const urlMatch = content.match(/https?:\/\/[^\s"<>]+/);
        if (urlMatch) {
            return { url: urlMatch[0] };
        }

        return null;
    } catch {
        // Extract any URL from the response
        const urlMatch = content.match(/https?:\/\/[^\s"<>]+/);
        return urlMatch ? { url: urlMatch[0] } : null;
    }
}

function isValidUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

function extractDomain(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return '';
    }
}

export default { generateRecommendation };
