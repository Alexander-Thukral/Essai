/**
 * Test Script for Curator Service
 * Run: node scripts/test-curator.js
 * 
 * Tests the recommendation generation and link verification
 * independently of Telegram for rapid iteration.
 */

import 'dotenv/config';
import { generateRecommendation } from '../src/services/gemini.js';
import { verifyLink } from '../src/services/linkVerifier.js';

// Mock user preferences for testing
const MOCK_PREFERENCES = [
    { tag: 'Philosophy', weight: 85 },
    { tag: 'Psychology', weight: 75 },
    { tag: 'Economics', weight: 70 },
    { tag: 'Game Theory', weight: 65 },
    { tag: 'History', weight: 60 },
];

// Mock existing URLs (to test deduplication)
const MOCK_EXISTING_URLS = [
    // Add URLs here if testing deduplication
];

async function runTest() {
    console.log('═'.repeat(60));
    console.log('🧪 CURATOR SERVICE TEST');
    console.log('═'.repeat(60));
    console.log('');

    // Display test config
    console.log('📊 Test Configuration:');
    console.log(`   Preferences: ${MOCK_PREFERENCES.map(p => `${p.tag}(${p.weight})`).join(', ')}`);
    console.log(`   Existing URLs: ${MOCK_EXISTING_URLS.length}`);
    console.log('');

    const startTime = Date.now();

    try {
        // Step 1: Generate Recommendation
        console.log('─'.repeat(60));
        console.log('🧠 Step 1: Generating Recommendation...');
        console.log('─'.repeat(60));

        const genStart = Date.now();
        const article = await generateRecommendation(MOCK_PREFERENCES, MOCK_EXISTING_URLS);
        const genTime = Date.now() - genStart;

        console.log(`\n✅ Generation complete (${genTime}ms)`);
        console.log('');
        console.log('📖 Article Details:');
        console.log(`   Title:       ${article.title}`);
        console.log(`   Author:      ${article.author}`);
        console.log(`   URL:         ${article.url}`);
        console.log(`   Description: ${article.description?.slice(0, 100)}...`);
        console.log(`   Reason:      ${article.reason?.slice(0, 100)}...`);
        console.log(`   Tags:        ${article.tags?.join(', ')}`);
        console.log(`   Backup URLs: ${article.backup_urls?.length || 0}`);

        if (article.backup_urls?.length) {
            console.log('   Backups:');
            article.backup_urls.slice(0, 3).forEach((url, i) => {
                console.log(`     ${i + 1}. ${url.slice(0, 70)}...`);
            });
        }

        // Step 2: Verify Link
        console.log('');
        console.log('─'.repeat(60));
        console.log('🔗 Step 2: Verifying Link...');
        console.log('─'.repeat(60));

        const verifyStart = Date.now();
        const verification = await verifyLink(article.url);
        const verifyTime = Date.now() - verifyStart;

        console.log(`\n${verification.isValid ? '✅' : '❌'} Verification complete (${verifyTime}ms)`);
        console.log(`   Valid:    ${verification.isValid}`);
        console.log(`   Status:   ${verification.status || 'N/A'}`);
        console.log(`   Paywall:  ${verification.isPaywall || false}`);
        if (verification.title) {
            console.log(`   Page Title: ${verification.title.slice(0, 60)}...`);
        }
        if (verification.reason) {
            console.log(`   Reason:   ${verification.reason}`);
        }

        // Step 3: Try backups if main fails
        if (!verification.isValid && article.backup_urls?.length) {
            console.log('');
            console.log('─'.repeat(60));
            console.log('🔄 Step 3: Trying Backup URLs...');
            console.log('─'.repeat(60));

            for (const backupUrl of article.backup_urls.slice(0, 3)) {
                const backupResult = await verifyLink(backupUrl);
                const status = backupResult.isValid ? '✅' : '❌';
                console.log(`   ${status} ${backupUrl.slice(0, 50)}... (${backupResult.status || 'N/A'})`);

                if (backupResult.isValid) {
                    console.log(`   → Using backup URL instead`);
                    article.url = backupUrl;
                    break;
                }
            }
        }

        // Summary
        const totalTime = Date.now() - startTime;
        console.log('');
        console.log('═'.repeat(60));
        console.log('📊 SUMMARY');
        console.log('═'.repeat(60));
        console.log(`   Generation Time:   ${genTime}ms`);
        console.log(`   Verification Time: ${verifyTime}ms`);
        console.log(`   Total Time:        ${totalTime}ms`);
        console.log(`   Final URL Valid:   ${verification.isValid ? 'YES ✅' : 'NO ❌'}`);
        console.log('');

        return { success: verification.isValid, article, verification, timing: { genTime, verifyTime, totalTime } };

    } catch (error) {
        const totalTime = Date.now() - startTime;
        console.log('');
        console.log('═'.repeat(60));
        console.log('❌ ERROR');
        console.log('═'.repeat(60));
        console.log(`   Message: ${error.message}`);
        console.log(`   Time:    ${totalTime}ms`);
        console.log('');
        console.log('Stack trace:');
        console.log(error.stack);

        return { success: false, error: error.message, timing: { totalTime } };
    }
}

// Run multiple tests for consistency check
async function runMultipleTests(count = 1) {
    if (count === 1) {
        await runTest();
        return;
    }

    console.log(`\n🔁 Running ${count} tests for consistency...\n`);

    const results = [];
    for (let i = 0; i < count; i++) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`TEST ${i + 1} of ${count}`);
        console.log(`${'='.repeat(60)}\n`);

        const result = await runTest();
        results.push(result);

        // Small delay between tests
        if (i < count - 1) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    // Summary of all tests
    console.log('\n');
    console.log('═'.repeat(60));
    console.log('🏁 BATCH SUMMARY');
    console.log('═'.repeat(60));

    const successful = results.filter(r => r.success).length;
    const avgGenTime = results.filter(r => r.timing.genTime).reduce((a, r) => a + r.timing.genTime, 0) / results.length;
    const avgTotalTime = results.reduce((a, r) => a + r.timing.totalTime, 0) / results.length;

    console.log(`   Tests Run:      ${count}`);
    console.log(`   Successful:     ${successful} (${Math.round(successful / count * 100)}%)`);
    console.log(`   Avg Gen Time:   ${Math.round(avgGenTime)}ms`);
    console.log(`   Avg Total Time: ${Math.round(avgTotalTime)}ms`);
    console.log('');
}

// Parse command line args
const testCount = parseInt(process.argv[2]) || 1;
runMultipleTests(testCount);
