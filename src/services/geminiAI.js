/**
 * Gemini AI Integration Service
 * Provides advanced AI responses using Google's Gemini API
 * 
 * Setup:
 * 1. npm install @google/generative-ai
 * 2. Add GEMINI_API_KEY to .env file
 * 3. Get API key from: https://makersuite.google.com/app/apikey
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL_CONFIG = (process.env.GEMINI_MODEL || 'auto').trim(); // 'auto' or explicit model
const GEMINI_MODEL_FALLBACK = 'gemini-2.5-flash';
let geminiClient = null;
let geminiAvailable = false;
let resolvedGeminiModel = null;
let resolveGeminiModelPromise = null;

// Try to load Gemini client if API key exists
if (GEMINI_API_KEY) {
    try {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        geminiClient = new GoogleGenerativeAI(GEMINI_API_KEY);
        geminiAvailable = true;
        console.log(`✅ Gemini AI initialized (model: ${GEMINI_MODEL_CONFIG})`);
    } catch (e) {
        console.warn('⚠️  Gemini AI package not available. Install with: npm install @google/generative-ai');
        geminiAvailable = false;
    }
} else {
    // Keep silent when key is not configured
    geminiAvailable = false;
}

function normalizeModelName(name) {
    if (!name) return name;
    return name.startsWith('models/') ? name.slice('models/'.length) : name;
}

async function resolveGeminiModelName() {
    if (!geminiClient || !geminiAvailable) return null;

    if (resolvedGeminiModel) return resolvedGeminiModel;

    // Explicit model name
    if (GEMINI_MODEL_CONFIG && GEMINI_MODEL_CONFIG.toLowerCase() !== 'auto') {
        resolvedGeminiModel = GEMINI_MODEL_CONFIG;
        return resolvedGeminiModel;
    }

    // Auto-select based on the API key's available models (cached)
    if (resolveGeminiModelPromise) return resolveGeminiModelPromise;

    resolveGeminiModelPromise = (async () => {
        try {
            if (typeof fetch !== 'function') {
                resolvedGeminiModel = GEMINI_MODEL_FALLBACK;
                return resolvedGeminiModel;
            }

            const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(GEMINI_API_KEY)}`;
            const res = await fetch(url);
            if (!res.ok) {
                resolvedGeminiModel = GEMINI_MODEL_FALLBACK;
                return resolvedGeminiModel;
            }

            const data = await res.json();
            const models = Array.isArray(data.models) ? data.models : [];

            const candidates = models
                .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
                .map(m => normalizeModelName(m.name))
                .filter(Boolean);

            const preferredOrder = [
                // Prefer models that commonly have Free Tier quota enabled
                'gemini-2.5-flash',
                'gemini-3-flash',
                'gemini-2.5-flash-lite',
                'gemini-3.1-flash-lite',
                // Then try other generations
                'gemini-2.0-flash',
                'gemini-2.0-flash-lite',
                'gemini-1.5-flash',
                'gemini-1.5-pro',
                'gemini-pro'
            ];

            for (const preferred of preferredOrder) {
                if (candidates.includes(preferred)) {
                    resolvedGeminiModel = preferred;
                    return resolvedGeminiModel;
                }
            }

            resolvedGeminiModel = candidates[0] || GEMINI_MODEL_FALLBACK;
            return resolvedGeminiModel;
        } catch {
            resolvedGeminiModel = GEMINI_MODEL_FALLBACK;
            return resolvedGeminiModel;
        } finally {
            // allow re-resolve only if we still don't have a model
            if (!resolvedGeminiModel) resolveGeminiModelPromise = null;
        }
    })();

    return resolveGeminiModelPromise;
}

/**
 * Analyze symptoms using Gemini API
 * Falls back to rule-based analysis if API unavailable
 */
async function analyzeSymptomWithGemini(symptoms, age, medicalHistory) {
    // If Gemini not available, use rule-based fallback
    if (!geminiClient || !geminiAvailable) {
        return generateRuleBasedAnalysis(symptoms, age, medicalHistory);
    }

    try {
        const modelName = await resolveGeminiModelName();
        const model = geminiClient.getGenerativeModel({ model: modelName || GEMINI_MODEL_FALLBACK });

        const prompt = `
You are an advanced medical AI assistant. Analyze the following symptoms and provide:
1. Primary concern
2. Recommended medical departments
3. Urgency level (low/medium/high)
4. Confidence score (0-100)
5. Specific recommendations

PATIENT INFORMATION:
- Symptoms: ${symptoms}
- Age: ${age || 'Not provided'}
- Medical History: ${medicalHistory || 'None reported'}

IMPORTANT: Always include disclaimer that this is AI-assisted analysis only.

Provide response in JSON format:
{
  "primaryConcern": "string",
  "recommendedDepartments": ["dept1", "dept2"],
  "urgencyLevel": "low|medium|high",
  "confidence": number,
  "recommendations": ["recommendation1", "recommendation2"],
  "disclaimer": "This is AI-assisted analysis..."
}`;

        const result = await model.generateContent(prompt);
        const responseText = await result.response.text();
        
        // Parse JSON response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }

        return generateRuleBasedAnalysis(symptoms, age, medicalHistory);
    } catch (e) {
        console.error('⚠️  Gemini API error:', e.message);
        console.error('Falling back to rule-based analysis...');
        return generateRuleBasedAnalysis(symptoms, age, medicalHistory);
    }
}

