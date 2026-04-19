/**
 * LangChain-based RAG generation (optional)
 * - Uses MongoDB-retrieved context (passed in) + Gemini via LangChain
 * - Safe fallback: returns null if LangChain/Gemini not available
 */

const DEFAULT_MODEL = 'gemini-2.5-flash';

let langChainLoadPromise = null;
let langChainExports = null;

function normalizeModelName(name) {
	if (!name) return null;
	const trimmed = String(name).trim();
	if (!trimmed || trimmed.toLowerCase() === 'auto') return null;
	return trimmed.startsWith('models/') ? trimmed.slice('models/'.length) : trimmed;
}

function buildContextString(retrievedData) {
	const parts = [];

	const doctors = Array.isArray(retrievedData?.doctors) ? retrievedData.doctors : [];
	if (doctors.length > 0) {
		const list = doctors
			.slice(0, 5)
			.map((d) => {
				const name = d?.name || 'Pa emër';
				const spec = d?.specialization ? ` (${d.specialization})` : '';
				const schedule = d?.schedule ? ` | Orari: ${d.schedule}` : '';
				const services = Array.isArray(d?.services) && d.services.length > 0
					? ` | Shërbime: ${d.services.slice(0, 5).join(', ')}`
					: '';
				return `- ${name}${spec}${schedule}${services}`;
			})
			.join('\n');
		parts.push(`DOKTORËT (nga databaza):\n${list}`);
	}

	const appointments = Array.isArray(retrievedData?.appointments) ? retrievedData.appointments : [];
	if (appointments.length > 0) {
		const list = appointments
			.slice(0, 5)
			.map((a) => {
				const when = a?.scheduledAt ? new Date(a.scheduledAt).toISOString() : 'Pa datë';
				const status = a?.status || 'unknown';
				return `- ${when} | status: ${status}`;
			})
			.join('\n');
		parts.push(`TERMINET E PËRDORUESIT (nga databaza):\n${list}`);
	}

	const sources = Array.isArray(retrievedData?.sources) ? retrievedData.sources : [];
	if (sources.length > 0) {
		parts.push(`BURIMET: ${sources.join(', ')}`);
	}

	return parts.length > 0 ? parts.join('\n\n') : 'Nuk u gjetën të dhëna relevante në databazë për këtë pyetje.';
}

async function loadLangChain() {
	if (langChainExports) return langChainExports;
	if (langChainLoadPromise) return langChainLoadPromise;

	langChainLoadPromise = (async () => {
		try {
			const [{ ChatGoogleGenerativeAI }, { SystemMessage, HumanMessage }] = await Promise.all([
				import('@langchain/google-genai'),
				import('@langchain/core/messages'),
			]);

			langChainExports = { ChatGoogleGenerativeAI, SystemMessage, HumanMessage };
			return langChainExports;
		} catch {
			langChainExports = null;
			return null;
		} finally {
			// allow retry if we couldn't load
			if (!langChainExports) langChainLoadPromise = null;
		}
	})();

	return langChainLoadPromise;
}

/**
 * @returns {Promise<string|null>} AI response, or null if LangChain/Gemini isn't available
 */
async function chatWithLangChainRAG(message, retrievedData) {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) return null;

	const lc = await loadLangChain();
	if (!lc) return null;

	const { ChatGoogleGenerativeAI, SystemMessage, HumanMessage } = lc;

	const modelName = normalizeModelName(process.env.GEMINI_MODEL) || DEFAULT_MODEL;
	const model = new ChatGoogleGenerativeAI({
		apiKey,
		model: modelName,
		temperature: 0.3,
	});

	const contextString = buildContextString(retrievedData);

	const system = [
		'Je një asistent mjekësor për BlueCare Medical Center.',
		'Përdor kontekstin nga databaza kur është i disponueshëm.',
		'Përgjigju vetëm në shqip.',
		'Mos jep diagnozë përfundimtare; nëse është urgjente/simptoma të rënda, sugjero urgjencën ose konsultë profesionale.',
	].join(' ');

	const user =
		`PYETJA E PËRDORUESIT:\n${String(message || '').trim()}\n\n` +
		`KONTEKSTI (nga MongoDB):\n${contextString}\n\n` +
		'Udhëzime:\n' +
		'1) Jep përgjigje të shkurtër dhe të saktë\n' +
		'2) Nëse pyet për orare/termine, referohu të dhënave\n' +
		'3) Nëse mungojnë të dhënat, kërko sqarim ose sugjero kontakt\n';

	const result = await model.invoke([new SystemMessage(system), new HumanMessage(user)]);

	if (typeof result?.content === 'string') return result.content;
	if (Array.isArray(result?.content)) {
		return result.content
			.map((c) => (typeof c === 'string' ? c : (c && c.text ? c.text : '')))
			.join('');
	}

	return String(result?.content || '').trim() || null;
}

module.exports = {
	chatWithLangChainRAG,
};
