# ðŸ¥ Node/Express/Mongo HealthFlow OS - BlueCare Medical Center

A comprehensive healthcare web application featuring AI-powered smart queue management, intelligent symptom checking, and advanced doctor scheduling.

![image alt] https://github.com/Dionuk1/HealthFlowOS/blob/6824890e99cc359b5518c9c4620c8762cbfb2821/image.png

## ðŸš€ **PREMIUM FEATURES NOW ACTIVE** âœ…

### âœ¨ **All Features Connected to Backend:**

| Feature | Status | Implementation |
|---------|--------|-----------------|
| **Doctor UI Cards** | âœ… LIVE | Real data from MongoDB with services, ratings, queue times |
| **Symptom Quick-Check** | âœ… LIVE | Connected to `/api/appointments/check-symptoms` |
| **Smart Queue System** | âœ… LIVE | Real wait times calculated from active appointments |
| **Emergency Mode Toggle** | âœ… LIVE | High-contrast layout switch in navigation |
| **Protected Patient Links** | âœ… LIVE | JWT authentication required for dashboard sections |
| **Admin Management** | âœ… LIVE | Role-based access control verified |
| **AES-256 Encryption** | âœ… LIVE | Medical data secured on backend |
| **Queue Prioritization** | âœ… LIVE | Intelligent doctor selection by experience + ratings |

---

## âœ¨ Premium Features

### ðŸ”„ **Smart Queue System**
- Calculates real-time wait times based on active appointments
- Intelligent doctor prioritization by experience & ratings
- Emergency mode bypass for urgent cases
- In-memory cache optimization (1-minute TTL)

### ðŸ§  **Symptom Checker AI**
- Maps symptoms to medical departments automatically
- Urgency level detection (Low, Medium, High)
- Multi-symptom analysis with confidence scoring
- Personalized department recommendations

### ðŸ‘¨â€âš•ï¸ **Doctor Management**
- Complete doctor profiles with specializations
- Multiple services per doctor (ECG, Tele-visit, Consultation, etc.)
- Availability scheduling (weekday/weekend)
- Experience tracking & patient ratings

### ðŸ“Š **Patient Dashboard**
- **Orari Im (My Schedule)**: Manage appointments
- **Receptet (My Prescriptions)**: Encrypted prescription access
- **Analizat e Mia (My Analysis)**: Upload/download medical records

### ðŸ” **Enterprise Security**
- JWT Auth (7-day tokens)
- bcryptjs password hashing (cost 12)
- AES-256 GCM encryption for medical data
- Role-based access control (admin, doctor, patient)

---

## ðŸ“ Complete Project Structure

```
.
â”œâ”€â”€ server.js                                    # Express entry point
â”œâ”€â”€ src/
â”‚   â”œâ”€â”€ config/db.js                           # MongoDB connection
â”‚   â”œâ”€â”€ middleware/
â”‚   â”‚   â”œâ”€â”€ auth.js                            # JWT verification
â”‚   â”‚   â””â”€â”€ requireRole.js                     # Role guards
â”‚   â”œâ”€â”€ models/
â”‚   â”‚   â”œâ”€â”€ User.js                            # Admin & Patient
â”‚   â”‚   â”œâ”€â”€ Doctor.js                          # Doctor profile (NEW)
â”‚   â”‚   â”œâ”€â”€ Appointment.js                     # Scheduling
â”‚   â”‚   â”œâ”€â”€ Prescription.js                    # Encrypted prescriptions
â”‚   â”‚   â””â”€â”€ MedicalRecord.js                   # Document uploads
â”‚   â”œâ”€â”€ routes/
â”‚   â”‚   â”œâ”€â”€ auth.js                            # Login/register
â”‚   â”‚   â”œâ”€â”€ public.js                          # Public endpoints
â”‚   â”‚   â”œâ”€â”€ appointment.js                     # Smart queue (NEW)
â”‚   â”‚   â”œâ”€â”€ patient.js                         # Patient dashboard
â”‚   â”‚   â”œâ”€â”€ doctor.js                          # Doctor features
â”‚   â”‚   â”œâ”€â”€ doctors.js                         # Admin doctor mgmt (NEW)
â”‚   â”‚   â””â”€â”€ admin.js                           # Admin panel
â”‚   â”œâ”€â”€ scripts/seed.js                        # DB seed with 5 doctors
â”‚   â””â”€â”€ utils/
â”‚       â”œâ”€â”€ aes256.js                          # AES-256 encryption
â”‚       â”œâ”€â”€ symptomChecker.js                  # Symptomâ†’Department (NEW)
â”‚       â””â”€â”€ queueManager.js                    # Smart queue logic (NEW)
â”œâ”€â”€ public/hf-client.js                        # Frontend JS client
â”œâ”€â”€ bluecare/index.html                        # HealthFlow OS UI
â”œâ”€â”€ uploads/medical-records/                   # PDF storage
â””â”€â”€ package.json
```

