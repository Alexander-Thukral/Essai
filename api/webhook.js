import bot from '../src/bot/index.js';

// Vercel Serverless Function
export default async function handler(req, res) {
    try {
        if (req.method === 'POST') {
            const update = req.body;
            console.log('📩 Webhook received update:', update.update_id);

            // Pass the update to node-telegram-bot-api to handle events
            bot.processUpdate(update);

            res.status(200).json({ ok: true });
        } else {
            // Handle GET requests (checking if alive)
            res.status(200).json({ status: 'Essai Bot is active', mode: 'webhook' });
        }
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: 'Failed to process update' });
    }
}
