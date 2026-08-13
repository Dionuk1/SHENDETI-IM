(function initializeShendetiAuth(windowObject) {
    'use strict';

    const config = windowObject.SHENDETI_IM_CONFIG;
    if (!config || !windowObject.Appwrite) throw new Error('Appwrite Web SDK configuration is unavailable.');

    const { Client, Account, TablesDB, Functions, Storage, Query, ID } = windowObject.Appwrite;
    const client = new Client().setEndpoint(config.APPWRITE_ENDPOINT).setProject(config.APPWRITE_PROJECT_ID);
    const account = new Account(client);
    const tables = new TablesDB(client);
    const functions = new Functions(client);
    const storage = new Storage(client);
    const ADMIN_MAIN_GUIDANCE = 'Llogarite e administratorit duhet te kycen vetem ne panelin /admin.';
    const state = { status: 'loading', account: null, profile: null, doctorProfile: null, role: null, user: null, reason: null };
    let restoreInFlight = null;
    let sessionCheckInFlight = null;
    let loginInFlight = null;
    let registrationInFlight = null;

    function publishAuthState(status, role, reason) {
        windowObject.dispatchEvent(new CustomEvent('shendeti:auth-changed', { detail: { status, role, reason } }));
    }

    function setAnonymous(reason = 'anonymous') {
        Object.assign(state, { status: 'anonymous', account: null, profile: null, doctorProfile: null, role: null, user: null, reason });
        publishAuthState(state.status, null, reason);
    }

    async function deleteRemoteSession() {
        try { await account.deleteSession({ sessionId: 'current' }); }
        catch (error) { if (Number(error?.code) !== 401) throw error; }
    }

    function safeError(error, fallback) {
        const errorType = String(error?.type || '');
        if (Number(error?.code) === 401 && (!errorType || errorType === 'user_invalid_credentials')) return 'Emaili ose fjalëkalimi është i pasaktë.';
        if (errorType === 'user_session_already_exists') return 'Sesioni ekzistues nuk mund të pastrohej. Provo përsëri.';
        if (Number(error?.code) === 409) return 'Regjistrimi nuk mund të përfundojë me këto të dhëna.';
        if (Number(error?.code) === 429) return 'Ka shumë tentativa. Provo përsëri pas pak.';
        return fallback || 'Veprimi nuk mund të përfundojë. Provo përsëri.';
    }

    async function retryAfterStaleSession(operation) {
        try { return await operation(); }
        catch (error) {
            if (String(error?.type || '') !== 'user_session_already_exists') throw error;
            await deleteRemoteSession();
            setAnonymous('stale-session-cleared');
            return operation();
        }
    }

    function createCredentialSession(email, password) {
        const credentials = { email: String(email).trim().toLowerCase(), password };
        return retryAfterStaleSession(() => account.createEmailPasswordSession(credentials));
    }

    function createPatientAccount(name, email, password) {
        const accountData = { userId: ID.unique(), email: String(email).trim().toLowerCase(), password, name: String(name).trim() };
        return retryAfterStaleSession(() => account.create(accountData));
    }

    async function exactlyOne(tableId, authUserId) {
        const result = await tables.listRows({
            databaseId: config.APPWRITE_DATABASE_ID,
            tableId,
            queries: [Query.equal('authUserId', [authUserId]), Query.limit(2)]
        });
        if (!Array.isArray(result.rows) || result.rows.length !== 1) {
            throw new Error(tableId === config.APPWRITE_PROFILES_TABLE_ID
                ? 'Profili privat mungon ose është i dyfishtë.'
                : 'Profili i doktorit mungon ose është i dyfishtë.');
        }
        return result.rows[0];
    }

    function roleAllowedForContext(role, accessContext) {
        if (!accessContext) return true;
        if (accessContext === 'main') return role === 'patient' || role === 'doctor';
        return role === accessContext;
    }

    function roleContextError(role, accessContext) {
        const isAdminOnMain = accessContext === 'main' && role === 'admin';
        const error = new Error(isAdminOnMain
            ? ADMIN_MAIN_GUIDANCE
            : 'Roli i llogarise nuk lejohet ne kete hyrje.');
        error.routeContextDenied = true;
        error.reason = isAdminOnMain ? 'admin-main-blocked' : 'route-role-blocked';
        return error;
    }

    async function resolveCurrent(accessContext) {
        const authAccount = await account.get();
        const labels = [...new Set((authAccount.labels || []).map((label) => String(label).toLowerCase()))];
        const roles = labels.filter((label) => ['patient', 'doctor', 'admin'].includes(label));
        if (roles.length !== 1) throw new Error('Llogaria nuk ka një rol të vetëm të vlefshëm.');
        const role = roles[0];
        if (!roleAllowedForContext(role, accessContext)) throw roleContextError(role, accessContext);

        const profile = await exactlyOne(config.APPWRITE_PROFILES_TABLE_ID, authAccount.$id);
        if (profile.isActive !== true || authAccount.status === false) throw new Error('Llogaria është joaktive.');

        let doctorProfile = null;
        if (role === 'doctor') {
            doctorProfile = await exactlyOne(config.APPWRITE_DOCTOR_PROFILES_TABLE_ID, authAccount.$id);
            if (doctorProfile.isActive !== true) throw new Error('Profili i doktorit është joaktiv.');
        }

        const user = Object.freeze({
            id: authAccount.$id,
            _id: authAccount.$id,
            name: profile.name || authAccount.name || '',
            email: authAccount.email || '',
            role,
            specialization: doctorProfile?.specialization || '',
            department: doctorProfile?.department || ''
        });
        Object.assign(state, { status: 'authenticated', account: authAccount, profile, doctorProfile, role, user, reason: null });
        publishAuthState(state.status, role, 'authenticated');
        return user;
    }

    async function clearSession() {
        const shouldDeleteRemoteSession = state.status === 'authenticated' && Boolean(state.account);
        if (shouldDeleteRemoteSession) await deleteRemoteSession();
        setAnonymous('logout');
    }

    async function performLogin(email, password, accessContext) {
        try {
            if (state.status === 'loading' || restoreInFlight) await restore();
            if (state.status === 'authenticated') await clearSession();
            await createCredentialSession(email, password);
            try { return await resolveCurrent(accessContext); }
            catch (error) {
                await deleteRemoteSession();
                setAnonymous(error?.reason || 'invalid');
                throw error;
            }
        } catch (error) { throw new Error(safeError(error, error?.message)); }
    }

    function login(email, password, accessContext = 'main') {
        if (registrationInFlight) return Promise.reject(new Error('Regjistrimi është në proces. Prisni derisa të përfundojë.'));
        if (!loginInFlight) {
            loginInFlight = (async () => {
                try { return await performLogin(email, password, accessContext); }
                finally { loginInFlight = null; }
            })();
        }
        return loginInFlight;
    }

    async function restoreCurrentSession(accessContext) {
        state.status = 'loading';
        try { return await resolveCurrent(accessContext); }
        catch (error) {
            if (error?.routeContextDenied === true) await deleteRemoteSession();
            setAnonymous(Number(error?.code) === 401 ? 'expired' : (error?.reason || 'invalid'));
            return null;
        }
    }

    async function restore(accessContext) {
        if (state.status === 'authenticated' && state.user) {
            if (roleAllowedForContext(state.role, accessContext)) return state.user;
            const error = roleContextError(state.role, accessContext);
            await deleteRemoteSession();
            setAnonymous(error.reason);
            return null;
        }
        if (!restoreInFlight) {
            restoreInFlight = restoreCurrentSession(accessContext).finally(() => { restoreInFlight = null; });
        }
        const user = await restoreInFlight;
        if (!user || roleAllowedForContext(user.role, accessContext)) return user;
        const error = roleContextError(user.role, accessContext);
        await deleteRemoteSession();
        setAnonymous(error.reason);
        return null;
    }

    async function requireCurrentSession() {
        const wasAuthenticated = state.status === 'authenticated' && Boolean(state.user);
        if (!wasAuthenticated) {
            const wasRestoring = state.status === 'loading' || restoreInFlight !== null;
            const restoredUser = await restore();
            if (!restoredUser || state.status !== 'authenticated') {
                throw new Error(wasRestoring ? 'Sesioni ka skaduar. Ju lutem kyçuni përsëri.' : 'Duhet të kyçeni fillimisht.');
            }
            return restoredUser;
        }

        if (!sessionCheckInFlight) {
            sessionCheckInFlight = account.get()
                .then((authAccount) => {
                    if (!state.user || authAccount.$id !== state.user.id || authAccount.status === false) {
                        const error = new Error('Sesioni nuk përputhet me përdoruesin aktiv.');
                        error.code = 401;
                        throw error;
                    }
                    state.account = authAccount;
                    return state.user;
                })
                .catch((error) => {
                    if (Number(error?.code) === 401) setAnonymous('expired');
                    throw error;
                })
                .finally(() => { sessionCheckInFlight = null; });
        }

        try { return await sessionCheckInFlight; }
        catch (error) {
            if (Number(error?.code) === 401) throw new Error('Sesioni ka skaduar. Ju lutem kyçuni përsëri.');
            throw error;
        }
    }

    async function performPatientRegistration(name, email, password) {
        let sessionCreated = false;
        try {
            if (state.status === 'loading' || restoreInFlight) await restore();
            if (state.status === 'authenticated') throw new Error('Dilni nga llogaria aktive para se të regjistroni një pacient të ri.');
            await createPatientAccount(name, email, password);
            await createCredentialSession(email, password);
            sessionCreated = true;
            const execution = await functions.createExecution({
                functionId: config.APPWRITE_REGISTRATION_FUNCTION_ID,
                body: JSON.stringify({ operation: 'bootstrap-patient' }),
                async: false
            });
            const result = JSON.parse(execution.responseBody || '{}');
            if (execution.status !== 'completed' || result.ok !== true) throw new Error('Profili i pacientit nuk u inicializua. Kontakto administratorin.');
            return await resolveCurrent('patient');
        } catch (error) {
            if (sessionCreated) {
                await deleteRemoteSession();
                setAnonymous('registration-failed');
            }
            throw new Error(safeError(error, error?.message));
        }
    }

    function registerPatient(name, email, password) {
        if (loginInFlight) return Promise.reject(new Error('Hyrja është në proces. Prisni derisa të përfundojë.'));
        if (!registrationInFlight) {
            registrationInFlight = (async () => {
                try { return await performPatientRegistration(name, email, password); }
                finally { registrationInFlight = null; }
            })();
        }
        return registrationInFlight;
    }

    async function executeClinical(operation, payload = {}) {
        await requireCurrentSession();
        const execution = await functions.createExecution({
            functionId: config.APPWRITE_REGISTRATION_FUNCTION_ID,
            body: JSON.stringify({ operation, ...payload }),
            async: false
        });
        let data = {};
        try { data = JSON.parse(execution.responseBody || '{}'); } catch {}
        return { status: Number(execution.responseStatusCode) || (execution.status === 'completed' ? 200 : 500), data };
    }

    async function executePublicClinical(operation, payload = {}) {
        const execution = await functions.createExecution({
            functionId: config.APPWRITE_REGISTRATION_FUNCTION_ID,
            body: JSON.stringify({ operation, ...payload }),
            async: false
        });
        let data = {};
        try { data = JSON.parse(execution.responseBody || '{}'); } catch {}
        return { status: Number(execution.responseStatusCode) || (execution.status === 'completed' ? 200 : 500), data };
    }

    async function executeTriage(symptoms) {
        const execution = await functions.createExecution({
            functionId: config.APPWRITE_AI_TRIAGE_FUNCTION_ID,
            body: JSON.stringify({ operation: 'analyzeSymptoms', symptoms: String(symptoms || '') }),
            async: false
        });
        let data = {};
        try { data = JSON.parse(execution.responseBody || '{}'); } catch {}
        return { status: Number(execution.responseStatusCode) || (execution.status === 'completed' ? 200 : 500), data };
    }

    async function executeAdmin(operation, payload = {}) {
        const user = await requireCurrentSession();
        if (user.role !== 'admin') throw new Error('Kërkohet rol administratori.');
        const execution = await functions.createExecution({
            functionId: config.APPWRITE_ADMIN_FUNCTION_ID,
            body: JSON.stringify({ operation, ...payload }),
            async: false
        });
        let data = {};
        try { data = JSON.parse(execution.responseBody || '{}'); } catch {}
        return { status: Number(execution.responseStatusCode) || (execution.status === 'completed' ? 200 : 500), data };
    }

    async function downloadMedicalFile(fileId, filename) {
        const data = await storage.getFileDownload({ bucketId: 'medical-pdfs', fileId: String(fileId) });
        const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href = url; link.download = String(filename || 'dokument.pdf');
        document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    windowObject.ShendetiAuth = Object.freeze({ state, login, restore, logout: clearSession, registerPatient, executeClinical, executePublicClinical, executeTriage, executeAdmin, downloadMedicalFile, safeError });
})(window);