---

## ðŸš€ Quick Start

### ðŸ—„ï¸ MongoDB Setup

**Prerequisites**
- Install MongoDB locally **or** create a MongoDB Atlas account.
- Have a valid connection string ready (local `mongodb://...` or Atlas `mongodb+srv://...`).

**Configure `.env`**
- Create a `.env` file in the project root (or copy `.env.example`).
- Set the MongoDB connection string using `MONGO_URI`.

Example (local MongoDB):
```env
MONGO_URI=mongodb://127.0.0.1:27017/healthflow_os
```

Example (MongoDB Atlas):
```env
MONGO_URI=<set-in-environment>
```

Notes
- Do **not** commit real credentials or connection strings to GitHub.
- If your hosting platform provides `MONGODB_URI`, map it to `MONGO_URI` (the app reads `MONGO_URI` by default).

**Database Seeding**
- After MongoDB is configured:
```bash
npm run seed
```

**Troubleshooting**
- If you hit `ECONNREFUSED`, make sure the MongoDB service (`mongod`) is running and your `MONGO_URI` points to the correct host/port.

### 1ï¸âƒ£ Setup Environment
```bash
cp .env.example .env
```

**Key settings:**
```
JWT_SECRET=your-secret-key-here
MEDICAL_AES_KEY=<64_hex_chars>
MONGO_URI=mongodb://127.0.0.1:27017/healthflow_os
```

Note: Secrets/keys should be provided via environment variables and generated during local setup. Do not hard-code real keys in documentation.

### 2ï¸âƒ£ Install Dependencies
```bash
npm install
```

### 3ï¸âƒ£ Seed Database (Create Doctors & Users)
```bash
npm run seed
```

Creates 5 specialist doctors with real services:
- Dr. Agon Berisha (Cardiology)
- Dr. Elena Hoxha (Neurology)
- Dr. Arben Krasniqi (Orthopedics)
- Dr. Nura Rama (General Practice)
- Dr. Mirela Duka (Psychiatry)

Plus: admin@healthflow.test, patient@healthflow.test (demo accounts)

Passwords are defined in environment variables or generated during local setup.

Tip: Set `SEED_DEFAULT_PASSWORD` (and optionally `SEED_ADMIN_PASSWORD`, `SEED_PATIENT_PASSWORD`, `SEED_DOCTOR_PASSWORD`) in your `.env` before running `npm run seed` to keep demo logins stable across runs.

### 4ï¸âƒ£ Start Server
```bash
npm start
```

ðŸŸ¢ Server running on **http://localhost:5500**

---

## ðŸ“š API Reference

### ðŸ” **Symptom Checker** (Public)

```bash
POST /api/appointments/check-symptoms

# Request:
{
  "symptoms": "chest pain and shortness of breath"
}

# Response:
{
  "valid": true,
  "suggestedDepartment": "cardiology",
  "suggestedSpecialization": "cardiology",
  "urgencyLevel": "high",
  "confidence": 95,
  "matchedSymptoms": [
    {"symptom": "chest pain", "department": "cardiology", "urgency": "high"}
  ],
  "recommendedAction": "Please see a doctor immediately or go to emergency"
}
```

---

### ðŸ‘¨â€âš•ï¸ **Get Doctors by Specialization** (Public)

```bash
GET /api/appointments/doctors/cardiology
GET /api/appointments/doctors/neurology?format=full

# Response:
{
  "doctors": [
    {
      "id": "...",
      "name": "Dr. Agon Berisha",
      "specialization": "cardiology",
      "department": "Cardiology Department",
      "experience": 15,
      "avgRating": 4.8,
      "services": [
        {"name": "ECG", "durationMinutes": 20},
        {"name": "Tele-visit", "durationMinutes": 30}
      ]
    }
  ]
}
```

