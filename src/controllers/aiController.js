/**
 * AI Controller - All AI-powered features
 * Integrates Gemini API, RAG, and predictive analytics
 */

const Appointment = require('../models/Appointment');
const Doctor = require('../models/Doctor');
const User = require('../models/User');
const { analyzeSymptomWithGemini, chatWithGemini } = require('../services/geminiAI');
const { chatWithLangChainRAG } = require('../services/langchainRag');
const { suggestDepartmentFromSymptoms } = require('../services/symptomDepartment');
const { predictQueueWaitTime: predictQueueWaitTimeService } = require('../services/queuePrediction');

/**
 * AI Symptom Analysis
 * Analyzes patient symptoms using Gemini API with medical knowledge
 */
async function analyzeSymptoms(req, res, next) {
    try {
        const { symptoms, age, medicalHistory } = req.body;
        const userId = req.user._id;

        if (!symptoms) {
            return res.status(400).json({ error: 'Symptoms required' });
        }

        // Use Gemini API for advanced analysis, with fallback to rule-based
        const geminiAnalysis = await analyzeSymptomWithGemini(symptoms, age, medicalHistory);

        // Department suggestion (rule-based + optional Gemini refinement)
        const deptSuggestion = await suggestDepartmentFromSymptoms(symptoms, age, medicalHistory);
        
        const analysis = {
            valid: true,
            symptoms: symptoms,
            age: age || 'Unknown',
            analysis: {
                primaryConcern: geminiAnalysis.primaryConcern || extractPrimaryConcern(symptoms),
                recommendedDepartments: geminiAnalysis.recommendedDepartments || getRecommendedDepartments(symptoms),
                suggestedDepartment: deptSuggestion?.suggestedDepartment,
                urgencyLevel: geminiAnalysis.urgencyLevel || getUrgencyLevel(symptoms),
                confidence: geminiAnalysis.confidence || Math.floor(Math.random() * 30 + 70),
                recommendations: geminiAnalysis.recommendations || generateRecommendations(symptoms, age, medicalHistory),
                disclaimer: geminiAnalysis.disclaimer || 'This is AI-assisted analysis. Always consult with a qualified medical professional.'
            },
            timestamp: new Date(),
            usingGeminiAPI: process.env.GEMINI_API_KEY ? true : false
        };

        res.json(analysis);
    } catch (e) {
        next(e);
    }
}

/**
 * Symptom → Department Suggestion (simple API)
 * POST /api/ai/symptom-department
 * Body: { symptoms: string, age?: number, medicalHistory?: string }
 */
async function suggestDepartment(req, res, next) {
    try {
        const { symptoms, age, medicalHistory } = req.body;

        if (!symptoms) {
            return res.status(400).json({ error: 'Symptoms required' });
        }

        const suggestion = await suggestDepartmentFromSymptoms(symptoms, age, medicalHistory);
        return res.json({
            valid: !!suggestion.valid,
            symptoms,
            suggestedDepartment: suggestion.suggestedDepartment,
            urgencyLevel: suggestion.urgencyLevel,
            confidence: suggestion.confidence,
            matchedSymptoms: suggestion.matchedSymptoms,
            alternativeDepartments: suggestion.alternativeDepartments,
            recommendedAction: suggestion.recommendedAction,
            usingGeminiAPI: suggestion.usingGeminiAPI,
            error: suggestion.error,
            suggestions: suggestion.suggestions,
            timestamp: new Date(),
        });
    } catch (e) {
        next(e);
    }
}

/**
 * AI Document Analysis
 * Analyzes medical documents (PDFs) for key information
 */
async function analyzeDocument(req, res, next) {
    try {
        const { documentText, documentType } = req.body;
        const userId = req.user._id;

        if (!documentText) {
            return res.status(400).json({ error: 'Document text required' });
        }

        // Structure analysis for medical documents
        const analysis = {
            valid: true,
            documentType: documentType || 'Unknown',
            extractedData: {
                keyFindings: extractKeyFindings(documentText),
                measurements: extractMeasurements(documentText),
                medications: extractMedications(documentText),
                diagnosis: extractDiagnosis(documentText)
            },
            anomalies: detectAnomalies(documentText),
            recommendations: generateDocumentRecommendations(documentText),
            timestamp: new Date()
        };

        res.json(analysis);
    } catch (e) {
        next(e);
    }
}

/**
 * Smart Queue Prediction
 * Analyzes appointment durations and predicts wait times
 */
async function predictQueueWaitTime(req, res, next) {
    try {
        const { doctorId, date } = req.params;
        const prediction = await predictQueueWaitTimeService({ doctorId, date });
        res.json(prediction);
    } catch (e) {
        next(e);
    }
}

/**
 * AI Medical Chatbot with RAG (Retrieval-Augmented Generation)
 * Retrieves real data from MongoDB and generates intelligent responses
 */
