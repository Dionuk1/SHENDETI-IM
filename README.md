# SHËNDETI IM

SHËNDETI IM është një platformë digjitale shëndetësore për menaxhimin e termineve, pacientëve, doktorëve, recetave dhe historisë mjekësore. Aplikacioni ofron panele të ndara sipas rolit, kontrolle autorizimi në backend dhe një Symptom Checker të asistuar nga Gemini me analizë rezervë të bazuar në rregulla.

> Ky projekt ofron mbështetje informative dhe menaxhim të të dhënave. Symptom Checker nuk zëvendëson diagnozën ose konsultën me një profesionist shëndetësor.

## Qëllimi

Qëllimi kryesor është të centralizojë proceset bazë të një platforme klinike:

- regjistrimin dhe hyrjen e sigurt të përdoruesve;
- rezervimin dhe administrimin e termineve;
- komunikimin pacient–doktor;
- krijimin dhe leximin e recetave digjitale;
- ruajtjen e historisë dhe dokumenteve mjekësore;
- analizën orientuese të simptomave;
- monitorimin administrativ dhe auditimin e veprimeve.

## Teknologjitë

- Node.js dhe Express
- MongoDB me Mongoose
- HTML, CSS dhe JavaScript pa framework frontend
- JWT për sesionet e aplikacionit
- bcrypt për hashimin e fjalëkalimeve
- AES-256-GCM për përmbajtjen e ndjeshme mjekësore
- Gemini SDK për Symptom Checker
- Node test runner për testet automatike
- Render për backend-in e prodhimit
- Appwrite Sites dhe storage privat, sipas konfigurimit të vendosjes

## Funksionalitetet e implementuara

### Pacienti

- Regjistrim publik si pacient
- Hyrje me email dhe fjalëkalim, përfshirë dërgimin e formularit me Enter
- Rezervim termini sipas doktorit, shërbimit, datës dhe orarit
- Shfaqje e orareve të lira dhe të zëna
- Anulim i termineve personale
- Symptom Checker me Gemini dhe fallback të bazuar në rregulla
- Sugjerim departamenti dhe nivel urgjence
- Mesazhe me doktorin
- Receta digjitale dhe pamje për printim
- Histori mjekësore
- Njoftime

### Doktori

- Hyrje me email dhe fjalëkalim
- Shfaqje e pacientëve të caktuar
- Aprovim, përfundim dhe anulim terminesh
- Menaxhim i orarit
- Mesazhe me pacientët
- Krijim recetash digjitale
- Profil profesional
- Qasje e autorizuar në historinë përkatëse të pacientit

### Administratori

- Faqe e veçantë hyrjeje te `/admin`
- Menaxhim i përdoruesve
- Menaxhim i doktorëve
- Menaxhim i termineve
- Database Health
- Logs & Security dhe audit logs
- Rivendosje e mbrojtur e fjalëkalimit të një përdoruesi
- Aktivizim dhe çaktivizim llogarish

## Siguria

Implementimi aktual përfshin:

- hashim të fjalëkalimeve me bcrypt;
- JWT me afat skadimi;
- autorizim sipas roleve patient, doctor dhe admin;
- kontrolle autorizimi në backend për burimet e mbrojtura;
- enkriptim AES-256-GCM për të dhënat mjekësore;
- rate limiting për hyrjen, regjistrimin dhe krijimin e termineve;
- audit logs për veprime të rëndësishme;
- konfigurim përmes variablave të mjedisit;
- kufizim të origjinave në backend-in e prodhimit;
- përgjigje gabimi që nuk ekspozojnë detaje të brendshme;
- ruajtje private opsionale për dokumentet mjekësore.

Mos ruani sekrete në frontend, README ose skedarë të ndjekur nga Git. Skedari `.env` është lokal dhe duhet të mbetet i përjashtuar nga versionimi.

## Instalimi lokal

### Kërkesat

- Node.js 22 ose version kompatibil
- npm
- MongoDB lokal ose një instancë MongoDB e aksesueshme

### Hapat

```bash
git clone https://github.com/Dionuk1/SHENDETI-IM.git
cd SHENDETI-IM
npm install
```

Kopjoni `.env.example` si `.env` dhe plotësoni vlerat private vetëm lokalisht.

### Variablat e mjedisit

Shembull me placeholder-a të sigurt:

```env
PORT=
NODE_ENV=
MONGODB_URI=
MONGO_URI=
JWT_SECRET=
MEDICAL_AES_KEY=
GEMINI_API_KEY=
GEMINI_MODEL=
ADMIN_EMAIL=
ADMIN_PASSWORD=
FRONTEND_URL=
ALLOWED_ORIGINS=
MEDICAL_STORAGE_DRIVER=
APPWRITE_ENDPOINT=
APPWRITE_PROJECT_ID=
APPWRITE_API_KEY=
APPWRITE_MEDICAL_BUCKET_ID=
MAX_REQUESTS_PER_MINUTE=
MAX_FAILED_LOGINS=
BAN_DURATION_MINUTES=
ADMIN_IPS=
```