---

### â±ï¸ **Queue Status & Recommendations** (Public)

```bash
# Get queue status for specific doctor
GET /api/appointments/queue-status/:doctorId

# Get smart recommendation
POST /api/appointments/recommend
{
  "specialization": "cardiology",
  "urgencyLevel": "high",
  "emergencyMode": false
}

# Response:
{
  "available": true,
  "doctor": {
    "id": "...",
    "name": "Dr. Agon Berisha",
    "experience": 15,
    "currentQueueSize": 2,
    "estimatedWaitMinutes": 60
  },
  "allOptions": [...],
  "emergencyMode": false,
  "recommendation": "Recommended: Dr. Agon Berisha (Wait time: ~60 min)"
}
```

---

### ðŸ“± **Patient Dashboard** (Authenticated)

```bash
GET /api/patient/dashboard
Authorization: Bearer <TOKEN>

# Response:
{
  "patient": {
    "id": "...",
    "name": "Dion Ukshini",
    "email": "patient@healthflow.test",
    "role": "patient"
  },
  "schedule": {
    "title": "Orari Im (My Schedule)",
    "appointments": [...],
    "total": "5"
  },
  "prescriptions": {
    "title": "Receptet (My Prescriptions)",
    "prescriptions": [...],
    "total": "3"
  },
  "analysis": {
    "title": "Analizat e Mia (My Analysis)",
    "records": [...],
    "total": "7"
  }
}
```

---

### ðŸ“… **Create Smart Appointment** (Authenticated)

```bash
POST /api/appointments/create
Authorization: Bearer <TOKEN>

# Option 1: By symptoms
{
  "symptoms": "chest pain",
  "service": "ECG",
  "scheduledAt": "2026-04-20T10:30:00Z",
  "urgencyLevel": "high",
  "emergencyMode": false,
  "notes": "Started after exercise"
}

# Option 2: By doctor specialization
{
  "specialization": "cardiology",
  "service": "ECG",
  "scheduledAt": "2026-04-20T10:30:00Z"
}

# Option 3: Direct doctor
{
  "doctorId": "...",
  "service": "ECG",
  "scheduledAt": "2026-04-20T10:30:00Z"
}

# Response:
{
  "appointment": {
    "id": "...",
    "doctor": {
      "id": "...",
      "name": "Dr. Agon Berisha",
      "specialization": "cardiology"
    },
    "service": "ECG",
    "scheduledAt": "2026-04-20T10:30:00Z",
    "status": "pending",
    "queueInfo": {
      "activeAppointments": 2,
      "estimatedWaitMinutes": 60,
      "busyLevel": "medium"
    }
  }
}
```

---

### ðŸ’Š **Prescriptions & Records** (Authenticated)

```bash
# Patient: Get prescriptions
GET /api/patient/prescriptions
GET /api/patient/prescriptions/:id  # Decrypted

# Patient: Upload medical record
POST /api/patient/records/upload
Content-Type: multipart/form-data
file: <PDF>
notes: "MRI scan results"

# Patient: Download record
GET /api/patient/records/:id/download

# Doctor: Write prescription
POST /api/doctor/prescriptions
{
  "patientId": "...",
  "title": "Heart Medication",
  "body": "Take 1 tablet daily...",
  "appointmentId": "..."
}
```

---

### ðŸ‘¨â€âš•ï¸ **Doctor Management** (Admin Only)

```bash
# Create doctor
POST /api/admin/doctors
{
  "name": "Dr. New Specialist",
  "email": "new@healthflow.test",
  "password": "<PASSWORD>",
  "specialization": "emergency",
  "department": "Emergency Department",
  "experience": 20,
  "services": [
    {"name": "Emergency Triage", "durationMinutes": 15},
    {"name": "Stabilization", "durationMinutes": 60}
  ],
  "bio": "Emergency medicine expert"
}

# List doctors
GET /api/admin/doctors?specialization=cardiology

# Update doctor
PATCH /api/admin/doctors/:id
{
  "experience": 16,
  "avgRating": 4.9
}

# Update availability
PATCH /api/admin/doctors/:id/availability
{
  "mondayFriday": {"start": "07:00", "end": "17:00"},
  "saturday": {"start": "08:00", "end": "12:00"},
  "sundayOff": true
}

# Delete doctor (soft delete)
DELETE /api/admin/doctors/:id
```

