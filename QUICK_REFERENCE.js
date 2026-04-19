/**
 * QUICK REFERENCE GUIDE - AI Features Command Library
 * ===================================================
 * 
 * Copy-paste examples for common tasks
 */

// ========== SECTION 1: BACKEND SETUP ==========

// File: server.js - Add at TOP (after const express = require('express'))
const aiRoutes = require('./routes/ai');
const { fraudDetectionMiddleware } = require('./middleware/fraudDetection');

// File: server.js - Add EARLY in middleware (after app = express())
app.use(express.json());
app.use(cors());
app.use(fraudDetectionMiddleware);  // ← ADD THIS LINE

// File: server.js - Add with OTHER ROUTES (after mongoose.connect)
app.use('/api/ai', aiRoutes);

// That's it! Now all 4 AI features are active.

// ========== SECTION 2: FRONTEND - QUICK ADD TO index.html ==========

/* 
Add this button to navbar or dashboard:
<button onclick="openAIChatbot()" style="background: #1e40af; color: white; padding: 10px 15px; border: none; border-radius: 6px; cursor: pointer;">
  💬 Ask AI
</button>

Then add this HTML element before </body>:
<div id="aiChatModal" style="display: none; position: fixed; width: 400px; height: 500px; right: 20px; bottom: 20px; background: white; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.2); z-index: 1000; flex-direction: column; display: none;">
    <div style="padding: 15px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
        <h4 style="margin: 0;">🏥 BlueCare AI Assistant</h4>
        <button onclick="document.getElementById('aiChatModal').style.display = 'none';" style="background: none; border: none; font-size: 20px; cursor: pointer;">×</button>
    </div>
    <div id="chatBox" style="flex: 1; overflow-y: auto; padding: 15px; background: #f5f5f5;"></div>
    <div style="padding: 10px; border-top: 1px solid #eee; display: flex; gap: 5px;">
        <input id="chatInput" type="text" placeholder="Ask me anything..." style="flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
        <button onclick="sendChatMessage()" style="padding: 10px 15px; background: #1e40af; color: white; border: none; border-radius: 4px; cursor: pointer;">Send</button>
    </div>
</div>

Then add this JavaScript before </script>:
*/

// Copy all the functions from AI_FRONTEND_INTEGRATION.js and paste into your index.html <script>

// ========== SECTION 3: COPY-PASTE CODE BLOCKS ==========

// ← COPY FROM HERE ← COPY FROM HERE ← COPY FROM HERE

// 1. Update Doctor Cards with Queue Prediction
function initializeDoctorQueues() {
    const doctors = document.querySelectorAll('[data-doctor-id]');
    doctors.forEach(doc => {
        const doctorId = doc.getAttribute('data-doctor-id');
        const today = new Date().toISOString().split('T')[0];
        
        fetch(`/api/ai/queue-prediction/${doctorId}/${today}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        })
        .then(r => r.json())
        .then(prediction => {
            const elem = doc.querySelector('[data-queue-status]');
            if (elem && prediction.estimatedWaitMinutes !== undefined) {
                const color = prediction.busyLevel === 'high' ? '#d32f2f' :
                             prediction.busyLevel === 'medium' ? '#f57c00' : '#4caf50';
                elem.innerHTML = `
                    <span style="color: ${color}; font-weight: bold;">
                        ${prediction.busyLevel.toUpperCase()} - ${prediction.estimatedWaitMinutes}min wait
                    </span>
                    <br><small>${prediction.recommendation}</small>
                `;
            }
        })
        .catch(e => console.error('Queue error:', e));
    });
}

// Call on dashboard load:
document.addEventListener('DOMContentLoaded', initializeDoctorQueues);

// 2. Add Symptom Analysis to "Symptom Quick-Check" Tab
function addSymptomAnalysisToUI() {
    const symptomTab = document.getElementById('symptomQuickCheck') || 
                      document.querySelector('[data-tab="symptom"]');
    
    if (symptomTab) {
        const analysisHTML = `
            <div style="max-width: 500px; margin: 20px auto;">
                <h3>Symptom Analysis with AI</h3>
                <div style="background: #f5f5f5; padding: 20px; border-radius: 8px;">
                    <input id="symptomInput" type="text" placeholder="Describe your symptoms..." 
                           style="width: 100%; padding: 10px; margin-bottom: 10px; border: 1px solid #ddd; border-radius: 4px;">
                    <input id="ageInput" type="number" placeholder="Your age" 
                           style="width: 100%; padding: 10px; margin-bottom: 10px; border: 1px solid #ddd; border-radius: 4px;">
                    <button onclick="analyzeSymptomsFrontend()" 
                            style="width: 100%; padding: 10px; background: #1e40af; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
                        🔍 Analyze Symptoms
                    </button>
                </div>
                <div id="analysisResults" style="margin-top: 20px;"></div>
            </div>
        `;
        symptomTab.innerHTML = analysisHTML;
    }
}

document.addEventListener('DOMContentLoaded', addSymptomAnalysisToUI);

// 3. Quick Chatbot Integration (Single Line Button)
function addChatbotButton() {
    const navbar = document.querySelector('nav') || document.querySelector('header');
    if (navbar) {
        const chatBtn = document.createElement('button');
        chatBtn.innerHTML = '💬 AI Assistant';
        chatBtn.onclick = openAIChatbot;
        chatBtn.style.cssText = 'margin: 0 10px; padding: 8px 15px; background: #1e40af; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;';
        navbar.appendChild(chatBtn);
    }
}

document.addEventListener('DOMContentLoaded', addChatbotButton);

// 4. Show Queue Prediction on Doctor Cards
function updateAllDoctorQueues() {
    document.querySelectorAll('[data-doctor-id]').forEach(async card => {
        const doctorId = card.getAttribute('data-doctor-id');
        const today = new Date().toISOString().split('T')[0];
        
        try {
            const resp = await fetch(`/api/ai/queue-prediction/${doctorId}/${today}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            const pred = await resp.json();
            
            const queueElem = card.querySelector('[data-queue]');
            if (queueElem) {
                const color = pred.busyLevel === 'high' ? '#ff5252' : 
                             pred.busyLevel === 'medium' ? '#ff9800' : '#4caf50';
                queueElem.innerHTML = `
                    <div style="padding: 10px; background: ${color}30; border-radius: 6px; border-left: 4px solid ${color};">
                        <div style="font-weight: bold; color: ${color};">⏱️ ${pred.estimatedWaitMinutes} min wait</div>
                        <div style="font-size: 12px; color: #666; margin-top: 5px;">${pred.recommendation}</div>
                    </div>
                `;
            }
        } catch (e) {
            console.error('Queue update error:', e);
        }
    });
}

