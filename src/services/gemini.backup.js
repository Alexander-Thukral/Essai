import { GoogleGenAI } from '@google/genai';
import config from '../config.js';

const SYSTEM_INSTRUCTION = `You are a sophisticated reading recommendation engine for an intellectual user with broad, multidisciplinary interests. 
Your goal is to surface "obscure gems", philosophically rich essays, and unexpected connections. 
Avoid generic "Top 10" lists. Prioritize depth, originality, and high-quality writing.
You must return a SINGLE reading recommendation in JSON format.
Ensure the article exists and is likely accessible online (not behind a hard paywall if possible).`;

/**
 * Generate a reading recommendation using a 2-step robust approach
 * Step 1: Curate - Pick an obscure gem (without Search, very stable)
 * Step 2: Ground - Find the actual URL for that specific gem (with Search)
 */
export async function generateRecommendation(preferences, existingUrls = []) {
    const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });

    // BUILD PREFERENCE CONTEXT
    const topInterests = preferences
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 7)
        .map(w => `${w.tag} (${Math.round(w.weight)}%)`)
        .join(', ');

    // STEP 1: CURATE (Fast, stable, no hallucinations)
    const curationPrompt = `
# ROLE
You are an elite reading curator—a blend of university professor, editor of "Arts & Letters Daily", and librarian of obscure but high-impact texts.

# USER PROFILE
- **Weighted Interests**: [${topInterests || 'Psychology, Philosophy, Economics, Physics, Game Theory, Essays, History'}]
- **Intellectual Appetite**: High. Prefers complexity, nuance, original sources, and interdisciplinary synthesis.
- **Goal**: Needs "brain food"—pieces that challenge assumptions, bridge disparate fields, or offer deep historical/philosophical context.

# YOUR TASK
Recommend EXACTLY ONE piece of reading material (Essay, Academic Paper, Deep-dive Blog Post, Long-form Article, or Lecture Transcript).

# SELECTION CRITERIA (STRICT)

## ✅ DO Prioritize:
1. **Anti-Viral**: Content that WON'T be trending on Twitter/X or major news. Timeless value over recency.
2. **Interdisciplinary Bridges**: Content connecting 2+ fields in unexpected ways (e.g., Physics + Ethics, Game Theory + History).
3. **High-Quality Sources**: Individual expert blogs (Gwern, Scott Alexander, Paul Graham), academic repositories (JSTOR free articles), niche journals (Aeon, The New Atlantis, Inference Review, Quillette, Works in Progress).
4. **Contrarian or Forgotten**: Overlooked classics, rehabilitated ideas, or well-argued minority positions.
5. **Primary Sources**: Original essays/papers over summaries where possible.

## ❌ DO NOT Recommend:
- Listicles ("10 things you need to know")
- Generic news or political op-eds from cable news outlets
- Self-help, productivity tips, or motivational content
- Wikipedia articles or basic encyclopedia entries
- Content behind hard paywalls
- Anything from the AVOID list below

# AVOID THESE URLs (User has read them):
${existingUrls.slice(0, 30).join('\n- ')}

# OUTPUT FORMAT (JSON ONLY)
Return a SINGLE JSON object:
{
  "title": "Exact title of the article",
  "author": "Author name",
  "description": "2-3 sentence summary emphasizing the key insight",
  "reason": "Why this matches the user's deep interests",
  "tags": ["Tag1", "Tag2"]
}
`;

    const curationResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: curationPrompt,
        config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json'
        }
    });

    const article = JSON.parse(curationResponse.text);
    console.log(`🧠 Curated concept: "${article.title}" by ${article.author}`);

    // STEP 2: GROUND (Find the best URL via Google Search)
    // We don't ask for JSON here. We just ask it to find the link, and we grab the Grounding Metadata directly.
    const searchPrompt = `Find the internet URL for the article "${article.title}" by ${article.author}.`;

    const searchResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: searchPrompt,
        config: {
            tools: [{ googleSearch: {} }]
        }
    });

    // Strategy: Look STRONLY at Grounding Metadata first
    // The model uses the tool, and the tool returns "groundingChunks" with "web.uri"
    const meta = searchResponse.candidates?.[0]?.groundingMetadata;
    const webChunks = meta?.groundingChunks?.filter(c => c.web?.uri) || [];

    if (webChunks.length > 0) {
        // Success! We have real search results used by the model
        article.url = webChunks[0].web.uri;
        article.backup_urls = webChunks.slice(1).map(c => c.web.uri);
        console.log(`✅ Found URL via Grounding Metadata: ${article.url}`);
    } else {
        // Fallback: Check if the text itself contains a URL (unlikely if tool wasn't used, but possible)
        const text = searchResponse.text || '';
        const urlMatch = text.match(/https?:\/\/[^\s"'<>]+/);
        if (urlMatch) {
            article.url = urlMatch[0];
            console.log(`⚠️ Found URL in text (fallback): ${article.url}`);
        }
    }

    if (!article.url) {
        console.error('❌ No URL found in Grounding Metadata. Response dump:', JSON.stringify(meta, null, 2));
        throw new Error(`Failed to find URL for "${article.title}". Search tool may have returned no results.`);
    }

    return article;
}

export default { generateRecommendation };

