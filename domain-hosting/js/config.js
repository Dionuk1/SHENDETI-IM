(function configureShendetiImApi(windowObject) {
    'use strict';

    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    const isLocal = localHosts.has(windowObject.location.hostname);
    const configuredBase = String(windowObject.SHENDETI_IM_CONFIG?.API_BASE_URL || '').trim();
    const apiBaseUrl = (configuredBase || (isLocal
        ? 'http://localhost:5500'
        : 'https://api.shendeti-im.me')).replace(/\/+$/, '');

    windowObject.SHENDETI_IM_CONFIG = Object.freeze({
        API_BASE_URL: apiBaseUrl,
        environment: isLocal ? 'development' : 'production',
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
    windowObject.fetch = (input, init) => nativeFetch(apiUrl(input), init);
})(window);
