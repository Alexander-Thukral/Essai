import { createClient } from '@supabase/supabase-js';
import config from '../config.js';

export const supabase = createClient(config.supabase.url, config.supabase.anonKey);

// ============ USERS ============

/**
 * Create or get user. New users are 'pending' if ownerId is set.
 */
export async function createUser(telegramId, username, isAdmin = false) {
    const status = isAdmin ? 'approved' : 'pending';

    const { data, error } = await supabase
        .from('users')
        .upsert({
            telegram_id: telegramId,
            telegram_username: username,
            status: status
        }, {
            onConflict: 'telegram_id'
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function approveUser(telegramId, approvedByTelegramId) {
    const { error } = await supabase
        .from('users')
        .update({
            status: 'approved',
            approved_at: new Date().toISOString(),
            approved_by: approvedByTelegramId // Stores telegram ID for simplicity
        })
        .eq('telegram_id', telegramId);

    if (error) throw error;
}

export async function blockUser(telegramId) {
    const { error } = await supabase
        .from('users')
        .update({ status: 'blocked' })
        .eq('telegram_id', telegramId);

    if (error) throw error;
}

export async function getUser(telegramId) {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId)
        .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found
    return data;
}

export async function updateUserScheduleStatus(telegramId, receiveScheduled) {
    const { error } = await supabase
        .from('users')
        .update({ receive_scheduled: receiveScheduled })
        .eq('telegram_id', telegramId);

    if (error) throw error;
}

// ============ RECOMMENDATIONS ============

export async function saveRecommendation(article) {
    // Check if URL already exists
    const { data: existing } = await supabase
        .from('recommendations')
        .select('id')
        .eq('url', article.url)
        .single();

    if (existing) return existing;

    const { data, error } = await supabase
        .from('recommendations')
        .insert({
            title: article.title,
            author: article.author,
            url: article.url,
            backup_urls: article.backup_urls || [],
            description: article.description,
            reason: article.reason,
            tags: article.tags,
            is_verified: article.isVerified || false,
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function updateRecommendationVerification(recId, isVerified) {
    const { error } = await supabase
        .from('recommendations')
        .update({ is_verified: isVerified })
        .eq('id', recId);

    if (error) throw error;
}

// ============ USER RECOMMENDATIONS ============

export async function saveUserRecommendation(userId, recommendationId, telegramMessageId) {
    const { data, error } = await supabase
        .from('user_recommendations')
        .insert({
            user_id: userId,
            recommendation_id: recommendationId,
            telegram_message_id: telegramMessageId,
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

export async function updateRating(userId, recommendationId, rating) {
    const { data, error } = await supabase
        .from('user_recommendations')
        .update({
            rating,
            rated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('recommendation_id', recommendationId)
        .select('*, recommendations(*)')
        .single();

    if (error) throw error;
    return data;
}

export async function getUserRecommendationByMessageId(telegramMessageId) {
    const { data, error } = await supabase
        .from('user_recommendations')
        .select('*, users(*), recommendations(*)')
        .eq('telegram_message_id', telegramMessageId)
        .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
}

export async function getExistingUrls(userId, limit = 50) {
    const { data, error } = await supabase
        .from('user_recommendations')
        .select('recommendations(url)')
        .eq('user_id', userId)
        .order('sent_at', { ascending: false })
        .limit(limit);

    if (error) throw error;
    return data?.map(r => r.recommendations?.url).filter(Boolean) || [];
}

// ============ PREFERENCES ============

export async function getUserPreferences(userId) {
    const { data, error } = await supabase
        .from('user_preferences')
        .select('tag, weight, sample_count')
        .eq('user_id', userId)
        .order('weight', { ascending: false });

    if (error) throw error;
    return data || [];
}

export async function updateUserPreference(userId, tag, weightDelta) {
    // First try to get existing
    const { data: existing } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', userId)
        .eq('tag', tag)
        .single();

    const currentWeight = existing?.weight ?? 50;
    const currentCount = existing?.sample_count ?? 0;
    const newWeight = Math.max(0, Math.min(100, currentWeight + weightDelta));

    const { error } = await supabase
        .from('user_preferences')
        .upsert({
            user_id: userId,
            tag,
            weight: newWeight,
            sample_count: currentCount + 1,
        }, {
            onConflict: 'user_id,tag'
        });

    if (error) throw error;
    return newWeight;
}

export async function setUserPreference(userId, tag, weight) {
    const clampedWeight = Math.max(0, Math.min(100, weight));

    const { error } = await supabase
        .from('user_preferences')
        .upsert({
            user_id: userId,
            tag,
            weight: clampedWeight,
            sample_count: 1,
        }, {
            onConflict: 'user_id,tag'
        });

    if (error) throw error;
    return clampedWeight;
}

export async function removeUserPreference(userId, tag) {
    const { error } = await supabase
        .from('user_preferences')
        .delete()
        .eq('user_id', userId)
        .ilike('tag', tag);

    if (error) throw error;
}

export async function resetUserPreferences(userId) {
    const { error } = await supabase
        .from('user_preferences')
        .delete()
        .eq('user_id', userId);

    if (error) throw error;
}

export async function getScheduledUsers() {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('is_active', true)
        .eq('receive_scheduled', true);

    if (error) throw error;
    return data || [];
}
