/**
 * FRONTEND AI INTEGRATION - JavaScript Code for index.html
 * =========================================================
 * 
 * Add these functions to your existing index.html <script> section
 * They integrate with the AI backend endpoints without modifying existing code
 * 
 * Call these functions from buttons/modals in your HTML:
 * - analyzeSymptomsFrontend() - For Symptom Quick-Check
 * - openAIChatbot() - For chat widget
 * - getQueuePrediction() - For doctor cards
 * - etc.
 */

// ==================== 1. AI SYMPTOM ANALYZER ====================

async function analyzeSymptomsFrontend() {
    const symptoms = document.getElementById('symptomInput')?.value;
    const age = document.getElementById('ageInput')?.value;
    const medicalHistory = document.getElementById('medicalHistoryInput')?.value || '';

    if (!symptoms) {
        alert('Please enter your symptoms');
        return;
    }

    try {
        const response = await fetch('/api/ai/analyze-symptoms', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
                symptoms: symptoms,
                age: parseInt(age) || null,
                medicalHistory: medicalHistory
            })
        });

        const data = await response.json();

        if (data.valid) {
            // Display analysis results
            displaySymptomAnalysis(data);
        } else {
            alert('Analysis failed. Please try again.');
        }
    } catch (e) {
        console.error('Symptom analysis error:', e);
        alert('Error analyzing symptoms');
    }
}

function displaySymptomAnalysis(analysis) {
    const resultsDiv = document.getElementById('analysisResults');
    if (!resultsDiv) return;

    let html = `
        <div style="background: #e8f5e9; border-left: 4px solid #4caf50; padding: 15px; border-radius: 4px;">
            <h4 style="color: #2e7d32; margin-top: 0;">AI Analysis Results</h4>
            
            <p><strong>Primary Concern:</strong> ${analysis.analysis.primaryConcern}</p>
            
            <p><strong>Recommended Departments:</strong></p>
            <ul style="margin: 5px 0;">
    `;

    analysis.analysis.recommendedDepartments.forEach(dept => {
        html += `<li>${dept.charAt(0).toUpperCase() + dept.slice(1)}</li>`;
    });

    html += `
            </ul>
            
            <p><strong>Urgency Level:</strong> 
                <span style="color: ${analysis.analysis.urgencyLevel === 'high' ? '#d32f2f' : analysis.analysis.urgencyLevel === 'medium' ? '#f57c00' : '#1976d2'};">
                    ${analysis.analysis.urgencyLevel.toUpperCase()}
                </span>
            </p>
            
            <p><strong>Confidence Level:</strong> ${analysis.analysis.confidence}%</p>
            
            <p><strong>Recommendations:</strong></p>
            <ul style="margin: 5px 0; color: #555;">
    `;

    analysis.analysis.recommendations.forEach(rec => {
        html += `<li>${rec}</li>`;
    });

    html += `
            </ul>
            
            <p style="font-size: 12px; color: #666; font-style: italic; margin: 10px 0 0 0;">
                ${analysis.analysis.disclaimer}
            </p>
        </div>
    `;

    resultsDiv.innerHTML = html;
}

// ==================== 2. AI DOCUMENT ANALYZER ====================

async function analyzeDocumentFrontend(documentText, documentType = 'Medical Report') {
    if (!documentText) {
        alert('Please provide document text');
        return;
    }

    try {
        const response = await fetch('/api/ai/analyze-document', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
                documentText: documentText,
                documentType: documentType
            })
        });

        const data = await response.json();

        if (data.valid) {
            displayDocumentAnalysis(data);
        }
    } catch (e) {
        console.error('Document analysis error:', e);
    }
}

