import TelegramBot from 'node-telegram-bot-api';
import config from '../src/config.js';

const bot = new TelegramBot(config.telegram.token);

async function setWebhook() {
    const url = process.argv[2];

    if (!url) {
        console.error('❌ Please provide the Vercel URL as an argument.');
        console.log('Usage: node scripts/set-webhook.js https://your-app.vercel.app/api/webhook');
        process.exit(1);
    }

    try {
        console.log(`🔗 Setting webhook to: ${url}`);
        const success = await bot.setWebHook(url);

        if (success) {
            console.log('✅ Webhook set successfully!');
            console.log('Your bot is now in Webhook mode (Vercel).');
        } else {
            console.error('❌ Failed to set webhook.');
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

setWebhook();
