/**
 * AI Fraud Detection Middleware
 * Monitors API requests for suspicious patterns and blocks anomalies
 * - Detects brute-force login attempts
 * - Detects mass data access patterns
 * - Blocks IPs with excessive failed requests
 */

const requestLog = {};
const blockedIPs = new Set();
const suspiciousPatterns = {};

// Configuration
const CONFIG = {
    MAX_REQUESTS_PER_MINUTE: 60,
    MAX_FAILED_LOGINS: 5,
    BAN_DURATION_MINUTES: 15,
    FAILED_LOGIN_WINDOW: 5 * 60 * 1000, // 5 minutes
    BULK_ACCESS_THRESHOLD: 50, // requests to /api/admin/users within 1 minute
    SUSPICIOUS_ENDPOINTS: ['/api/admin/users', '/api/patient/records', '/api/doctor/schedule']
};

/**
 * Main Fraud Detection Middleware
 * Use: app.use(fraudDetectionMiddleware)
 */
function fraudDetectionMiddleware(req, res, next) {
    const clientIP = req.ip || req.connection.remoteAddress;
    const endpoint = req.path;
    const method = req.method;
    const timestamp = Date.now();

    // Check if IP is blocked
    if (blockedIPs.has(clientIP)) {
        return res.status(429).json({
            error: 'Too many suspicious requests. Your IP has been temporarily blocked.',
            retryAfter: CONFIG.BAN_DURATION_MINUTES
        });
    }

    // Initialize IP tracking
    if (!requestLog[clientIP]) {
        requestLog[clientIP] = {
            totalRequests: [],
            failedLogins: [],
            suspiciousRequests: []
        };
    }

    // Track request timestamp
    requestLog[clientIP].totalRequests.push(timestamp);

    // Clean old requests (older than 1 minute)
    requestLog[clientIP].totalRequests = requestLog[clientIP].totalRequests.filter(
        t => timestamp - t < 60 * 1000
    );

    // 1. RATE LIMITING - Check requests per minute
    if (requestLog[clientIP].totalRequests.length > CONFIG.MAX_REQUESTS_PER_MINUTE) {
        logSecurityEvent(clientIP, 'RATE_LIMIT_EXCEEDED', {
            requestCount: requestLog[clientIP].totalRequests.length,
            endpoint: endpoint
        });
        blockIP(clientIP);
        return res.status(429).json({
            error: 'Rate limit exceeded. Too many requests.',
            retryAfter: CONFIG.BAN_DURATION_MINUTES
        });
    }

    // 2. BULK DATA ACCESS DETECTION
    if (CONFIG.SUSPICIOUS_ENDPOINTS.includes(endpoint) && method === 'GET') {
        detectBulkDataAccess(clientIP, endpoint, timestamp);
    }

    // 3. BRUTE FORCE LOGIN DETECTION
    if (endpoint === '/api/auth/login' && method === 'POST') {
        // Will be checked in auth controller after failed login
        res.on('finish', () => {
            if (res.statusCode === 401 || res.statusCode === 400) {
                recordFailedLogin(clientIP, timestamp);
            }
        });
    }

    // 4. SUSPICIOUS PATTERN DETECTION
    if (detectSuspiciousPatterns(clientIP, endpoint, timestamp)) {
        logSecurityEvent(clientIP, 'SUSPICIOUS_PATTERN_DETECTED', {
            endpoint: endpoint,
            method: method
        });
        recordSuspiciousRequest(clientIP, timestamp);
    }

    // Attach security info to request for controllers to use
    req.security = {
        clientIP: clientIP,
        trustLevel: calculateTrustLevel(clientIP),
        isBlocked: blockedIPs.has(clientIP)
    };

    next();
}

/**
 * BRUTE FORCE DETECTION
 * Track failed login attempts and block after threshold
 */
function recordFailedLogin(clientIP, timestamp) {
    // Clean old failed logins (older than window)
    requestLog[clientIP].failedLogins = requestLog[clientIP].failedLogins.filter(
        t => timestamp - t < CONFIG.FAILED_LOGIN_WINDOW
    );

    requestLog[clientIP].failedLogins.push(timestamp);

    if (requestLog[clientIP].failedLogins.length >= CONFIG.MAX_FAILED_LOGINS) {
        logSecurityEvent(clientIP, 'BRUTE_FORCE_DETECTED', {
            failedAttempts: requestLog[clientIP].failedLogins.length
        });
        blockIP(clientIP);
    }
}

/**
 * BULK DATA ACCESS DETECTION
 * Detects attempts to access large amounts of user data (mass export)
 */
