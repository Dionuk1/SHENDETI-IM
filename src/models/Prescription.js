const mongoose = require('mongoose');

const encryptedTextSchema = new mongoose.Schema(
    {
        iv: { type: String, required: true },
        tag: { type: String, required: true },
        ciphertext: { type: String, required: true },
    },
    { _id: false }
);

const prescriptionSchema = new mongoose.Schema(
    {
        patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        title: { type: String, required: true, trim: true, maxlength: 200 },
        bodyEncrypted: { type: encryptedTextSchema, required: true },
        appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null, index: true },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Prescription', prescriptionSchema);
