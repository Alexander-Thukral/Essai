/**
 * Test Script for Two-Step Curator
 * Run: node scripts/test-curator.js [runs]
 * 
 * Tests the new two-step recommendation pipeline independently of Telegram.
 */

import 'dotenv/config';
import { generateRecommendation } from '../src/services/curator.js';
import { verifyLink } from '../src/services/linkVerifier.js';

const MOCK_PREFERENCES = [
    { tag: 'Philosophy', weight: 85 },
    { tag: 'Psychology', weight: 75 },
    { tag: 'Economics', weight: 70 },
    { tag: 'Game Theory', weight: 65 },
    { tag: 'History', weight: 55 },
];

const runs = parseInt(process.argv[2], 10) || 1;

async function runTest(runNum) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🧪 RUN ${runNum}`);
    console.log('='.repeat(60));

    const startTime = Date.now();

    try {
        // Step 1+2: Generate recommendation
        const article = await generateRecommendation(MOCK_PREFERENCES, []);
        const genTime = Date.now() - startTime;

        console.log(`\n📊 Generation took ${genTime}ms`);
        console.log(`\n--- PRIMARY ---`);
        console.log(`Title:       ${article.title}`);
        console.log(`Author:      ${article.author}`);
        console.log(`Publication: ${article.publication || 'N/A'}`);
        console.log(`Category:    ${article.category}`);
        console.log(`URL:         ${article.url}`);
        console.log(`Fallback?    ${article.is_search_fallback ? 'YES (Google search)' : 'No'}`);
        console.log(`Tags:        ${JSON.stringify(article.tags)}`);
        console.log(`Description: ${article.description?.slice(0, 150)}...`);
        console.log(`Reason:      ${article.reason?.slice(0, 150)}...`);

        // Verify primary
        console.log(`\n🔍 Verifying primary URL...`);
        const verification = await verifyLink(article.url, article.title);
        console.log(`  Valid:      ${verification.isValid ? '✅ Yes' : '❌ No'}`);
        console.log(`  Confidence: ${verification.confidence}`);
        console.log(`  Status:     ${verification.status || 'N/A'}`);
        console.log(`  Reason:     ${verification.reason || 'OK'}`);
        if (verification.title) console.log(`  Page Title: ${verification.title.slice(0, 80)}`);

        // Show alternatives
        if (article.alternatives?.length > 0) {
            console.log(`\n--- ALTERNATIVES (${article.alternatives.length}) ---`);
            for (const alt of article.alternatives) {
                console.log(`  • "${alt.title}" by ${alt.author}`);
                console.log(`    URL: ${alt.url}`);
                console.log(`    Fallback? ${alt.is_search_fallback ? 'YES' : 'No'}`);

                const altV = await verifyLink(alt.url, alt.title);
                console.log(`    Valid: ${altV.isValid ? '✅' : '❌'} (${altV.confidence})`);
            }
        }

        const totalTime = Date.now() - startTime;
        console.log(`\n⏱️ Total time: ${totalTime}ms`);

        return {
            success: true,
            primaryValid: verification.isValid,
            primaryFallback: !!article.is_search_fallback,
            altsCount: article.alternatives?.length || 0,
            timeMs: totalTime,
        };
    } catch (error) {
        console.error(`\n❌ FAILED: ${error.message}`);
        console.error(error.stack?.split('\n').slice(0, 3).join('\n'));
        return { success: false, error: error.message };
    }
}

async function main() {
    console.log(`\n🚀 Testing Two-Step Curator — ${runs} run(s)\n`);

    const results = [];
    for (let i = 1; i <= runs; i++) {
        const result = await runTest(i);
        results.push(result);

        // Rate limit protection between runs
        if (i < runs) {
            console.log(`\n⏳ Waiting 3s before next run...`);
            await new Promise(r => setTimeout(r, 3000));
        }
    }

    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    const successful = results.filter(r => r.success);
    const primaryValid = successful.filter(r => r.primaryValid);
    const avgTime = successful.length ? Math.round(successful.reduce((s, r) => s + r.timeMs, 0) / successful.length) : 0;

    console.log(`  Runs:          ${runs}`);
    console.log(`  Successful:    ${successful.length}/${runs}`);
    console.log(`  Primary Valid: ${primaryValid.length}/${successful.length}`);
    console.log(`  Avg Time:      ${avgTime}ms`);

    if (results.some(r => !r.success)) {
        console.log(`  Failures:`);
        results.filter(r => !r.success).forEach((r, i) => {
            console.log(`    ${i + 1}. ${r.error}`);
        });
    }
}

main();
