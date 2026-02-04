import { GoogleGenAI } from '@google/genai';
import 'dotenv/config';
import fs from 'fs';

// Fallback if not in .env (for testing if needed, but user should have it)
const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    console.error('❌ GEMINI_API_KEY not found in environment');
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

async function testGrounding() {
    const model = 'gemini-2.5-flash';
    const logFile = 'scripts/test-output.txt';

    // Helper to log to both console and file
    const log = (msg) => {
        console.log(msg);
        const str = typeof msg === 'object' ? JSON.stringify(msg, null, 2) : msg;
        fs.appendFileSync(logFile, str + '\n');
    };

    fs.writeFileSync(logFile, ''); // Clear file

    log(`🤖 Testing Model: ${model}`);
    log(`🔎 Tool: googleSearch enabled`);

    const prompt = 'Who won the euro 2024?';

    try {
        const result = await ai.models.generateContent({
            model: model,
            contents: prompt,
            config: {
                tools: [{ googleSearch: {} }]
            }
        });

        log('\n✅ API Call Successful');
        log('--- FULL RESULT OBJECT ---');
        log(result);

        // Specifically look for candidates
        if (result.candidates && result.candidates.length > 0) {
            log('\n--- CANDIDATE 0 ---');
            log(result.candidates[0]);

            // Check for grounding metadata
            if (result.candidates[0].groundingMetadata) {
                log('\n🌍 Grounding Metadata Found!');
                log(result.candidates[0].groundingMetadata);
            } else {
                log('\n❌ No grounding metadata in candidate[0]');
            }
        }

    } catch (error) {
        log('❌ API Call Failed: ' + error.message);
        log(error);
    }
}

testGrounding();
