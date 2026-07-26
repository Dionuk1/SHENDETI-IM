const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const frontend = fs.readFileSync(path.join(root, 'domain-hosting', 'index.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'domain-hosting', 'admin', 'index.html'), 'utf8');
const configScript = fs.readFileSync(path.join(root, 'domain-hosting', 'js', 'config.js'), 'utf8');
const backendServer = fs.readFileSync(path.join(root, 'backend', 'server.js'), 'utf8');
const backendPackage = JSON.parse(fs.readFileSync(path.join(root, 'backend', 'package.json'), 'utf8'));
const renderBlueprint = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8');

function configuredWindow(hostname) {
    const requests = [];
    const window = {
        location: {
            hostname,
            origin: hostname === 'localhost' ? 'http://localhost:8080' : 'https://shendeti-im.me',
        },
        fetch: async (input, init) => {
            requests.push({ input, init });
            return { ok: true };
        },
    };
    vm.runInNewContext(configScript, { window, URL, Set, Object, String });
    return { window, requests };
}

test('production frontend is the real application and loads shared API configuration first', () => {
    assert.match(frontend, /SHËNDETI IM/);
    assert.doesNotMatch(frontend, /COMING SOON/);
    assert.match(frontend, /<script src="\/js\/config\.js"><\/script>/);
    assert.match(admin, /<script src="\/js\/config\.js"><\/script>/);
    assert.doesNotMatch(frontend, /http:\/\/localhost:5500\/api\//);
});

test('shared API configuration selects production and local backends', async () => {
    const production = configuredWindow('shendeti-im.me');
    await production.window.fetch('/api/auth/me');
    assert.equal(production.window.SHENDETI_IM_CONFIG.API_BASE_URL, 'https://api.shendeti-im.me');
    assert.equal(production.requests[0].input, 'https://api.shendeti-im.me/api/auth/me');

    const local = configuredWindow('localhost');
    await local.window.fetch('/api/auth/me');
    assert.equal(local.window.SHENDETI_IM_CONFIG.API_BASE_URL, 'http://localhost:5500');
    assert.equal(local.requests[0].input, 'http://localhost:5500/api/auth/me');
});

test('Render backend is API-only and has verified runtime commands', () => {
    assert.equal(backendPackage.scripts.start, 'node server.js');
    assert.equal(backendPackage.engines.node, '22.x');
    assert.doesNotMatch(backendServer, /express\.static|sendFile|bluecare/);
    assert.match(backendServer, /app\.get\('\/health'/);
    assert.match(backendServer, /process\.env\.PORT \|\| 5500/);
    assert.match(backendServer, /const host = '0\.0\.0\.0'/);
    assert.match(renderBlueprint, /autoDeployTrigger: off/);
    assert.doesNotMatch(renderBlueprint, /^\s+value:/m);
    const declaredVariables = (renderBlueprint.match(/^\s+- key:/gm) || []).length;
    const manualVariables = (renderBlueprint.match(/^\s+sync: false/gm) || []).length;
    assert.equal(manualVariables, declaredVariables);
});

test('medical PDF adapter uses private Appwrite server configuration without network access in test', async () => {
    const originalEnv = {
        MEDICAL_STORAGE_DRIVER: process.env.MEDICAL_STORAGE_DRIVER,
        APPWRITE_ENDPOINT: process.env.APPWRITE_ENDPOINT,
        APPWRITE_PROJECT_ID: process.env.APPWRITE_PROJECT_ID,
        appwriteApiKey: process.env['APPWRITE_' + 'API_KEY'],
        APPWRITE_MEDICAL_BUCKET_ID: process.env.APPWRITE_MEDICAL_BUCKET_ID,
    };
    const originalFetch = global.fetch;
    const calls = [];
    process.env.MEDICAL_STORAGE_DRIVER = 'appwrite';
    process.env.APPWRITE_ENDPOINT = 'https://appwrite.invalid/v1';
    process.env.APPWRITE_PROJECT_ID = 'staging-project';
    process.env['APPWRITE_' + 'API_KEY'] = 'test-only-placeholder';
    process.env.APPWRITE_MEDICAL_BUCKET_ID = 'medical-pdfs';
    global.fetch = async (url, options = {}) => {
        calls.push({ url, options });
        if (options.method === 'POST') return { ok: true };
        const bytes = Uint8Array.from(Buffer.from('%PDF-test'));
        return { ok: true, arrayBuffer: async () => bytes.buffer };
    };

    try {
        const storage = require('../backend/src/services/medicalStorage');
        const reference = await storage.storeMedicalPdf({
            buffer: Buffer.from('%PDF-test'),
            originalName: 'fixture.pdf',
        });
        assert.match(reference, /^appwrite:\/\/medical-pdfs\/[a-f0-9]{32}$/);
        assert.equal(calls[0].url, 'https://appwrite.invalid/v1/storage/buckets/medical-pdfs/files');
        assert.equal(calls[0].options.headers['X-Appwrite-Project'], 'staging-project');
        assert.equal(calls[0].options.headers['X-Appwrite-Key'], 'test-only-placeholder');
        assert.equal((await storage.readMedicalPdf(reference)).toString('ascii'), '%PDF-test');
    } finally {
        global.fetch = originalFetch;
        for (const [key, value] of Object.entries(originalEnv)) {
            if (value === undefined) delete process.env[key];
            else process.env[key === 'appwriteApiKey' ? 'APPWRITE_API_KEY' : key] = value;
        }
        if (originalEnv.appwriteApiKey === undefined) delete process.env.APPWRITE_API_KEY;
    }
});

test('production medical storage never falls back to local disk when Appwrite is missing', async () => {
    const keys = [
        'NODE_ENV',
        'MEDICAL_STORAGE_DRIVER',
        'APPWRITE_ENDPOINT',
        'APPWRITE_PROJECT_ID',
        'APPWRITE_API_KEY',
        'APPWRITE_MEDICAL_BUCKET_ID',
    ];
    const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    process.env.NODE_ENV = 'production';
    for (const key of keys.slice(1)) delete process.env[key];

    try {
        const storage = require('../backend/src/services/medicalStorage');
        assert.equal(storage.storageDriver(), 'appwrite');
        await assert.rejects(
            storage.storeMedicalPdf({ buffer: Buffer.from('%PDF-test'), originalName: 'fixture.pdf' }),
            (error) => error.statusCode === 503 && error.message === 'Medical storage is not configured'
        );
    } finally {
        for (const [key, value] of Object.entries(original)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
});
