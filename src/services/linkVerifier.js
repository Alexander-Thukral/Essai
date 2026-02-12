import axios from 'axios';

/**
 * Smart Link Verifier
 * 
 * Multi-strategy verification:
 * 1. HEAD request (fast) → GET fallback (reliable)
 * 2. Title keyword matching to detect wrong-page redirects
 * 3. Trusted domain whitelist for known-good sites
 * 4. Graceful paywall detection
 * 5. Never blocks delivery on uncertainty
 * 
 * Returns confidence levels: 'high', 'medium', 'low', 'failed'
 */

const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
};

// Domains we trust — a 200 from these is always valid
const TRUSTED_DOMAINS = [
    'aeon.co', 'paulgraham.com', 'gwern.net',
    'astralcodexten.substack.com', 'substack.com',
    'arxiv.org', 'ssrn.com', 'nber.org',
    'jstor.org', 'philpapers.org',
    'plato.stanford.edu',
    'medium.com', 'wikipedia.org',
    'theatlantic.com', 'newyorker.com', 'nybooks.com',
    'lrb.co.uk', 'theguardian.com',
    'econlib.org', 'libertyfund.org',
    'gutenberg.org', 'archive.org',
    'researchgate.net', 'academia.edu',
    'lesswrong.com', 'overcomingbias.com',
    'marginalrevolution.com', 'slatestarcodex.com',
    'nautil.us', 'quillette.com',
    'thenewatlantis.com', 'worksinprogress.co',
    'nplusonemag.com',
];

// Known paywall domains (page exists but may need subscription)
const PAYWALL_DOMAINS = [
    'nytimes.com', 'wsj.com', 'ft.com',
    'economist.com', 'wired.com',
    'hbr.org', 'foreignaffairs.com',
];

/**
 * Check if URL is from a trusted domain
 */
function isTrustedDomain(url) {
    try {
        const hostname = new URL(url).hostname.toLowerCase();
        return TRUSTED_DOMAINS.some(d => hostname.includes(d));
    } catch { return false; }
}

/**
 * Check if URL is from a known paywall domain
 */
function isPaywallDomain(url) {
    try {
        const hostname = new URL(url).hostname.toLowerCase();
        return PAYWALL_DOMAINS.some(d => hostname.includes(d));
    } catch { return false; }
}

/**
 * Check if this is a search fallback URL (not a real article)
 */
function isSearchFallback(url) {
    try {
        const hostname = new URL(url).hostname.toLowerCase();
        return hostname.includes('google.com') && url.includes('/search?');
    } catch { return false; }
}

/**
 * Extract page title from HTML
 */
function extractTitle(html) {
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match ? match[1].trim().slice(0, 300) : '';
}

/**
 * Check keyword overlap between expected and actual title
 * Returns a ratio 0.0 to 1.0
 */
function titleMatchScore(expectedTitle, actualTitle) {
    if (!expectedTitle || !actualTitle) return 0;

    const clean = (str) => str.toLowerCase().replace(/[^\w\s]/g, '');
    const expectedWords = clean(expectedTitle).split(/\s+/).filter(w => w.length > 3);
    const actualStr = clean(actualTitle);

    if (expectedWords.length === 0) return 1; // Can't check, assume ok

    const matches = expectedWords.filter(w => actualStr.includes(w));
    return matches.length / expectedWords.length;
}

/**
 * Verify a URL is accessible and likely points to the expected content.
 * 
 * @param {string} url - URL to verify
 * @param {string} expectedTitle - Title we expect to find (for content matching)
 * @returns {Promise<{isValid: boolean, confidence: string, status?: number, title?: string, isPaywall?: boolean, reason?: string}>}
 */
