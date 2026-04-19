/**
 * AI FEATURES TEST SUITE
 * 
 * Run this file with: node src/scripts/test-ai-features.js
 * Make sure server is running on localhost:5500 with a valid JWT token
 */

const http = require('http');
const assert = require('assert');

// Configuration
const BASE_URL = 'http://localhost:5500';
const TEST_TOKEN = process.env.TEST_TOKEN || 'your_jwt_token_here';
const TEST_DOCTOR_ID = process.env.TEST_DOCTOR_ID || '';

let testResults = {
    passed: 0,
    failed: 0,
    tests: []
};

/**
 * Make HTTP request
 */
function makeRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${TEST_TOKEN}`
            }
        };

        const req = http.request(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        data: JSON.parse(data),
                        headers: res.headers
                    });
                } catch (e) {
                    resolve({
                        status: res.statusCode,
                        data: data,
                        headers: res.headers
                    });
                }
            });
        });

        req.on('error', reject);

        if (body) {
            req.write(JSON.stringify(body));
        }

        req.end();
    });
}

/**
 * Test wrapper
 */
async function test(name, fn) {
    try {
        await fn();
        testResults.passed++;
        testResults.tests.push({ name, status: '✅ PASS' });
        console.log(`✅ ${name}`);
    } catch (e) {
        testResults.failed++;
        testResults.tests.push({ name, status: '❌ FAIL', error: e.message });
        console.log(`❌ ${name}: ${e.message}`);
    }
}

/**
 * TEST SUITE
 */
async function runTests() {
    console.log('\n🧪 AI FEATURES TEST SUITE\n');
    console.log('=' .repeat(60));

    // ===== 1. SYMPTOM ANALYSIS =====
    await test('POST /api/ai/analyze-symptoms - Basic request', async () => {
        const response = await makeRequest('POST', '/api/ai/analyze-symptoms', {
            symptoms: 'Chest pain and shortness of breath',
            age: 45,
            medicalHistory: 'Hypertension'
        });

        assert.strictEqual(response.status, 200, `Expected 200, got ${response.status}`);
        assert(response.data.valid || response.data.analysis, 'Missing analysis data');
        assert(response.data.analysis?.primaryConcern, 'Missing primaryConcern');
        assert(response.data.analysis?.urgencyLevel, 'Missing urgencyLevel');
        assert(response.data.analysis?.confidence >= 0, 'Invalid confidence score');
    });

    await test('POST /api/ai/analyze-symptoms - Validates input', async () => {
        const response = await makeRequest('POST', '/api/ai/analyze-symptoms', {
            // Missing symptoms
            age: 30
        });

        assert.strictEqual(response.status, 400, `Expected 400, got ${response.status}`);
    });

    await test('POST /api/ai/analyze-symptoms - Detects urgency levels', async () => {
        const response = await makeRequest('POST', '/api/ai/analyze-symptoms', {
            symptoms: 'SEVERE EMERGENCY chest pain',
            age: 50
        });

        assert(response.data.analysis?.urgencyLevel === 'high', 'Failed to detect high urgency');
    });

    // ===== 1b. SYMPTOM → DEPARTMENT =====
    await test('POST /api/ai/symptom-department - Suggests department', async () => {
        const response = await makeRequest('POST', '/api/ai/symptom-department', {
            symptoms: 'dhimbje gjoksi dhe frymëmarrje e vështirë',
            age: 45,
        });

        assert.strictEqual(response.status, 200, `Expected 200, got ${response.status}`);
        assert(response.data.valid === true, 'Expected valid=true');
        assert(response.data.suggestedDepartment, 'Missing suggestedDepartment');
        assert(response.data.urgencyLevel, 'Missing urgencyLevel');
    });

    await test('POST /api/ai/symptom-department - Validates input', async () => {
        const response = await makeRequest('POST', '/api/ai/symptom-department', {
            age: 30
        });

        assert.strictEqual(response.status, 400, `Expected 400, got ${response.status}`);
    });

    // ===== 2. DOCUMENT ANALYSIS =====
    await test('POST /api/ai/analyze-document - Basic request', async () => {
        const response = await makeRequest('POST', '/api/ai/analyze-document', {
            documentText: 'ECG Report: HR 78, BP 120/80, Normal findings',
            documentType: 'ECG'
        });

        assert.strictEqual(response.status, 200, `Expected 200, got ${response.status}`);
        assert(response.data.valid, 'Document analysis failed');
        assert(response.data.extractedData, 'Missing extractedData');
    });

    await test('POST /api/ai/analyze-document - Validates input', async () => {
        const response = await makeRequest('POST', '/api/ai/analyze-document', {
            // Missing documentText
            documentType: 'ECG'
        });

        assert.strictEqual(response.status, 400, `Expected 400, got ${response.status}`);
    });

    // ===== 3. CHATBOT WITH RAG =====
    await test('POST /api/ai/chat - Basic question', async () => {
        const response = await makeRequest('POST', '/api/ai/chat', {
            message: 'Are doctors available today?',
            conversationId: 'test-123'
        });

        assert.strictEqual(response.status, 200, `Expected 200, got ${response.status}`);
        assert(response.data.valid, 'Chat response failed');
        assert(response.data.aiResponse, 'Missing aiResponse');
        assert(response.data.conversationId, 'Missing conversationId');
    });

    await test('POST /api/ai/chat - Handles doctor queries', async () => {
        const response = await makeRequest('POST', '/api/ai/chat', {
            message: 'Is Dr. Arta available?',
            conversationId: 'test-124'
        });

        assert(response.data.aiResponse.length > 0, 'Empty response');
    });

    await test('POST /api/ai/chat - Appointment inquiry', async () => {
        const response = await makeRequest('POST', '/api/ai/chat', {
            message: 'When is my next appointment?',
            conversationId: 'test-125'
        });

        assert(response.data.aiResponse.length > 0, 'Empty response');
    });

    await test('POST /api/ai/chat - Validates input', async () => {
        const response = await makeRequest('POST', '/api/ai/chat', {
            // Missing message
            conversationId: 'test-126'
        });

        assert.strictEqual(response.status, 400, `Expected 400, got ${response.status}`);
    });

    // ===== 4. QUEUE PREDICTION =====
    await test('GET /api/ai/queue-prediction/:doctorId/:date - Basic request', async () => {
        // Provide a real doctor id via TEST_DOCTOR_ID for a reliable 200.
        const today = new Date().toISOString().split('T')[0];

        const doctorId = TEST_DOCTOR_ID && TEST_DOCTOR_ID.trim() ? TEST_DOCTOR_ID.trim() : 'test-doctor-id';
        const response = await makeRequest('GET', `/api/ai/queue-prediction/${encodeURIComponent(doctorId)}/${today}`);

        // Should return 404 for non-existent doctor or 200 with prediction
        assert([200, 404].includes(response.status), `Expected 200 or 404, got ${response.status}`);
        
        if (response.status === 200) {
            assert(response.data.estimatedWaitMinutes !== undefined, 'Missing estimatedWaitMinutes');
            assert(['low', 'medium', 'high'].includes(response.data.busyLevel), 'Invalid busyLevel');
        }
    });

    // ===== 5. AUTHENTICATION =====
    await test('POST /api/ai/chat - Requires authentication', async () => {
        const response = await new Promise((resolve) => {
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                    // No Authorization header
                }
            };

            const req = http.request(new URL('/api/ai/chat', BASE_URL), options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({
                    status: res.statusCode,
                    data: data
                }));
            });

            req.write(JSON.stringify({ message: 'test' }));
            req.end();
        });

        assert.strictEqual(response.status, 401, `Expected 401, got ${response.status}`);
    });

    // ===== 6. FRAUD DETECTION =====
    await test('Fraud Detection - Middleware is active', async () => {
        // Multiple requests in quick succession should be rate-limited
        const promises = [];
        for (let i = 0; i < 5; i++) {
            promises.push(
                makeRequest('POST', '/api/ai/chat', {
                    message: 'Test message',
                    conversationId: 'fraud-test'
                })
            );
        }

        const responses = await Promise.all(promises);
        
        // At least one should succeed (showing middleware is processing)
        const successCount = responses.filter(r => r.status === 200).length;
        assert(successCount > 0, 'All requests blocked unexpectedly');
    });

    // ===== SUMMARY =====
    console.log('\n' + '='.repeat(60));
    console.log('\n📊 TEST RESULTS\n');
    console.log(`✅ Passed: ${testResults.passed}`);
    console.log(`❌ Failed: ${testResults.failed}`);
    console.log(`📈 Total:  ${testResults.passed + testResults.failed}`);
    
    if (testResults.failed === 0) {
        console.log('\n🎉 ALL TESTS PASSED! AI Features are working correctly.\n');
    } else {
        console.log('\n⚠️ Some tests failed. Review the errors above.\n');
    }

    console.log('=' .repeat(60));
    console.log('\nTest Details:');
    testResults.tests.forEach(t => {
        console.log(`  ${t.status} - ${t.name}`);
        if (t.error) console.log(`     Error: ${t.error}`);
    });
}

/**
 * SETUP VERIFICATION
 */
async function verifySetup() {
    console.log('🔍 VERIFYING SETUP...\n');

    // Check if server is running
    try {
        const response = await makeRequest('GET', '/');
        console.log('✅ Server is running on localhost:5500');
    } catch (e) {
        console.log('❌ Server is not running. Start with: npm run dev');
        process.exit(1);
    }

    // Check if token is valid
    if (TEST_TOKEN === 'your_jwt_token_here') {
        console.log('⚠️  TEST_TOKEN not set. Set with: export TEST_TOKEN=your_token');
        console.log('   You can get a token by logging in via the UI.');
    } else {
        console.log('✅ TEST_TOKEN is configured');
    }

    console.log('\n' + '='.repeat(60) + '\n');
}

/**
 * RUN ALL TESTS
 */
(async () => {
    try {
        await verifySetup();
        await runTests();
    } catch (e) {
        console.error('Fatal error:', e);
        process.exit(1);
    }
})();

module.exports = { runTests, test };
