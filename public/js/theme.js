(function initializeShendetiTheme(window, document) {
    'use strict';

    const STORAGE_KEY = 'shendeti-theme';
    const ALLOWED_THEMES = new Set(['light', 'dark']);

    function storedTheme() {
        try {
            const value = window.localStorage.getItem(STORAGE_KEY);
            if (ALLOWED_THEMES.has(value)) return value;
            window.localStorage.setItem(STORAGE_KEY, 'light');
        } catch {}
        return 'light';
    }

    function syncControls(theme) {
        document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
            const nextTheme = theme === 'dark' ? 'light' : 'dark';
            button.dataset.currentTheme = theme;
            button.setAttribute('aria-label', nextTheme === 'dark' ? 'Aktivizo modalitetin e erret' : 'Aktivizo modalitetin e ndritshem');
            button.setAttribute('title', nextTheme === 'dark' ? 'Modaliteti i erret' : 'Modaliteti i ndritshem');
            button.setAttribute('aria-pressed', String(theme === 'dark'));
        });
    }

    function applyTheme(theme) {
        const safeTheme = ALLOWED_THEMES.has(theme) ? theme : 'light';
        document.documentElement.dataset.theme = safeTheme;
        document.documentElement.style.colorScheme = safeTheme;
        syncControls(safeTheme);
        return safeTheme;
    }

    function selectTheme(theme) {
        const safeTheme = ALLOWED_THEMES.has(theme) ? theme : 'light';
        try { window.localStorage.setItem(STORAGE_KEY, safeTheme); } catch {}
        return applyTheme(safeTheme);
    }

    function toggleTheme() { return selectTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); }

    applyTheme(storedTheme());
    window.ShendetiTheme = Object.freeze({ storageKey: STORAGE_KEY, get: () => document.documentElement.dataset.theme, set: selectTheme, toggle: toggleTheme });
    document.addEventListener('DOMContentLoaded', () => syncControls(document.documentElement.dataset.theme));
    window.addEventListener('storage', (event) => { if (event.key === STORAGE_KEY) selectTheme(event.newValue); });
})(window, document);
