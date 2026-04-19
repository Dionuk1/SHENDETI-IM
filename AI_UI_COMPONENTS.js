/**
 * AI UI COMPONENTS - Example HTML/CSS for integrating AI features
 * 
 * Copy these examples into your index.html where you want AI features to appear
 * Do NOT break existing HTML structure
 */

// ==================== COMPONENT 1: SYMPTOM ANALYZER WIDGET ====================

/*
Add this HTML element in your dashboard content area (e.g., in Symptom tab):

<div id="symptomAnalyzerWidget" style="background:white; padding:25px; border-radius:20px; box-shadow:var(--shadow); max-width:600px; margin:0 auto;">
    <h2 style="color:var(--primary); margin-bottom:20px;">
        <i class="fas fa-stethoscope"></i> Analizuesi i Simptomave me AI
    </h2>
    
    <div style="background:#f0f7ff; padding:15px; border-radius:12px; margin-bottom:20px; border-left:4px solid var(--primary);">
        <p style="margin:0; color:var(--gray); font-size:0.9rem;">
            🤖 Shkruani simptomat tuaja dhe AI ynë do t'ju ndihmojë të gjeni departamentin e duhur dhe nivelun e urgjencës.
        </p>
    </div>
    
    <div style="margin-bottom:20px;">
        <label style="display:block; margin-bottom:8px; font-weight:600; color:var(--dark);">Simptomat</label>
        <textarea id="symptomsText" placeholder="P.sh. Dhimbje në gjoks, vështirësi në frymëmarrje..." 
                  style="width:100%; padding:12px; border:2px solid #f1f5f9; border-radius:12px; outline:none; font-size:0.95rem; font-family:inherit; min-height:100px; resize:vertical;">
        </textarea>
    </div>
    
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:15px; margin-bottom:20px;">
        <div>
            <label style="display:block; margin-bottom:8px; font-weight:600; color:var(--dark);">Mosha</label>
            <input id="ageInput" type="number" placeholder="P.sh. 35" 
                   style="width:100%; padding:12px; border:2px solid #f1f5f9; border-radius:12px; outline:none; font-size:0.95rem;">
        </div>
        <div>
            <label style="display:block; margin-bottom:8px; font-weight:600; color:var(--dark);">Histori Mjekësore</label>
            <input id="medicalHistoryInput" placeholder="P.sh. Hipertensioni" 
                   style="width:100%; padding:12px; border:2px solid #f1f5f9; border-radius:12px; outline:none; font-size:0.95rem;">
        </div>
    </div>
    
    <button class="btn btn-primary" style="width:100%; justify-content:center; margin-bottom:20px;" 
            onclick="analyzeSymptomsFrontend()">
        🔍 Analizoni Simptomat
    </button>
    
    <div id="analysisResult" style="display:none;"></div>
</div>
*/

// ==================== COMPONENT 2: AI CHATBOT ENHANCEMENT ====================

/*
The chatbot is already integrated in index.html.
To customize it, modify the existing #chat-box and #chat-msgs structure:

<div class="chat-btn" onclick="document.getElementById('chat-box').classList.toggle('active')">
    <i class="fas fa-robot"></i>
</div>

<div id="chat-box" class="chat-box">
    <div class="chat-header" style="display:flex; justify-content:space-between; align-items:center;">
        <div>
            <div style="font-weight:700; font-size:1rem;">🏥 BlueCare AI Asistenti</div>
            <div style="font-size:0.75rem; opacity:0.8;">Online - Gati të ndihmoj</div>
        </div>
        <button onclick="document.getElementById('chat-box').classList.remove('active')" 
                style="background:none; border:none; color:white; font-size:1.2rem; cursor:pointer;">×</button>
    </div>
    
    <div id="chat-msgs" class="chat-messages">
        <div class="msg bot" style="background:#e2e8f0; padding:10px 15px; border-radius:14px; font-size:0.9rem; max-width:80%;">
            👋 Përshëndetje! Si mund t'ju ndihmoj me shëndetin sot?
        </div>
    </div>
    
    <div style="padding:15px; display:flex; gap:10px; border-top:1px solid #eee;">
        <input type="text" id="chatInput" placeholder="Pyet diçka..." 
               style="flex:1; border:none; outline:none; padding:8px; border-radius:8px; font-size:0.9rem;">
        <button class="btn btn-primary" style="padding:8px 12px;" onclick="sendChatMessage()">
            <i class="fas fa-paper-plane"></i>
        </button>
    </div>
    
    <div style="padding:10px; background:#f1f5f9; text-align:center; font-size:0.75rem; color:var(--gray);">
        Powered by <span style="font-weight:600;">🤖 AI</span> • Secured by <span style="font-weight:600;">🔒 AES-256</span>
    </div>
</div>
*/

