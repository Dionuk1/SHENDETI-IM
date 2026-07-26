const express = require('express');
const User = require('../models/User');
const Doctor = require('../models/Doctor');

const router = express.Router();

// Public data used by the landing UI
router.get('/public/doctors', async (req, res, next) => {
    try {
        const docs = await User.find({ role: 'doctor' })
            .select('_id name')
            .sort({ name: 1 })
            .limit(100);

        res.json({
            doctors: docs.map((d) => ({ id: d._id.toString(), name: d.name })),
        });
    } catch (e) {
        next(e);
    }
});

/**
 * Get All Doctors (public list with specializations)
 * GET /public/doctors/list?specialization=cardiology
 */
router.get('/doctors/list', async (req, res, next) => {
    try {
        const { specialization } = req.query;
        const query = { isActive: true };

        if (specialization) {
            query.specialization = String(specialization);
        }

        const doctors = await Doctor.find(query)
            .select('-passwordHash -licenseNumber')
            .sort({ avgRating: -1, experience: -1 })
            .limit(50);

        res.json({
            doctors: doctors.map((d) => d.toPublicJson()),
        });
    } catch (e) {
        next(e);
    }
});

module.exports = router;
