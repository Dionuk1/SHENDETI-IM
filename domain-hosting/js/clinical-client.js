(function initializeClinicalClient(windowObject) {
    'use strict';

    async function call(operation, payload = {}) {
        const result = await windowObject.ShendetiAuth.executeClinical(operation, payload);
        const data = result.data || {};
        if (data.error && typeof data.error === 'object') data.error = data.error.message || 'Veprimi dështoi.';
        return new Response(JSON.stringify(data), { status: result.status, headers: { 'Content-Type': 'application/json' } });
    }

    async function callPublic(operation, payload = {}) {
        const result = await windowObject.ShendetiAuth.executePublicClinical(operation, payload);
        const data = result.data || {};
        if (data.error && typeof data.error === 'object') data.error = data.error.message || 'Veprimi publik dështoi.';
        return new Response(JSON.stringify(data), { status: result.status, headers: { 'Content-Type': 'application/json' } });
    }

    async function callTriage(symptoms) {
        const result = await windowObject.ShendetiAuth.executeTriage(symptoms);
        const data = result.data || {};
        return new Response(JSON.stringify(data), { status: result.status, headers: { 'Content-Type': 'application/json' } });
    }

    async function callAdmin(operation, payload = {}) {
        const result = await windowObject.ShendetiAuth.executeAdmin(operation, payload);
        const data = result.data || {};
        if (data.error && typeof data.error === 'object') data.error = data.error.message || 'Veprimi administrativ dështoi.';
        return new Response(JSON.stringify(data), { status: result.status, headers: { 'Content-Type': 'application/json' } });
    }

    async function body(init) {
        if (!init?.body) return {};
        try { return JSON.parse(init.body); } catch { return {}; }
    }

    function fileBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onerror = () => reject(new Error('File read failed.'));
            reader.onload = () => resolve(String(reader.result || '').split(',')[1] || ''); reader.readAsDataURL(file);
        });
    }

    function availability(schedule) {
        return {
            mondayFriday: { start: schedule?.weekdayStart || '', end: schedule?.weekdayEnd || '' },
            saturday: { start: schedule?.saturdayStart || '', end: schedule?.saturdayEnd || '' },
            sundayOff: schedule?.sundayOff !== false,
            maxPatientsPerDay: schedule?.maxPatientsPerDay
        };
    }

    function normalizeDoctorSpecialization(value) {
        const normalized = String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const aliases = {
            'kardiologji': 'cardiology', 'cardiology': 'cardiology', 'cardiologist': 'cardiology', 'cardiologists': 'cardiology',
            'neurologji': 'neurology', 'neurology': 'neurology', 'neurologist': 'neurology', 'neurologists': 'neurology',
            'ortopedi': 'orthopedics', 'orthopedic': 'orthopedics', 'orthopedics': 'orthopedics', 'orthopedist': 'orthopedics', 'orthopedists': 'orthopedics',
            'psikiatri': 'psychiatry', 'psychiatry': 'psychiatry', 'psychiatrist': 'psychiatry', 'psychiatrists': 'psychiatry',
            'mjekesi e pergjithshme': 'general', 'general': 'general', 'general medicine': 'general', 'family medicine': 'general', 'general practitioner': 'general', 'general practitioners': 'general',
            'pediatri': 'pediatrics', 'pediatric': 'pediatrics', 'pediatrics': 'pediatrics', 'pediatrician': 'pediatrics', 'pediatricians': 'pediatrics',
            'dermatologji': 'dermatology', 'dermatology': 'dermatology', 'dermatologist': 'dermatology', 'dermatologists': 'dermatology',
            'pulmonologji': 'pulmonology', 'pulmonology': 'pulmonology', 'pulmonologist': 'pulmonology', 'pulmonologists': 'pulmonology',
            'gjinekologji': 'gynecology', 'gynecology': 'gynecology', 'gynaecology': 'gynecology', 'gynecologist': 'gynecology', 'gynecologists': 'gynecology',
            'urgjence': 'emergency', 'emergency': 'emergency'
        };
        return aliases[normalized] || normalized;
    }

    async function routeLegacy(urlValue, init = {}) {
        const url = new URL(urlValue, windowObject.location.origin);
        const path = url.pathname;
        const method = String(init.method || 'GET').toUpperCase();
        const input = await body(init);
        let match;

        if (method === 'POST' && path === '/api/ai-triage/analyze-symptoms') {
            return callTriage(input.symptoms);
        }

        if (path.startsWith('/api/admin/')) {
            const page = Number(url.searchParams.get('page')) || 1;
            const limit = Number(url.searchParams.get('limit')) || 25;
            if (method === 'GET' && path === '/api/admin/health') return callAdmin('health');
            if (method === 'GET' && path === '/api/admin/stats') return callAdmin('getAnalytics', { from: url.searchParams.get('from') || undefined, to: url.searchParams.get('to') || undefined });
            if (method === 'GET' && path === '/api/admin/clinical-metadata') return callAdmin('getClinicalMetadataCounts');
            if (method === 'GET' && path === '/api/admin/notifications') return callAdmin('listNotifications', { page, limit, type: url.searchParams.get('type') || undefined, read: url.searchParams.has('read') ? url.searchParams.get('read') === 'true' : undefined });
            if (method === 'GET' && path === '/api/admin/audit-logs') return callAdmin('listAuditLogs', { page, limit, action: url.searchParams.get('action') || undefined, role: url.searchParams.get('role') || undefined, status: url.searchParams.get('status') || undefined, from: url.searchParams.get('from') || undefined, to: url.searchParams.get('to') || undefined });
            if (method === 'GET' && path === '/api/admin/users') return callAdmin('listUsers', { page, limit, search: url.searchParams.get('search') || undefined, role: url.searchParams.get('role') || undefined, isActive: url.searchParams.has('isActive') ? url.searchParams.get('isActive') === 'true' : undefined });
            if (method === 'POST' && path === '/api/admin/users') return callAdmin('createUser', {
                name: input.name, email: input.email, password: input.password, role: input.role,
                specialization: input.specialization, department: input.department, experienceYears: input.experienceYears
            });
            if (method === 'GET' && (match = /^\/api\/admin\/users\/([^/]+)$/.exec(path))) return callAdmin('getUserSummary', { userId: decodeURIComponent(match[1]) });
            if (method === 'PATCH' && (match = /^\/api\/admin\/users\/([^/]+)$/.exec(path))) {
                const userId = decodeURIComponent(match[1]);
                if (Object.keys(input).length === 1 && typeof input.isActive === 'boolean') return callAdmin('setProfileActive', { userId, isActive: input.isActive });
                return callAdmin('updateUser', {
                    userId, name: input.name, isActive: input.isActive, specialization: input.specialization, department: input.department,
                    experienceYears: input.experienceYears, weekdayStart: input.weekdayStart, weekdayEnd: input.weekdayEnd,
                    saturdayStart: input.saturdayStart, saturdayEnd: input.saturdayEnd, sundayOff: input.sundayOff, maxPatientsPerDay: input.maxPatientsPerDay
                });
            }
            if (method === 'PATCH' && (match = /^\/api\/admin\/users\/([^/]+)\/password$/.exec(path))) return callAdmin('updateUserPassword', {
                userId: decodeURIComponent(match[1]), newPassword: input.newPassword, confirmPassword: input.confirmPassword
            });
            if (method === 'PATCH' && (match = /^\/api\/admin\/users\/([^/]+)\/role$/.exec(path))) return callAdmin('changeUserRole', {
                userId: decodeURIComponent(match[1]), newRole: input.newRole, confirmed: input.confirmed === true,
                specialization: input.specialization, department: input.department, experienceYears: input.experienceYears
            });
            if (method === 'DELETE' && (match = /^\/api\/admin\/users\/([^/]+)$/.exec(path))) return callAdmin('deleteUser', {
                userId: decodeURIComponent(match[1]), confirmed: input.confirmed === true
            });
            if (method === 'GET' && path === '/api/admin/doctors') return callAdmin('listDoctors', { page, limit, specialization: url.searchParams.get('specialization') || undefined, isActive: url.searchParams.has('isActive') ? url.searchParams.get('isActive') === 'true' : undefined });
            if (method === 'GET' && (match = /^\/api\/admin\/doctors\/([^/]+)$/.exec(path))) return callAdmin('getDoctorDetails', { doctorId: decodeURIComponent(match[1]) });
            if ((method === 'PATCH' || method === 'DELETE') && (match = /^\/api\/admin\/doctors\/([^/]+)$/.exec(path))) return callAdmin('setDoctorActive', { doctorId: decodeURIComponent(match[1]), isActive: method === 'DELETE' ? false : input.isActive });
            if (method === 'GET' && path === '/api/admin/appointments') return callAdmin('listAppointments', { page, limit, status: url.searchParams.get('status') || undefined, from: url.searchParams.get('from') || undefined, to: url.searchParams.get('to') || undefined, doctorId: url.searchParams.get('doctorId') || undefined, patientId: url.searchParams.get('patientId') || undefined });
            if (method === 'PATCH' && (match = /^\/api\/admin\/appointments\/([^/]+)$/.exec(path))) return callAdmin('approveAppointment', { appointmentId: decodeURIComponent(match[1]) });
            if (method === 'DELETE' && (match = /^\/api\/admin\/appointments\/([^/]+)$/.exec(path))) return callAdmin('cancelAppointment', { appointmentId: decodeURIComponent(match[1]), reason: input.reason });
            return null;
        }

        if (method === 'GET' && (path === '/api/doctors/list' || path === '/api/public/doctors')) {
            return callPublic('listPublicDoctors', { limit: Number(url.searchParams.get('limit')) || undefined });
        }
        if (method === 'GET' && (match = /^\/api\/appointments\/doctors\/([^/]+)$/.exec(path))) {
            return call('listDoctors', { specialization: normalizeDoctorSpecialization(decodeURIComponent(match[1])) });
        }
        if (method === 'GET' && (match = /^\/api\/appointments\/slots\/([^/]+)$/.exec(path))) {
            return call('getAvailableSlots', { doctorId: decodeURIComponent(match[1]), date: url.searchParams.get('date'), service: url.searchParams.get('service') || 'Konsultim' });
        }
        if (method === 'GET' && (match = /^\/api\/appointments\/queue-status\/([^/]+)$/.exec(path))) {
            return call('getQueueStatus', { doctorId: decodeURIComponent(match[1]) });
        }
        if (method === 'GET' && path === '/api/appointments/my-appointments') return call('listMyAppointments');
        if (method === 'GET' && path === '/api/patient/dashboard') return call('getPatientDashboard');
        if (method === 'POST' && path === '/api/appointments/create') {
            return call('createAppointment', { doctorId: input.doctorId, service: input.service, scheduledAt: input.scheduledAt });
        }
        if (method === 'DELETE' && (match = /^\/api\/appointments\/([^/]+)$/.exec(path))) {
            return call('cancelMyAppointment', { appointmentId: decodeURIComponent(match[1]), reason: input.reason || '' });
        }
        if (method === 'GET' && path === '/api/doctor/appointments') return call('listDoctorAppointments');
        if (method === 'PATCH' && (match = /^\/api\/doctor\/appointments\/([^/]+)$/.exec(path))) {
            const appointmentId = decodeURIComponent(match[1]);
            return input.status === 'cancelled'
                ? call('cancelDoctorAppointment', { appointmentId, reason: input.reason || '' })
                : call('updateAppointmentStatus', { appointmentId, status: input.status });
        }
        if (method === 'DELETE' && (match = /^\/api\/doctor\/appointments\/([^/]+)$/.exec(path))) {
            return call('cancelDoctorAppointment', { appointmentId: decodeURIComponent(match[1]), reason: input.reason || '' });
        }
        if (method === 'GET' && path === '/api/doctors/schedule') {
            const result = await windowObject.ShendetiAuth.executeClinical('getDoctorSchedule');
            const data = result.data || {};
            return new Response(JSON.stringify({ ...data, availability: availability(data.schedule) }), { status: result.status, headers: { 'Content-Type': 'application/json' } });
        }
        if (method === 'PATCH' && path === '/api/doctors/schedule') {
            const payload = input.day === 'mondayFriday' ? { weekdayStart: input.start, weekdayEnd: input.end }
                : input.day === 'saturday' ? { saturdayStart: input.start, saturdayEnd: input.end }
                : input.day === 'sunday' ? { sundayOff: !input.open } : {};
            const result = await windowObject.ShendetiAuth.executeClinical('updateDoctorSchedule', payload);
            const data = result.data || {};
            if (data.error && typeof data.error === 'object') data.error = data.error.message;
            return new Response(JSON.stringify({ ...data, availability: availability(data.schedule) }), { status: result.status, headers: { 'Content-Type': 'application/json' } });
        }
        if (method === 'GET' && path === '/api/notifications') return call('listMyNotifications', { limit: Number(url.searchParams.get('limit')) || 30 });
        if (method === 'PATCH' && path === '/api/notifications/read-all') return call('markAllNotificationsRead');
        if (method === 'PATCH' && (match = /^\/api\/notifications\/([^/]+)\/read$/.exec(path))) {
            return call('markNotificationRead', { notificationId: decodeURIComponent(match[1]) });
        }
        if (method === 'GET' && path === '/api/patient/prescriptions') return call('listMyPrescriptions');
        if (method === 'GET' && (match = /^\/api\/patient\/prescriptions\/([^/]+)$/.exec(path))) return call('getMyPrescription', { prescriptionId: decodeURIComponent(match[1]) });
        if (method === 'GET' && path === '/api/patient/history') return call('listMyMedicalHistory');
        if (method === 'GET' && path === '/api/patient/records') return call('listMyMedicalRecords');
        if (method === 'POST' && path === '/api/patient/records/upload') {
            const form = init.body; const file = form instanceof FormData ? form.get('file') : null;
            if (!(file instanceof File)) return new Response(JSON.stringify({ error: 'Zgjidhni një PDF.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
            return call('uploadMyMedicalRecord', { filename: file.name, mimeType: file.type, base64: await fileBase64(file), notes: String(form.get('notes') || '') });
        }
        if (method === 'GET' && (match = /^\/api\/patient\/records\/([^/]+)\/download$/.exec(path))) {
            const result = await windowObject.ShendetiAuth.executeClinical('downloadMyMedicalRecord', { recordId: decodeURIComponent(match[1]) });
            if (result.status >= 200 && result.status < 300 && result.data?.download) await windowObject.ShendetiAuth.downloadMedicalFile(result.data.download.fileId, result.data.download.filename);
            return new Response(JSON.stringify(result.data || {}), { status: result.status, headers: { 'Content-Type': 'application/json' } });
        }
        if (method === 'GET' && path === '/api/doctor/prescriptions') return call('listDoctorPrescriptions');
        if (method === 'GET' && (match = /^\/api\/doctor\/prescriptions\/([^/]+)$/.exec(path))) return call('getDoctorPrescription', { prescriptionId: decodeURIComponent(match[1]) });
        if (method === 'POST' && path === '/api/doctor/prescriptions') return call('createPrescription', {
            patientId: input.patientId, appointmentId: input.appointmentId, diagnosis: input.diagnosis, medicationName: input.medicationName,
            dosage: input.dosage, frequency: input.frequency, duration: input.duration, instructions: input.instructions, additionalNotes: input.additionalNotes || ''
        });
        if (method === 'PATCH' && (match = /^\/api\/doctor\/prescriptions\/([^/]+)$/.exec(path))) return call('updateDoctorPrescription', {
            prescriptionId: decodeURIComponent(match[1]), diagnosis: input.diagnosis, medicationName: input.medicationName,
            dosage: input.dosage, frequency: input.frequency, duration: input.duration, instructions: input.instructions,
            additionalNotes: input.additionalNotes || ''
        });
        if (method === 'DELETE' && (match = /^\/api\/doctor\/prescriptions\/([^/]+)$/.exec(path))) return call('deleteDoctorPrescription', {
            prescriptionId: decodeURIComponent(match[1])
        });
        if (method === 'GET' && (match = /^\/api\/patients\/([^/]+)\/history$/.exec(path))) return call('getAssignedPatientHistory', { patientId: decodeURIComponent(match[1]) });
        return null;
    }

    windowObject.ShendetiClinical = Object.freeze({ call, callPublic, callAdmin, routeLegacy, normalizeDoctorSpecialization });
})(window);
