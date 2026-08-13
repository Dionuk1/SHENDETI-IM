(function configureShendetiImApi(windowObject) {
    'use strict';

    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    const isLocal = localHosts.has(windowObject.location.hostname);
    const configuredBase = String(windowObject.SHENDETI_IM_CONFIG?.API_BASE_URL || '').trim();
    const apiBaseUrl = (configuredBase || (isLocal
        ? 'http://localhost:5500'
        : 'https://api.shendeti-im.me')).replace(/\/+$/, '');

    windowObject.SHENDETI_IM_CONFIG = Object.freeze({
        APPWRITE_ENDPOINT: 'https://fra.cloud.appwrite.io/v1',
        APPWRITE_PROJECT_ID: '6a66216909c3398b7265',
        APPWRITE_DATABASE_ID: 'shendeti',
        APPWRITE_PROFILES_TABLE_ID: 'profiles',
        APPWRITE_DOCTOR_PROFILES_TABLE_ID: 'doctor_profiles',
        APPWRITE_REGISTRATION_FUNCTION_ID: 'clinical-api',
        APPWRITE_AI_TRIAGE_FUNCTION_ID: 'ai-triage',
        APPWRITE_ADMIN_FUNCTION_ID: 'admin-api',
        API_BASE_URL: apiBaseUrl,
        environment: 'appwrite-development',
        LEGACY_CLINICAL_API_ENABLED: false,
    });

    const nativeFetch = windowObject.fetch.bind(windowObject);

    function apiUrl(input) {
        if (typeof input !== 'string') return input;
        if (input.startsWith('/api/')) return `${apiBaseUrl}${input}`;

        try {
            const parsed = new URL(input, windowObject.location.origin);
            const isLegacyLocalApi = localHosts.has(parsed.hostname)
                && parsed.port === '5500'
                && parsed.pathname.startsWith('/api/');

            if (isLegacyLocalApi) {
                return `${apiBaseUrl}${parsed.pathname}${parsed.search}${parsed.hash}`;
            }
        } catch {
            return input;
        }

        return input;
    }

    windowObject.shendetiImApiUrl = apiUrl;
    windowObject.fetch = (input, init) => {
        const resolved = apiUrl(input);
        const url = typeof resolved === 'string' ? resolved : String(resolved?.url || '');
        if (url.includes('/api/') && windowObject.ShendetiClinical?.routeLegacy) {
            return Promise.resolve(windowObject.ShendetiClinical.routeLegacy(url, init)).then((response) => response || (
                windowObject.SHENDETI_IM_CONFIG.LEGACY_CLINICAL_API_ENABLED === true
                    ? nativeFetch(resolved, init)
                    : new Response(JSON.stringify({ error: 'Kjo veçori aktivizohet në një fazë të ardhshme.' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
            ));
        }
        if (url.includes('/api/') && windowObject.SHENDETI_IM_CONFIG.LEGACY_CLINICAL_API_ENABLED !== true && typeof Response !== 'undefined') {
            return Promise.resolve(new Response(JSON.stringify({
                error: 'Kjo veçori aktivizohet në një fazë të ardhshme.'
            }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
        }
        return nativeFetch(resolved, init);
    };
})(window);
