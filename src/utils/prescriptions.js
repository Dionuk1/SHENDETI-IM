const { encryptText, decryptText } = require('./aes256');

function cleanText(value, maxLength) {
    return String(value || '').trim().slice(0, maxLength);
}

function prescriptionContentFromInput(input = {}) {
    const structured = ['diagnosis', 'medicationName', 'dosage', 'frequency', 'duration', 'instructions', 'additionalNotes']
        .some((field) => String(input[field] || '').trim());

    if (!structured) {
        return {
            diagnosis: cleanText(input.title, 500),
            medicationName: '',
            dosage: '',
            frequency: '',
            duration: '',
            instructions: '',
            additionalNotes: cleanText(input.body, 5000),
            legacy: true,
        };
    }

    return {
        diagnosis: cleanText(input.diagnosis, 500),
        medicationName: cleanText(input.medicationName, 300),
        dosage: cleanText(input.dosage, 200),
        frequency: cleanText(input.frequency, 200),
        duration: cleanText(input.duration, 200),
        instructions: cleanText(input.instructions, 2000),
        additionalNotes: cleanText(input.additionalNotes, 2000),
        legacy: false,
    };
}

function encryptPrescriptionContent(content) {
    return encryptText(JSON.stringify(content));
}

function decryptPrescriptionContent(payload) {
    const plain = decryptText(payload);
    if (!plain) return null;
    try {
        const parsed = JSON.parse(plain);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const content = prescriptionContentFromInput(parsed);
            content.legacy = parsed.legacy === true;
            return content;
        }
    } catch {
        // Existing prescriptions may contain a plain-text encrypted body.
    }
    return prescriptionContentFromInput({ body: plain });
}

function prescriptionReference(prescription) {
    const issuedAt = new Date(prescription.createdAt || Date.now());
    const year = Number.isNaN(issuedAt.getTime()) ? new Date().getFullYear() : issuedAt.getFullYear();
    const suffix = String(prescription._id || '').slice(-8).toUpperCase();
    return `RX-${year}-${suffix}`;
}

module.exports = {
    prescriptionContentFromInput,
    encryptPrescriptionContent,
    decryptPrescriptionContent,
    prescriptionReference,
};
