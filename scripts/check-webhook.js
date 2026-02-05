import TelegramBot from 'node-telegram-bot-api';
import config from '../src/config.js';

const bot = new TelegramBot(config.telegram.token);

async function checkWebhook() {
    try {
        console.log('🔍 Checking webhook info...\n');
        const info = await bot.getWebHookInfo();

        console.log('📡 Webhook URL:', info.url || '(none)');
        console.log('📌 Pending updates:', info.pending_update_count);
        console.log('🕐 Last error date:', info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : 'None');
        console.log('❌ Last error message:', info.last_error_message || 'None');
        console.log('📦 Max connections:', info.max_connections);
        console.log('🔗 IP address:', info.ip_address || 'Not set');

        if (!info.url) {
            console.log('\n⚠️ No webhook is set! The bot is in polling mode.');
        } else if (info.last_error_message) {
            console.log('\n🚨 There was a recent error with the webhook!');
        } else {
            console.log('\n✅ Webhook appears to be configured correctly.');
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

checkWebhook();
