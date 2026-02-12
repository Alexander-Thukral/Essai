/**
 * One-time DB cleanup script
 * Fixes corrupt preference weights (>100 or <0) from previous bugs.
 * Run: node scripts/fix-preferences.js
 */

import 'dotenv/config';
import { clampAllPreferences } from '../src/services/supabase.js';

async function main() {
    console.log('🔧 Fixing corrupt preference weights...\n');
    const result = await clampAllPreferences();

    if (result.fixed > 0) {
        console.log(`\n✅ Fixed ${result.fixed}/${result.total} corrupt rows`);
    } else {
        console.log('✅ No corrupt rows found — all weights are 0-100');
    }
}

main().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
