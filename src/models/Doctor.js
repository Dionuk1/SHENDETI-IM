const mongoose = require('mongoose');

const doctorSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 120 },
        email: { type: String, required: true, trim: true, lowercase: true, unique: true, maxlength: 255 },
        passwordHash: { type: String, required: true },
        specialization: {
            type: String,
            enum: [
                'cardiology',
                'neurology',
                'orthopedics',
                'general',
                'pediatrics',
                'psychiatry',
                'dermatology',
                'emergency',
            ],
            required: true,
            index: true,
        },
        department: { type: String, required: true, trim: true, maxlength: 120 },
        experience: { type: Number, default: 0 },
        services: [
            {
                name: { type: String, required: true },
                durationMinutes: { type: Number, default: 30 },
                available: { type: Boolean, default: true },
            },
        ],
        licenseNumber: { type: String, unique: true, sparse: true },
        isActive: { type: Boolean, default: true, index: true },
        // RREGULLIMI KËTU:
        availability: {
            mondayFriday: {
                start: { type: String, default: '08:00' },
                end: { type: String, default: '16:00' }
            },
            saturday: {
                start: { type: String, default: '09:00' },
                end: { type: String, default: '12:00' }
            },
            sundayOff: { type: Boolean, default: true },
        },
        maxPatientsPerDay: { type: Number, default: 20 },
        avgRating: { type: Number, default: 4.5, min: 0, max: 5 },
        totalPatients: { type: Number, default: 0 },
        bio: { type: String, maxlength: 500 },
    },
    { timestamps: true }
);

doctorSchema.methods.toPublicJson = function toPublicJson() {
    return {
        id: this._id.toString(),
        name: this.name,
        specialization: this.specialization,
        department: this.department,
        experience: this.experience,
        services: this.services,
        avgRating: this.avgRating,
        bio: this.bio,
        isActive: this.isActive,
    };
};

doctorSchema.methods.toSafeJson = function toSafeJson() {
    return {
        id: this._id.toString(),
        name: this.name,
        email: this.email,
        specialization: this.specialization,
        department: this.department,
        experience: this.experience,
        services: this.services,
        licenseNumber: this.licenseNumber,
        isActive: this.isActive,
        availability: this.availability,
        maxPatientsPerDay: this.maxPatientsPerDay,
        avgRating: this.avgRating,
        totalPatients: this.totalPatients,
        createdAt: this.createdAt,
    };
};

module.exports = mongoose.model('Doctor', doctorSchema);