---

## ðŸ§  How Symptom Checker Works

| Symptom | Department | Urgency | Confidence |
|---------|-----------|---------|-----------|
| Chest pain | Cardiology | HIGH | 100% |
| Shortness of breath | Cardiology | HIGH | 95% |
| Headache | Neurology | LOW | 100% |
| Back pain | Orthopedics | LOW | 100% |
| Fever | General | MEDIUM | 95% |
| Anxiety | Psychiatry | MEDIUM | 90% |

**Supported Symptoms (80+ conditions):**
- Cardiovascular: chest pain, palpitations, hypertension
- Neurological: headache, migraine, dizziness, stroke
- Orthopedic: back pain, fracture, sprain, joint pain
- General: fever, cough, sore throat, nausea, abdominal pain
- Mental Health: anxiety, depression, stress
- Dermatology: skin infection, acne, rash

---

## ðŸš€ Advanced Features

### AI & Smart Services
- **Symptom Checker (AI-assisted triage):** Analyzes symptoms (Albanian/English) and returns a suggested department, urgency level, and confidence score; the UI can then fetch and show recommended doctors for that department.
- **Predictive Queue (real-time wait estimation):** Estimates waiting time from active appointments/queue state, classifies load (low/medium/high), and supports smart doctor recommendations.
- **Medical Chatbot (RAG):** Uses Retrieval-Augmented Generation by retrieving relevant clinic context from MongoDB (e.g., doctor directory and appointment context) and generating grounded answers; falls back safely when AI providers are not configured.

### Cybersecurity & Protection
- **AI Fraud Detection:** Detects suspicious patterns such as API bursts and repeated probing; flags incidents like `RATE_LIMIT_EXCEEDED` and `SUSPICIOUS_PATTERN_DETECTED` for monitoring and response.
- **Rate Limiting:** Applies per-IP thresholds and temporary bans to reduce DoS/brute-force risk; limits are configurable via environment variables.
- **Data Encryption (AES-256):** Encrypts sensitive medical data using AES-256; encryption secrets belong in environment variables and should never be committed to source control.

---

## âš™ï¸ Smart Queue Algorithm

```
1. Count active appointments (pending + confirmed)
   Dr. A: 3 active â†’ ~90 min wait
   Dr. B: 1 active â†’ ~30 min wait
   Dr. C: 5 active â†’ ~150 min wait

2. Determine busy level:
   High:   >15 appointments
   Medium: 7-15 appointments
   Low:    <7 appointments

3. Sort by:
   - Queue size (ascending)
   - Patient rating (descending)

4. Special handling:
   Urgent â†’ Skip busy doctors
   Emergency â†’ Highest priority
   Normal â†’ Balanced recommendation
```

---

## ðŸŽ® Frontend JavaScript Examples

```html
<script src="/hf-client.js"></script>
<script>
  // Check symptoms
  const check = await hfClient.checkSymptoms("chest pain");
  console.log(check.suggestedDepartment);  // "cardiology"
  console.log(check.urgencyLevel);         // "high"

  // Get doctors with queues
  const doctors = await hfClient.getAvailableDoctors(
    'cardiology',
    'full'  // detailed info with queue
  );

  // Get smart recommendation
  const rec = await hfClient.getSmartQueueRecommendation(
    'cardiology',
    'high',   // urgencyLevel
    false     // emergencyMode
  );
  console.log(rec.doctor.name);

  // Login
  const user = await hfClient.login(
    'patient@healthflow.test',
    '<PASSWORD>',
    'patient'
  );

  // Get patient dashboard
  const dashboard = await hfClient.patientDashboard();
  console.log(dashboard.schedule.appointments);
  console.log(dashboard.prescriptions.prescriptions);
  console.log(dashboard.analysis.records);

  // Create smart appointment
  const apt = await hfClient.createAppointmentSmart({
    symptoms: 'chest pain',
    service: 'ECG',
    scheduledAt: new Date(Date.now() + 3600000).toISOString(),
    urgencyLevel: 'high'
  });
  console.log('Queue wait:', apt.queueInfo.estimatedWaitMinutes);

  // Cancel appointment
  await hfClient.cancelAppointment(apt.id);

  // Upload medical record
  await hfClient.uploadRecord(
    fileInput.files[0],
    'MRI scan from hospital'
  );

  // Get prescriptions
  const prescs = await hfClient.patientPrescriptions();
  const presc = await hfClient.patientPrescription(prescs[0].id);
  console.log(presc.body);  // Decrypted
</script>
```

