const MAX_SYMPTOM_LENGTH = 500;
const DISCLAIMER = 'Ky informacion nuk është diagnozë mjekësore. Konsultohuni me një profesionist shëndetësor të licencuar. Për simptoma urgjente ose shenja alarmi, kontaktoni menjëherë shërbimet e urgjencës.';
const ALLOWED_INPUT_KEYS = new Set(['operation', 'symptoms']);

const DEPARTMENTS = Object.freeze({
  Kardiologji: ['zem', 'zemer', 'kardi', 'rrahje', 'palpit', 'presion', 'tension', 'chest', 'kraharor', 'gjoks', 'krahu', 'arm pain'],
  Neurologji: ['dhimbje koke', 'koke', 'migren', 'marramend', 'vertigo', 'konvulsion', 'seizure', 'harrim', 'amnezi', 'mpirje', 'neurolog'],
  Ortopedi: ['shpine', 'mesit', 'kock', 'fraktur', 'ndrydh', 'kyc', 'artikul', 'joint', 'back pain', 'orthoped'],
  Psikiatri: ['ankth', 'anxiety', 'panik', 'depres', 'stress', 'stres', 'psychiatr'],
  'Mjekësi e Përgjithshme': ['bark', 'stomak', 'abdomen', 'nauze', 'vjell', 'temperature', 'temperatur', 'ethe', 'ftoh', 'gryke', 'throat'],
  Pediatri: ['femije', 'foshnje', 'bebe', 'pediatric', 'child', 'kid'],
  Dermatologji: ['lekure', 'skuqje', 'rash', 'kruar', 'itch', 'akne', 'acne', 'pucrra', 'pucra'],
  Pulmonologji: ['koll', 'cough', 'astm', 'wheeze', 'fishkellim', 'bronkit', 'pneumon', 'mushker', 'mushkri', 'lung', 'breath', 'frym', 'shortness of breath'],
  Gjinekologji: ['cikel', 'period', 'menstru', 'gjakderdh', 'shtatz', 'pregnan', 'vagin', 'sekrecion', 'dhimbje pelv', 'gjinek'],
});

