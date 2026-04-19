#!/usr/bin/env node

/**
 * Gemini API Test - Uses Compatible Model
 */

require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

console.log('\n🧪 TESTING GEMINI API\n');
console.log('=' .repeat(60));

if (!process.env.GEMINI_API_KEY) {
    console.log('❌ GEMINI_API_KEY not found in .env\n');
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Try different models that work with free tier
const models = ['gemini-pro', 'gemini-1.5-flash', 'gemini-1.5-pro'];

async function testGemini() {
    let success = false;
    let usedModel = null;

    for (const modelName of models) {
        try {
            console.log(`\n🔄 Trying model: ${modelName}`);
            const model = genAI.getGenerativeModel({ model: modelName });
            
            // Simple test
            const result = await model.generateContent('Say hello in one word');
            const response = await result.response.text();
            
            console.log(`✅ SUCCESS with ${modelName}!`);
            console.log(`Response: ${response}\n`);
            success = true;
            usedModel = modelName;
            break;
        } catch (error) {
            console.log(`❌ Failed: ${error.message.substring(0, 80)}`);
        }
    }

    if (!success) {
        console.log('\n❌ No models available with this API key\n');
        console.log('Troubleshooting:');
        console.log('1. API key might be invalid or revoked');
        console.log('2. Try getting a new key from: https://makersuite.google.com/app/apikey');
        console.log('3. Wait a few minutes after creating key before using\n');
        process.exit(1);
    }

    // Now test medical analysis
    console.log('=' .repeat(60));
    console.log(`\n✅ Using model: ${usedModel}\n`);
    
    try {
        console.log('📋 Testing Medical Symptom Analysis...\n');
        const model = genAI.getGenerativeModel({ model: usedModel });
        
        const medicalPrompt = `Analyze these symptoms: chest pain and shortness of breath.
Patient age: 45. Medical history: hypertension.
Respond in this format:
Concern: [primary concern]
Departments: [recommended]
Urgency: [low/medium/high]
Confidence: [0-100]`;

        const result = await model.generateContent(medicalPrompt);
        const response = await result.response.text();
        
        console.log('AI Response:');
        console.log(response);
        console.log('\n' + '=' .repeat(60));
        console.log('\n✅ GEMINI API IS WORKING!\n');
        console.log('Model being used: ' + usedModel);
        console.log('\nNext: Update geminiAI.js to use: ' + usedModel);
        
    } catch (error) {
        console.log('❌ Analysis failed:', error.message);
    }
}

testGemini();
