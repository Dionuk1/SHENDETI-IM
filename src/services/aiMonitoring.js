/**
 * AI & Security Monitoring Dashboard
 * Provides real-time insights into AI usage and security events
 * 
 * Access: /api/admin/ai-dashboard
 * Requires: Admin role + JWT auth
 */

class AIMonitoringDashboard {
    constructor() {
        this.stats = {
            totalSymptomAnalyzes: 0,
            totalChatMessages: 0,
            totalQueuePredictions: 0,
            totalDocumentAnalyzes: 0,
            aiResponseTime: {
                avgMs: 0,
                min: Infinity,
                max: 0,
                samples: []
            },
            securityEvents: [],
            blockedIPs: [],
            fraudDetectionStatus: {
                active: true,
                totalBlocks: 0,
                recentIncidents: []
            },
            topSymptoms: [],
            topQueries: [],
            activeSessions: 0,
            peakHour: 0,
            errorRate: 0,
            geminiApiStatus: 'pending'
        };

        this.eventLog = [];
        this.maxEventLog = 1000; // Keep last 1000 events
    }

    /**
     * Log AI usage
     */
    logAIUsage(type, userId, responseTime, success = true) {
        const timestamp = new Date();

        // Update stats
        switch (type) {
            case 'symptom':
                this.stats.totalSymptomAnalyzes++;
                break;
            case 'chat':
                this.stats.totalChatMessages++;
                break;
            case 'queue':
                this.stats.totalQueuePredictions++;
                break;
            case 'document':
                this.stats.totalDocumentAnalyzes++;
                break;
        }

        // Track response time
        this.stats.aiResponseTime.samples.push(responseTime);
        if (this.stats.aiResponseTime.samples.length > 100) {
            this.stats.aiResponseTime.samples.shift(); // Keep last 100
        }
        this.updateResponseTimeStats();

        // Add to event log
        const event = {
            timestamp,
            type,
            userId,
            responseTime,
            success,
            status: success ? '✅' : '❌'
        };

        this.eventLog.push(event);
        if (this.eventLog.length > this.maxEventLog) {
            this.eventLog.shift();
        }

        // Log to console
        console.log(`[AI] ${event.status} ${type.toUpperCase()} - ${responseTime}ms - User: ${userId}`);
    }

    /**
     * Log security events
     */
    logSecurityEvent(eventType, ipAddress, details) {
        const timestamp = new Date();
        const event = {
            timestamp,
            type: eventType,
            ip: ipAddress,
            details: details,
            severity: this.determineSeverity(eventType)
        };

        this.stats.securityEvents.push(event);
        if (this.stats.securityEvents.length > 500) {
            this.stats.securityEvents.shift(); // Keep last 500
        }

        if (this.stats.fraudDetectionStatus.recentIncidents.length < 10) {
            this.stats.fraudDetectionStatus.recentIncidents.push(event);
        }

        console.warn(`[SECURITY] ${eventType} from ${ipAddress}`, details);
    }

    /**
     * Track symptom patterns
     */
    trackSymptom(symptom) {
        const existing = this.stats.topSymptoms.find(s => s.text === symptom);
        if (existing) {
            existing.count++;
        } else {
            this.stats.topSymptoms.push({ text: symptom, count: 1 });
        }
        // Keep top 10
        this.stats.topSymptoms.sort((a, b) => b.count - a.count).slice(0, 10);
    }

    /**
     * Track search queries
     */
    trackQuery(query) {
        const existing = this.stats.topQueries.find(q => q.text === query);
        if (existing) {
            existing.count++;
        } else {
            this.stats.topQueries.push({ text: query, count: 1 });
        }
        // Keep top 20
        this.stats.topQueries.sort((a, b) => b.count - a.count).slice(0, 20);
    }

    /**
     * Get dashboard data for admin
     */
    getDashboardData() {
        return {
            overview: {
                totalAnalyzes: this.stats.totalSymptomAnalyzes + this.stats.totalDocumentAnalyzes,
                totalChats: this.stats.totalChatMessages,
                totalQueuePredictions: this.stats.totalQueuePredictions,
                avgResponseTime: Math.round(this.stats.aiResponseTime.avgMs),
                errorRate: this.stats.errorRate.toFixed(2) + '%'
            },
            performance: {
                avgResponseTime: Math.round(this.stats.aiResponseTime.avgMs),
                minResponseTime: this.stats.aiResponseTime.min,
                maxResponseTime: this.stats.aiResponseTime.max,
                samplesCollected: this.stats.aiResponseTime.samples.length
            },
            security: {
                fraudDetectionActive: this.stats.fraudDetectionStatus.active,
                totalBlockedIPs: this.stats.fraudDetectionStatus.totalBlocks,
                currentlyBlockedIPs: this.stats.blockedIPs.length,
                blockedIPs: this.stats.blockedIPs.slice(0, 10),
                recentIncidents: this.stats.fraudDetectionStatus.recentIncidents.slice(0, 10)
            },
            insights: {
                topSymptoms: this.stats.topSymptoms.slice(0, 5),
                topQueries: this.stats.topQueries.slice(0, 5),
                peakActivityHour: this.stats.peakHour
            },
            recentEvents: this.eventLog.slice(-20).reverse(),
            status: {
                geminiAPI: this.stats.geminiApiStatus,
                mongoConnection: 'connected',
                serverHealth: 'healthy'
            },
            timestamp: new Date()
        };
    }