function stripDiacritics(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalize(value) {
  return stripDiacritics(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function invalidInput(message) {
  return { status: 400, body: { error: 'invalid_input', message } };
}

function validateInput(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return invalidInput('Kërkesa duhet të jetë një objekt JSON.');
  }

  const keys = Object.keys(payload);
  if (keys.some((key) => !ALLOWED_INPUT_KEYS.has(key))) {
    return invalidInput('Kërkesa përmban fusha të palejuara.');
  }
  if (payload.operation !== 'analyzeSymptoms') {
    return invalidInput('Operacion i panjohur.');
  }
  if (typeof payload.symptoms !== 'string') {
    return invalidInput('Simptomat duhet të jenë tekst i thjeshtë.');
  }

  const symptoms = payload.symptoms.trim();
  if (symptoms.length < 2) return invalidInput('Përshkruani simptomat me të paktën 2 karaktere.');
  if (symptoms.length > MAX_SYMPTOM_LENGTH) return invalidInput(`Simptomat nuk duhet të kalojnë ${MAX_SYMPTOM_LENGTH} karaktere.`);
  if (/\u0000|[<>]/.test(symptoms)) return invalidInput('Lejohet vetëm tekst i thjeshtë.');
  if (/\b(?:https?:\/\/|www\.)\S+/i.test(symptoms)) return invalidInput('URL-të nuk lejohen.');
  if (/\b(?:data:application\/(?:pdf|octet-stream)|file:|blob:)/i.test(symptoms)
    || /(?:^|\s)(?:[a-z]:\\|\.{0,2}\/|\\\\)[^\s]+/i.test(symptoms)
    || /\b[^\s]+\.(?:pdf|docx?|jpe?g|png|gif|zip)(?:\b|$)/i.test(symptoms)) {
    return invalidInput('Skedarët dhe të dhënat binare nuk lejohen.');
  }
  if (/(?:[A-Za-z0-9+/]{160,}={0,2})/.test(symptoms)) return invalidInput('Të dhënat base64 nuk lejohen.');
  if (/\b(?:ignore|disregard|override)\s+(?:all\s+)?(?:(?:previous|prior|system)\s+){1,2}(?:instructions?|prompts?)\b/i.test(symptoms)
    || /\b(?:system|developer)\s*prompt\s*:/i.test(symptoms)) {
    return invalidInput('Udhëzimet ose prompt-et nuk lejohen.');
  }
  if (/\b(?:i am|i'm|jam|roli im eshte|roli im është|vepro si|act as)\s+(?:an?\s+)?(?:admin(?:istrator)?|doctor|mjek|patient|pacient|system|developer)\b/i.test(symptoms)
    || /\b(?:user|patient|doctor|admin|auth)(?:id|_id|userid|user_id)\s*[:=]/i.test(symptoms)) {
    return invalidInput('Roli dhe identiteti nuk pranohen në përshkrimin e simptomave.');
  }

  return { symptoms, normalized: normalize(symptoms) };
}

function detectRedFlags(text) {
  const flags = [];
  const chest = /\b(chest|kraharor|gjoks)\b/.test(text);
  const breathing = /\b(breath|shortness|mungese ajri|manges ajri|mbyt)\b/.test(text) || text.includes('frym');
  const arm = /\b(arm|krah|krahu)\b/.test(text);
  const unconscious = /\b(unconscious|faint|fainted|fikje|fiket|pa ndjenja|humbje ndjenjash)\b/.test(text);
  const stroke = /\b(stroke|goditje ne tru|fytyre e varur|face droop|slurred speech|veshtiresi ne te folur|dobesi e papritur|mpirje e papritur)\b/.test(text);
  const severeBleeding = /\b(severe bleeding|heavy bleeding|gjakderdhje e rende|gjakderdhje e madhe|nuk ndalet gjak)\b/.test(text);
  const selfHarm = /\b(suicide|suicidal|kill myself|self harm|vetvras|vras veten|demtoj veten)\b/.test(text);

  if (chest && (breathing || arm)) flags.push('dhimbje_kraharori_me_frymemarrje_ose_krah');
  if (breathing && /\b(severe|shume e forte|papritur|sudden)\b/.test(text)) flags.push('veshtiresi_e_rende_ne_frymemarrje');
  if (unconscious) flags.push('humbje_e_vetedijes');
  if (stroke) flags.push('shenja_te_mundshme_te_goditjes_ne_tru');
  if (severeBleeding) flags.push('gjakderdhje_e_rende');
  if (selfHarm) flags.push('rrezik_vetedemtimi');
  return flags;
}

function chooseDepartment(text) {
  const matches = Object.entries(DEPARTMENTS)
    .map(([name, keywords]) => ({ name, hits: keywords.filter((keyword) => text.includes(keyword)).length }))
    .sort((a, b) => b.hits - a.hits);
  return matches[0]?.hits > 0 ? matches[0] : { name: 'Mjekësi e Përgjithshme', hits: 0 };
}

function mediumUrgency(text) {
  const breathing = /\b(breath|shortness|mungese ajri|manges ajri)\b/.test(text) || text.includes('frym');
  const fever = /\b(ethe|ethet|temperature|temperatur|fever)\b/.test(text);
  const rash = /\b(skuqje|rash|iritim)\b/.test(text);
  const severePain = /\b(dhimbje|dhembje|pain)\b/.test(text) && /\b(severe|shume e forte|papritur|sudden)\b/.test(text);
  const bleeding = /\b(gjakderdh|bleeding)\b/.test(text);
  return breathing || severePain || bleeding || (fever && rash);
}

function analyzeSymptoms(symptoms, normalized) {
  const redFlags = detectRedFlags(normalized);
  const department = chooseDepartment(normalized);
  const urgency = redFlags.length ? 'high' : mediumUrgency(normalized) ? 'medium' : 'low';
  const confidence = department.hits > 0 ? Math.min(95, 55 + (department.hits * 10) + (urgency === 'high' ? 18 : urgency === 'medium' ? 10 : 0)) : 28;
  const emergency = redFlags.length > 0;
  const nextSteps = emergency
    ? ['Kontaktoni menjëherë shërbimet e urgjencës ose paraqituni në urgjencën më të afërt.', 'Mos prisni përgjigje të tjera online nëse simptomat janë të rënda ose po përkeqësohen.']
    : urgency === 'medium'
      ? ['Kërkoni vlerësim nga një profesionist shëndetësor brenda 24–48 orëve.', 'Nëse simptomat përkeqësohen ose shfaqen shenja alarmi, kontaktoni urgjencën.']
      : ['Caktoni një konsultë me një profesionist shëndetësor.', 'Monitoroni simptomat dhe kërkoni ndihmë më shpejt nëse përkeqësohen.'];
  const recommendedAction = nextSteps.join(' ');

  return {
    summary: emergency
      ? 'U identifikuan shenja alarmi që kërkojnë vlerësim urgjent.'
      : department.hits > 0
        ? 'Simptomat përputhen me një kategori orientuese për zgjedhjen e departamentit.'
        : 'Simptomat nuk përputhen qartë me një departament të specializuar.',
    urgency,
    urgencyLevel: urgency,
    suggestedDepartment: emergency ? 'Urgjencë' : department.name,
    confidence,
    redFlags,
    nextSteps,
    recommendedAction,
    disclaimer: DISCLAIMER,
    source: 'rule_based',
  };
}

export function handleAnalyzeSymptoms(payload) {
  const validated = validateInput(payload);
  if (validated.status) return validated;
  return { status: 200, body: analyzeSymptoms(validated.symptoms, validated.normalized) };
}

export default async function main({ req, res, log }) {
  const startedAt = Date.now();
  const result = handleAnalyzeSymptoms(req.bodyJson);
  const urgency = result.body?.urgency || 'none';
  const durationBucket = Date.now() - startedAt < 100 ? 'lt_100ms' : 'gte_100ms';
  log(`operation=analyzeSymptoms status=${result.status} urgency=${urgency} source=rule_based duration=${durationBucket}`);
  return res.json(result.body, result.status);
}
