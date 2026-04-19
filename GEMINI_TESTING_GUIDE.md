# 🧪 GEMINI API - TESTING GUIDE

## ⚠️ Current Status

Your API key is **NOT working**. The system is using **rule-based fallback** which still works but without Gemini's AI power.

---

## ✅ Quick Fix (3 Steps)

### Step 1: Get New Free API Key

1. Open: https://makersuite.google.com/app/apikey
2. Log in with Google account
3. Click **"Create API Key"** or **"Get API Key"**
4. Copy the key (starts with `AQ.`)

### Step 2: Update `.env` File

```bash
# Edit .env file and replace:
GEMINI_API_KEY=your_new_key_here
GEMINI_MODEL=gemini-pro
```

Example:
```bash
GEMINI_API_KEY=<YOUR_GEMINI_API_KEY>
GEMINI_MODEL=gemini-pro
```

### Step 3: Test

```bash
# Verify setup
node verify-gemini.js

# Or run server
npm run dev
```

---

## 🧪 Testing Methods

### Method 1: Quick Verification (30 seconds)
```bash
node verify-gemini.js
```

**Expected output:**
```
✅ GEMINI_API_KEY found
✅ Gemini client initialized successfully
✅ ALL CHECKS PASSED!
```

---

### Method 2: Direct API Test
```bash
node test-gemini-simple.js
```

**Expected output:**
```
✅ SUCCESS with gemini-pro!
Response: Hello

📋 Testing Medical Symptom Analysis...
Concern: Cardiovascular
Departments: Cardiology, Pulmonology
...
```

---

### Method 3: Test Backend Endpoint

**Start server:**
```bash
npm run dev
```

**In another terminal, test endpoint:**
```bash
# Get JWT token first (login)
# Then test symptom analysis:
curl -X POST http://localhost:5500/api/ai/analyze-symptoms \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "symptoms": "Chest pain and dizziness",
    "age": 35,
    "medicalHistory": "None"
  }'
```

**Expected response:**
```json
{
  "valid": true,
  "symptoms": "Chest pain and dizziness",
  "analysis": {
    "primaryConcern": "Cardiovascular",
    "recommendedDepartments": ["cardiology"],
    "urgencyLevel": "high",
    "confidence": 85,
    "recommendations": [...],
    "disclaimer": "This is AI-assisted analysis..."
  },
  "usingGeminiAPI": true
}
```

---

### Method 4: Test in Browser

**Start server:**
```bash
npm run dev
```

**Open browser:**
1. Go to http://localhost:5500
2. Log in
3. Click robot icon 🤖 (bottom right)
4. Type: "Are doctors available today?"
5. See AI response!

---

## 📊 Testing Checklist

- [ ] Step 1: Got new Gemini API key
- [ ] Step 2: Updated `.env` file
- [ ] Step 3: Run `node verify-gemini.js`
- [ ] Step 4: Check output shows `✅ ALL CHECKS PASSED`
- [ ] Step 5: Start server with `npm run dev`
- [ ] Step 6: Test endpoint or browser UI

---

## 🔍 Troubleshooting Tests

### Test 1: Check API Key Format
```bash
# Make sure .env has no spaces:
GEMINI_API_KEY=AQ.xyz123...  # ✅ Correct
GEMINI_API_KEY= AQ.xyz123... # ❌ Wrong (space after =)
GEMINI_API_KEY = AQ.xyz123...# ❌ Wrong (spaces around =)
```

### Test 2: Verify .env is Loaded
```bash
node -e "require('dotenv').config(); console.log('KEY:', process.env.GEMINI_API_KEY);"
```

Should print your API key.

### Test 3: Check Package is Installed
```bash
npm ls @google/generative-ai
```

Should show version like `0.24.1` or similar.

### Test 4: Check Internet Connection
```bash
curl https://generativelanguage.googleapis.com
```

Should not show connection error.

---

## 📝 Environment Variables

### Required:
```bash
GEMINI_API_KEY=your_key_here  # Get from makersuite.google.com
```

### Optional:
```bash
GEMINI_MODEL=gemini-pro       # Model to use (default: gemini-pro)
                              # Other options: gemini-1.5-pro, gemini-1.5-flash
```

---

## 🔐 API Key Safety

✅ **Safe practices:**
- API key is private (don't share)
- Only stored in `.env` file
- Never commit `.env` to git
- Free tier API (no credit card needed)

❌ **Don't do:**
- Don't put key in code
- Don't commit `.env` to git
- Don't share key with others

---

## 💡 Model Selection

### Default: `gemini-pro`
- Most stable
- Free tier compatible
- Good balance

### Alternatives:
```bash
GEMINI_MODEL=gemini-1.5-pro    # More powerful
GEMINI_MODEL=gemini-1.5-flash  # Faster, newer
```

If you use alternative model and it doesn't work, fall back to `gemini-pro`.

---

## 🆘 Still Not Working?

### Issue: "API Key is empty"
- Check `.env` file exists
- Check value after `GEMINI_API_KEY=`
- Restart server after adding key

### Issue: "Model not found"
- Use `GEMINI_MODEL=gemini-pro` (more compatible)
- Or try: `GEMINI_MODEL=gemini-1.5-pro`

### Issue: "Unauthorized"
- API key might be revoked
- Get new key from makersuite.google.com
- Wait 2-3 minutes before testing

### Issue: "Rate limit exceeded"
- Free tier has limits
- Wait a minute and retry
- Or upgrade to paid tier

---

## ✨ Once Working

You'll see responses like:

**Symptom Analysis:**
```
AI says: "Based on your symptoms of chest pain and dizziness, 
this could be a cardiovascular issue. I recommend visiting 
Cardiology. Urgency: HIGH"
```

**Chatbot:**
```
User: "Is Dr. Elena available?"
AI: "Yes, Dr. Elena (Cardiologist) is available tomorrow 
at 10:00 AM and 3:00 PM. Would you like to book?"
```

---

## 📚 Documentation Files

| File | Purpose |
|------|---------|
| `GEMINI_API_FIX.md` | How to fix invalid API key |
| `GEMINI_SETUP_COMPLETE.md` | What was set up |
| `verify-gemini.js` | Verification script |
| `test-gemini-simple.js` | Direct API test |
| `test-gemini-api.js` | Comprehensive test |

---

## 🚀 Next Steps

1. **Get API key** from makersuite.google.com (2 min)
2. **Update .env** file (1 min)
3. **Run test** with `node verify-gemini.js` (30 sec)
4. **Start server** with `npm run dev` (instant)
5. **Enjoy** enhanced AI features! ✨

---

**Once you add a valid key, your BlueCare AI will be fully powered by Google Gemini!** 🤖
