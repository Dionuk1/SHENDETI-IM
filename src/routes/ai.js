/**
 * AI Routes - Symptom Analysis, Document Analysis, and Chatbot
 * Integrates with Gemini API for intelligent health insights
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const aiController = require('../controllers/aiController');

const router = express.Router();

/**
 * AI Symptom Analysis
 * POST /api/ai/analyze-symptoms
 * Body: { symptoms: string, age: number, medicalHistory: string }
 * Returns: AI-enhanced diagnosis with confidence and recommendations
 */
router.post('/analyze-symptoms', requireAuth, aiController.analyzeSymptoms);

/**
 * AI Document Analysis
 * POST /api/ai/analyze-document
 * Body: { documentText: string, documentType: string }
 * Returns: Extracted data, anomalies detected, recommendations
 */
router.post('/analyze-document', requireAuth, aiController.analyzeDocument);

/**
 * AI Medical Chatbot with RAG
 * POST /api/ai/chat
 * Body: { message: string, conversationId: string }
 * Returns: AI response with real data from MongoDB
 */
router.post('/chat', requireAuth, aiController.chatWithRAG);

/**
 * Get Smart Queue Prediction
 * GET /api/ai/queue-prediction/:doctorId/:date
 * Returns: Predicted wait time, busy level, optimal appointment slot
 */
router.get('/queue-prediction/:doctorId/:date', requireAuth, aiController.predictQueueWaitTime);

module.exports = router;
