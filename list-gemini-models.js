#!/usr/bin/env node

/**
 * Check available Gemini models
 */

require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

console.log('\n🔍 Checking Available Gemini Models\n');

if (!process.env.GEMINI_API_KEY) {
    console.log('❌ No GEMINI_API_KEY in .env');
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function listModels() {
    try {
        const models = await genAI.listModels();
        console.log('Available Models:');
        console.log('=' .repeat(60));
        
        for await (const model of models) {
            console.log(`\n📦 ${model.name}`);
            console.log(`   Version: ${model.version}`);
            if (model.description) console.log(`   Description: ${model.description}`);
        }
        
    } catch (error) {
        console.log('❌ Error listing models:', error.message);
        console.log('\nNote: Free Gemini API key has limited model access.');
        console.log('Common available models:');
        console.log('- gemini-pro (free tier)');
        console.log('- gemini-1.5-pro (with API key)');
        console.log('- gemini-1.5-flash (newer, requires updates)\n');
    }
}

listModels();
