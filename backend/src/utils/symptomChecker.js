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

function stripDiacritics(str) {
    return String(str || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function normalizeClinicText(text) {
    return stripDiacritics(String(text || '')).toLowerCase().trim();
}

const CLINIC_DEPARTMENTS = {
    Kardiologji: {
        specializationKey: 'cardiology',
        keywords: [
            'zem',
            'zemer',
            'zëmër',
            'kardi',
            'rrahje',
            'palpit',
            'presion',
            'tension',
            'chest pain',
            'chest',
            'kraharor',
            'gjoks',
            'shortness of breath',
            'difficulty breathing',
            'frym',
            'mungese ajri',
            'manges',
            'krahu',
            'arm pain',
            'left arm',
        ],
    },
    Pediatri: {
        specializationKey: 'pediatrics',
        keywords: ['femije', 'fëmij', 'foshnje', 'bebe', 'beb', 'pediatric', 'child', 'kid'],
    },
    Dermatologji: {
        specializationKey: 'dermatology',
        keywords: ['lekure', 'lëkur', 'skuqje', 'rash', 'kruar', 'itch', 'akne', 'acne', 'pucrra', 'pucra'],
    },
    Pulmonologji: {
        specializationKey: 'pulmonology',
        keywords: [
            'koll',
            'cough',
            'astm',
            'wheeze',
            'fishkellim',
            'bronkit',
            'pneumon',
            'mushker',
            'mushkri',
            'lung',
            'breath',
            'frym',
            'shortness of breath',
        ],
    },
    Gjinekologji: {
        specializationKey: 'gynecology',
        keywords: [
            'cikel',
            'period',
            'menstru',
            'gjakderdh',
            'shtatz',
            'pregnan',
            'vagin',
            'sekrecion',
            'dhimbje pelv',
            'gjinek',
        ],
    },
};

function pickClinicDepartment(inputNorm) {
    const matches = Object.entries(CLINIC_DEPARTMENTS)
        .map(([name, cfg]) => {
            const hits = (cfg.keywords || []).reduce((acc, kw) => (inputNorm.includes(normalizeClinicText(kw)) ? acc + 1 : acc), 0);
            return { name, specializationKey: cfg.specializationKey, hits };
        })
        .sort((a, b) => b.hits - a.hits);

    return matches[0] && matches[0].hits > 0 ? matches[0] : null;
}

function computeClinicUrgency(inputNorm) {
    // High-urgency red flags
    const hasChestPain = /\b(kraharor|gjoks|chest)\b/.test(inputNorm) || inputNorm.includes('chest pain');
    const hasBreath =
        inputNorm.includes('frym') ||
        inputNorm.includes('mungese ajri') ||
        inputNorm.includes('manges ajri') ||
        inputNorm.includes('breath') ||
        inputNorm.includes('shortness');
    const hasArmPain = /\b(krah|krahu|arm)\b/.test(inputNorm);
    const hasFainting = /\b(t[ei]\s*fiket|fik(et|je)|unconscious|faint)\b/.test(inputNorm);
    const hasSevere = /\b(shume e forte|shum[eë]\s*e\s*forte|shum[eë]|severe|sudden)\b/.test(inputNorm);

    if (
        (hasChestPain && hasBreath) ||
        (hasChestPain && hasArmPain) ||
        (hasArmPain && hasBreath) ||
        (hasBreath && hasSevere) ||
        hasFainting
    ) {
        return 'high';
    }

    // Medium urgency indicators
    const hasFever = /\b(ethe|ethet|temperature|temperatur|fever)\b/.test(inputNorm);
    const hasPersistentPain = /\b(dhimbje|dhembje|pain)\b/.test(inputNorm);
    const hasRash = /\b(skuqje|rash|iritim)\b/.test(inputNorm);
    const hasBleeding = /\b(gjakderdh|bleeding)\b/.test(inputNorm);

    if (hasBleeding) return 'high';
    if (hasFever && (hasBreath || hasRash)) return 'medium';
    if (hasBreath || (hasPersistentPain && hasSevere)) return 'medium';

    return 'low';
}

function computeClinicConfidence(hitCount, urgency) {
    const base = hitCount > 0 ? 55 : 28;
    const urgencyBonus = urgency === 'high' ? 18 : urgency === 'medium' ? 10 : 0;
    const hitBonus = Math.min(30, hitCount * 10);
    return Math.max(10, Math.min(95, Math.round(base + hitBonus + urgencyBonus)));
}

function clinicRecommendedAction(urgency) {
    if (urgency === 'high') {
        return 'Nëse simptomat janë të forta ose po përkeqësohen, paraqituni menjëherë te urgjenca ose kontaktoni mjekun.';
    }
    if (urgency === 'medium') {
        return 'Rekomandohet konsultë brenda 24-48 orëve. Nëse simptomat përkeqësohen, kontaktoni urgjencën.';
    }
    return 'Rekomandohet të caktoni një konsultë kur ju përshtatet dhe të monitoroni simptomat.';
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
    const inputNorm = normalizeClinicText(userInput);

    if (!input || input.length < 2) {
        return {
            valid: false,
            error: 'Please enter at least 2 characters describing your symptoms.',
        };
    }

    // 1) Clinic-first mapping (strict departments, Albanian labels)
    const deptPick = pickClinicDepartment(inputNorm);
    const urgencyLevel = computeClinicUrgency(inputNorm);

    if (deptPick) {
        const confidence = computeClinicConfidence(deptPick.hits, urgencyLevel);
        return {
            valid: true,
            // UI uses this value directly for the /appointments/doctors/:specialization call.
            // Keep it as an Albanian label (strict list) and map it server-side in /doctors.
            suggestedDepartment: deptPick.name,
            // Keep a machine key for other backends/scripts.
            suggestedSpecialization: deptPick.specializationKey,
            urgencyLevel,
            confidence,
            matchedSymptoms: [
                {
                    symptom: deptPick.name,
                    department: deptPick.name,
                    urgency: urgencyLevel,
                    relevance: confidence,
                },
            ],
            alternativeDepartments: [],
            recommendedAction: clinicRecommendedAction(urgencyLevel),
        };
    }

    // 2) Legacy scoring against the built-in database (fallback)
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
        // Strict list fallback: return a safe, low-confidence triage instead of N/A.
        const safeDept = 'Kardiologji';
        const safeUrgency = urgencyLevel || 'low';
        const confidence = computeClinicConfidence(0, safeUrgency);

        return {
            valid: true,
            suggestedDepartment: safeDept,
            suggestedSpecialization: CLINIC_DEPARTMENTS[safeDept].specializationKey,
            urgencyLevel: safeUrgency,
            confidence,
            matchedSymptoms: [],
            alternativeDepartments: [],
            recommendedAction:
                'Nuk u kuptuan plotësisht simptomat. Ju lutem përshkruani më shumë detaje (p.sh. vendndodhja, kohëzgjatja, intensiteti).',
        };
    }

    // Get top match
    const topMatch = scores[0];

    // Aggregate all possible departments
    const allDepartments = [...new Set(scores.map((s) => s.department))];
    const urgencyLevels = scores.map((s) => s.urgency);
    const maxUrgency = ['high', 'medium', 'low'].find((u) => urgencyLevels.includes(u));

    // Map legacy department keys into the strict clinic list
    const legacyToClinic = {
        cardiology: 'Kardiologji',
        pediatrics: 'Pediatri',
        dermatology: 'Dermatologji',
        general: 'Pulmonologji',
        emergency: 'Kardiologji',
        neurology: 'Kardiologji',
        orthopedics: 'Kardiologji',
        psychiatry: 'Kardiologji',
    };

    const clinicDept = legacyToClinic[topMatch.department] || 'Kardiologji';
    const clinicSpecKey = CLINIC_DEPARTMENTS[clinicDept]?.specializationKey || 'cardiology';

    return {
        valid: true,
        suggestedDepartment: clinicDept,
        suggestedSpecialization: clinicSpecKey,
        urgencyLevel: topMatch.urgency,
        confidence: Math.max(10, Math.min(95, Math.round(topMatch.relevance))),
        matchedSymptoms: scores.slice(0, 3).map((s) => ({
            symptom: s.symptom,
            department: legacyToClinic[s.department] || clinicDept,
            urgency: s.urgency,
            relevance: s.relevance,
        })),
        alternativeDepartments: allDepartments
            .filter((d) => d !== topMatch.department)
            .slice(0, 2),
        recommendedAction: clinicRecommendedAction(maxUrgency || topMatch.urgency || 'low'),
    };
}

module.exports = {
    checkSymptoms,
    SYMPTOM_DATABASE,
};
