const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 120 },
        email: { type: String, required: true, trim: true, lowercase: true, unique: true, maxlength: 255 },
        passwordHash: { type: String, default: null, select: false },
        role: { type: String, enum: ['patient', 'doctor', 'admin'], default: 'patient', index: true },
        authProvider: { type: String, enum: ['local', 'google'], default: 'local' },
        googleId: { type: String, default: undefined, unique: true, sparse: true, select: false },
        profileImage: { type: String, default: null, maxlength: 2048 },
        isActive: { type: Boolean, default: true, index: true },
    },
    { timestamps: true }
);

userSchema.methods.toSafeJson = function toSafeJson() {
    return {
        id: this._id.toString(),
        name: this.name,
        email: this.email,
        role: this.role,
        authProvider: this.authProvider,
        profileImage: this.profileImage,
        isActive: this.isActive,
        createdAt: this.createdAt,
    };
};

module.exports = mongoose.model('User', userSchema);
