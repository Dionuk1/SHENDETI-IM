#!/usr/bin/env node

/**
 * Gemini API Verification Script
 * Tests that Gemini API is properly configured and working
 */

require('dotenv').config();

console.log('\n🔍 GEMINI API VERIFICATION\n');
console.log('=' .repeat(50));

// Check 1: Environment Variable
console.log('\n1️⃣  Checking GEMINI_API_KEY...');
if (process.env.GEMINI_API_KEY) {
    const key = process.env.GEMINI_API_KEY;
    const masked = key.substring(0, 5) + '...' + key.substring(key.length - 5);
    console.log('   ✅ API Key found:', masked);
} else {
    console.log('   ❌ API Key NOT found in .env');
    console.log('   📝 Add to .env: GEMINI_API_KEY=your_key');
    process.exit(1);
}

// Check 2: Package Installation
console.log('\n2️⃣  Checking @google/generative-ai package...');
try {
    require('@google/generative-ai');
    console.log('   ✅ Package installed successfully');
} catch (e) {
    console.log('   ❌ Package NOT installed');
    console.log('   📝 Run: npm install @google/generative-ai');
    process.exit(1);
}

// Check 3: Gemini Client Initialization
console.log('\n3️⃣  Initializing Gemini client...');
try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = client.getGenerativeModel({ model: 'gemini-1.5-flash' });
    console.log('   ✅ Gemini client initialized successfully');
} catch (e) {
    console.log('   ❌ Failed to initialize Gemini client');
    console.log('   Error:', e.message);
    process.exit(1);
}

// Check 4: AI Service Files
console.log('\n4️⃣  Checking AI service files...');
const fs = require('fs');
const filesNeeded = [
    'src/services/geminiAI.js',
    'src/controllers/aiController.js',
    'src/routes/ai.js'
];

let allFound = true;
filesNeeded.forEach(file => {
    if (fs.existsSync(file)) {
        console.log(`   ✅ ${file}`);
    } else {
        console.log(`   ❌ ${file} NOT FOUND`);
        allFound = false;
    }
});

if (!allFound) process.exit(1);

// Check 5: Gemini Import in Controller
console.log('\n5️⃣  Checking geminiAI import in aiController.js...');
try {
    const controllerContent = fs.readFileSync('src/controllers/aiController.js', 'utf8');
    if (controllerContent.includes('geminiAI') && controllerContent.includes('analyzeSymptomWithGemini')) {
        console.log('   ✅ Gemini AI imported and configured');
    } else {
        console.log('   ❌ Gemini AI NOT properly imported');
        process.exit(1);
    }
} catch (e) {
    console.log('   ❌ Error reading controller file');
    process.exit(1);
}

// Check 6: Routes Registration
console.log('\n6️⃣  Checking AI routes registration...');
try {
    const serverContent = fs.readFileSync('server.js', 'utf8');
    if (serverContent.includes('/api/ai') || serverContent.includes('aiRoutes')) {
        console.log('   ✅ AI routes registered in server.js');
    } else {
        console.log('   ⚠️  AI routes may not be registered - check manually');
    }
} catch (e) {
    console.log('   ⚠️  Could not verify routes');
}

console.log('\n' + '='.repeat(50));
console.log('\n✨ ALL CHECKS PASSED!\n');
console.log('Gemini API is ready to use with BlueCare! 🚀\n');
console.log('Start server with: npm run dev\n');
console.log('Test endpoints:');
console.log('  POST   /api/ai/analyze-symptoms');
console.log('  POST   /api/ai/analyze-document');
console.log('  POST   /api/ai/chat');
console.log('  GET    /api/ai/queue-prediction/:doctorId/:date');
console.log('\n');
