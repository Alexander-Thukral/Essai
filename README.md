# 📚 Essai - AI Reading Curator

**Essai** is an intelligent reading curator that lives in Telegram. It doesn't just "generate content"—it proactively searches the web to find **exceptional, human-written essays, academic papers, and hidden gems** tailored to your intellectual taste.

> "The antidote to algorithmic feeds. Deep reading, verified and delivered."

## ✨ Unique Features

### 🧠 The "Elite Curator" Engine
Unlike standard AI recommendations that hallucinate titles, Essai uses a **search-first architecture** (powered by Groq Compound models) to:
*   **Balance the Canon**: Intelligently mixes **Timeless Classics** (Montaigne, Orwell, Sontag) with **Modern Hidden Gems** (Niche journals, personal blogs, preprints).
*   **Prioritize Depth**: Specifically hunts for **direct PDF links**, academic papers, and longform essays.
*   **Verify Reality**: Every recommended link is checked in real-time for validity and paywall status before it reaches you.

### 🎯 Adaptive Taste Learning
Essai learns what you love.
*   **Weighted Interests**: Your profile isn't just a list of tags; it's a weighted graph (e.g., *Philosophy: 85%, Economics: 40%*).
*   **Interactive Feedback**: Rate articles (1-5 stars) to fine-tune your weights.
*   **Reroll Capability**: Don't like a pick? Hit **"Recommend Something Else"** to instantly get a fresh alternative without affecting your profile.

### 🛠️ Robust Architecture
*   **Dual-Mode Core**: Runs as a standard polling bot (local/VPS) OR a serverless webhook (Vercel Free Tier).
*   **Smart Link Verifier**: Detects "soft paywalls" (Medium, Substack) vs. broken links.
*   **Supabase Backend**: Persists your reading history and taste profile.

## 🚀 Tech Stack

*   **Runtime**: Node.js
*   **AI/LLM**: Groq API (Llama 3.3 / Compound Beta) for high-speed, grounded reasoning.
*   **Database**: Supabase (PostgreSQL) for user state and vectors.
*   **Platform**: Telegram Bot API (`node-telegram-bot-api`).
*   **Validation**: Custom Axios-based link verifier with anti-bot evasion headers.

## 📦 Installation

### Prerequisites
*   Node.js v18+
*   A Supabase project (Free tier is fine)
*   A Groq Cloud API Key
*   A Telegram Bot Token (@BotFather)

### Setup

1.  **Clone the repo**
    ```bash
    git clone https://github.com/Alexander-Thukral/Essai.git
    cd Essai
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Configure Environment**
    Create a `.env` file:
    ```env
    TELEGRAM_BOT_TOKEN=your_token_here
    GROQ_API_KEY=your_groq_key
    SUPABASE_URL=your_supabase_url
    SUPABASE_KEY=your_supabase_anon_key
    OWNER_ID=your_telegram_id (optional, for admin access)
    ```

4.  **Initialize Database**
    Run the SQL scripts in `scripts/schema.sql` in your Supabase SQL Editor.

5.  **Run Locally**
    ```bash
    npm run dev
    ```

## 🌐 Deployment

Essai is designed to run **24/7 for free**.

### Option A: Vercel (Serverless) - Recommended
1.  Install Vercel CLI: `npm i -g vercel`
2.  Deploy: `vercel --prod`
3.  Set Environment Variables in Vercel Dashboard.
4.  Set Webhook:
    ```bash
    node scripts/set-webhook.js https://your-project.vercel.app/api/webhook
    ```

### Option B: Railway / VPS (Polling)
1.  Push to GitHub.
2.  Connect Railway/Render.
3.  Set Environment Variables.
4.  The bot will auto-detect it's not on Vercel and start Polling mode.

## 📝 License

ISC
