/**
 * INTEGRATION GUIDE FOR AI FEATURES IN BLUECARE
 * ==================================================
 * 
 * This file shows how to integrate all AI modules into your existing server.js
 * Copy the relevant lines into your server.js - NO CHANGES to existing code needed
 */

// ==================== STEP 1: IMPORTS ====================
// Add these imports at the top of your server.js (after existing imports)

const aiRoutes = require('./routes/ai');
const { fraudDetectionMiddleware } = require('./middleware/fraudDetection');
const ragChatbot = require('./services/ragChatbot');

// ==================== STEP 2: FRAUD DETECTION MIDDLEWARE ====================
// Add this AFTER app = express() and BEFORE other middleware
// This should be early in the middleware chain

app.use(fraudDetectionMiddleware); // Detects anomalies on ALL routes

// ==================== STEP 3: REGISTER AI ROUTES ====================
// Add this with your other route registrations (around where you do app.use('/api/auth', ...))

app.use('/api/ai', aiRoutes); // All AI endpoints under /api/ai

// ==================== STEP 4: OPTIONAL - SECURITY STATUS ENDPOINT ====================
// Add this route if you want admins to see security monitoring

const { getSecurityStatus, unblockIP } = require('./middleware/fraudDetection');

app.get('/api/admin/security-status', requireAuth, isAdmin, (req, res) => {
    res.json(getSecurityStatus());
});

app.post('/api/admin/unblock-ip/:ip', requireAuth, isAdmin, (req, res) => {
    const success = unblockIP(req.params.ip);
    res.json({ success, message: success ? 'IP unblocked' : 'IP not found in block list' });
});

// ==================== EXAMPLE server.js INTEGRATION ====================
/**

const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// ✅ ADD AI FRAUD DETECTION - VERY EARLY
const { fraudDetectionMiddleware } = require('./middleware/fraudDetection');
app.use(fraudDetectionMiddleware);

// Database
mongoose.connect(process.env.MONGO_URI);

// Routes
const authRoutes = require('./routes/auth');
const patientRoutes = require('./routes/patient');
const doctorRoutes = require('./routes/doctor');
const adminRoutes = require('./routes/admin');

// ✅ ADD AI ROUTES
const aiRoutes = require('./routes/ai');

app.use('/api/auth', authRoutes);
app.use('/api/patient', patientRoutes);
app.use('/api/doctor', doctorRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/ai', aiRoutes); // ✅ ADD THIS LINE

const PORT = process.env.PORT || 5500;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

*/

// ==================== USAGE EXAMPLES ====================

/**
 * 1. AI SYMPTOM ANALYSIS
 * ======================
 * 
 * Frontend (index.html):
 * ----------------------
 * const response = await fetch('/api/ai/analyze-symptoms', {
 *     method: 'POST',
 *     headers: {
 *         'Content-Type': 'application/json',
 *         'Authorization': `Bearer ${token}`
 *     },
 *     body: JSON.stringify({
 *         symptoms: 'Chest pain and shortness of breath',
 *         age: 45,
 *         medicalHistory: 'Hypertension'
 *     })
 * });
 * const data = await response.json();
 * console.log('Recommended departments:', data.analysis.recommendedDepartments);
 */

/**
 * 2. AI DOCUMENT ANALYSIS
 * =======================
 * 
 * Frontend:
 * --------
 * const response = await fetch('/api/ai/analyze-document', {
 *     method: 'POST',
 *     headers: {
 *         'Content-Type': 'application/json',
 *         'Authorization': `Bearer ${token}`
 *     },
 *     body: JSON.stringify({
 *         documentText: 'ECG Report: HR 78, BP 120/80, Normal findings',
 *         documentType: 'ECG'
 *     })
 * });
 */

/**
 * 3. SMART QUEUE PREDICTION
 * =========================
 * 
 * Frontend:
 * --------
 * const response = await fetch('/api/ai/queue-prediction/doctorId123/2026-04-16', {
 *     method: 'GET',
 *     headers: { 'Authorization': `Bearer ${token}` }
 * });
 * const prediction = await response.json();
 * console.log('Wait time:', prediction.estimatedWaitMinutes, 'minutes');
 * console.log('Busy level:', prediction.busyLevel); // 'low' | 'medium' | 'high'
 */

/**
 * 4. RAG MEDICAL CHATBOT
 * ======================
 * 
 * Frontend:
 * --------
 * const response = await fetch('/api/ai/chat', {
 *     method: 'POST',
 *     headers: {
 *         'Content-Type': 'application/json',
 *         'Authorization': `Bearer ${token}`
 *     },
 *     body: JSON.stringify({
 *         message: 'A është Dr. Arta e lirë sot?',
 *         conversationId: 'conv123'
 *     })
 * });
 * const chat = await response.json();
 * console.log('AI Response:', chat.aiResponse);
 * console.log('Data sources used:', chat.dataUsed); // ['Doctor Directory', 'Doctor Schedules']
 */

/**
 * 5. FRAUD DETECTION (AUTOMATIC)
 * ===============================
 * 
 * The fraud detection middleware works automatically on all routes.
 * No changes needed in existing code!
 * 
 * It detects:
 * - Rate limit violations (>60 requests/minute)
 * - Brute force login attempts (>5 failed logins in 5 minutes)
 * - Bulk data access attempts (>50 requests to /api/admin/users in 1 minute)
 * - Sequential ID enumeration (harvesting user data)
 * 
 * Blocked IPs return 429 error and are temporarily banned
 */

// ==================== ENVIRONMENT VARIABLES ====================
/**
 * Add to your .env file:
 * 
 * # Fraud Detection
 * ADMIN_IPS=127.0.0.1,192.168.1.100
 * 
 * # AI Services (optional, for future LLM integration)
 * GEMINI_API_KEY=your_api_key_here
 * OPENAI_API_KEY=your_api_key_here
 */

// ==================== TESTING THE INTEGRATION ====================
/**
 * 1. Test Fraud Detection:
 *    - Make 70 requests to any endpoint in 60 seconds
 *    - Should get 429 error and IP blocked
 * 
 * 2. Test AI Chatbot:
 *    - POST to /api/ai/chat with message "A është Dr. X e lirë sot?"
 *    - Should return intelligent response based on DB data
 * 
 * 3. Test Symptom Analysis:
 *    - POST to /api/ai/analyze-symptoms with chest pain symptoms
 *    - Should recommend Cardiology department
 * 
 * 4. Test Queue Prediction:
 *    - GET /api/ai/queue-prediction/doctorId/2026-04-16
 *    - Should return wait time prediction based on appointments
 */

// ==================== SECURITY NOTES ====================
/**
 * 1. All AI routes require JWT authentication (requireAuth middleware)
 * 2. Fraud detection is automatic and transparent
 * 3. Blocked IPs are temporarily banned (15 minutes)
 * 4. Admin can manually unblock IPs via /api/admin/unblock-ip/:ip
 * 5. All suspicious events are logged to console (set up Sentry in production)
 * 6. No user data is exposed by AI responses beyond what the user owns
 */

module.exports = {
    // Example configuration object for AI services
    aiConfig: {
        symptomAnalysisEnabled: true,
        documentAnalysisEnabled: true,
        chatbotEnabled: true,
        queuePredictionEnabled: true,
        fraudDetectionEnabled: true,
        maxRequestsPerMinute: 60,
        banDurationMinutes: 15
    }
};
