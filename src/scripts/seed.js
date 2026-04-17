require('dotenv').config();

const bcrypt = require('bcryptjs');

const { connectDb } = require('../config/db');
const User = require('../models/User');
const Doctor = require('../models/Doctor');

async function upsertUser({ name, email, password, role }) {
    const passwordHash = await bcrypt.hash(String(password), 12);

    const user = await User.findOneAndUpdate(
        { email: String(email).toLowerCase().trim() },
        {
            $set: {
                name: String(name).trim(),
                email: String(email).toLowerCase().trim(),
                passwordHash,
                role,
            },
        },
        { new: true, upsert: true }
    );

    return user;
}

async function upsertDoctor({
    name,
    email,
    password,
    specialization,
    department,
    experience,
    services,
    bio,
}) {
    const passwordHash = await bcrypt.hash(String(password), 12);

    const doctor = await Doctor.findOneAndUpdate(
        { email: String(email).toLowerCase().trim() },
        {
            $set: {
                name: String(name).trim(),
                email: String(email).toLowerCase().trim(),
                passwordHash,
                specialization,
                department,
                experience: Number(experience),
                services: Array.isArray(services) ? services : [],
                bio,
                isActive: true,
            },
        },
        { new: true, upsert: true }
    );

    return doctor;
}

(async () => {
    await connectDb();

    const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@healthflow.test';
    const adminPass = process.env.SEED_ADMIN_PASSWORD || 'password123';

    const doctorEmail = process.env.SEED_DOCTOR_EMAIL || 'doctor@healthflow.test';
    const doctorPass = process.env.SEED_DOCTOR_PASSWORD || 'password123';

    const patientEmail = process.env.SEED_PATIENT_EMAIL || 'patient@healthflow.test';
    const patientPass = process.env.SEED_PATIENT_PASSWORD || 'password123';

    // Create base users
    const admin = await upsertUser({ name: 'Admin', email: adminEmail, password: adminPass, role: 'admin' });

    const patients = await Promise.all([
        upsertUser({ name: 'Dion Ukshini', email: patientEmail, password: patientPass, role: 'patient' }),
        upsertUser({ name: 'Arta Krasniqi', email: 'arta@healthflow.test', password: 'password123', role: 'patient' }),
        upsertUser({ name: 'Besnik Dervishi', email: 'besnik@healthflow.test', password: 'password123', role: 'patient' }),
        upsertUser({ name: 'Sara Gashi', email: 'sara@healthflow.test', password: 'password123', role: 'patient' }),
    ]);

    // Create doctors with specializations
    const doctors = await Promise.all([
        upsertDoctor({
            name: 'Dr. Agon Berisha',
            email: 'agon@healthflow.test',
            password: 'password123',
            specialization: 'cardiology',
            department: 'Cardiology Department',
            experience: 15,
            services: [
                { name: 'ECG', durationMinutes: 20 },
                { name: 'Cardiac Consultation', durationMinutes: 45 },
                { name: 'Tele-visit', durationMinutes: 30 },
            ],
            bio: 'Experienced cardiologist with 15 years of practice. Specializing in cardiac care and prevention.',
        }),
        upsertDoctor({
            name: 'Dr. Elena Hoxha',
            email: 'elena@healthflow.test',
            password: 'password123',
            specialization: 'neurology',
            department: 'Neurology Department',
            experience: 12,
            services: [
                { name: 'Neurological Exam', durationMinutes: 40 },
                { name: 'Headache Assessment', durationMinutes: 30 },
                { name: 'Tele-visit', durationMinutes: 30 },
            ],
            bio: 'Neurologist specializing in headaches, dizziness, and neurological conditions.',
        }),
        upsertDoctor({
            name: 'Dr. Arben Krasniqi',
            email: 'arben@healthflow.test',
            password: 'password123',
            specialization: 'orthopedics',
            department: 'Orthopedics Department',
            experience: 18,
            services: [
                { name: 'Orthopedic Consultation', durationMinutes: 50 },
                { name: 'Injury Assessment', durationMinutes: 45 },
                { name: 'X-ray Review', durationMinutes: 20 },
            ],
            bio: 'Senior orthopedic surgeon with expertise in sports injuries and joint disorders.',
        }),
        upsertDoctor({
            name: 'Dr. Nura Rama',
            email: 'nura@healthflow.test',
            password: 'password123',
            specialization: 'general',
            department: 'General Medicine',
            experience: 10,
            services: [
                { name: 'General Consultation', durationMinutes: 30 },
                { name: 'Health Check-up', durationMinutes: 45 },
                { name: 'Tele-visit', durationMinutes: 25 },
            ],
            bio: 'Dedicated general practitioner focused on preventive medicine and holistic care.',
        }),
        upsertDoctor({
            name: 'Dr. Mirela Duka',
            email: 'mirela@healthflow.test',
            password: 'password123',
            specialization: 'psychiatry',
            department: 'Mental Health Department',
            experience: 14,
            services: [
                { name: 'Psychiatric Consultation', durationMinutes: 60 },
                { name: 'Mental Health Assessment', durationMinutes: 50 },
                { name: 'Tele-visit', durationMinutes: 40 },
            ],
            bio: 'Compassionate psychiatrist specializing in anxiety, depression, and therapy.',
        }),

        // Extra doctors
        upsertDoctor({
            name: 'Dr. Luan Gashi',
            email: 'luan@healthflow.test',
            password: 'password123',
            specialization: 'cardiology',
            department: 'Cardiology Department',
            experience: 9,
            services: [
                { name: 'Blood Pressure Review', durationMinutes: 20 },
                { name: 'Cardiac Consultation', durationMinutes: 40 },
                { name: 'Tele-visit', durationMinutes: 25 },
            ],
            bio: 'Cardiology specialist focused on hypertension and preventive care.',
        }),
        upsertDoctor({
            name: 'Dr. Bora Kelmendi',
            email: 'bora@healthflow.test',
            password: 'password123',
            specialization: 'neurology',
            department: 'Neurology Department',
            experience: 8,
            services: [
                { name: 'Neurological Exam', durationMinutes: 35 },
                { name: 'Migraine Consultation', durationMinutes: 30 },
                { name: 'Tele-visit', durationMinutes: 25 },
            ],
            bio: 'Neurologist focusing on migraines and sleep-related neurological issues.',
        }),
        upsertDoctor({
            name: 'Dr. Ilir Hyseni',
            email: 'ilir@healthflow.test',
            password: 'password123',
            specialization: 'orthopedics',
            department: 'Orthopedics Department',
            experience: 11,
            services: [
                { name: 'Injury Assessment', durationMinutes: 40 },
                { name: 'Joint Pain Consultation', durationMinutes: 35 },
                { name: 'X-ray Review', durationMinutes: 20 },
            ],
            bio: 'Orthopedist specializing in joint pain and rehabilitation plans.',
        }),
        upsertDoctor({
            name: 'Dr. Vesa Shala',
            email: 'vesa@healthflow.test',
            password: 'password123',
            specialization: 'general',
            department: 'General Medicine',
            experience: 7,
            services: [
                { name: 'General Consultation', durationMinutes: 25 },
                { name: 'Health Check-up', durationMinutes: 40 },
                { name: 'Tele-visit', durationMinutes: 20 },
            ],
            bio: 'General practitioner with focus on primary care and follow-ups.',
        }),
        upsertDoctor({
            name: 'Dr. Erion Aliu',
            email: 'erion@healthflow.test',
            password: 'password123',
            specialization: 'psychiatry',
            department: 'Mental Health Department',
            experience: 6,
            services: [
                { name: 'Mental Health Assessment', durationMinutes: 45 },
                { name: 'Therapy Session', durationMinutes: 50 },
                { name: 'Tele-visit', durationMinutes: 35 },
            ],
            bio: 'Psychiatry specialist focusing on stress management and therapy sessions.',
        }),
    ]);

    // Ensure doctors can log in (auth uses the User collection)
    await Promise.all(
        doctors.map((doc) =>
            upsertUser({
                name: doc.name,
                email: doc.email,
                password: 'password123',
                role: 'doctor',
            })
        )
    );

    console.log('✅ Seed complete');
    console.log('\n📋 Created Accounts:');
    console.log('─'.repeat(60));
    console.log(`👤 Admin: ${admin.email} / ${adminPass}`);
    console.log('\n👥 Patients:');
    patients.forEach((p) => {
        console.log(`   • ${p.email} / password123`);
    });
    console.log('\n👨‍⚕️ Doctors:');
    doctors.forEach((doc) => {
        console.log(
            `   • ${doc.name} (${doc.specialization}) - ${doc.email} / password123`
        );
    });
    console.log('─'.repeat(60));
    console.log('\nℹ️  Start the server with: npm start');
    console.log('   Visit: http://localhost:5500');

    process.exit(0);
})().catch((e) => {
    console.error('❌ Seed failed:', e.message);
    process.exit(1);
});