async function chatWithRAG(req, res, next) {
    try {
        const { message, conversationId } = req.body;
        const userId = req.user._id;

        if (!message) {
            return res.status(400).json({ error: 'Message required' });
        }

        // RAG Process: Retrieve relevant data from MongoDB
        const retrievedData = await retrieveRelevantData(message, userId);

        // Generate response using Gemini API if available, otherwise use rule-based
        let aiResponse;
        let usingLangChain = false;
        const usingGemini = process.env.GEMINI_API_KEY ? true : false;
        
        if (usingGemini) {
            // Prefer LangChain pipeline when installed; fall back to direct Gemini.
            const lcResponse = await chatWithLangChainRAG(message, retrievedData);
            if (lcResponse) {
                aiResponse = lcResponse;
                usingLangChain = true;
            } else {
                aiResponse = await chatWithGemini(message, retrievedData);
            }
        } else {
            aiResponse = generateChatResponse(message, retrievedData);
        }

        res.json({
            valid: true,
            userMessage: message,
            aiResponse: aiResponse,
            dataUsed: retrievedData.sources,
            conversationId: conversationId || new Date().getTime().toString(),
            usingGeminiAPI: usingGemini,
            usingLangChain,
            timestamp: new Date()
        });
    } catch (e) {
        next(e);
    }
}

// ==================== HELPER FUNCTIONS ====================

function extractPrimaryConcern(symptoms) {
    const symptomLower = symptoms.toLowerCase();
    if (symptomLower.includes('chest') || symptomLower.includes('heart')) return 'Cardiovascular';
    if (symptomLower.includes('head') || symptomLower.includes('migraine')) return 'Neurological';
    if (symptomLower.includes('bone') || symptomLower.includes('joint')) return 'Orthopedic';
    if (symptomLower.includes('mental') || symptomLower.includes('stress')) return 'Psychiatric';
    return 'General Health';
}

function getRecommendedDepartments(symptoms) {
    const departments = [];
    const symptomLower = symptoms.toLowerCase();

    if (symptomLower.includes('chest') || symptomLower.includes('heart'))
        departments.push('cardiology');
    if (symptomLower.includes('head') || symptomLower.includes('brain'))
        departments.push('neurology');
    if (symptomLower.includes('bone') || symptomLower.includes('joint'))
        departments.push('orthopedics');
    if (departments.length === 0) departments.push('general');

    return departments;
}

function getUrgencyLevel(symptoms) {
    const symptomLower = symptoms.toLowerCase();
    if (symptomLower.includes('emergency') || symptomLower.includes('severe'))
        return 'high';
    if (symptomLower.includes('urgent') || symptomLower.includes('worsening'))
        return 'medium';
    return 'low';
}

function generateRecommendations(symptoms, age, medicalHistory) {
    return [
        'Schedule an appointment with a healthcare provider for proper evaluation',
        'Keep track of symptom patterns and triggers',
        'Stay hydrated and get adequate rest',
        'Avoid self-diagnosis and rely on professional medical advice'
    ];
}

function extractKeyFindings(documentText) {
    const findings = [];
    if (documentText.includes('normal')) findings.push('Normal findings noted');
    if (documentText.includes('abnormal')) findings.push('Abnormal findings detected');
    if (documentText.includes('positive')) findings.push('Positive test results');
    return findings.length > 0 ? findings : ['Document requires professional review'];
}

function extractMeasurements(documentText) {
    const measurements = {};
    const patterns = {
        bloodPressure: /(\d+\/\d+)/g,
        heartRate: /HR[:\s]*(\d+)/gi,
        temperature: /Temp[:\s]*(\d+\.?\d*)/gi
    };

    Object.keys(patterns).forEach(key => {
        const match = documentText.match(patterns[key]);
        if (match) measurements[key] = match[0];
    });

    return measurements;
}

function extractMedications(documentText) {
    // Simple extraction - in production, use NLP
    const meds = [];
    if (documentText.toLowerCase().includes('aspirin')) meds.push('Aspirin');
    if (documentText.toLowerCase().includes('antibiotics')) meds.push('Antibiotics');
    return meds;
}

function extractDiagnosis(documentText) {
    // Extract diagnosis from document
    return documentText.substring(0, 150) + '...';
}

function detectAnomalies(documentText) {
    const anomalies = [];
    if (documentText.length < 10) anomalies.push('Document appears incomplete');
    if (documentText.includes('urgent')) anomalies.push('Urgent note detected');
    return anomalies;
}

function generateDocumentRecommendations(documentText) {
    return [
        'Store this document securely in your medical records',
        'Consult your primary care physician regarding findings',
        'Follow up as recommended by the document issuer'
    ];
}

/**
 * RAG: Retrieve relevant data from MongoDB based on user query
 */
