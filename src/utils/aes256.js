const crypto = require('crypto');

function getAesKey() {
    const raw = process.env.MEDICAL_AES_KEY;

    if (!raw) {
        const err = new Error('Missing MEDICAL_AES_KEY (required for AES-256).');
        err.statusCode = 500;
        throw err;
    }

    // Accept 64 hex chars or base64.
    let key;
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
        key = Buffer.from(raw, 'hex');
    } else {
        try {
            key = Buffer.from(raw, 'base64');
        } catch {
            key = null;
        }
    }

    if (!key || key.length !== 32) {
        const err = new Error('MEDICAL_AES_KEY must be 32 bytes (base64) or 64 hex characters.');
        err.statusCode = 500;
        throw err;
    }

    return key;
}

function encryptText(plainText) {
    const key = getAesKey();
    const iv = crypto.randomBytes(12); // GCM recommended 12 bytes

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        ciphertext: ciphertext.toString('base64'),
    };
}

function decryptText(payload) {
    if (!payload || !payload.iv || !payload.tag || !payload.ciphertext) {
        return null;
    }

    const key = getAesKey();

    const iv = Buffer.from(payload.iv, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');
    const ciphertext = Buffer.from(payload.ciphertext, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plain.toString('utf8');
}

module.exports = {
    encryptText,
    decryptText,
};
