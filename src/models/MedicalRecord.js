const mongoose = require('mongoose');

const encryptedTextSchema = new mongoose.Schema(
    {
        iv: { type: String, required: true },
        tag: { type: String, required: true },
        ciphertext: { type: String, required: true },
    },
    { _id: false }
);

const medicalRecordSchema = new mongoose.Schema(
    {
        patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        originalName: { type: String, required: true, maxlength: 255 },
        mimeType: { type: String, required: true, maxlength: 120 },
        size: { type: Number, required: true },
        filePath: { type: String, required: true },
        notesEncrypted: { type: encryptedTextSchema, default: null },
    },
    { timestamps: true }
);

module.exports = mongoose.model('MedicalRecord', medicalRecordSchema);