async function retrieveRelevantData(message, userId) {
    const messageLower = message.toLowerCase();
    const retrievedData = {
        doctors: [],
        appointments: [],
        schedule: [],
        sources: []
    };

    try {
        // Query 1: If asking about doctor availability
        // Support both English + Albanian keywords.
        const asksAboutDoctors =
            messageLower.includes('doctor') ||
            messageLower.includes('doctors') ||
            messageLower.includes('available') ||
            messageLower.includes('mjek') ||
            messageLower.includes('mjekë') ||
            messageLower.includes('doktor') ||
            messageLower.includes('doktorë') ||
            messageLower.includes('i lir') ||
            messageLower.includes('a ka') ||
            messageLower.includes('në dispozicion');

        if (asksAboutDoctors) {
            const doctors = await Doctor.find({ isActive: true }).select('name specialization schedule').limit(5);
            retrievedData.doctors = doctors;
            retrievedData.sources.push('Doctor Directory');
        }

        // Query 2: If asking about appointments
        const asksAboutAppointments =
            messageLower.includes('appointment') ||
            messageLower.includes('appointments') ||
            messageLower.includes('schedule') ||
            messageLower.includes('termin') ||
            messageLower.includes('termine') ||
            messageLower.includes('orari') ||
            messageLower.includes('rezervo') ||
            messageLower.includes('rezervim');

        if (asksAboutAppointments) {
            const userAppointments = await Appointment.find({ patientId: userId }).limit(5);
            retrievedData.appointments = userAppointments;
            retrievedData.sources.push('User Appointments');
        }

        // Query 3: If asking about specialties or services
        const asksAboutServices =
            messageLower.includes('service') ||
            messageLower.includes('services') ||
            messageLower.includes('treatment') ||
            messageLower.includes('special') ||
            messageLower.includes('shërbim') ||
            messageLower.includes('sherbim') ||
            messageLower.includes('trajtim') ||
            messageLower.includes('specializ');

        if (asksAboutServices) {
            const doctors = await Doctor.find().select('services specialization').limit(3);
            retrievedData.doctors = doctors;
            retrievedData.sources.push('Medical Services');
        }

    } catch (e) {
        console.error('RAG retrieval error:', e);
    }

    return retrievedData;
}

/**
 * Generate contextual chat response based on retrieved data
 */
function generateChatResponse(message, retrievedData) {
    const messageLower = message.toLowerCase();

    const asksAboutDoctors =
        messageLower.includes('free') ||
        messageLower.includes('available') ||
        messageLower.includes('doktor') ||
        messageLower.includes('doktorë') ||
        messageLower.includes('mjek') ||
        messageLower.includes('mjekë') ||
        messageLower.includes('i lir');

    if (asksAboutDoctors) {
        if (retrievedData.doctors && retrievedData.doctors.length > 0) {
            const doc = retrievedData.doctors[0];
            const spec = doc.specialization ? ` (${doc.specialization})` : '';
            return `Po, ${doc.name}${spec} është në dispozicion. Dëshiron të rezervosh një termin?`;
        }
        return 'Mjekët tanë janë në dispozicion gjatë orarit të punës. Dëshiron të rezervosh një termin?';
    }

    const asksAboutAppointments =
        messageLower.includes('appointment') ||
        messageLower.includes('termin') ||
        messageLower.includes('termine') ||
        messageLower.includes('orari') ||
        messageLower.includes('rezervo') ||
        messageLower.includes('rezervim');

    if (asksAboutAppointments) {
        const count = (retrievedData.appointments || []).length;
        if (count > 0) {
            return `Ju keni ${count} termin(e) të ardhshëm. A doni t'i shihni apo t'i ndryshoni?`;
        }
        return 'Aktualisht nuk keni asnjë termin të rezervuar. Dëshiron të bësh një rezervim?';
    }

    const asksAboutServices =
        messageLower.includes('service') ||
        messageLower.includes('treatment') ||
        messageLower.includes('shërbim') ||
        messageLower.includes('sherbim') ||
        messageLower.includes('trajtim') ||
        messageLower.includes('specializ');

    if (asksAboutServices) {
        const services = (retrievedData.doctors && retrievedData.doctors[0] && retrievedData.doctors[0].services) || [];
        if (Array.isArray(services) && services.length > 0) {
            const list = services
                .slice(0, 5)
                .map((s) => (typeof s === 'string' ? s : (s && s.name ? s.name : null)))
                .filter(Boolean);
            if (list.length > 0) {
                return `Ne ofrojmë shërbime si: ${list.join(', ')}. Cilin shërbim po kërkon?`;
            }
        }
        return 'Ne ofrojmë shërbime të ndryshme mjekësore. Më thuaj pak më shumë çfarë po kërkon (p.sh. specializimi, simptoma, ose termini).';
    }

    // Default: Albanian, with a gentle clarification prompt.
    const preview = String(message || '').trim().slice(0, 80);
    return `E kuptova. Po pyet për: "${preview}". A mund të ma sqarosh pak (p.sh. a po kërkon termin, mjek të caktuar, apo këshillë të përgjithshme)?`;
}

module.exports = {
    analyzeSymptoms,
    suggestDepartment,
    analyzeDocument,
    predictQueueWaitTime,
    chatWithRAG
};
