/**
 * Symptom → Department suggestion
 * - Uses rule-based matcher first (symptomChecker)
 * - Optionally refines via Gemini (if configured)
 */

const { checkSymptoms } = require('../utils/symptomChecker');
const { analyzeSymptomWithGemini } = require('./geminiAI');

const FALLBACK_DEPARTMENT = 'general';

function normalizeDepartment(raw) {
    if (!raw) return null;
    const s = String(raw).trim().toLowerCase();
    if (!s) return null;

    // Common Albanian → internal keys
    const map = {
        kardiologji: 'cardiology',
        kardio: 'cardiology',
        zemra: 'cardiology',
        neurologji: 'neurology',
        neuro: 'neurology',
        truri: 'neurology',
        ortopedi: 'orthopedics',
        ortoped: 'orthopedics',
        kocka: 'orthopedics',
        pediatri: 'pediatrics',
        femije: 'pediatrics',
        fëmije: 'pediatrics',
        dermatologji: 'dermatology',
        lekura: 'dermatology',
        lëkura: 'dermatology',
        urgjence: 'emergency',
        urgjencë: 'emergency',
        emergjence: 'emergency',
        emergjencë: 'emergency',
        emergjenca: 'emergency',
        general: 'general',
        gjeneral: 'general',
        'mjekesi familjare': 'general',
    };

    if (map[s]) return map[s];

    // Normalize some English variants
    if (s.includes('cardio')) return 'cardiology';
    if (s.includes('neuro')) return 'neurology';
    if (s.includes('ortho')) return 'orthopedics';
    if (s.includes('derma')) return 'dermatology';
    if (s.includes('pedia')) return 'pediatrics';
    if (s.includes('emerg')) return 'emergency';

    // If Gemini returns our known internal keys already
    return s.replace(/\s+/g, '-');
}

function pickFirstDepartmentFromLLM(llmResult) {
    const list = Array.isArray(llmResult?.recommendedDepartments) ? llmResult.recommendedDepartments : [];
    for (const item of list) {
        const normalized = normalizeDepartment(item);
        if (normalized) return normalized;
    }
    return null;
}

async function suggestDepartmentFromSymptoms(symptoms, age, medicalHistory) {
    const rule = checkSymptoms(symptoms);

    const result = {
        valid: !!rule?.valid,
        suggestedDepartment: rule?.suggestedDepartment || rule?.suggestedSpecialization || FALLBACK_DEPARTMENT,
        urgencyLevel: rule?.urgencyLevel || 'low',
        confidence: typeof rule?.confidence === 'number' ? rule.confidence : 50,
        usingGeminiAPI: !!process.env.GEMINI_API_KEY,
        matchedSymptoms: rule?.matchedSymptoms || [],
        alternativeDepartments: rule?.alternativeDepartments || [],
        recommendedAction: rule?.recommendedAction,
    };

    // If input isn't even valid for rule-based, don't waste LLM calls.
    if (!rule?.valid) {
        return { ...result, error: rule?.error, suggestions: rule?.suggestions };
    }

    if (!process.env.GEMINI_API_KEY) {
        return result;
    }

    try {
        const llm = await analyzeSymptomWithGemini(symptoms, age, medicalHistory);
        const llmDept = pickFirstDepartmentFromLLM(llm);
        const llmUrgency = llm?.urgencyLevel && ['low', 'medium', 'high'].includes(String(llm.urgencyLevel).toLowerCase())
            ? String(llm.urgencyLevel).toLowerCase()
            : null;

        return {
            ...result,
            suggestedDepartment: llmDept || result.suggestedDepartment,
            urgencyLevel: llmUrgency || result.urgencyLevel,
            confidence: typeof llm?.confidence === 'number' ? llm.confidence : result.confidence,
        };
    } catch {
        return result;
    }
}

module.exports = {
    suggestDepartmentFromSymptoms,
};