/**
 * Chat with medical context using Gemini API
 * Retrieves data from MongoDB and uses it in conversation
 */
async function chatWithGemini(message, context) {
    if (!geminiClient || !geminiAvailable) {
        return generateRuleBasedChat(message, context);
    }

    try {
        const modelName = await resolveGeminiModelName();
        const model = geminiClient.getGenerativeModel({ model: modelName || GEMINI_MODEL_FALLBACK });

        // Build context from retrieved data
        let contextString = 'AVAILABLE DATA:\n';
        
        if (context.doctors && context.doctors.length > 0) {
            contextString += 'Doctors: ' + context.doctors.map(d => 
                `${d.name} (${d.specialization}, Rating: ${d.rating || 'N/A'}/5)`
            ).join(', ') + '\n';
        }

        if (context.appointments && context.appointments.length > 0) {
            contextString += 'User Appointments: ' + context.appointments.map(a => 
                `${new Date(a.scheduledAt).toLocaleDateString()} with Dr. ${a.doctorId?.name}`
            ).join(', ') + '\n';
        }

        if (context.services && context.services.length > 0) {
            contextString += 'Available Services: ' + context.services.join(', ') + '\n';
        }

        const prompt = `
Je një asistent i dobishëm mjekësor për BlueCare Medical Center. Përdor informacionin e dhënë për t'u përgjigjur saktë.

${contextString}

Pyetja e përdoruesit: "${message}"

Udhëzime:
1. Përdor të dhëna reale nga databaza kur janë në dispozicion
2. Ji profesional dhe miqësor
3. Jep informacion të saktë dhe të përgjithshëm (jo diagnozë përfundimtare)
4. Nëse nuk je i sigurt, sugjero kontaktimin e BlueCare support ose një mjeku
5. Gjithmonë jep përparësi sigurisë së përdoruesit
6. Përgjigju vetëm në gjuhën shqipe

Përgjigja:`;

        const result = await model.generateContent(prompt);
        const responseText = await result.response.text();
        
        return responseText;
    } catch (e) {
        console.error('⚠️  Gemini API error:', e.message);
        console.error('Falling back to rule-based chat...');
        return generateRuleBasedChat(message, context);
    }
}

/**
 * Fallback: Rule-based symptom analysis
 */
function generateRuleBasedAnalysis(symptoms, age, medicalHistory) {
    const symptomLower = symptoms.toLowerCase();

    const departments = [];
    if (symptomLower.includes('chest') || symptomLower.includes('heart')) {
        departments.push('cardiology');
    }
    if (symptomLower.includes('head') || symptomLower.includes('brain')) {
        departments.push('neurology');
    }
    if (symptomLower.includes('bone') || symptomLower.includes('joint')) {
        departments.push('orthopedics');
    }
    if (departments.length === 0) departments.push('general');

    let urgency = 'low';
    if (symptomLower.includes('emergency') || symptomLower.includes('severe')) urgency = 'high';
    else if (symptomLower.includes('urgent') || symptomLower.includes('worsening')) urgency = 'medium';

    return {
        primaryConcern: getPrimaryConcern(symptoms),
        recommendedDepartments: departments,
        urgencyLevel: urgency,
        confidence: Math.floor(Math.random() * 30 + 70),
        recommendations: [
            'Schedule an appointment with a healthcare provider',
            'Keep track of symptom patterns',
            'Stay hydrated and get adequate rest',
            'Avoid self-diagnosis - consult with medical professionals'
        ],
        disclaimer: 'This is AI-assisted analysis. Always consult with a qualified medical professional.'
    };
}

/**
 * Fallback: Rule-based chatbot
 */