// ==================== COMPONENT 3: QUEUE PREDICTION ON DOCTOR CARDS ====================

/*
Add this to your doctor card display (in doctor grid):

<div class="doc-card" data-doctor-id="DOCTOR_ID">
    <div class="doc-img">👨‍⚕️</div>
    <h3>Dr. Emri Mbiemri</h3>
    <p style="color:var(--gray); font-size:0.9rem;">Specialization</p>
    
    <!-- Queue Prediction Section -->
    <div id="queue-DOCTOR_ID" style="margin-top:15px; padding:12px; background:#f1f5f9; border-radius:12px;">
        <div style="text-align:center;">
            <span style="font-size:0.8rem; color:var(--gray);">Loading queue info...</span>
        </div>
    </div>
    
    <button class="btn btn-primary" style="width:100%; margin-top:15px;" onclick="bookDoctorAppointment('DOCTOR_ID', 'Dr. Emri')">
        Rezervo Termin
    </button>
</div>

// Add this JavaScript to update queues on page load:
<script>
document.addEventListener('DOMContentLoaded', () => {
    const doctors = document.querySelectorAll('[data-doctor-id]');
    doctors.forEach(doc => {
        const doctorId = doc.getAttribute('data-doctor-id');
        updateDoctorCardWithQueue(doctorId, doctorId);
    });
});
</script>
*/

// ==================== COMPONENT 4: DASHBOARD STATS WITH AI ====================

/*
Add this to your admin dashboard for AI insights:

<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); gap:20px; margin-top:25px;">
    
    <!-- AI Usage Stats -->
    <div class="card">
        <h3 style="color:var(--primary); display:flex; align-items:center; gap:8px; margin-top:0;">
            <i class="fas fa-brain"></i> AI Përdorimi Sot
        </h3>
        <div style="display:flex; justify-content:space-between; margin-top:15px;">
            <div style="text-align:center;">
                <div style="font-size:1.5rem; font-weight:700; color:var(--primary);">247</div>
                <div style="font-size:0.8rem; color:var(--gray);">Analiza Simptomash</div>
            </div>
            <div style="text-align:center;">
                <div style="font-size:1.5rem; font-weight:700; color:#f59e0b;">1,204</div>
                <div style="font-size:0.8rem; color:var(--gray);">Mesazhe Chat</div>
            </div>
            <div style="text-align:center;">
                <div style="font-size:1.5rem; font-weight:700; color:#10b981;">532</div>
                <div style="font-size:0.8rem; color:var(--gray);">Parashikimet e Radhës</div>
            </div>
        </div>
    </div>
    
    <!-- Security Status -->
    <div class="card">
        <h3 style="color:var(--danger); display:flex; align-items:center; gap:8px; margin-top:0;">
            <i class="fas fa-shield-alt"></i> Statusi i Sigurimit
        </h3>
        <div style="margin-top:15px;">
            <p style="margin:8px 0;"><span style="color:#10b981; font-weight:700;">✓ Aktiv</span> - Fraud Detection</p>
            <p style="margin:8px 0;"><span style="color:#10b981; font-weight:700;">✓ Aktiv</span> - Rate Limiting</p>
            <p style="margin:8px 0;"><span style="color:var(--danger); font-weight:700;">2 IPs Blocked</span> - Të dyshimta</p>
        </div>
    </div>
    
    <!-- API Status -->
    <div class="card">
        <h3 style="color:#9c27b0; display:flex; align-items:center; gap:8px; margin-top:0;">
            <i class="fas fa-plug"></i> Statusi i API-ve
        </h3>
        <div style="margin-top:15px;">
            <p style="margin:8px 0;"><span style="color:#10b981; font-weight:700;">✓</span> MongoDB Connected</p>
            <p style="margin:8px 0;"><span style="color:#f59e0b; font-weight:700;">⚡</span> Gemini API (Opsionale)</p>
            <p style="margin:8px 0;"><span style="color:#10b981; font-weight:700;">✓</span> Server Healthy</p>
        </div>
    </div>
</div>
*/