---

## ðŸ” Security

| Component | Method | Details |
|-----------|--------|---------|
| Passwords | bcryptjs | Cost 12 (industry standard) |
| Sessions | JWT | 7-day expiration |
| Medical Data | AES-256 GCM | Authenticated encryption |
| API | Role Middleware | Admin/Doctor/Patient guards |
| Input | Type + Length | All payloads validated |
| Errors | Safe Messages | No stack traces leaked |

---

## ðŸ“Š Models

### Doctor Schema
```javascript
{
  name: String,
  email: String (unique),
  passwordHash: String,
  specialization: enum [cardiology, neurology, orthopedics, general, pediatrics, psychiatry, dermatology, emergency],
  department: String,
  experience: Number,
  services: [{
    name: String,           // "ECG", "Surgery"
    durationMinutes: Number,
    available: Boolean
  }],
  licenseNumber: String (unique),
  isActive: Boolean,
  availability: {
    mondayFriday: {start, end},
    saturday: {start, end},
    sundayOff: Boolean
  },
  maxPatientsPerDay: Number,
  avgRating: Number (0-5),
  totalPatients: Number,
  bio: String,
  timestamps
}
```

### Appointment Schema
```javascript
{
  patientId: ObjectId,
  doctorId: ObjectId,
  service: String,
  scheduledAt: Date,
  status: enum [pending, confirmed, cancelled, completed],
  notes: String,
  timestamps
}
```

---

## âœ… Testing with cURL

```bash
# 1. Check symptoms
curl -X POST http://localhost:5500/api/appointments/check-symptoms \
  -H 'Content-Type: application/json' \
  -d '{"symptoms":"chest pain and shortness of breath"}'

# 2. Get cardiology doctors
curl http://localhost:5500/api/appointments/doctors/cardiology

# 3. Get queue status
curl http://localhost:5500/api/appointments/queue-status/[DOCTOR_ID]

# 4. Get smart recommendation
curl -X POST http://localhost:5500/api/appointments/recommend \
  -H 'Content-Type: application/json' \
  -d '{"specialization":"cardiology","urgencyLevel":"high"}'

# 5. Login as patient
TOKEN=$(curl -X POST http://localhost:5500/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"patient@healthflow.test","password":"<PASSWORD>","role":"patient"}' \
  | jq -r '.token')

# 6. Get dashboard
curl http://localhost:5500/api/patient/dashboard \
  -H "Authorization: Bearer $TOKEN"

# 7. Create appointment with symptoms
curl -X POST http://localhost:5500/api/appointments/create \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "symptoms":"chest pain",
    "service":"ECG",
    "scheduledAt":"2026-04-20T10:30:00Z",
    "urgencyLevel":"high"
  }'
```

---

## ðŸš€ Production Checklist

- [ ] Generate new JWT_SECRET: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
- [ ] Generate new MEDICAL_AES_KEY: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- [ ] Use MongoDB Atlas (managed database)
- [ ] Enable HTTPS/TLS certificates
- [ ] Set NODE_ENV=production
- [ ] Configure rate limiting
- [ ] Setup error logging (Sentry/LogRocket)
- [ ] Run security audit
- [ ] Regular database backups
- [ ] Monitor performance metrics

---

## ðŸŽ¯ Frontend Integration Guide

### **Doctor UI Cards (Auto-Populated from Database)**
```javascript
// Automatically called on page load
updateLandingDoctors()
// Fetches from: GET /api/appointments/doctors/{specialization}
// Displays: Name, Rating, Services, Experience, Queue Wait Times
```

**Card Features:**
- âœ… Real doctor data from MongoDB
- âœ… Services shown inline (ECG, Tele-visit, etc.)
- âœ… Experience & rating displayed
- âœ… Real-time queue wait times (~13 min, ~17 min)

