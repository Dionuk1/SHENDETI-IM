/**
 * Symptom Checker Logic
 * Maps patient symptoms to medical departments and urgency levels
 */

const SYMPTOM_DATABASE = {
    // Cardiovascular symptoms
    'chest pain': { department: 'cardiology', urgency: 'high', keywords: ['dhimbje në kraharor', 'chest'] },
    'shortness of breath': {
        department: 'cardiology',
        urgency: 'high',
        keywords: ['mungesë ajri', 'teshje', 'difficulty breathing'],
    },
    'heart palpitations': {
        department: 'cardiology',
        urgency: 'medium',
        keywords: ['rrahje të shpejta', 'palpitations', 'irregular heartbeat'],
    },
    'high blood pressure': {
        department: 'cardiology',
        urgency: 'low',
        keywords: ['presion i lartë', 'hypertension', 'high bp'],
    },

    // Neurological symptoms
    'headache': { department: 'neurology', urgency: 'low', keywords: ['dhimbje koke', 'head pain'] },
    'migraine': { department: 'neurology', urgency: 'low', keywords: ['migrenë', 'severe headache'] },
    'dizziness': { department: 'neurology', urgency: 'medium', keywords: ['marramendi', 'vertigo'] },
    'seizure': { department: 'neurology', urgency: 'high', keywords: ['konvulsion', 'seizure', 'fainting'] },
    'stroke symptoms': { department: 'emergency', urgency: 'high', keywords: ['aksidentshtroak', 'numbness'] },
    'memory loss': { department: 'neurology', urgency: 'medium', keywords: ['harrim', 'amnesia'] },

    // Orthopedic symptoms
    'back pain': {
        department: 'orthopedics',
        urgency: 'low',
        keywords: ['dhimbje spine', 'lumbar pain', 'lower back'],
    },
    'joint pain': {
        department: 'orthopedics',
        urgency: 'low',
        keywords: ['dhimbje artikulimi', 'joint ache', 'arthritis'],
    },
    'fractured bone': {
        department: 'orthopedics',
        urgency: 'high',
        keywords: ['kockë e këputur', 'fracture', 'broken'],
    },
    'sprain': { department: 'orthopedics', urgency: 'medium', keywords: ['dislokacion', 'sprain'] },

    // General symptoms
    'fever': { department: 'general', urgency: 'medium', keywords: ['temperaturë e lartë', 'high temperature'] },
    'cough': { department: 'general', urgency: 'low', keywords: ['kollë', 'cough'] },
    'cold symptoms': {
        department: 'general',
        urgency: 'low',
        keywords: ['simptoma të ftohjes', 'flu', 'cold'],
    },
    'sore throat': { department: 'general', urgency: 'low', keywords: ['gryka e dhimbur', 'throat pain'] },
    'nausea': { department: 'general', urgency: 'low', keywords: ['nausea', 'vomiting'] },
    'abdominal pain': {
        department: 'general',
        urgency: 'medium',
        keywords: ['dhimbje barkut', 'stomach pain', 'abdomen'],
    },

    // Pediatric
    'fever in child': { department: 'pediatrics', urgency: 'high', keywords: ['temperatura në fëmijë'] },
    'rash': { department: 'dermatology', urgency: 'low', keywords: ['iritime lëkure', 'skin rash'] },

    // Mental health
    'anxiety': {
        department: 'psychiatry',
        urgency: 'medium',
        keywords: ['ankth', 'anxiety', 'panic attack'],
    },
    'depression': { department: 'psychiatry', urgency: 'medium', keywords: ['depresion', 'depression'] },
    'stress': { department: 'psychiatry', urgency: 'low', keywords: ['stresi', 'stress'] },

    // Dermatology
    'skin infection': {
        department: 'dermatology',
        urgency: 'medium',
        keywords: ['infeksion i lëkurës', 'skin infection'],
    },
    'acne': { department: 'dermatology', urgency: 'low', keywords: ['akne', 'pimples'] },
};

function normalizeInput(text) {
    return String(text).toLowerCase().trim();
}

function calculateRelevance(symptom, userInput) {
    const input = normalizeInput(userInput);
    const symptomLower = normalizeInput(symptom);

    // Exact match
    if (input === symptomLower) return 100;

    // Keyword match
    const keywords = SYMPTOM_DATABASE[symptomLower]?.keywords || [];
    for (const keyword of keywords) {
        if (input.includes(normalizeInput(keyword)) || normalizeInput(keyword).includes(input)) {
            return 80;
        }
    }

    // Substring match
    if (symptomLower.includes(input) || input.includes(symptomLower)) {
        return 60;
    }

    return 0;
}

function checkSymptoms(userInput) {
    const input = normalizeInput(userInput);

    if (!input || input.length < 2) {
        return {
            valid: false,
            error: 'Please enter at least 2 characters describing your symptoms.',
        };
    }

    // Score each symptom
    const scores = Object.keys(SYMPTOM_DATABASE)
        .map((symptom) => ({
            symptom,
            relevance: calculateRelevance(symptom, input),
            ...SYMPTOM_DATABASE[symptom],
        }))
        .filter((s) => s.relevance > 0)
        .sort((a, b) => b.relevance - a.relevance);

    if (scores.length === 0) {
        return {
            valid: false,
            error: 'Symptoms not recognized. Please describe your symptoms more clearly.',
            suggestions: ['Try mentioning specific body parts', 'Describe what you feel', 'Use common health terms'],
        };
    }

    // Get top match
    const topMatch = scores[0];

    // Aggregate all possible departments
    const allDepartments = [...new Set(scores.map((s) => s.department))];
    const urgencyLevels = scores.map((s) => s.urgency);
    const maxUrgency = ['high', 'medium', 'low'].find((u) => urgencyLevels.includes(u));

    return {
        valid: true,
        suggestedDepartment: topMatch.department,
        suggestedSpecialization: topMatch.department,
        urgencyLevel: topMatch.urgency,
        confidence: Math.min(100, topMatch.relevance),
        matchedSymptoms: scores.slice(0, 3).map((s) => ({
            symptom: s.symptom,
            department: s.department,
            urgency: s.urgency,
            relevance: s.relevance,
        })),
        alternativeDepartments: allDepartments
            .filter((d) => d !== topMatch.department)
            .slice(0, 2),
        recommendedAction:
            maxUrgency === 'high'
                ? 'Please see a doctor immediately or go to emergency'
                : maxUrgency === 'medium'
                  ? 'Schedule an appointment within 24-48 hours'
                  : 'Schedule an appointment at your convenience',
    };
}

module.exports = {
    checkSymptoms,
    SYMPTOM_DATABASE,
};