setInterval(updateAllDoctorQueues, 5 * 60 * 1000); // Update every 5 minutes

// 5. Symptom Analyzer Pop-up Window
function openSymptomAnalyzer() {
    const modal = document.createElement('div');
    modal.id = 'symptomModal';
    modal.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        width: 90%; max-width: 400px; z-index: 1000;
    `;
    modal.innerHTML = `
        <h3 style="margin-top: 0;">Analyze Your Symptoms</h3>
        <input id="symptomInput2" type="text" placeholder="Describe your symptoms..." 
               style="width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
        <input id="ageInput2" type="number" placeholder="Age" 
               style="width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
        <button onclick="analyzeSymptomModal()" style="width: 100%; padding: 10px; background: #1e40af; color: white; border: none; border-radius: 4px; cursor: pointer;">Analyze</button>
        <button onclick="document.getElementById('symptomModal').remove()" style="width: 100%; padding: 10px; margin-top: 10px; background: #e0e0e0; border: none; border-radius: 4px; cursor: pointer;">Close</button>
        <div id="symptomModalResults" style="margin-top: 15px;"></div>
    `;
    document.body.appendChild(modal);
    
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 999;';
    overlay.onclick = () => { overlay.remove(); modal.remove(); };
    document.body.appendChild(overlay);
}

async function analyzeSymptomModal() {
    const symptoms = document.getElementById('symptomInput2').value;
    const age = document.getElementById('ageInput2').value;
    
    const resp = await fetch('/api/ai/analyze-symptoms', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ symptoms, age: parseInt(age) })
    });
    const data = await resp.json();
    
    const resultsDiv = document.getElementById('symptomModalResults');
    resultsDiv.innerHTML = `
        <div style="background: #e8f5e9; padding: 15px; border-radius: 6px;">
            <p><strong>Primary Concern:</strong> ${data.analysis.primaryConcern}</p>
            <p><strong>Recommended Departments:</strong> ${data.analysis.recommendedDepartments.join(', ')}</p>
            <p><strong>Urgency:</strong> <span style="color: ${data.analysis.urgencyLevel === 'high' ? '#d32f2f' : '#f57c00'};">${data.analysis.urgencyLevel.toUpperCase()}</span></p>
            <p><strong>Confidence:</strong> ${data.analysis.confidence}%</p>
        </div>
    `;
}

// 6. Monitor Fraud Detection (For Admins)
async function checkSecurityStatus() {
    const resp = await fetch('/api/admin/security-status', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    const status = await resp.json();
    
    console.log('Blocked IPs:', status.blockedIPs);
    console.log('Blocked Count:', status.blockedIPsCount);
    
    // Display in admin dashboard
    const elem = document.getElementById('securityStatus');
    if (elem) {
        elem.innerHTML = `
            <div style="background: ${status.blockedIPsCount > 0 ? '#ffebee' : '#e8f5e9'}; padding: 15px; border-radius: 6px;">
                <p><strong>🔒 Security Status</strong></p>
                <p>Blocked IPs: ${status.blockedIPsCount}</p>
                ${status.blockedIPsCount > 0 ? `<p style="color: #d32f2f;"><strong>⚠️ Active blocks:</strong> ${status.blockedIPs.join(', ')}</p>` : ''}
            </div>
        `;
    }
}

// Refresh every 30 seconds (for admin)
setInterval(checkSecurityStatus, 30 * 1000);

// 7. Test API Endpoint (For Development)
async function testAIEndpoints() {
    console.log('Testing AI Endpoints...');
    
    const token = localStorage.getItem('token');
    
    // Test 1: Symptom Analysis
    console.log('Test 1: Symptom Analysis');
    const symptomResp = await fetch('/api/ai/analyze-symptoms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ symptoms: 'Chest pain', age: 40 })
    });
    console.log('Symptom Response:', await symptomResp.json());
    
    // Test 2: Chat
    console.log('Test 2: AI Chat');
    const chatResp = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ message: 'Are doctors available today?', conversationId: 'test' })
    });
    console.log('Chat Response:', await chatResp.json());
    
    console.log('✅ All AI endpoints working!');
}

// Run tests: testAIEndpoints()

// ← COPY UNTIL HERE ← COPY UNTIL HERE ← COPY UNTIL HERE

// ========== SECTION 4: COMMON PATTERNS ==========

// Pattern 1: Loading Spinner while AI is Processing
function showLoadingSpinner(elementId) {
    document.getElementById(elementId).innerHTML = `
        <div style="text-align: center; padding: 20px;">
            <div style="border: 4px solid #f3f3f3; border-top: 4px solid #1e40af; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto;"></div>
            <p style="color: #666; margin-top: 10px;">AI is analyzing...</p>
        </div>
    `;
}

// Pattern 2: Error Handling
async function callAIWithErrorHandling(endpoint, method = 'GET', body = null) {
    try {
        const options = {
            method: method,
            headers: { 
                'Authorization': `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
            }
        };
        if (body) options.body = JSON.stringify(body);
        
        const response = await fetch(endpoint, options);
        
        if (response.status === 429) {
            alert('Too many requests. Please wait a moment.');
            return null;
        }
        if (response.status === 401) {
            alert('Please log in to use AI features.');
            return null;
        }
        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('AI API Error:', error);
        alert('Error: ' + error.message);
        return null;
    }
}

