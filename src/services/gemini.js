import Groq from 'groq-sdk';
import config from '../config.js';

/**
 * Groq Compound Curator
 * 
 * Uses Groq's Compound models (specifically compound-mini for speed/limits)
 * with built-in web search for:
 * 1. Real-time web search
 * 2. Creative curation
 * 3. Multi-link recommendations
 */

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

/**
 * Parse recommendations from Groq response
 */
function parseRecommendationsResponse(content) {
    if (!content) {
        throw new Error('Empty response from Groq');
    }

    try {
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        const jsonStr = jsonMatch ? jsonMatch[1].trim() : content.trim();

        const parsed = JSON.parse(jsonStr);

        if (parsed.recommendations) {
            return parsed.recommendations;
        } else if (Array.isArray(parsed)) {
            return parsed;
        } else {
            return [parsed];
        }
    } catch (parseError) {
        console.error('❌ Failed to parse JSON response:', content.slice(0, 500));
        throw new Error(`Failed to parse recommendation: ${parseError.message}`);
    }
}

/**
 * Retry with exponential backoff
 */
async function retryWithBackoff(fn, maxRetries = 3, initialDelayMs = 2000) {
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
                console.log(`⏳ Rate limited. Waiting ${delay / 1000}s before retry...`);
                await new Promise(r => setTimeout(r, delay));
            } else {
                throw error;
            }
        }
    }

    throw lastError;
}

/**
 * Generate reading recommendations using Groq Compound (Mini)
 * 
 * @param {Array<{tag: string, weight: number}>} preferences - User's weighted interests
 * @param {string[]} existingUrls - URLs to avoid
 * @returns {Promise<Object>} Primary article with backup_urls
 */
export async function generateRecommendation(preferences, existingUrls = []) {
    const groq = new Groq({
        apiKey: config.groq.apiKey,
    });

    const topInterests = preferences
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 5)
        .map(w => `${w.tag} (${Math.round(w.weight)}%)`)
        .join(', ') || 'Philosophy, Psychology, Economics, History, Essays';

    const existingList = existingUrls.length > 0
        ? existingUrls.slice(0, 20).map(url => `- ${url}`).join('\n')
        : '(None yet)';

    const prompt = CURATOR_PROMPT
        .replace('[USER_INTERESTS]', topInterests)
        .replace('[EXISTING_URLS]', existingList);

    console.log(`🧠 Generating recommendations for: ${topInterests}`);

    // Use groq/compound-mini for better rate limits
    // Falls back to similar capable models if needed
    const response = await retryWithBackoff(async () => {
        return await groq.chat.completions.create({
            model: 'groq/compound-mini',
            messages: [{ role: 'user', content: prompt }],
        });
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
        throw new Error('Empty response from Groq');
    }

    const recommendations = parseRecommendationsResponse(content);

    if (!recommendations.length) {
        throw new Error('No recommendations in response');
    }

    console.log(`📚 Got ${recommendations.length} recommendations`);

    // Sort: PDFs first, then classics, then gems
    recommendations.sort((a, b) => {
        // PDFs first
        if (a.is_pdf && !b.is_pdf) return -1;
        if (!a.is_pdf && b.is_pdf) return 1;
        return 0;
    });

    // Primary is first
    const primary = recommendations[0];

    // Alternatives are the rest
    primary.alternatives = recommendations.slice(1);

    // Backup URLs: We don't have true backups for the same article from this prompt.
    primary.backup_urls = [];

    primary.all_recommendations = recommendations;

    const categoryEmoji = primary.category === 'classic' ? '🏛️' : '💎';
    console.log(`✅ Primary: "${primary.title}" by ${primary.author} ${primary.is_pdf ? '📄' : ''} ${categoryEmoji}`);
    console.log(`🔗 URL: ${primary.url}`);
    if (primary.alternatives.length > 0) {
        console.log(`📎 ${primary.alternatives.length} alternatives available`);
    }

    if (!primary.url || !primary.title) {
        throw new Error('Invalid recommendation: missing url or title');
    }

    return primary;
}

export default { generateRecommendation };
