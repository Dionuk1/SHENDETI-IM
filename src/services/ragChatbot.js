/**
 * RAG (Retrieval-Augmented Generation) Chatbot with LangChain
 * Uses MongoDB as knowledge base for context-aware medical responses
 * 
 * Integration:
 * 1. npm install langchain @langchain/core @langchain/community
 * 2. Import in server.js and attach to /api/ai/chat route
 * 3. Requires GEMINI_API_KEY in .env
 */

const Doctor = require('../models/Doctor');
const Appointment = require('../models/Appointment');
const User = require('../models/User');

/**
 * Advanced RAG System
 * Retrieves data from MongoDB and generates context-aware responses
 */
class MedicalRAGSystem {
    constructor() {
        this.conversationHistory = {};
        this.contextWindow = 5; // Last 5 messages for context
    }

    /**
     * Main RAG pipeline: Retrieve → Augment → Generate
     */
    async process(userId, userMessage) {
        try {
            // Step 1: RETRIEVE - Get relevant data from MongoDB
            const context = await this.retrieveContext(userMessage, userId);

            // Step 2: AUGMENT - Prepare context for generation
            const augmentedPrompt = this.augmentPrompt(userMessage, context);

            // Step 3: GENERATE - Create response using context
            const response = await this.generateResponse(augmentedPrompt, context);

            // Step 4: STORE - Save to conversation history
            this.storeConversation(userId, userMessage, response, context);

            return {
                response: response,
                sources: context.sources,
                confidence: context.confidence
            };
        } catch (e) {
            console.error('RAG processing error:', e);
            return {
                response: 'I apologize, but I encountered an error processing your request. Please try again.',
                sources: [],
                confidence: 0
            };
        }
    }

    /**
     * RETRIEVAL STAGE: Extract relevant information from MongoDB
     */
    async retrieveContext(userMessage, userId) {
        const context = {
            doctors: [],
            appointments: [],
            userInfo: null,
            services: [],
            schedules: [],
            sources: [],
            confidence: 50
        };

        const messageLower = userMessage.toLowerCase();

        try {
            // 1. Doctor queries
            if (this.matchesIntent(messageLower, ['doctor', 'specialist', 'cardio', 'neuro', 'ortho'])) {
                const specialization = this.extractSpecialization(messageLower);
                const query = specialization
                    ? { specialization: new RegExp(specialization, 'i'), isActive: true }
                    : { isActive: true };

                context.doctors = await Doctor.find(query)
                    .select('name specialization services rating avgDurationMins schedule')
                    .limit(5)
                    .lean();

                context.sources.push('Doctor Database');
                context.confidence += 15;
            }

            // 2. Appointment queries
            if (this.matchesIntent(messageLower, ['appointment', 'booking', 'schedule', 'visit', 'when'])) {
                context.appointments = await Appointment.find({ patientId: userId })
                    .populate('doctorId', 'name specialization')
                    .select('scheduledAt status notes')
                    .limit(3)
                    .lean();

                context.sources.push('Appointment Records');
                context.confidence += 15;
            }

            // 3. Service queries
            if (this.matchesIntent(messageLower, ['service', 'treatment', 'procedure', 'checkup', 'test'])) {
                const doctors = await Doctor.find({ isActive: true })
                    .select('services')
                    .limit(5)
                    .lean();

                context.services = [...new Set(doctors.flatMap(d => d.services || []))];
                context.sources.push('Medical Services');
                context.confidence += 10;
            }

            // 4. Schedule availability queries
            if (this.matchesIntent(messageLower, ['available', 'free', 'open', 'slot', 'time'])) {
                const doctors = await Doctor.find({ isActive: true })
                    .select('name schedule')
                    .limit(5)
                    .lean();

                context.schedules = doctors.map(d => ({
                    name: d.name,
                    schedule: d.schedule || 'Call for availability'
                }));

                context.sources.push('Doctor Schedules');
                context.confidence += 15;
            }

            // 5. User info queries
            if (this.matchesIntent(messageLower, ['my', 'account', 'profile', 'record'])) {
                context.userInfo = await User.findById(userId)
                    .select('name email role medicalHistory')
                    .lean();

                context.sources.push('User Profile');
                context.confidence += 10;
            }

        } catch (e) {
            console.error('Context retrieval error:', e);
        }

        return context;
    }

