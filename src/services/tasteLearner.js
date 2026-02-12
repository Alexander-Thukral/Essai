import { updateUserPreference, getUserPreferences, setUserPreference } from './supabase.js';

// Default tags for new users — curated starting interests
const DEFAULT_TAGS = [
    'Psychology', 'Philosophy', 'Economics', 'Physics',
    'History', 'Essays', 'Game Theory', 'Biology',
    'Sociology', 'Mathematics', 'Computer Science', 'Geopolitics'
];

/**
 * Calculate taste impact from rating (1-5 scale)
 * Rating 5 → +4, 4 → +2, 3 → 0 (neutral), 2 → -2, 1 → -4
 * Skip (0) → not called (handled in caller)
 */
export function calculateImpact(rating) {
    return (rating - 3) * 2;
}

/**
 * Initialize default tags for a new user.
 * All start at weight 50 (neutral / equal interest).
 */
export async function initializeDefaultTags(userId) {
    for (const tag of DEFAULT_TAGS) {
        await setUserPreference(userId, tag, 50);
    }
    return DEFAULT_TAGS.length;
}

/**
 * Update user preferences based on article rating.
 * Called after a user rates a recommendation 1-5.
 */
export async function updateTasteFromRating(userId, tags, rating) {
    const impact = calculateImpact(rating);
    if (impact === 0) return; // Neutral rating = no change

    for (const tag of tags) {
        await updateUserPreference(userId, tag, impact);
    }
}

/**
 * Get top N preferences for a user.
 * If user has no preferences, initialize defaults first.
 */
export async function getTopPreferences(userId, limit = 7) {
    let prefs = await getUserPreferences(userId);

    if (!prefs.length) {
        await initializeDefaultTags(userId);
        prefs = await getUserPreferences(userId);
    }

    return prefs.slice(0, limit);
}

/**
 * Format preferences for Telegram display.
 * Weights are 0-100 scale, displayed as a visual bar.
 * Always clamps to valid range for display safety.
 */
export function formatPreferences(preferences) {
    if (!preferences.length) {
        return '_No interests set yet. Use /addtag to add topics!_';
    }

    const lines = preferences.map((p, i) => {
        // ALWAYS clamp to 0-100 for display (safety against corrupt DB values)
        const weight = Math.max(0, Math.min(100, Math.round(p.weight)));
        const bar = getWeightBar(weight);
        return `${i + 1}. **${p.tag}** ${bar} ${weight}%`;
    });

    return lines.join('\n');
}

/**
 * Generate a visual bar for weight (0-100 → 0-10 blocks)
 */
function getWeightBar(weight) {
    const clamped = Math.max(0, Math.min(100, weight));
    const filled = Math.round(clamped / 10);
    const empty = 10 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

export default {
    calculateImpact,
    updateTasteFromRating,
    getTopPreferences,
    formatPreferences,
    initializeDefaultTags,
    DEFAULT_TAGS
};