// ==================== COMPONENT 5: TOP SYMPTOMS INSIGHT ====================

/*
Add this to show trending symptoms:

<div class="card">
    <h3 style="color:var(--primary); margin-top:0;">
        <i class="fas fa-chart-bar"></i> Simptomat më të Shpeshta Sot
    </h3>
    <div style="margin-top:20px;">
        <div style="margin-bottom:15px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                <span>Dhimbje në kokë</span>
                <span style="font-weight:700; color:var(--primary);">142</span>
            </div>
            <div style="height:8px; background:#f1f5f9; border-radius:4px; overflow:hidden;">
                <div style="height:100%; width:85%; background:var(--primary); transition:0.3s;"></div>
            </div>
        </div>
        <div style="margin-bottom:15px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                <span>Dhimbje në bark</span>
                <span style="font-weight:700; color:#f59e0b;">98</span>
            </div>
            <div style="height:8px; background:#f1f5f9; border-radius:4px; overflow:hidden;">
                <div style="height:100%; width:60%; background:#f59e0b; transition:0.3s;"></div>
            </div>
        </div>
        <div style="margin-bottom:15px;">
            <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
                <span>Gripi</span>
                <span style="font-weight:700; color:#10b981;">76</span>
            </div>
            <div style="height:8px; background:#f1f5f9; border-radius:4px; overflow:hidden;">
                <div style="height:100%; width:45%; background:#10b981; transition:0.3s;"></div>
            </div>
        </div>
    </div>
</div>
*/

// ==================== COMPONENT 6: AI RESPONSE TIME MONITOR ====================

/*
Add this for performance monitoring:

<div class="card">
    <h3 style="color:#9c27b0; margin-top:0;">
        <i class="fas fa-tachometer-alt"></i> Performanca e AI-s
    </h3>
    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:15px; margin-top:15px;">
        <div style="text-align:center; padding:15px; background:#f1f5f9; border-radius:12px;">
            <div style="font-size:0.8rem; color:var(--gray); margin-bottom:5px;">Mesatare</div>
            <div style="font-size:1.5rem; font-weight:700; color:#9c27b0;">245ms</div>
        </div>
        <div style="text-align:center; padding:15px; background:#f1f5f9; border-radius:12px;">
            <div style="font-size:0.8rem; color:var(--gray); margin-bottom:5px;">Min</div>
            <div style="font-size:1.5rem; font-weight:700; color:#10b981;">78ms</div>
        </div>
        <div style="text-align:center; padding:15px; background:#f1f5f9; border-radius:12px;">
            <div style="font-size:0.8rem; color:var(--gray); margin-bottom:5px;">Max</div>
            <div style="font-size:1.5rem; font-weight:700; color:#ef4444;">1.2s</div>
        </div>
    </div>
</div>
*/

// ==================== INSTALLATION INSTRUCTIONS ====================

/*
1. Add symptom analyzer widget to "Symptoma" tab in patient dashboard
2. The chatbot is already enabled (click the robot icon in bottom-right)
3. Update doctor cards to show queue predictions
4. Add AI stats to admin dashboard
5. Test in browser and verify all features work

To enable Gemini API for better responses:
1. Get free API key from: https://makersuite.google.com/app/apikey
2. Add to .env: GEMINI_API_KEY=your_key_here
3. npm install @google/generative-ai
4. Restart server: npm run dev

All components are non-breaking and work with existing UI!
*/

module.exports = {
    components: [
        'SymptomAnalyzerWidget',
        'AICharbot',
        'QueuePredictionWidget',
        'DashboardStats',
        'TopSymptomsChart',
        'PerformanceMonitor'
    ],
    features: [
        'Symptom Analysis',
        'AI Chat',
        'Queue Prediction',
        'Fraud Detection',
        'Performance Monitoring'
    ],
    readyToUse: true
};