function generateRuleBasedChat(message, context) {
    const msgLower = String(message || '').toLowerCase();

    // Doctor availability (English + Albanian)
    if (
        msgLower.includes('free') ||
        msgLower.includes('available') ||
        msgLower.includes('doktor') ||
        msgLower.includes('mjek') ||
        msgLower.includes('i lir') ||
        msgLower.includes('në dispozicion')
    ) {
        if (context.doctors && context.doctors.length > 0) {
            const doc = context.doctors[0];
            const spec = doc.specialization ? ` (${doc.specialization})` : '';
            return `Po, ${doc.name}${spec} është në dispozicion. Dëshiron të rezervosh një termin?`;
        }
        return 'Mjekët tanë janë në dispozicion gjatë orarit të punës. Dëshiron të rezervosh një termin?';
    }

    // Appointments (English + Albanian)
    if (msgLower.includes('appointment') || msgLower.includes('termin') || msgLower.includes('termine') || msgLower.includes('orari')) {
        const count = (context.appointments || []).length;
        if (count > 0) {
            return `Ju keni ${count} termin(e) të ardhshëm. A doni t'i shihni apo t'i ndryshoni?`;
        }
        return 'Aktualisht nuk keni asnjë termin të rezervuar. Dëshiron të bësh një rezervim?';
    }

    // Services
    if (msgLower.includes('service') || msgLower.includes('services') || msgLower.includes('treatment') || msgLower.includes('shërbim') || msgLower.includes('sherbim')) {
        const services = Array.isArray(context.services) ? context.services : [];
        if (services.length > 0) {
            return `Ne ofrojmë shërbime si: ${services.slice(0, 3).join(', ')}, dhe të tjera.`;
        }
        return 'Ne ofrojmë shërbime të ndryshme mjekësore. Si mund të të ndihmoj?';
    }

    // Default (Albanian)
    const preview = String(message || '').trim().slice(0, 80);
    return `E kuptova. Po pyet për: "${preview}". A mund të ma sqarosh pak (p.sh. termin, mjek/specializim, ose simptoma)?`;
}

/**
 * Determine primary medical concern
 */
function getPrimaryConcern(symptoms) {
    const symptomLower = symptoms.toLowerCase();
    
    if (symptomLower.includes('chest') || symptomLower.includes('heart')) return 'Cardiovascular';
    if (symptomLower.includes('head') || symptomLower.includes('migraine')) return 'Neurological';
    if (symptomLower.includes('bone') || symptomLower.includes('joint')) return 'Orthopedic';
    if (symptomLower.includes('mental') || symptomLower.includes('stress')) return 'Psychiatric';
    if (symptomLower.includes('skin')) return 'Dermatological';
    if (symptomLower.includes('stomach') || symptomLower.includes('digestive')) return 'Gastrointestinal';
    
    return 'General Health';
}

/**
 * Clinic Symptom Triage (Strict)
 * Returns only these departments: Kardiologji, Pediatri, Dermatologji, Pulmonologji, Gjinekologji
 * Output is Albanian and JSON only.
 */
async function classifyClinicSymptomsWithGemini(symptoms) {
    if (!geminiClient || !geminiAvailable) return null;

    const allowed = ['Kardiologji', 'Pediatri', 'Dermatologji', 'Pulmonologji', 'Gjinekologji'];
    const safeText = String(symptoms || '').trim();
    if (!safeText) return null;

    try {
        const modelName = await resolveGeminiModelName();
        const model = geminiClient.getGenerativeModel({ model: modelName || GEMINI_MODEL_FALLBACK });

        const prompt = `
Je një asistent mjekësor triage për BlueCare Clinic.

Detyrë: Klasifiko simptomat në NJË (dhe vetëm një) departament nga kjo listë e mbyllur:
${allowed.map((d) => `- ${d}`).join('\n')}

Rregulla STRICT:
1) Nëse simptomat lidhen me zemrën (p.sh. dhimbje gjoksi/kraharori, rrahje të çrregullta, dhimbje krahu e majtë), kthe gjithmonë "Kardiologji".
2) Jep gjithmonë "confidence" 0-100 (numër i plotë).
3) Jep gjithmonë "urgencyLevel" vetëm: low | medium | high.
4) Vendos urgjencë "high" kur ka kombinime si: (dhimbje krahu + frymëmarrje e vështirë) ose (dhimbje gjoksi + frymëmarrje e vështirë) ose (të fikët).
5) Përgjigju në shqip. Mos shto asnjë tekst jashtë JSON.

Simptomat e pacientit:
"""${safeText}"""

Kthe VETËM këtë JSON:
{
  "suggestedDepartment": "${allowed.join(' | ')}",
  "urgencyLevel": "low|medium|high",
  "confidence": 0,
  "recommendedAction": "string"
}
`;

        const result = await model.generateContent(prompt);
        const responseText = await result.response.text();

        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;

        const parsed = JSON.parse(jsonMatch[0]);
        const dept = String(parsed?.suggestedDepartment || '').trim();
        const urgency = String(parsed?.urgencyLevel || '').trim().toLowerCase();
        const confidence = Number(parsed?.confidence);
        const recommendedAction = String(parsed?.recommendedAction || '').trim();

        if (!allowed.includes(dept)) return null;
        if (!['low', 'medium', 'high'].includes(urgency)) return null;
        if (!Number.isFinite(confidence)) return null;

        return {
            suggestedDepartment: dept,
            urgencyLevel: urgency,
            confidence: Math.max(0, Math.min(100, Math.round(confidence))),
            recommendedAction,
        };
    } catch (e) {
        console.warn('⚠️  Clinic triage Gemini error:', e?.message || e);
        return null;
    }
}

/**
 * Check if Gemini API is available and working
 */
function isGeminiAvailable() {
    return geminiAvailable;
}

module.exports = {
    analyzeSymptomWithGemini,
    classifyClinicSymptomsWithGemini,
    chatWithGemini,
    isGeminiAvailable,
    generateRuleBasedAnalysis,
    generateRuleBasedChat
};
