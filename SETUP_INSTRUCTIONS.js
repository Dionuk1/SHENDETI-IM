/**
 * PACKAGE.JSON DEPENDENCIES FOR AI FEATURES
 * ==========================================
 * 
 * Run: npm install
 * 
 * Then add these to your bluecare/package.json "dependencies" section
 */

// Current dependencies your project likely has:
{
  "dependencies": {
    "express": "^4.18.2",
    "mongoose": "^7.0.0",
    "cors": "^2.8.5",
    "dotenv": "^16.0.3",
    "jsonwebtoken": "^9.0.0",
    "bcryptjs": "^2.4.3"
  },
  "devDependencies": {
    "nodemon": "^2.0.20"
  }
}

// ==================== NEW DEPENDENCIES FOR AI ====================

// Option 1: BASIC SETUP (No external LLM, uses rule-based AI)
// No additional npm packages needed! All AI code uses built-in Node.js

// Option 2: WITH GEMINI API INTEGRATION
// npm install @google/generative-ai

// Option 3: WITH LANGCHAIN (Recommended for advanced RAG)
// npm install langchain @langchain/core @langchain/community @langchain/openai

// Option 4: WITH BOTH GEMINI AND LANGCHAIN
// npm install @google/generative-ai langchain @langchain/core @langchain/community

// For our current implementation, NO new packages are required!
// The fraud detection and RAG use only built-in Node.js modules.

// ==================== COMPLETE UPDATED package.json ====================

{
  "name": "bluecare",
  "version": "1.0.0",
  "description": "BlueCare Medical Center - Healthcare Management System with AI",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "mongoose": "^7.0.0",
    "cors": "^2.8.5",
    "dotenv": "^16.0.3",
    "jsonwebtoken": "^9.0.0",
    "bcryptjs": "^2.4.3"
  },
  "devDependencies": {
    "nodemon": "^2.0.20"
  },
  "engines": {
    "node": ">=14.0.0"
  }
}

// Optional for future enhancements:
// "langchain": "^0.0.207",
// "@langchain/core": "^0.1.0",
// "@google/generative-ai": "^0.1.0"

// ==================== INSTALLATION STEPS ====================

/*
1. Navigate to project folder:
   cd bluecare

2. Install dependencies (if not already done):
   npm install

3. Create src/routes folder if it doesn't exist:
   mkdir -p src/routes

4. Create src/controllers folder if it doesn't exist:
   mkdir -p src/controllers

5. Create src/middleware folder if it doesn't exist:
   mkdir -p src/middleware

6. Create src/services folder if it doesn't exist:
   mkdir -p src/services

7. Copy AI files to appropriate locations:
   - src/routes/ai.js
   - src/controllers/aiController.js
   - src/middleware/fraudDetection.js
   - src/services/ragChatbot.js

8. Update your server.js (see INTEGRATION_GUIDE.js)

9. Verify environment variables in .env file:
   MONGO_URI=mongodb://localhost:27017/bluecare
   JWT_SECRET=your_secret_key
   ADMIN_IPS=127.0.0.1

10. Start the server:
    npm run dev

11. Test AI endpoints:
    curl -X POST http://localhost:5500/api/ai/chat \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer YOUR_TOKEN" \
      -d '{"message": "Is Dr. X available?"}'
*/

// ==================== FOLDER STRUCTURE ====================

/*
bluecare/
├── src/
│   ├── routes/
│   │   ├── auth.js
│   │   ├── patient.js
│   │   ├── doctor.js
│   │   ├── admin.js
│   │   └── ai.js (NEW)
│   │
│   ├── controllers/
│   │   └── aiController.js (NEW)
│   │
│   ├── middleware/
│   │   ├── auth.js
│   │   └── fraudDetection.js (NEW)
│   │
│   ├── services/
│   │   └── ragChatbot.js (NEW)
│   │
│   ├── models/
│   │   ├── User.js
│   │   ├── Doctor.js
│   │   └── Appointment.js
│   │
│   └── server.js (MODIFIED to add AI routes & fraud detection)
│
├── .env
├── package.json
├── INTEGRATION_GUIDE.js (NEW)
└── AI_FRONTEND_INTEGRATION.js (NEW)
*/

// ==================== ENVIRONMENT VARIABLES (.env) ====================

/*
# Database
MONGO_URI=mongodb://localhost:27017/bluecare

# JWT
JWT_SECRET=your_super_secret_jwt_key_here_change_in_production
JWT_EXPIRE=7d

# Server
PORT=5500
NODE_ENV=development

# Admin IP Whitelist (optional, comma-separated)
ADMIN_IPS=127.0.0.1,192.168.1.100

# AI Services (optional, for future use)
GEMINI_API_KEY=
OPENAI_API_KEY=

# Fraud Detection Settings (optional)
MAX_REQUESTS_PER_MINUTE=60
MAX_FAILED_LOGINS=5
BAN_DURATION_MINUTES=15
*/

// ==================== QUICK START CHECKLIST ====================

/*
☐ 1. Copy AI files to src/ folders
☐ 2. Run npm install (if needed)
☐ 3. Update server.js with imports and middleware
☐ 4. Add AI route registration to server.js
☐ 5. Update .env with ADMIN_IPS if needed
☐ 6. Test with: npm run dev
☐ 7. Test endpoints using curl or Postman
☐ 8. Add frontend integration functions to index.html
☐ 9. Add HTML elements for chatbot, analysis, etc.
☐ 10. Update doctor cards to show queue predictions

For detailed setup, see: INTEGRATION_GUIDE.js
For frontend code, see: AI_FRONTEND_INTEGRATION.js
*/

// ==================== COMMON ISSUES & SOLUTIONS ====================

/*
Issue: "Cannot find module './routes/ai'"
Solution: Make sure ai.js is in src/routes/ folder

Issue: "fraudDetectionMiddleware is not defined"
Solution: Check that fraudDetection.js is in src/middleware/

Issue: "PORT already in use"
Solution: Change PORT in .env or kill process on that port

Issue: "Unauthorized" when calling AI routes
Solution: Make sure Authorization header is included with valid JWT token

Issue: Rate limiting is blocking legitimate requests
Solution: Increase MAX_REQUESTS_PER_MINUTE in .env

Issue: Chat responses not using database data
Solution: Check MongoDB connection and Doctor/Appointment model names
*/

module.exports = {
  projectName: "BlueCare Medical Center with AI",
  version: "2.0.0-AI-Enhanced",
  newFeatures: [
    "AI Symptom Analysis",
    "Document Analysis", 
    "Smart Queue Prediction",
    "RAG Medical Chatbot",
    "Fraud Detection & Security"
  ],
  setupTime: "5-10 minutes",
  noBreakingChanges: true,
  backsCompatible: true
};