export async function verifyLink(url, expectedTitle = '') {
    // Search fallback URLs are always "valid" (they're Google search links)
    if (isSearchFallback(url)) {
        return {
            isValid: true,
            confidence: 'low',
            reason: 'Search fallback URL',
            isPaywall: false,
            isSearchFallback: true,
        };
    }

    const isPaywall = isPaywallDomain(url);
    const isTrusted = isTrustedDomain(url);

    // Strategy 1: Try HEAD request first (fast)
    try {
        const headResult = await axios.head(url, {
            timeout: 6000,
            maxRedirects: 5,
            headers: BROWSER_HEADERS,
            validateStatus: () => true,
        });

        if (headResult.status >= 200 && headResult.status < 400) {
            // HEAD succeeded — page exists
            // PDFs: content-type check is sufficient
            const contentType = (headResult.headers['content-type'] || '').toLowerCase();
            if (contentType.includes('pdf')) {
                return {
                    isValid: true,
                    confidence: 'high',
                    status: headResult.status,
                    isPaywall: false,
                    isPdf: true,
                };
            }

            // For trusted domains, HEAD 200 is enough
            if (isTrusted || isPaywall) {
                return {
                    isValid: true,
                    confidence: isTrusted ? 'high' : 'medium',
                    status: headResult.status,
                    isPaywall,
                };
            }
        }

        // HEAD returned 4xx/5xx — fall through to GET
        if (headResult.status === 404 || headResult.status === 410) {
            return {
                isValid: false,
                confidence: 'high',
                status: headResult.status,
                reason: 'Page not found',
                isPaywall: false,
            };
        }
    } catch {
        // HEAD failed (many sites reject HEAD) — fall through to GET
    }

    // Strategy 2: Full GET request with content inspection
    try {
        const response = await axios.get(url, {
            timeout: 10000,
            maxRedirects: 5,
            headers: BROWSER_HEADERS,
            validateStatus: () => true,
            maxContentLength: 500000, // 500KB
            responseType: 'text',
        });

        const status = response.status;
        const html = typeof response.data === 'string' ? response.data : '';
        const pageTitle = extractTitle(html);

        // 404 or page-not-found
        if (status === 404 || status === 410) {
            return {
                isValid: false,
                confidence: 'high',
                status,
                title: pageTitle,
                reason: 'Page not found',
                isPaywall: false,
            };
        }

        // Page-not-found in content but 200 status (soft 404)
        if (status === 200 && html.length < 5000) {
            const notFoundPatterns = [
                /page\s*(not\s*found|doesn'?t\s*exist)/i,
                /no\s*longer\s*(available|exists)/i,
                /has\s*been\s*(removed|deleted)/i,
                /content\s*unavailable/i,
            ];
            if (notFoundPatterns.some(p => p.test(html))) {
                return {
                    isValid: false,
                    confidence: 'medium',
                    status,
                    title: pageTitle,
                    reason: 'Content appears removed (soft 404)',
                    isPaywall: false,
                };
            }
        }

        // 2xx/3xx — page exists
        if (status >= 200 && status < 400) {
            // Title match check (hallucination detection)
            let confidence = 'medium';
            let reason;

            if (expectedTitle && pageTitle) {
                const score = titleMatchScore(expectedTitle, pageTitle);
                if (score >= 0.3) {
                    confidence = 'high';
                } else if (score === 0 && expectedTitle.split(/\s+/).length > 2) {
                    // Zero keyword overlap with a multi-word title = likely wrong page
                    confidence = 'low';
                    reason = 'Title mismatch — page may not be the expected article';
                }
            }

            if (isTrusted) confidence = 'high';

            return {
                isValid: true,
                confidence,
                status,
                title: pageTitle,
                isPaywall,
                reason,
            };
        }

        // 401/403 — page exists but restricted
        if (status === 401 || status === 403) {
            return {
                isValid: true,
                confidence: 'medium',
                status,
                title: pageTitle,
                isPaywall: true,
                reason: 'Login or subscription required',
            };
        }

        // 5xx — server error, treat as uncertain
        if (status >= 500) {
            return {
                isValid: false,
                confidence: 'low',
                status,
                reason: `Server error (${status})`,
                isPaywall: false,
            };
        }

        // Other 4xx
        return {
            isValid: false,
            confidence: 'medium',
            status,
            reason: `HTTP ${status}`,
            isPaywall: false,
        };

    } catch (error) {
        const code = error.code || '';

        // DNS failure = definitely invalid
        if (code === 'ENOTFOUND') {
            return { isValid: false, confidence: 'high', reason: 'Domain not found', isPaywall: false };
        }

        // Connection refused
        if (code === 'ECONNREFUSED') {
            return { isValid: false, confidence: 'high', reason: 'Connection refused', isPaywall: false };
        }

        // Timeout — page might be slow but exists
        if (code === 'ECONNABORTED' || error.message?.includes('timeout')) {
            return { isValid: false, confidence: 'low', reason: 'Timeout', isPaywall: false };
        }

        // SSL error — site exists but cert issue
        if (code.includes('SSL') || code.includes('CERT')) {
            return { isValid: true, confidence: 'low', reason: 'SSL certificate issue', isPaywall: false };
        }

        // Known paywall or trusted domain with connection issues — assume valid
        if (isPaywall || isTrusted) {
            return {
                isValid: true,
                confidence: 'low',
                reason: 'Verification blocked (trusted domain)',
                isPaywall,
            };
        }

        return {
            isValid: false,
            confidence: 'low',
            reason: code || error.message || 'Network error',
            isPaywall: false,
        };
    }
}

/**
 * Verify multiple URLs and return the first valid one.
 * Used in the recommendation pipeline to try primary → alternatives.
 * 
 * @param {Array<{url: string, title: string}>} candidates
 * @returns {Promise<{article: object, verification: object, index: number} | null>}
 */
export async function findFirstValidLink(candidates) {
    for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        const verification = await verifyLink(candidate.url, candidate.title);

        if (verification.isValid) {
            return { article: candidate, verification, index: i };
        }

        console.log(`  ❌ Link ${i + 1} failed: ${candidate.url} — ${verification.reason}`);
    }
    return null;
}

export default { verifyLink, findFirstValidLink };