// Pattern 3: Retry Logic for Failed Requests
async function callAIWithRetry(endpoint, method = 'GET', body = null, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await callAIWithErrorHandling(endpoint, method, body);
            if (result) return result;
        } catch (e) {
            if (attempt < maxRetries) {
                console.log(`Retry attempt ${attempt + 1}...`);
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    }
    return null;
}

// ========== SECTION 5: CONFIGURATION EXAMPLES ==========

// Custom AI Config (Optional)
const aiConfig = {
    // Feature toggles
    symptomAnalysisEnabled: true,
    documentAnalysisEnabled: true,
    chatbotEnabled: true,
    queuePredictionEnabled: true,
    
    // Fraud detection thresholds
    maxRequestsPerMinute: 60,
    maxFailedLogins: 5,
    banDurationMinutes: 15,
    
    // UI customization
    chatbotPosition: 'bottom-right', // 'bottom-right', 'bottom-left', 'top-right'
    chatbotWidth: 400,
    chatbotHeight: 500,
    chatbotTheme: 'light' // 'light', 'dark'
};

// Example: Disable feature if needed
if (!aiConfig.chatbotEnabled) {
    // Don't initialize chatbot
}

// ========== SECTION 6: DATABASE MODELS REFERENCE ==========

/*
Required Collections in MongoDB:

1. doctors {
    _id: ObjectId,
    name: string,
    specialization: string,
    services: [string],
    schedule: string,
    rating: number,
    avgDurationMins: number,
    isActive: boolean
}

2. appointments {
    _id: ObjectId,
    patientId: ObjectId,
    doctorId: ObjectId,
    scheduledAt: Date,
    status: string ('pending', 'confirmed', 'completed', 'cancelled'),
    notes: string
}

3. users {
    _id: ObjectId,
    name: string,
    email: string,
    role: string ('patient', 'doctor', 'admin'),
    medicalHistory: string
}
*/

// ========== SECTION 7: ENVIRONMENT VARIABLES (.env) ==========

/*
# Copy to your .env file:

# AI Features
GEMINI_API_KEY=
OPENAI_API_KEY=

# Fraud Detection
MAX_REQUESTS_PER_MINUTE=60
MAX_FAILED_LOGINS=5
BAN_DURATION_MINUTES=15
ADMIN_IPS=127.0.0.1

# Server
PORT=5500
MONGO_URI=mongodb://localhost:27017/bluecare
JWT_SECRET=your_secret_key
NODE_ENV=development
*/

// ========== END OF QUICK REFERENCE ==========

module.exports = {
    version: '1.0',
    lastUpdated: '2026-04-16',
    features: 4,
    setupTime: '10 minutes',
    documentation: 'README_AI.md'
};
