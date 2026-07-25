const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LOCAL_UPLOADS_ROOT = path.resolve(path.join(process.cwd(), 'uploads', 'medical-records'));

function storageDriver() {
    const configured = String(process.env.MEDICAL_STORAGE_DRIVER || '').trim().toLowerCase();
    if (configured) return configured;
    return process.env.NODE_ENV === 'production' ? 'appwrite' : 'local';
}

function appwriteConfig() {
    const endpoint = String(process.env.APPWRITE_ENDPOINT || '').trim().replace(/\/+$/, '');
    const projectId = String(process.env.APPWRITE_PROJECT_ID || '').trim();
    const apiKey = String(process.env.APPWRITE_API_KEY || '').trim();
    const bucketId = String(process.env.APPWRITE_MEDICAL_BUCKET_ID || '').trim();

    if (!endpoint || !projectId || !apiKey || !bucketId) {
        const error = new Error('Medical storage is not configured');
        error.statusCode = 503;
        throw error;
    }

    return { endpoint, projectId, apiKey, bucketId };
}

function appwriteHeaders(config) {
    return {
        'X-Appwrite-Project': config.projectId,
        'X-Appwrite-Key': config.apiKey,
    };
}

function assertLocalPath(filePath) {
    const absolute = path.resolve(filePath);
    if (!absolute.startsWith(`${LOCAL_UPLOADS_ROOT}${path.sep}`)) {
        const error = new Error('Invalid stored file path');
        error.statusCode = 400;
        throw error;
    }
    return absolute;
}

async function storeLocalPdf(buffer) {
    await fs.promises.mkdir(LOCAL_UPLOADS_ROOT, { recursive: true });
    const filename = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}.pdf`;
    const absolute = path.join(LOCAL_UPLOADS_ROOT, filename);
    await fs.promises.writeFile(absolute, buffer, { flag: 'wx' });
    return absolute;
}

async function storeAppwritePdf(buffer, originalName) {
    const config = appwriteConfig();
    const fileId = crypto.randomUUID().replace(/-/g, '');
    const form = new FormData();
    form.append('fileId', fileId);
    form.append('file', new Blob([buffer], { type: 'application/pdf' }), originalName);

    const response = await fetch(
        `${config.endpoint}/storage/buckets/${encodeURIComponent(config.bucketId)}/files`,
        { method: 'POST', headers: appwriteHeaders(config), body: form }
    );

    if (!response.ok) {
        const error = new Error('Medical file storage failed');
        error.statusCode = 502;
        throw error;
    }

    return `appwrite://${config.bucketId}/${fileId}`;
}

async function storeMedicalPdf({ buffer, originalName }) {
    const driver = storageDriver();
    if (driver === 'local') return storeLocalPdf(buffer);
    if (driver === 'appwrite') return storeAppwritePdf(buffer, originalName);
    throw new Error('Unsupported MEDICAL_STORAGE_DRIVER');
}

function parseAppwriteReference(reference) {
    const parsed = new URL(reference);
    if (parsed.protocol !== 'appwrite:' || !parsed.hostname || !parsed.pathname.slice(1)) {
        throw new Error('Invalid Appwrite storage reference');
    }
    return { bucketId: parsed.hostname, fileId: parsed.pathname.slice(1) };
}

async function readMedicalPdf(reference) {
    if (!String(reference).startsWith('appwrite://')) {
        return fs.promises.readFile(assertLocalPath(reference));
    }

    const config = appwriteConfig();
    const { bucketId, fileId } = parseAppwriteReference(reference);
    if (bucketId !== config.bucketId) throw new Error('Invalid Appwrite storage bucket');

    const response = await fetch(
        `${config.endpoint}/storage/buckets/${encodeURIComponent(bucketId)}/files/${encodeURIComponent(fileId)}/download`,
        { headers: appwriteHeaders(config) }
    );
    if (!response.ok) {
        const error = new Error(response.status === 404 ? 'Medical file not found' : 'Medical file download failed');
        error.statusCode = response.status === 404 ? 404 : 502;
        throw error;
    }
    return Buffer.from(await response.arrayBuffer());
}

async function deleteMedicalPdf(reference) {
    if (!reference) return;
    if (!String(reference).startsWith('appwrite://')) {
        await fs.promises.unlink(assertLocalPath(reference)).catch(() => {});
        return;
    }

    const config = appwriteConfig();
    const { bucketId, fileId } = parseAppwriteReference(reference);
    if (bucketId !== config.bucketId) throw new Error('Invalid Appwrite storage bucket');
    await fetch(
        `${config.endpoint}/storage/buckets/${encodeURIComponent(bucketId)}/files/${encodeURIComponent(fileId)}`,
        { method: 'DELETE', headers: appwriteHeaders(config) }
    );
}

module.exports = {
    deleteMedicalPdf,
    readMedicalPdf,
    storeMedicalPdf,
    storageDriver,
};