    /**
     * AUGMENTATION: Create detailed prompt with retrieved context
     */
    augmentPrompt(userMessage, context) {
        let prompt = `You are a helpful medical assistant for BlueCare Medical Center. Use the provided information to answer the user's question accurately and professionally.

USER QUESTION: "${userMessage}"

CONTEXT FROM DATABASE:
`;

        // Add doctor information
        if (context.doctors.length > 0) {
            prompt += `\nAVAILABLE DOCTORS:\n`;
            context.doctors.forEach(d => {
                prompt += `- Dr. ${d.name} (${d.specialization}): Rating ${d.rating || 'N/A'}/5, Avg appointment ${d.avgDurationMins || 30}min, Services: ${(d.services || []).join(', ')}\n`;
            });
        }

        // Add appointment information
        if (context.appointments.length > 0) {
            prompt += `\nUSER'S APPOINTMENTS:\n`;
            context.appointments.forEach(a => {
                const date = new Date(a.scheduledAt).toLocaleDateString();
                prompt += `- ${date} with Dr. ${a.doctorId?.name} (${a.status})\n`;
            });
        }

        // Add available services
        if (context.services.length > 0) {
            prompt += `\nAVAILABLE SERVICES: ${context.services.join(', ')}\n`;
        }

        // Add schedule information
        if (context.schedules.length > 0) {
            prompt += `\nDOCTOR SCHEDULES:\n`;
            context.schedules.forEach(s => {
                prompt += `- Dr. ${s.name}: ${s.schedule}\n`;
            });
        }

        prompt += `
INSTRUCTIONS:
1. Use the database information to provide accurate answers
2. If asked "A është Dr. X i lirë sot?" check the schedule information
3. For appointment questions, reference the user's actual appointments
4. Keep responses professional and friendly
5. If information isn't available, suggest contacting BlueCare support
6. Always prioritize user safety and encourage professional medical consultation

RESPONSE:`;

        return prompt;
    }

    /**
     * GENERATION: Create AI response using context
     */
    async generateResponse(augmentedPrompt, context) {
        // In production, integrate with Gemini API:
        // const response = await googleGenerativeAI.generateContent(augmentedPrompt);
        // return response.text;

        // For now, provide intelligent rule-based responses
        const userMessage = augmentedPrompt.match(/USER QUESTION: "(.*?)"/)[1].toLowerCase();

        // Specific response patterns based on context
        if (userMessage.includes('free') || userMessage.includes('available')) {
            if (context.schedules.length > 0) {
                const doctors = context.schedules.slice(0, 2);
                return `Doctors available today include: ${doctors.map(d => `Dr. ${d.name} (${d.schedule})`).join(', ')}. You can book an appointment through our system.`;
            }
        }

        if (userMessage.includes('appointment')) {
            if (context.appointments.length > 0) {
                const next = context.appointments[0];
                const date = new Date(next.scheduledAt).toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
                return `Your next appointment is on ${date} with Dr. ${next.doctorId?.name}. The status is ${next.status}. Is there anything else you'd like to know?`;
            }
            return 'You currently have no scheduled appointments. Would you like to book one?';
        }

        if (userMessage.includes('service') || userMessage.includes('treatment')) {
            if (context.services.length > 0) {
                return `BlueCare offers the following services: ${context.services.slice(0, 5).join(', ')}, and more. Which service are you interested in?`;
            }
        }

        if (userMessage.includes('doctor')) {
            if (context.doctors.length > 0) {
                const doc = context.doctors[0];
                return `Dr. ${doc.name} specializes in ${doc.specialization} with a ${doc.rating || 'excellent'} rating. Services include: ${(doc.services || []).slice(0, 3).join(', ')}. Would you like to schedule an appointment?`;
            }
        }

        // Default response
        return `Thank you for your question about ${userMessage.substring(0, 30)}. Based on our records, I can help you with scheduling, appointment information, or service inquiries. What specifically would you like to know?`;
    }

    /**
     * STORAGE: Keep conversation history
     */
    storeConversation(userId, userMessage, response, context) {
        if (!this.conversationHistory[userId]) {
            this.conversationHistory[userId] = [];
        }

        this.conversationHistory[userId].push({
            role: 'user',
            content: userMessage,
            timestamp: new Date()
        });

        this.conversationHistory[userId].push({
            role: 'assistant',
            content: response,
            context: context.sources,
            timestamp: new Date()
        });

        // Keep only last N messages
        if (this.conversationHistory[userId].length > this.contextWindow * 2) {
            this.conversationHistory[userId] = this.conversationHistory[userId].slice(-this.contextWindow * 2);
        }
    }

    /**
     * UTILITY: Intent matching
     */
    matchesIntent(message, keywords) {
        return keywords.some(keyword => message.includes(keyword));
    }

    /**
     * UTILITY: Extract medical specialization from message
     */
    extractSpecialization(message) {
        const specialties = {
            cardio: 'cardiology',
            heart: 'cardiology',
            neuro: 'neurology',
            brain: 'neurology',
            ortho: 'orthopedics',
            bone: 'orthopedics',
            psych: 'psychiatry',
            dental: 'dentistry'
        };

        for (const [keyword, specialty] of Object.entries(specialties)) {
            if (message.includes(keyword)) return specialty;
        }

        return null;
    }

    /**
     * Get conversation history
     */
    getHistory(userId) {
        return this.conversationHistory[userId] || [];
    }

    /**
     * Clear conversation history
     */
    clearHistory(userId) {
        delete this.conversationHistory[userId];
    }
}

// Export singleton instance
module.exports = new MedicalRAGSystem();