- Në prodhim përdorni `MONGODB_URI`.
- `JWT_SECRET` duhet të jetë sekret i fortë.
- `MEDICAL_AES_KEY` duhet të jetë 32 bytes, i koduar si 64 karaktere hex ose base64.
- Pa `GEMINI_API_KEY`, Symptom Checker përdor analizën rezervë të bazuar në rregulla.
- Variablat Appwrite nevojiten vetëm kur përdoret driver-i përkatës i storage.

### MongoDB

Për zhvillim lokal mund të përdoret databaza:

```text
mongodb://127.0.0.1:27017/healthflow_os
```

Mos e vendosni URI-në e prodhimit ose kredencialet e MongoDB në skedarë të ndjekur nga Git.

### Nisja

```bash
npm start
```

Aplikacioni lokal përdor zakonisht:

- Web: `http://localhost:5500`
- Admin: `http://localhost:5500/admin`

Backend-i i veçuar për prodhim gjendet te `backend/`:

```bash
cd backend
npm ci
npm start
```

## Skriptet e zhvillimit

```bash
npm run check
npm test
npm run seed
npm run bootstrap:admin
npm run reset:user-passwords
npm run cleanup:development-users
```

Skriptet e seed, reset dhe cleanup janë mjete zhvillimi. Lexoni opsionet e tyre dhe përdorni flag-un për aplikim vetëm pasi të jetë bërë backup dhe të jetë verifikuar objekti i ndryshimit.

## Struktura e projektit

```text
.
├── backend/                 # Backend API për vendosjen e prodhimit
├── bluecare/index.html      # UI e aplikacionit lokal
├── domain-hosting/          # Frontend statik për hosting
├── public/                  # Asete dhe hyrja lokale e administratorit
├── src/
│   ├── config/              # MongoDB
│   ├── controllers/         # Kontrolluesit AI
│   ├── middleware/          # Auth, role, rate-limit dhe fraud detection
│   ├── models/              # Modelet Mongoose
│   ├── routes/              # API-të sipas domain-it
│   ├── services/            # Gemini, queue dhe sugjerimi i departamentit
│   └── utils/               # AES, audit, termine, receta dhe njoftime
├── test/                    # Testet automatike
├── render.yaml              # Konfigurimi i backend-it në Render
└── .env.example             # Emrat e konfigurimit pa sekrete
```

## Përmbledhje e API-së

| Prefiksi | Qëllimi |
|---|---|
| `/api/auth` | Regjistrim, hyrje, hyrje admin dhe sesioni aktual |
| `/api/appointments` | Doktorë, orare, rezervime, queue dhe anulime |
| `/api/patient` | Dashboard, termine, receta, histori dhe dokumente |
| `/api/doctor` | Termine, pacientë dhe receta |
| `/api/doctors` | Orari i doktorit |
| `/api/admin` | Users, termine, health, statistika dhe audit logs |
| `/api/admin/doctors` | Menaxhimi administrativ i doktorëve |
| `/api/notifications` | Njoftime dhe statusi read/unread |
| `/api/ai` | Analiza e simptomave, departamenti, dokumentet dhe queue prediction |

Endpoint-et klinike dhe administrative mbrohen me JWT dhe kontrolle roli.

## Testimi

```bash
npm run check
npm test
```

Testet e integrimit me databazë janë opt-in:

```powershell
$env:RUN_INTEGRATION='1'
$env:TEST_BASE_URL='http://localhost:5510'
npm test
```

Kontrolli manual para prodhimit duhet të përfshijë hyrjen për secilin rol, navigimin e përsëritur, rezervimin/anulimin e terminit, mesazhet, recetat, njoftimet dhe një kërkesë reale të Symptom Checker.

## Screenshots

Pamjet aktuale të desktopit, telefonit, paneleve sipas rolit dhe printimit të recetës duhet të kapen nga build-i i fundit përpara publikimit. Mos përdorni pamje që tregojnë kredenciale, token-e ose të dhëna reale pacientësh.

## Kufizime të njohura

- Symptom Checker është orientues dhe nuk ofron diagnozë mjekësore.
- Integrimi Gemini varet nga çelësi, modeli, quota dhe disponueshmëria e shërbimit.
- Mesazhet aktuale janë funksion i aplikacionit dhe jo zëvendësim për komunikim emergjent.
- Testet e integrimit kërkojnë MongoDB dhe konfigurim të veçantë.
- Verifikimi vizual i responsive layout dhe print preview mbetet pjesë e QA-së manuale.

## Përmirësime të ardhshme

- Teste browser end-to-end për të tre rolet
- Rikuperim fjalëkalimi përmes emailit
- Monitorim dhe observability të centralizuar
- Përmirësim i aksesueshmërisë dhe testimit me screen readers
- Pipeline CI për syntax, test, secret scanning dhe deploy verification

## Licenca

Ky projekt shpërndahet me licencën MIT. Shihni [LICENSE](LICENSE). Mund të përdoret gjithashtu si projekt akademik ose demonstrues; përdorimi klinik real kërkon shqyrtim të veçantë ligjor, sigurie dhe pajtueshmërie.