function detectBulkDataAccess(clientIP, endpoint, timestamp) {
    if (!suspiciousPatterns[clientIP]) {
        suspiciousPatterns[clientIP] = {};
    }

    if (!suspiciousPatterns[clientIP][endpoint]) {
        suspiciousPatterns[clientIP][endpoint] = [];
    }

    // Add request to pattern tracking
    suspiciousPatterns[clientIP][endpoint].push(timestamp);

    // Clean old requests
    suspiciousPatterns[clientIP][endpoint] = suspiciousPatterns[clientIP][endpoint].filter(
        t => timestamp - t < 60 * 1000
    );

    // Check if threshold exceeded in 1 minute
    if (suspiciousPatterns[clientIP][endpoint].length > CONFIG.BULK_ACCESS_THRESHOLD) {
        logSecurityEvent(clientIP, 'BULK_DATA_ACCESS_ATTEMPT', {
            endpoint: endpoint,
            accessCount: suspiciousPatterns[clientIP][endpoint].length
        });
        blockIP(clientIP);
    }
}

/**
 * ANOMALY DETECTION
 * Detects unusual access patterns
 */
function detectSuspiciousPatterns(clientIP, endpoint, timestamp) {
    const patterns = [];

    // Pattern 1: Rapid endpoint switching (bot behavior)
    const recentRequests = requestLog[clientIP].totalRequests.filter(
        t => timestamp - t < 5 * 1000 // Last 5 seconds
    );
    if (recentRequests.length > 10) {
        patterns.push('rapid_requests');
    }

    // Pattern 2: Sequential ID access (harvesting user data)
    if (endpoint.includes('/api/patient/') || endpoint.includes('/api/doctor/')) {
        const pathParts = endpoint.split('/');
        if (pathParts.length > 3) {
            const idPattern = pathParts[pathParts.length - 1];
            if (/^\d+$/.test(idPattern)) {
                // Numeric ID detected - could be sequential enumeration
                if (!suspiciousPatterns[clientIP + '_seq']) {
                    suspiciousPatterns[clientIP + '_seq'] = [];
                }
                suspiciousPatterns[clientIP + '_seq'].push(parseInt(idPattern));

                // Check for sequential pattern
                const ids = suspiciousPatterns[clientIP + '_seq'].slice(-10);
                const isSequential = ids.length > 5 && isSequentialArray(ids);
                if (isSequential) {
                    patterns.push('sequential_id_enumeration');
                }
            }
        }
    }

    // Pattern 3: Admin panel access from unusual IPs
    if (endpoint.includes('/api/admin/') && !isKnownAdminIP(clientIP)) {
        patterns.push('unusual_admin_access');
    }

    return patterns.length > 0;
}

/**
 * UTILITY FUNCTIONS
 */

function blockIP(clientIP) {
    blockedIPs.add(clientIP);
    console.warn(`⚠️ SECURITY: IP ${clientIP} blocked for ${CONFIG.BAN_DURATION_MINUTES} minutes`);

    // Auto-unblock after duration
    setTimeout(() => {
        blockedIPs.delete(clientIP);
        console.log(`✅ SECURITY: IP ${clientIP} unblocked`);
    }, CONFIG.BAN_DURATION_MINUTES * 60 * 1000);
}

function recordSuspiciousRequest(clientIP, timestamp) {
    if (!requestLog[clientIP]) return;
    requestLog[clientIP].suspiciousRequests.push(timestamp);
}

function calculateTrustLevel(clientIP) {
    const data = requestLog[clientIP];
    if (!data) return 100;

    let trustScore = 100;

    // Deduct for failed logins
    if (data.failedLogins.length > 2) trustScore -= 30;

    // Deduct for suspicious requests
    if (data.suspiciousRequests.length > 0) trustScore -= 20;

    return Math.max(0, trustScore);
}

function isSequentialArray(arr) {
    if (arr.length < 3) return false;
    for (let i = 1; i < arr.length; i++) {
        if (arr[i] !== arr[i - 1] + 1) return false;
    }
    return true;
}

function isKnownAdminIP(ip) {
    // In production, maintain a whitelist of admin IPs
    const adminIPs = process.env.ADMIN_IPS ? process.env.ADMIN_IPS.split(',') : [];
    return adminIPs.includes(ip);
}

function logSecurityEvent(clientIP, eventType, details) {
    const timestamp = new Date().toISOString();
    console.warn(`🚨 SECURITY EVENT [${timestamp}]`);
    console.warn(`   Type: ${eventType}`);
    console.warn(`   IP: ${clientIP}`);
    console.warn(`   Details:`, details);

    // In production: Send to logging service, Sentry, or security dashboard
    // logToSecurityDashboard({ eventType, clientIP, details, timestamp });
}

/**
 * Get blocked IPs status (for admin dashboard)
 */
function getSecurityStatus() {
    return {
        blockedIPsCount: blockedIPs.size,
        blockedIPs: Array.from(blockedIPs),
        activeMonitoring: requestLog,
        timestamp: new Date()
    };
}

/**
 * Clear block for a specific IP (admin action)
 */
function unblockIP(clientIP) {
    if (blockedIPs.has(clientIP)) {
        blockedIPs.delete(clientIP);
        console.log(`✅ Admin cleared block for IP: ${clientIP}`);
        return true;
    }
    return false;
}

module.exports = {
    fraudDetectionMiddleware,
    getSecurityStatus,
    unblockIP,
    recordFailedLogin
};
