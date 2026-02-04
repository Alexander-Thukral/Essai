Here is an overview of the architectural decisions and the execution plan implemented so far for CuriousMind.
1. High-Level Architecture: "Thick Client" / Serverless
We opted for a Client-Side Single Page Application (SPA) architecture. Instead of a traditional backend (Node/Python) managing the logic, the browser handles everything.
Why: It is the fastest way to prototype. It costs $0 to host (can run on GitHub Pages or locally), requires no database setup, and keeps your API keys stored locally on your own machine rather than a remote server.
Trade-off: Data is local to your specific browser. If you switch computers, your "taste profile" doesn't come with you (yet).
2. Core Components
A. The Brain (Gemini Flash)
Service: services/gemini.ts
Decision: We are using gemini-2.5-flash-latest.
Reasoning: Recommendation engines require iterative prompting. Flash is fast and cheap (or free), allowing us to use large context windows (sending your previous history) without hitting rate limits or high costs. We use JSON Schema Mode to force the AI to return structured data we can immediately render, avoiding the need for messy text parsing.
B. The Memory (Local Storage Layer)
Service: services/storage.ts
Decision: We treat the browser's localStorage as a NoSQL database.
Reasoning: It provides persistence between page reloads without the complexity of setting up Supabase/PostgreSQL immediately. It stores:
Articles: The content you've generated.
User Preferences: The weighted tags.
API Key: Securely saved so you don't re-enter it.
C. The Feedback Loop (Taste Engine)
Logic: updateTasteProfile in storage.ts
Algorithm: We implemented a "Weighted Tag Heuristic."
Every tag (e.g., "Philosophy") starts at a weight of 50.
5-star rating: +4 to weight.
1-star rating: -4 to weight.
Dampening: Weights are capped between 0 and 100.
Result: When you request a new article, we take your top 5 weighted tags and inject them into the System Prompt. This creates a self-reinforcing loop where the AI "learns" what you like.
D. The UI (React + Tailwind)
Components: Modular design (ArticleCard, TasteChart).
Visualization: We added recharts to visualize the taste profile. This satisfies the requirement for "Transparent" AI—you can actually see why the bot thinks you like Psychology.
3. Execution Plan Status
We are currently completing Phase 1 (Basic Pipeline) and part of Phase 2 (UI/Rating) from your original brief, but adapted for the web first.
Done:
Connect to Gemini API.
Generate recommendations with "intellectual" constraints.
Render results.
Rate content.
Adjust taste profile based on ratings.
Persist data.
Deferred (Future Phases):
Automation/Scheduler: Currently, you must click "Recommend." To run this automatically every 2 days on Windows, we would eventually move the gemini.ts logic to a Node.js script run by Windows Task Scheduler.
Telegram: Currently, the UI is the delivery mechanism. Integrating Telegram would require a small backend server (or a serverless function) to receive the webhook.
Link Verification: We currently trust Gemini's output. Real link checking (pinging the URL) is blocked by CORS (Cross-Origin Resource Sharing) in browsers. This specific feature requires a backend proxy to work reliably.
Summary
You now have a functional Personal Recommendation Dashboard. It acts as the "training ground" for your algorithm. Once you have used this for a few weeks and the tag weights have stabilized around your actual interests, we can easily port the logic to a background script for the Telegram automation you originally envisioned.