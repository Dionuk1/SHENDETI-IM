const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 120 },
        email: { type: String, required: true, trim: true, lowercase: true, unique: true, maxlength: 255 },
        passwordHash: { type: String, required: true },
        role: { type: String, enum: ['patient', 'doctor', 'admin'], default: 'patient', index: true },
    },
    { timestamps: true }
);

userSchema.methods.toSafeJson = function toSafeJson() {
    return {
        id: this._id.toString(),
        name: this.name,
        email: this.email,
        role: this.role,
        createdAt: this.createdAt,
    };
};

module.exports = mongoose.model('User', userSchema);
