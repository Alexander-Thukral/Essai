import { Article, UserPreferences, TagWeight } from '../types';
import { INITIAL_TAGS, MOCK_ARTICLES } from '../constants';

const KEYS = {
  ARTICLES: 'curious_mind_articles',
  PREFS: 'curious_mind_prefs',
  API_KEY: 'curious_mind_api_key'
};

export const getArticles = (): Article[] => {
  const stored = localStorage.getItem(KEYS.ARTICLES);
  if (!stored) {
    // Seed with mock data if empty
    localStorage.setItem(KEYS.ARTICLES, JSON.stringify(MOCK_ARTICLES));
    return MOCK_ARTICLES as Article[];
  }
  return JSON.parse(stored);
};

export const saveArticles = (articles: Article[]) => {
  localStorage.setItem(KEYS.ARTICLES, JSON.stringify(articles));
};

export const getPreferences = (): UserPreferences => {
  const stored = localStorage.getItem(KEYS.PREFS);
  if (!stored) {
    const initial: UserPreferences = {
      weights: INITIAL_TAGS.map(tag => ({ tag, weight: 50 })), // Start neutral
      lastGenerated: null
    };
    localStorage.setItem(KEYS.PREFS, JSON.stringify(initial));
    return initial;
  }
  return JSON.parse(stored);
};

export const savePreferences = (prefs: UserPreferences) => {
  localStorage.setItem(KEYS.PREFS, JSON.stringify(prefs));
};

export const getApiKey = (): string | null => {
  // Check process.env first (for dev), then local storage
  if (process.env.API_KEY) return process.env.API_KEY;
  return localStorage.getItem(KEYS.API_KEY);
};

export const saveApiKey = (key: string) => {
  localStorage.setItem(KEYS.API_KEY, key);
};

// Simple algorithm to update weights based on rating
export const updateTasteProfile = (articles: Article[]): UserPreferences => {
  const currentPrefs = getPreferences();
  const newWeights: Record<string, number> = {};
  
  // Initialize with current weights
  currentPrefs.weights.forEach(w => {
    newWeights[w.tag] = w.weight;
  });

  articles.filter(a => a.rating !== undefined).forEach(article => {
    const rating = article.rating!;
    const impact = (rating - 3) * 2; // 5->+4, 4->+2, 3->0, 2->-2, 1->-4, 0->-6

    article.tags.forEach(tag => {
      // Normalize tag key
      const tagKey = currentPrefs.weights.find(w => w.tag.toLowerCase() === tag.toLowerCase())?.tag || tag;
      
      if (!newWeights[tagKey]) newWeights[tagKey] = 50; // New tag starts at 50
      
      // Apply impact with dampening
      newWeights[tagKey] = Math.max(0, Math.min(100, newWeights[tagKey] + impact));
    });
  });

  const updatedWeights: TagWeight[] = Object.entries(newWeights).map(([tag, weight]) => ({ tag, weight }));
  const newPrefs = { ...currentPrefs, weights: updatedWeights };
  savePreferences(newPrefs);
  return newPrefs;
};