    /**
     * Get full audit log (with filtering)
     */
    getAuditLog(filters = {}) {
        let filtered = [...this.eventLog];

        // Filter by type
        if (filters.type) {
            filtered = filtered.filter(e => e.type === filters.type);
        }

        // Filter by user
        if (filters.userId) {
            filtered = filtered.filter(e => e.userId === filters.userId);
        }

        // Filter by success/failure
        if (filters.successOnly !== undefined) {
            filtered = filtered.filter(e => e.success === filters.successOnly);
        }

        // Sort by date
        filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        return {
            total: filtered.length,
            events: filtered.slice(0, 100),
            filters: filters
        };
    }

    /**
     * Get security report
     */
    getSecurityReport() {
        const now = new Date();
        const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        const events24h = this.stats.securityEvents.filter(e => new Date(e.timestamp) > last24h);
        const events7d = this.stats.securityEvents.filter(e => new Date(e.timestamp) > last7d);

        return {
            summary: {
                total_events: this.stats.securityEvents.length,
                events_24h: events24h.length,
                events_7d: events7d.length,
                current_blocked_ips: this.stats.blockedIPs.length
            },
            incidents: {
                critical: events24h.filter(e => e.severity === 'critical').length,
                high: events24h.filter(e => e.severity === 'high').length,
                medium: events24h.filter(e => e.severity === 'medium').length,
                low: events24h.filter(e => e.severity === 'low').length
            },
            topThreats: this.getTopThreats(),
            recentIncidents: this.stats.securityEvents.slice(-20).reverse(),
            blocked_ips: this.stats.blockedIPs,
            timestamp: now
        };
    }

    /**
     * Helper: Update response time statistics
     */
    updateResponseTimeStats() {
        if (this.stats.aiResponseTime.samples.length === 0) return;

        const samples = this.stats.aiResponseTime.samples;
        this.stats.aiResponseTime.avgMs = Math.round(
            samples.reduce((a, b) => a + b, 0) / samples.length
        );
        this.stats.aiResponseTime.min = Math.min(...samples);
        this.stats.aiResponseTime.max = Math.max(...samples);
    }

    /**
     * Helper: Determine event severity
     */
    determineSeverity(eventType) {
        const severityMap = {
            'BRUTE_FORCE_DETECTED': 'critical',
            'BULK_DATA_ACCESS_ATTEMPT': 'critical',
            'RATE_LIMIT_EXCEEDED': 'high',
            'SUSPICIOUS_PATTERN_DETECTED': 'high',
            'SEQUENTIAL_ID_ENUMERATION': 'critical',
            'UNUSUAL_ADMIN_ACCESS': 'medium'
        };
        return severityMap[eventType] || 'low';
    }

    /**
     * Helper: Get top threats
     */
    getTopThreats() {
        const threatTypes = {};
        this.stats.securityEvents.forEach(event => {
            threatTypes[event.type] = (threatTypes[event.type] || 0) + 1;
        });
        return Object.entries(threatTypes)
            .map(([type, count]) => ({ type, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
    }

    /**
     * Set Gemini API status
     */
    setGeminiStatus(status) {
        this.stats.geminiApiStatus = status;
    }

    /**
     * Register blocked IP
     */
    registerBlockedIP(ipAddress) {
        if (!this.stats.blockedIPs.includes(ipAddress)) {
            this.stats.blockedIPs.push(ipAddress);
            this.stats.fraudDetectionStatus.totalBlocks++;
        }
    }

    /**
     * Clear old events (cleanup)
     */
    clearOldEvents(olderThanHours = 72) {
        const cutoffTime = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
        this.eventLog = this.eventLog.filter(e => new Date(e.timestamp) > cutoffTime);
        this.stats.securityEvents = this.stats.securityEvents.filter(e => new Date(e.timestamp) > cutoffTime);
    }
}

// Export singleton instance
module.exports = new AIMonitoringDashboard();
