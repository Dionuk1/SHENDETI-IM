#!/usr/bin/env node

/**
 * Gemini API Direct Test Script
 * Tests Gemini API directly without server
 */

require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

console.log('\n🧪 TESTING GEMINI API DIRECTLY\n');
console.log('=' .repeat(60));

// Check if API key exists
if (!process.env.GEMINI_API_KEY) {
    console.log('❌ GEMINI_API_KEY not found in .env');
    console.log('📝 Add this to .env file:');
    console.log('GEMINI_API_KEY=<YOUR_GEMINI_API_KEY>');
    process.exit(1);
}

console.log('✅ API Key found\n');

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function testGeminiAPI() {
    try {
        console.log('📡 Connecting to Gemini API...\n');
        
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        // Test 1: Simple question
        console.log('Test 1️⃣  - Simple Question');
        console.log('-' .repeat(60));
        const prompt1 = 'What are the symptoms of a common cold?';
        console.log(`Query: "${prompt1}"`);
        console.log('Waiting for response...\n');
        
        const result1 = await model.generateContent(prompt1);
        const response1 = await result1.response.text();
        console.log('Response:');
        console.log(response1.substring(0, 300) + '...\n');

        // Test 2: Medical analysis (what we use in the app)
        console.log('Test 2️⃣  - Medical Symptom Analysis');
        console.log('-' .repeat(60));
        const medicalPrompt = `
You are a medical AI assistant. Analyze these symptoms:
Symptoms: Chest pain and shortness of breath
Age: 45
Medical History: Hypertension

Provide response in JSON format:
{
  "primaryConcern": "string",
  "recommendedDepartments": ["dept1", "dept2"],
  "urgencyLevel": "low|medium|high",
  "confidence": number (0-100),
  "recommendations": ["rec1", "rec2"],
  "disclaimer": "string"
}`;
        
        console.log('Query: Medical symptom analysis (Chest pain + shortness of breath)');
        console.log('Waiting for response...\n');
        
        const result2 = await model.generateContent(medicalPrompt);
        const response2 = await result2.response.text();
        console.log('Response:');
        
        // Try to parse JSON
        try {
            const jsonMatch = response2.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                console.log(JSON.stringify(parsed, null, 2));
            } else {
                console.log(response2.substring(0, 500) + '...');
            }
        } catch (e) {
            console.log(response2.substring(0, 500) + '...');
        }
        console.log('');

        // Test 3: Chat with context (RAG)
        console.log('Test 3️⃣  - Medical Chatbot');
        console.log('-' .repeat(60));
        const chatPrompt = `
You are BlueCare Medical Center chatbot assistant.

AVAILABLE DATA:
Doctors: Dr. Elena (Cardiology, Rating: 4.8/5), Dr. Arta (General, Rating: 4.5/5)
Available Services: Emergency, Cardiology, General Medicine

User Question: "Is Dr. Elena available tomorrow?"

Provide a helpful response using the available data.`;

        console.log('Query: "Is Dr. Elena available tomorrow?"');
        console.log('Waiting for response...\n');
        
        const result3 = await model.generateContent(chatPrompt);
        const response3 = await result3.response.text();
        console.log('Response:');
        console.log(response3.substring(0, 400) + '...\n');

        console.log('=' .repeat(60));
        console.log('\n✅ ALL TESTS PASSED!\n');
        console.log('Gemini API is working correctly! 🚀\n');
        console.log('Next Steps:');
        console.log('1. Start server: npm run dev');
        console.log('2. Test endpoint: POST /api/ai/analyze-symptoms');
        console.log('3. Test chatbot: Click robot icon 🤖 in browser\n');

    } catch (error) {
        console.log('❌ ERROR:', error.message);
        console.log('\nTroubleshooting:');
        console.log('1. Check .env file has GEMINI_API_KEY');
        console.log('2. Check API key format (should start with AQ.)');
        console.log('3. Check internet connection');
        console.log('4. Check Gemini API quota/rate limits\n');
        process.exit(1);
    }
}

testGeminiAPI();