function displayDocumentAnalysis(analysis) {
    const resultsDiv = document.getElementById('documentAnalysisResults');
    if (!resultsDiv) return;

    let html = `
        <div style="background: #f3e5f5; border-left: 4px solid #9c27b0; padding: 15px; border-radius: 4px;">
            <h4 style="color: #6a1b9a; margin-top: 0;">Document Analysis: ${analysis.documentType}</h4>
    `;

    if (analysis.extractedData.keyFindings.length > 0) {
        html += `<p><strong>Key Findings:</strong><ul>`;
        analysis.extractedData.keyFindings.forEach(f => {
            html += `<li>${f}</li>`;
        });
        html += `</ul></p>`;
    }

    if (Object.keys(analysis.extractedData.measurements).length > 0) {
        html += `<p><strong>Measurements:</strong><ul>`;
        Object.entries(analysis.extractedData.measurements).forEach(([key, val]) => {
            html += `<li>${key}: ${val}</li>`;
        });
        html += `</ul></p>`;
    }

    if (analysis.anomalies.length > 0) {
        html += `<p style="color: #c62828;"><strong>⚠️ Anomalies Detected:</strong><ul>`;
        analysis.anomalies.forEach(a => {
            html += `<li>${a}</li>`;
        });
        html += `</ul></p>`;
    }

    html += `</div>`;
    resultsDiv.innerHTML = html;
}

// ==================== 3. AI MEDICAL CHATBOT WITH RAG ====================

let chatConversationId = null;

function openAIChatbot() {
    chatConversationId = new Date().getTime().toString();
    const chatModal = document.getElementById('aiChatModal');
    if (chatModal) {
        chatModal.style.display = 'block';
        addChatMessage('assistant', 'Përshëndetje! Unë jam asistenti AI i BlueCare. Si mund t\'ju ndihmoj sot? 🏥');
    }
}

async function sendChatMessage() {
    const chatInput = document.getElementById('chatInput');
    const userMessage = chatInput?.value;

    if (!userMessage) return;

    // Display user message
    addChatMessage('user', userMessage);
    chatInput.value = '';

    try {
        const response = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
                message: userMessage,
                conversationId: chatConversationId
            })
        });

        const data = await response.json();

        if (data.valid) {
            addChatMessage('assistant', data.aiResponse);

            // Show sources if available
            if (data.dataUsed && data.dataUsed.length > 0) {
                const sourcesText = `📚 Data used: ${data.dataUsed.join(', ')}`;
                addChatMessage('info', sourcesText, true);
            }
        }
    } catch (e) {
        console.error('Chat error:', e);
        addChatMessage('assistant', 'Sorry, I encountered an error. Please try again.');
    }
}

function addChatMessage(role, content, isSmall = false) {
    const chatBox = document.getElementById('chatBox');
    if (!chatBox) return;

    const messageDiv = document.createElement('div');
    messageDiv.style.marginBottom = '10px';
    messageDiv.style.padding = '10px';
    messageDiv.style.borderRadius = '6px';
    messageDiv.style.fontSize = isSmall ? '12px' : '14px';

    if (role === 'user') {
        messageDiv.style.background = '#1e40af';
        messageDiv.style.color = 'white';
        messageDiv.style.textAlign = 'right';
        messageDiv.innerHTML = content;
    } else if (role === 'assistant') {
        messageDiv.style.background = '#e8eaed';
        messageDiv.style.color = '#202124';
        messageDiv.innerHTML = content;
    } else if (role === 'info') {
        messageDiv.style.background = '#fff3cd';
        messageDiv.style.color = '#856404';
        messageDiv.style.fontSize = '12px';
        messageDiv.innerHTML = content;
    }

    chatBox.appendChild(messageDiv);
    chatBox.scrollTop = chatBox.scrollHeight; // Auto-scroll
}

// ==================== 4. SMART QUEUE PREDICTION ====================

