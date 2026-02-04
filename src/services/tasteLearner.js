import { updateUserPreference, getUserPreferences, setUserPreference } from './supabase.js';

// Default tags for new users
const DEFAULT_TAGS = [
    'Psychology', 'Philosophy', 'Economics', 'Physics',
    'History', 'Essays', 'Game Theory', 'Biology',
    'Sociology', 'Mathematics', 'Computer Science', 'Geopolitics'
];

/**
 * Calculate taste impact from rating
 * Rating 5 → +4, 4 → +2, 3 → 0, 2 → -2, 1 → -4, 0 → -6
 * @param {number} rating - 0-5 rating
 * @returns {number} weight delta
 */
export function calculateImpact(rating) {
    return (rating - 3) * 2;
}

/**
 * Initialize default tags for a new user
 * @param {string} userId - Supabase user UUID
 */
export async function initializeDefaultTags(userId) {
    for (const tag of DEFAULT_TAGS) {
        await setUserPreference(userId, tag, 50);
    }
}

/**
 * Update user preferences based on article rating
 * @param {string} userId - Supabase user UUID
 * @param {string[]} tags - Tags from the rated article
 * @param {number} rating - 0-5 rating
 * @returns {Promise<void>}
 */
export async function updateTasteFromRating(userId, tags, rating) {
    const impact = calculateImpact(rating);

    // Skip neutral ratings
    if (impact === 0) return;

    // Update each tag
    for (const tag of tags) {
        await updateUserPreference(userId, tag, impact);
    }
}

/**
 * Get top N preferences for display
 * If user has no preferences, initialize defaults first
 * @param {string} userId - Supabase user UUID
 * @param {number} limit - Number of top preferences to return
 * @returns {Promise<Array<{tag: string, weight: number}>>}
 */
export async function getTopPreferences(userId, limit = 5) {
    let prefs = await getUserPreferences(userId);

    // If no preferences, initialize defaults
    if (!prefs.length) {
        await initializeDefaultTags(userId);
        prefs = await getUserPreferences(userId);
    }

    return prefs.slice(0, limit);
}

/**
 * Format preferences for display
 * @param {Array<{tag: string, weight: number}>} preferences
 * @returns {string}
 */
export function formatPreferences(preferences) {
    if (!preferences.length) {
        return '📊 No taste profile yet. Use /addtag to add interests!';
    }

    const lines = preferences.map((p, i) => {
        const bar = getWeightBar(p.weight);
        return `${i + 1}. **${p.tag}** ${bar} ${Math.round(p.weight)}%`;
    });

    return `📊 **Your Interests:**\n\n${lines.join('\n')}\n\n_Use /settag, /addtag, /removetag to customize_`;
}

/**
 * Generate a visual bar for weight
 * @param {number} weight - 0-100 weight
 * @returns {string}
 */
function getWeightBar(weight) {
    const filled = Math.round(weight / 10);
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
