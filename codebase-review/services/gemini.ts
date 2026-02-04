import { GoogleGenAI, Type } from "@google/genai";
import { Article, UserPreferences } from "../types";
import { SYSTEM_INSTRUCTION } from "../constants";

export const generateRecommendation = async (
  apiKey: string,
  preferences: UserPreferences,
  existingUrls: string[]
): Promise<Partial<Article>> => {
  const ai = new GoogleGenAI({ apiKey });

  // 1. Build context from preferences
  const topInterests = preferences.weights
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map(w => w.tag)
    .join(", ");

  // Increased context for avoidance to prevent repeats
  const avoidUrls = existingUrls.slice(0, 50).join(", ");

  const prompt = `
    Role: You are an elite reading curator for an intellectual user. Think of yourself as a blend of a university professor, the editor of "Arts & Letters Daily", and a librarian of obscure but high-impact texts.

    User Profile:
    - Top Interests: [${topInterests}]
    - Intellectual Appetite: High. Prefers complexity, nuance, and original sources over summaries.
    - Goal: Needs "brain food"—pieces that challenge assumptions, bridge disparate fields (e.g. Physics + Sociology), or offer deep historical context.

    Task:
    Recommend EXACTLY ONE piece of reading material (Essay, Academic Paper, Deep-dive Blog Post, or Lecture Transcript).

    Strict Selection Criteria:
    1. **Anti-Viral**: Do not recommend what is currently trending on Twitter/X or major news sites. Look for timeless value or overlooked gems.
    2. **Interdisciplinary**: Prioritize content that connects two or more of the user's interests in unexpected ways.
    3. **Source Quality**: Prioritize individual experts (Substack/blogs), academic repositories, niche literary journals, or long-form essay sites (e.g., Aeon, The New Atlantis, Inference Review, Gwern.net).
    4. **Accessibility**: The link MUST be accessible (no hard paywalls requiring a subscription to read).

    Negative Constraints:
    - NO listicles ("10 things you need to know").
    - NO generic news or political op-eds from major cable news outlets.
    - NO self-help or productivity porn.
    - DO NOT recommend these URLs (User has already read them): ${avoidUrls}

    Output Format:
    Return a single JSON object matching the schema.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-latest", // Using Flash for speed/cost efficiency
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            author: { type: Type.STRING },
            url: { type: Type.STRING },
            description: { type: Type.STRING },
            reason: { type: Type.STRING },
            tags: { 
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ["title", "author", "url", "description", "reason", "tags"]
        }
      }
    });

    const text = response.text;
    if (!text) throw new Error("No response from Gemini");

    const data = JSON.parse(text);
    return data;
  } catch (error) {
    console.error("Gemini Generation Error:", error);
    throw error;
  }
};