---

### **Symptom Quick-Check**
```javascript
// Call when user clicks "Get suggestion"
quickCheckSymptom(symptomInput, age, urgency)
// Sends to: POST /api/appointments/check-symptoms
// Returns: Department, Urgency Level, Confidence %, Recommendation
```

**Example Usage:**
```html
<!-- In HTML button -->
<button onclick="quickCheckSymptom('Cough + sore throat', 23, 'High')">
  Get suggestion
</button>
```

**API Response Example:**
```json
{
  "valid": true,
  "suggestedDepartment": "general",
  "urgencyLevel": "medium",
  "confidence": 95,
  "recommendedAction": "Consider throat exam + respiratory assessment"
}
```

---

### **Smart Queue Display**
```javascript
// Get real-time queue info for a doctor
getQueueInfo(doctorId)
// Returns: { estimatedWaitMinutes: 13, activeAppointments: 2, busyLevel: "low" }
```

Doctor cards automatically show:
- â± **Estimated wait time** (top-right corner)
- ðŸ“Š **Queue size** (number of active appointments)
- â­ **Rating** and **Experience years**

---

### **Emergency Mode Toggle**
```javascript
// Toggle high-contrast layout for urgent access
toggleEmergencyMode()
// Activates: Brightness + Contrast boost, Red accent color
// Usage: Click "Emergency" switch in top navigation
```

**Features:**
- ðŸš¨ High-contrast layout (visible even in poor light)
- âš¡ Faster priority for urgent cases
- ðŸ“ All functionality preserved

---

### **Protected Patient Links (JWT Required)**
```javascript
// Check authentication before accessing patient sections
checkAuthAndNavigate(section)
// section = 'patient' | 'admin' | 'doctor'

// Example:
// <button onclick="checkAuthAndNavigate('patient')">Orari Im</button>
// If not logged in â†’ redirects to login modal
// If wrong role â†’ shows error
```

---

### **Smart Appointment Booking**
```javascript
// Auto-select doctor when clicking "Rezervo VizitÃ«"
selectDoctor(doctorName)

// Full booking flow:
// 1. Click doctor card "Rezervo VizitÃ«"
// 2. selectDoctor() pre-fills doctor name
// 3. Choose date/time
// 4. Shows real queue wait info
// 5. Submit to: POST /api/appointments/create
```

---

### **Real-Time Data Updates**
All cards refresh data every time page loads:
- âœ… Doctor list from `/api/appointments/doctors`
- âœ… Queue status from `/api/appointments/queue-status`
- âœ… Symptom analysis from `/api/appointments/check-symptoms`
- âœ… Patient dashboard from `/api/patient/dashboard` (with JWT)

---

## ðŸ› Troubleshooting

| Issue | Solution |
|-------|----------|
| `Missing JWT_SECRET` | Set in .env file |
| `MongoDB connection refused` | Ensure MongoDB running on localhost:27017 |
| `Doctor not found` | Run `npm run seed` |
| `Symptom not recognized` | Add to `SYMPTOM_DATABASE` in `symptomChecker.js` |
| `Queue data not updating` | Cache expires after 1 minute, restart server if needed |
| `Doctor cards show empty/no wait times` | Ensure `/api/appointments/doctors` returns valid data |
| `Emergency Mode button doesn't appear` | Clear browser cache, refresh page |
| `Symptom check returns 'not found'` | Check `symptomChecker.js` for symptom keywords |
| `Protected links show error` | Log in first, ensure token is stored in localStorage |
| `Queue times always show 0` | Create test appointments with `npm run seed`, they show in queue |

---

### **Frontend Error Checklist:**
1. âœ… Server running on `http://localhost:5500` (not 3000)
2. âœ… MongoDB connected and `npm run seed` executed
3. âœ… Doctor cards loading with real data (check Network tab)
4. âœ… Emergency toggle appears in top-right of nav
5. âœ… Symptom Quick-Check button functional
6. âœ… JWT token saved in localStorage after login

---

**Built with â¤ï¸ for BlueCare Medical Center**

*Now serving smarter healthcare through intelligent appointment scheduling, advanced symptom analysis, and secure patient data management.*

