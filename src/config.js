import 'dotenv/config';

export const config = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN,
    ownerId: process.env.ALLOWED_TELEGRAM_IDS
      ? parseInt(process.env.ALLOWED_TELEGRAM_IDS.split(',')[0].trim(), 10)
      : null,
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
  },
  gemini: {
    // Falls back to Windows env variable if not in .env
    apiKey: process.env.GEMINI_API_KEY,
  },
  groq: {
    // Falls back to Windows env variable if not in .env
    apiKey: process.env.GROQ_API_KEY,
  },
};

// Log owner status
if (config.telegram.ownerId) {
  console.log(`🔒 Access Control enabled. Owner: ${config.telegram.ownerId}`);
} else {
  console.warn(`⚠️ No owner configured. New users will be stuck in pending state!`);
}

export default config;
