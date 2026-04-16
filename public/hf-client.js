/**
 * HealthFlow OS Frontend Client
 * Wraps API calls with JWT + role-based UI
 */

const API_BASE = '/api';

class HealthFlowClient {
    constructor() {
        this.token = localStorage.getItem('hf_token');
        this.user = this.token ? JSON.parse(localStorage.getItem('hf_user') || '{}') : null;
    }

    async request(method, path, body = null) {
        const opts = {
            method,
            headers: { 'Content-Type': 'application/json' },
        };

        if (this.token) {
            opts.headers.Authorization = `Bearer ${this.token}`;
        }

        if (body) {
            opts.body = JSON.stringify(body);
        }

        const res = await fetch(`${API_BASE}${path}`, opts);
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            const e = new Error(err.error || res.statusText);
            e.status = res.status;
            throw e;
        }

        return res.status === 204 ? null : res.json();
    }

    async register(name, email, password) {
        const data = await this.request('POST', '/auth/register', { name, email, password });
        this.setToken(data.token, data.user);
        return data.user;
    }

    async login(email, password, role) {
        const data = await this.request('POST', '/auth/login', { email, password, role });
        this.setToken(data.token, data.user);
        return data.user;
    }

    async me() {
        if (!this.token) return null;
        try {
            const data = await this.request('GET', '/auth/me');
            return data.user;
        } catch {
            return null;
        }
    }

    async logout() {
        this.token = null;
        this.user = null;
        localStorage.removeItem('hf_token');
        localStorage.removeItem('hf_user');
    }

    setToken(token, user) {
        this.token = token;
        this.user = user;
        localStorage.setItem('hf_token', token);
        localStorage.setItem('hf_user', JSON.stringify(user));
    }

    // Patient routes
    async patientAppointments() {
        const data = await this.request('GET', '/patient/appointments');
        return data.appointments || [];
    }

    async createAppointment(doctorId, service, scheduledAt, notes) {
        const data = await this.request('POST', '/patient/appointments', {
            doctorId,
            service,
            scheduledAt,
            notes,
        });
        return data.appointment;
    }

    async patientPrescriptions() {
        const data = await this.request('GET', '/patient/prescriptions');
        return data.prescriptions || [];
    }

    async patientPrescription(id) {
        const data = await this.request('GET', `/patient/prescriptions/${id}`);
        return data.prescription;
    }

    async patientRecords() {
        const data = await this.request('GET', '/patient/records');
        return data.records || [];
    }

    async uploadRecord(file, notes) {
        const form = new FormData();
        form.append('file', file);
        if (notes) {
            form.append('notes', notes);
        }

        const opts = {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.token}` },
            body: form,
        };

        const res = await fetch(`${API_BASE}/patient/records/upload`, opts);
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(err.error || res.statusText);
        }

        return res.json();
    }

    async downloadRecord(id, originalName) {
        if (!this.token) {
            throw new Error('Not authenticated');
        }

        const res = await fetch(`${API_BASE}/patient/records/${id}/download`, {
            headers: { Authorization: `Bearer ${this.token}` },
        });

        if (!res.ok) {
            throw new Error('Download failed');
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = originalName || 'record.pdf';
        a.click();
        URL.revokeObjectURL(url);
    }

    // Doctor routes
    async doctorAppointments() {
        const data = await this.request('GET', '/doctor/appointments');
        return data.appointments || [];
    }

    async updateAppointmentStatus(id, status) {
        await this.request('PATCH', `/doctor/appointments/${id}`, { status });
    }

    async doctorPrescriptions() {
        const data = await this.request('GET', '/doctor/prescriptions');
        return data.prescriptions || [];
    }

    async doctorPrescription(id) {
        const data = await this.request('GET', `/doctor/prescriptions/${id}`);
        return data.prescription;
    }

    async createPrescription(patientId, title, body, appointmentId) {
        const data = await this.request('POST', '/doctor/prescriptions', {
            patientId,
            title,
            body,
            appointmentId,
        });
        return data.prescription;
    }

    // Admin routes
    async adminHealth() {
        const data = await this.request('GET', '/admin/health');
        return data;
    }

    async adminUsers(role) {
        const url = role ? `/admin/users?role=${role}` : '/admin/users';
        const data = await this.request('GET', url);
        return data.users || [];
    }

    async createUser(name, email, password, role) {
        const data = await this.request('POST', '/admin/users', {
            name,
            email,
            password,
            role,
        });
        return data.user;
    }

    async updateUser(id, role, name) {
        const data = await this.request('PATCH', `/admin/users/${id}`, { role, name });
        return data.user;
    }

    async deleteUser(id) {
        await this.request('DELETE', `/admin/users/${id}`);
    }

    async adminAppointments() {
        const data = await this.request('GET', '/admin/appointments');
        return data.appointments || [];
    }

    async adminUpdateAppointmentStatus(id, status) {
        await this.request('PATCH', `/admin/appointments/${id}`, { status });
    }

    async adminDeleteAppointment(id) {
        await this.request('DELETE', `/admin/appointments/${id}`);
    }

    // Public
    async publicDoctors() {
        const data = await this.request('GET', '/public/doctors');
        return data.doctors || [];
    }

    async publicDoctorsList(specialization) {
        const url = specialization ? `/doctors/list?specialization=${specialization}` : '/doctors/list';
        const data = await this.request('GET', url);
        return data.doctors || [];
    }

    // Appointment & Queue Management (Public endpoints)
    async checkSymptoms(symptoms) {
        const data = await this.request('POST', '/appointments/check-symptoms', { symptoms });
        return data;
    }

    async getAvailableDoctors(specialization, format = 'basic') {
        const url = format === 'full' ? `/appointments/doctors/${specialization}?format=full` : `/appointments/doctors/${specialization}`;
        const data = await this.request('GET', url);
        return data.doctors || [];
    }

    async getQueueStatus(doctorId) {
        const data = await this.request('GET', `/appointments/queue-status/${doctorId}`);
        return data.queue;
    }

    async getSmartQueueRecommendation(specialization, urgencyLevel = 'low', emergencyMode = false) {
        const data = await this.request('POST', '/appointments/recommend', {
            specialization,
            urgencyLevel,
            emergencyMode,
        });
        return data;
    }

    // Patient Dashboard & Appointments (Patient only)
    async patientDashboard() {
        const data = await this.request('GET', '/patient/dashboard');
        return data;
    }

    async patientAppointments() {
        // Legacy method compatibility
        const dashboard = await this.patientDashboard();
        return dashboard?.schedule?.appointments || [];
    }

    async createAppointmentSmart(payload) {
        // Enhanced appointment creation with smart queue
        // payload: { doctorId?, specialization?, service, scheduledAt, symptoms?, urgencyLevel?, emergencyMode? }
        const data = await this.request('POST', '/appointments/create', payload);
        return data.appointment;
    }

    async createAppointment(doctorId, service, scheduledAt, notes) {
        // Legacy method compatibility
        return this.createAppointmentSmart({ doctorId, service, scheduledAt, notes });
    }

    async cancelAppointment(id) {
        await this.request('DELETE', `/appointments/${id}`);
    }
}

// Singleton
window.hfClient = new HealthFlowClient();
