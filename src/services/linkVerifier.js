import axios from 'axios';

/**
 * Link Verifier Service
 * 
 * Verifies URLs are accessible. Handles:
 * - Substack and newsletter platforms
 * - Paywalled content (marks it, doesn't reject)
 * - Redirect URLs
 * - Various HTTP edge cases
 */

// Browser-like headers to avoid being blocked
const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
};

// Known paywalled domains (still valid, just flagged)
const KNOWN_PAYWALL_DOMAINS = [
    'substack.com',
    'astralcodexten.com',
    'medium.com',
    'nytimes.com',
    'wsj.com',
    'ft.com',
    'economist.com',
    'newyorker.com',
    'theatlantic.com',
    'wired.com',
];

// Patterns that indicate a soft paywall (content still accessible)
const SOFT_PAYWALL_PATTERNS = [
    /subscribe/i,
    /sign.?up/i,
    /create.?account/i,
    /member/i,
];

// Patterns that indicate page not found
const NOT_FOUND_PATTERNS = [
    /page\s*(not\s*found|doesn'?t\s*exist)/i,
    /404/i,
    /no\s*longer\s*(available|exists)/i,
    /has\s*been\s*(removed|deleted)/i,
    /content\s*unavailable/i,
];

/**
 * Check if domain is known to have paywall
 */
function isKnownPaywallDomain(url) {
    try {
        const hostname = new URL(url).hostname.toLowerCase();
        return KNOWN_PAYWALL_DOMAINS.some(domain => hostname.includes(domain));
    } catch {
        return false;
    }
}

/**
 * Extract title from HTML
 */
function extractTitle(html) {
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match ? match[1].trim().slice(0, 200) : '';
}

/**
 * Check if content indicates page not found
 */
function isNotFound(html, status) {
    if (status === 404) return true;

    // Check first 5KB of content for not-found patterns
    const sample = html.slice(0, 5000);
    return NOT_FOUND_PATTERNS.some(pattern => pattern.test(sample));
}

/**
 * Verify if a URL is accessible
 * 
 * @param {string} url - URL to verify
 * @param {Object} options - Options
 * @returns {Promise<{isValid: boolean, isPaywall?: boolean, status?: number, title?: string, reason?: string}>}
 */
export async function verifyLink(url, options = {}) {
    const { timeout = 15000 } = options;

    // Pre-check for known paywall domains
    const isKnownPaywall = isKnownPaywallDomain(url);

    try {
        // Use GET request (HEAD often fails or returns different status)
        const response = await axios.get(url, {
            timeout,
            maxRedirects: 5,
            headers: BROWSER_HEADERS,
            validateStatus: () => true, // Accept any status
            maxContentLength: 500000, // 500KB max
            responseType: 'text',
        });

        const status = response.status;
        const html = typeof response.data === 'string' ? response.data : '';
        const title = extractTitle(html);

        // Check for not found
        if (isNotFound(html, status)) {
            return {
                isValid: false,
                isPaywall: false,
                status,
                title,
                reason: 'Page not found',
            };
        }

        // 2xx or 3xx = Valid
        if (status >= 200 && status < 400) {
            return {
                isValid: true,
                isPaywall: isKnownPaywall,
                status,
                title,
            };
        }

        // 401/403 = Likely paywall or login required
        // Still "valid" in the sense the page exists
        if (status === 401 || status === 403) {
            return {
                isValid: true, // Page exists, just restricted
                isPaywall: true,
                status,
                title,
                reason: 'Login/subscription required',
            };
        }

        // 5xx = Server error, might be temporary
        if (status >= 500) {
            return {
                isValid: false,
                isPaywall: false,
                status,
                reason: `Server error (${status})`,
            };
        }

        // Other 4xx
        return {
            isValid: false,
            isPaywall: false,
            status,
            reason: `HTTP ${status}`,
        };

    } catch (error) {
        // Network errors
        const errorCode = error.code || 'UNKNOWN';

        // Some sites block axios but page is still valid
        // If it's a known paywall domain, assume it's valid
        if (isKnownPaywall && (errorCode === 'ERR_BAD_RESPONSE' || errorCode === 'ECONNRESET')) {
            return {
                isValid: true,
                isPaywall: true,
                reason: 'Known paywall site (verification blocked)',
            };
        }

        // Timeout - page might be slow but valid
        if (errorCode === 'ECONNABORTED' || error.message?.includes('timeout')) {
            return {
                isValid: false,
                isPaywall: false,
                reason: 'Timeout',
            };
        }

        // DNS error = definitely invalid
        if (errorCode === 'ENOTFOUND') {
            return {
                isValid: false,
                isPaywall: false,
                reason: 'Domain not found',
            };
        }

        // Connection refused
        if (errorCode === 'ECONNREFUSED') {
            return {
                isValid: false,
                isPaywall: false,
                reason: 'Connection refused',
            };
        }

        // SSL errors - site exists but cert issue
        if (errorCode.includes('SSL') || errorCode.includes('CERT')) {
            return {
                isValid: true, // Site exists
                isPaywall: false,
                reason: 'SSL certificate issue',
            };
        }

        // Default: assume invalid
        return {
            isValid: false,
            isPaywall: false,
            reason: errorCode || error.message || 'Network error',
        };
    }
}

export default { verifyLink };