async function getQueuePrediction(doctorId, date) {
    try {
        const response = await fetch(`/api/ai/queue-prediction/${doctorId}/${date}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });

        const prediction = await response.json();

        return {
            estimatedWait: prediction.estimatedWaitMinutes,
            busyLevel: prediction.busyLevel,
            confidence: prediction.confidenceLevel,
            recommendation: prediction.recommendation,
            optimalSlots: prediction.optimalSlots
        };
    } catch (e) {
        console.error('Queue prediction error:', e);
        return null;
    }
}

function displayQueuePrediction(prediction, elementId) {
    const element = document.getElementById(elementId);
    if (!element || !prediction) return;

    const busyColor = prediction.busyLevel === 'high' ? '#d32f2f' :
                      prediction.busyLevel === 'medium' ? '#f57c00' : '#4caf50';

    let html = `
        <div style="padding: 10px; background: ${busyColor}20; border-left: 4px solid ${busyColor}; border-radius: 4px;">
            <p style="margin: 5px 0;">
                <strong>⏱️ Est. Wait:</strong> ${prediction.estimatedWait} min | 
                <strong>Status:</strong> <span style="color: ${busyColor};">${prediction.busyLevel.toUpperCase()}</span>
            </p>
            <p style="margin: 5px 0; font-size: 12px; color: #666;">
                ${prediction.recommendation}
            </p>
            ${prediction.optimalSlots ? `<p style="margin: 5px 0; font-size: 12px;">💡 Best times: ${prediction.optimalSlots.join(', ')}</p>` : ''}
        </div>
    `;

    element.innerHTML = html;
}

// ==================== 5. UPDATE DOCTOR CARDS WITH QUEUE PREDICTION ====================

async function updateDoctorCardWithQueue(doctorId, cardElementId) {
    const today = new Date().toISOString().split('T')[0];
    const prediction = await getQueuePrediction(doctorId, today);

    if (prediction) {
        displayQueuePrediction(prediction, `queue-${cardElementId}`);
    }
}

// ==================== 6. HTML ELEMENTS TO ADD ====================

/**
 * Add these HTML elements to your index.html where needed:
 * 
 * 1. For Symptom Analysis:
 * <div id="symptomAnalyzer">
 *     <input id="symptomInput" type="text" placeholder="Describe your symptoms...">
 *     <input id="ageInput" type="number" placeholder="Age">
 *     <button onclick="analyzeSymptomsFrontend()">Analyze with AI</button>
 *     <div id="analysisResults"></div>
 * </div>
 * 
 * 2. For Chatbot:
 * <div id="aiChatModal" style="display: none; position: fixed; width: 400px; height: 500px; right: 20px; bottom: 20px; background: white; border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.2); z-index: 1000; flex-direction: column; display: flex;">
 *     <div style="padding: 15px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between;">
 *         <h4 style="margin: 0;">BlueCare AI Assistant</h4>
 *         <button onclick="document.getElementById('aiChatModal').style.display = 'none';" style="background: none; border: none; font-size: 20px; cursor: pointer;">×</button>
 *     </div>
 *     <div id="chatBox" style="flex: 1; overflow-y: auto; padding: 15px;"></div>
 *     <div style="padding: 10px; border-top: 1px solid #eee; display: flex;">
 *         <input id="chatInput" type="text" placeholder="Ask me anything..." style="flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px; margin-right: 5px;">
 *         <button onclick="sendChatMessage()" style="padding: 8px 15px; background: #1e40af; color: white; border: none; border-radius: 4px; cursor: pointer;">Send</button>
 *     </div>
 * </div>
 * 
 * 3. For Queue Prediction on Doctor Cards:
 * Add <div id="queue-[doctorId]"></div> to each doctor card
 * Then call: updateDoctorCardWithQueue('[doctorId]', '[doctorId]')
 */

// ==================== 7. INITIALIZE ON PAGE LOAD ====================

// Add this to your existing DOMContentLoaded or initialization function:
/*
document.addEventListener('DOMContentLoaded', () => {
    // Load doctor queue predictions on dashboard
    if (document.getElementById('doctorCardsContainer')) {
        const doctorIds = ['docId1', 'docId2', 'docId3']; // Replace with actual IDs
        doctorIds.forEach(id => {
            updateDoctorCardWithQueue(id, id);
        });
    }
    
    // Initialize AI chatbot button
    const chatButton = document.getElementById('aiChatBtn');
    if (chatButton) {
        chatButton.addEventListener('click', openAIChatbot);
    }
});
*/

module.exports = {
    analyzeSymptomsFrontend,
    analyzeDocumentFrontend,
    openAIChatbot,
    sendChatMessage,
    getQueuePrediction,
    updateDoctorCardWithQueue
};
