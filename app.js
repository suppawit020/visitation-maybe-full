// ============================================================
// APP CONFIGURATION & CONSTANTS
// ============================================================
const CONFIG = {
    KEYS: {
        PROFILE: 'outlet_profile_v1',
        SESSION: 'checklist_user_session',
        REMEMBER: 'checklist_user_remember',
        AUTOSAVE: 'checklist_autosave_v1',
        LOGIN_AT: 'checklist_login_at',
        APPOINTMENTS: 'checklist_calendar_appointments' // เพิ่มคีย์สำหรับเก็บนัดหมาย
    },
    SUPABASE: {
        URL: 'https://bvonujjvovziubyhqsjx.supabase.co',
        KEY: 'sb_publishable_GBw0pKHMLihSSfRTpnxuTw_e0OC1hYD'
    },
    SESSION_HOURS: {
        DEFAULT: 8,
        REMEMBER: 720
    },
    PAGE_SIZE: 5,
    MAX_PHOTOS: 10,
    ALLOW_LIBRARY_UPLOAD: true
};

// ============================================================
// CRYPTO UTILITIES
// ============================================================
async function sha256(text) {
    const buf = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(text)
    );
    return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// ============================================================
// SUPABASE DB & STORAGE
// ============================================================
const DB = {
    async query(path, opts = {}) {
        const res = await fetch(CONFIG.SUPABASE.URL + '/rest/v1/' + path, {
            ...opts,
            cache: 'no-store',
            headers: {
                'apikey': CONFIG.SUPABASE.KEY,
                'Authorization': 'Bearer ' + CONFIG.SUPABASE.KEY,
                'Content-Type': 'application/json',
                'Prefer': opts.prefer || 'return=representation',
                ...opts.headers
            }
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`DB Error ${res.status}: ${text.substring(0, 200)}`);
        return text ? JSON.parse(text) : null;
    },

    async select(table, params = '') {
        return this.query(`${table}?${params}`);
    },

    async insert(table, payload) {
        return this.query(table, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    },

    async update(table, params, payload) {
        return this.query(`${table}?${params}`, {
            method: 'PATCH',
            prefer: 'return=minimal',
            body: JSON.stringify(payload)
        });
    },

    async uploadFile(bucket, path, blob, contentType = 'image/jpeg') {
        const res = await fetch(`${CONFIG.SUPABASE.URL}/storage/v1/object/${bucket}/${path}`, {
            method: 'POST',
            headers: {
                'apikey': CONFIG.SUPABASE.KEY,
                'Authorization': 'Bearer ' + CONFIG.SUPABASE.KEY,
                'Content-Type': contentType,
                'x-upsert': 'false'
            },
            body: blob
        });
        if (!res.ok) { const t = await res.text(); throw new Error(t); }
        return `${CONFIG.SUPABASE.URL}/storage/v1/object/public/${bucket}/${path}`;
    }
};

const TEAM_STRUCTURE = {
    'Admin': ['Admin'],
    'Horeca': ['BKK', 'EAST'],
    'On Premise': ['BKK', 'EAST', 'North+Northeast'],
    'Southern': ['Phuket-HRC', 'Phuket-OP', 'Samui-HRC', 'Samui-OP']
};

let AppState = {
    cameraStream: null,
    isCameraLoading: false,
    currentFacingMode: 'environment',
    visits: [],
    photos: [],
    userProfile: { empId: '', name: '', email: '', team: '', area: '', contact: '', avatar: '' },
    currentPage: 0,
    pendingSaveData: null,
    deleteTargetId: null,
    tomSelectCustomer: null,
    loggedInUser: null,
    realtimeChannel: null,
    visitRealtimeChannel: null,
    notifInterval: null,
    totalPages: 1,
    totalCount: 0,
    fpDate: null,
    fpNextDate: null,
    fpFilterDate: null,
    isClearingForm: false,
    calendarObj: null,
    localAppointments: [],
    notifications: [] // เก็บ notification list
};

// ============================================================
// INITIALIZATION & SESSION
// ============================================================
window.addEventListener('DOMContentLoaded', async () => {
    initDarkMode();
    await checkSession();
});

async function checkSession() {
    try {
        const rawProfile = localStorage.getItem(CONFIG.KEYS.PROFILE);
        const isRemember = !!localStorage.getItem(CONFIG.KEYS.REMEMBER);
        const hasSession = isRemember || !!sessionStorage.getItem(CONFIG.KEYS.SESSION);

        if (!rawProfile || !hasSession) return false;
        const loginAt = parseInt(localStorage.getItem(CONFIG.KEYS.LOGIN_AT) || '0', 10);
        if (loginAt) {
            const maxHours = isRemember
                ? CONFIG.SESSION_HOURS.REMEMBER
                : CONFIG.SESSION_HOURS.DEFAULT;
            const elapsedHours = (Date.now() - loginAt) / 3600000;
            if (elapsedHours > maxHours) {
                _clearSessionStorage();
                showSessionExpiredBanner();
                return false;
            }
        }

        const localProfile = JSON.parse(rawProfile);
        if (!localProfile.empId && !localProfile.name) return false;

        AppState.userProfile = {
            empId: localProfile.empId || '',
            name: localProfile.name || '',
            email: localProfile.email || '',
            team: localProfile.team || '',
            subTeam: localProfile.subTeam || '',
            area: localProfile.area || '',
            contact: localProfile.contact || '-',
            avatar: localProfile.avatar || ''
        };

        // โหลดนัดหมายจาก LocalStorage
        const savedApts = localStorage.getItem(CONFIG.KEYS.APPOINTMENTS);
        if (savedApts) AppState.localAppointments = JSON.parse(savedApts);

        // โหลด notifications จาก localStorage
        try {
            const savedNotifs = localStorage.getItem('visitation_notifications');
            if (savedNotifs) AppState.notifications = JSON.parse(savedNotifs);
        } catch (e) { AppState.notifications = []; }

        showMainApp();
        return true;
    } catch (e) {
        console.error("Session check error:", e);
        return false;
    }
}

function _clearSessionStorage() {
    sessionStorage.removeItem(CONFIG.KEYS.SESSION);
    localStorage.removeItem(CONFIG.KEYS.REMEMBER);
    localStorage.removeItem(CONFIG.KEYS.PROFILE);
    localStorage.removeItem(CONFIG.KEYS.LOGIN_AT);
}

function showSessionExpiredBanner() {
    const errEl = document.getElementById('login-error');
    if (errEl) {
        errEl.textContent = 'Your session has expired. Please sign in again.';
        errEl.style.display = 'block';
    }
}

function initApp() {
    AppState.fpDate = flatpickr("#f-date", {
        altInput: true, altFormat: "d M Y", dateFormat: "Y-m-d", defaultDate: "today", minDate: "today", maxDate: "today"
    });

    AppState.fpNextDate = flatpickr("#f-next-date", {
        altInput: true,
        altFormat: "d M Y",
        dateFormat: "Y-m-d",
        minDate: "today",
        onReady: function (_, __, fp) {
            // inject time dropdowns below calendar
            const cal = fp.calendarContainer;
            const timeRow = document.createElement('div');
            timeRow.className = 'fp-custom-time-row';
            timeRow.innerHTML = `
                <span class="fp-time-label">Time</span>
                <select id="fp-next-hour" class="fp-time-select">
                    ${Array.from({ length: 24 }, (_, i) => `<option value="${String(i).padStart(2, '0')}">${String(i).padStart(2, '0')}</option>`).join('')}
                </select>
                <span class="fp-time-sep">:</span>
                <select id="fp-next-min" class="fp-time-select">
                    ${['00', '15', '30', '45'].map(m => `<option value="${m}">${m}</option>`).join('')}
                </select>`;
            cal.appendChild(timeRow);
            // default 09:00
            document.getElementById('fp-next-hour').value = '09';
        },
        onClose: function (selectedDates, dateStr, fp) {
            if (!selectedDates[0]) return;
            const h = document.getElementById('fp-next-hour')?.value || '09';
            const m = document.getElementById('fp-next-min')?.value || '00';
            // store datetime in hidden field format
            const d = selectedDates[0];
            const pad = n => String(n).padStart(2, '0');
            const full = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${h}:${m}`;
            fp.input.value = full;
            fp.altInput.value = `${pad(d.getDate())} ${d.toLocaleString('en', { month: 'short' })} ${d.getFullYear()} ${h}:${m}`;
        }
    });

    AppState.fpFilterDate = flatpickr("#fl-date-wrap", {
        wrap: true, altInput: true, altFormat: "d M Y", dateFormat: "Y-m-d",
        onChange: function () { resetAndFetch(); }
    });

    bindPositionToggle();
    prefillAndLockTeamFields();

    document.getElementById('profile-menu-wrap').style.display = 'block';

    const localProfile = JSON.parse(localStorage.getItem(CONFIG.KEYS.PROFILE)) || AppState.userProfile;
    AppState.userProfile.avatar = localProfile.avatar || '';

    const initial = (AppState.userProfile.name || 'U').charAt(0).toUpperCase();
    document.getElementById('avatar-small-text').textContent = initial;
    document.getElementById('avatar-text').textContent = initial;

    document.getElementById('pd-name').textContent = AppState.userProfile.name;
    document.getElementById('pd-emp-id').textContent = AppState.userProfile.empId || 'NO ID';
    document.getElementById('pd-email').textContent = AppState.userProfile.email;
    document.getElementById('pd-team').textContent = AppState.userProfile.team || 'No Team';
    const subTeamEl = document.getElementById('pd-sub-team');
    if (subTeamEl) subTeamEl.textContent = AppState.userProfile.subTeam || '-';
    document.getElementById('pd-contact').textContent = AppState.userProfile.contact || '-';

    loadAvatarUI();

    const cbNext = document.getElementById('cb-next-visit');
    if (cbNext && !cbNext._bound) {
        cbNext._bound = true;
        cbNext.addEventListener('change', function () {
            document.getElementById('next-visit-wrap').style.display = this.checked ? 'block' : 'none';
            if (this.checked && AppState.fpNextDate) AppState.fpNextDate.setDate(today());
        });
    }

    loadCustomerDropdown();
    bindAutoSave();
    loadAutoSaveData();
    switchTab('new');

    loadVisitsFromDB();
    setupRealtime();
}

function prefillAndLockTeamFields() {
    const mainTeam = AppState.userProfile.team || '';
    const localProfile = JSON.parse(localStorage.getItem(CONFIG.KEYS.PROFILE)) || {};
    const subTeam = AppState.userProfile.subTeam || localProfile.subTeam || '';

    const mainSelect = document.getElementById('f-main-team');
    const subSelect = document.getElementById('f-sub-team');
    if (!mainSelect || !subSelect) return;

    if (mainTeam) {
        if (!mainSelect.querySelector(`option[value="${mainTeam}"]`)) {
            const opt = document.createElement('option');
            opt.value = mainTeam; opt.textContent = mainTeam;
            mainSelect.appendChild(opt);
        }
        mainSelect.value = mainTeam;
        mainSelect.disabled = true;

        subSelect.innerHTML = '';
        const subs = TEAM_STRUCTURE[mainTeam] || (subTeam ? [subTeam] : []);
        subs.forEach(sub => {
            const opt = document.createElement('option');
            opt.value = sub; opt.textContent = sub;
            subSelect.appendChild(opt);
        });
    }

    if (subTeam) {
        subSelect.value = subTeam;
        subSelect.disabled = true;
    }
}

async function loadCustomerDropdown() {
    try {
        const team = (AppState.userProfile.team || '').trim().toLowerCase();
        const isAdmin = (team === 'admin');
        const empId = AppState.userProfile.empId;
        const bdeName = AppState.userProfile.name;

        let params = `select=customer_id,name_of_outlet&status=neq.INACTIVE&order=customer_id.asc`;
        if (!isAdmin) {
            if (empId && bdeName) params += `&or=(user_id.eq.${encodeURIComponent(empId)},bde.eq.${encodeURIComponent(bdeName)})`;
            else if (empId) params += `&user_id=eq.${encodeURIComponent(empId)}`;
            else if (bdeName) params += `&bde=eq.${encodeURIComponent(bdeName)}`;
        }

        const data = await DB.select('customer_information', params);

        const selectEl = document.getElementById('f-customer');
        if (!selectEl) return;

        if (AppState.tomSelectCustomer) {
            AppState.tomSelectCustomer.destroy();
            AppState.tomSelectCustomer = null;
        }

        const options = (data || []).map(c => ({
            value: c.customer_id,
            text: `${c.name_of_outlet}`,
            searchText: `${c.customer_id} ${c.name_of_outlet}`,
            outletName: c.name_of_outlet
        }));

        AppState.tomSelectCustomer = new TomSelect(selectEl, {
            options: options,
            items: [],
            valueField: 'value',
            labelField: 'text',
            searchField: ['text', 'searchText'],
            sortField: { field: 'value', direction: 'asc' },
            placeholder: options.length > 0 ? '-- Select outlet --' : 'No outlets found',
            allowEmptyOption: true,
            maxOptions: 500,
            maxItems: 1,
            plugins: ['clear_button'],
            render: {
                option: function (item, escape) {
                    return `<div><span style="color:var(--text-muted);font-size:11px;margin-right:6px;">${escape(item.value)}</span>${escape(item.text)}</div>`;
                },
                item: function (item, escape) {
                    return `<div>${escape(item.text)}</div>`;
                }
            },
            onChange: function (value) {
                const opt = options.find(o => o.value === value);
                document.getElementById('f-outlet-name').value = opt ? opt.outletName : '';
                saveAutoSaveData();
            }
        });

    } catch (e) {
        console.error("Load customers error:", e);
    }
}

window.handleFilterPosChange = function () {
    const pos = document.getElementById('fl-pos').value;
    const otherInput = document.getElementById('fl-pos-other');
    if (pos === '__other__') {
        otherInput.style.display = 'block';
        otherInput.focus();
    } else {
        otherInput.style.display = 'none';
        otherInput.value = '';
        resetAndFetch();
    }
}

// ============================================================
// AUTHENTICATION MODULE
// ============================================================
window.doUserLogin = async function () {
    const usernameInput = document.getElementById('login-username').value.trim();
    const pass = document.getElementById('login-pass').value;
    const remember = document.getElementById('login-remember').checked;
    const errEl = document.getElementById('login-error');
    const btn = document.getElementById('btn-login');
    errEl.style.display = 'none';

    if (!usernameInput || !pass) {
        errEl.textContent = 'Please enter username and password.';
        errEl.style.display = 'block';
        return;
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Signing in...'; }

    try {
        const data = await DB.select(
            'user_information',
            `select=*,users(id,password_hash,is_active)&username=eq.${encodeURIComponent(usernameInput)}&limit=1`
        );

        const info = data && data[0];

        if (!info) {
            errEl.textContent = 'Invalid username or password.';
            errEl.style.display = 'block';
            return;
        }
        if (info.users && info.users.is_active === false) {
            errEl.textContent = 'This account has been disabled. Please contact admin.';
            errEl.style.display = 'block';
            return;
        }
        const storedHash = info.users?.password_hash || '';
        const inputHash = await sha256(pass);
        const isValid = storedHash === inputHash;
        if (!isValid) {
            errEl.textContent = 'Invalid username or password.';
            errEl.style.display = 'block';
            return;
        }

        AppState.userProfile = {
            empId: info.user_id,
            name: info.name,
            email: info.email,
            team: info.team,
            subTeam: info.sub_team,
            area: info.level,
            contact: info.contact || '-',
            avatar: info.avatar || ''
        };

        const profilePayload = JSON.stringify(AppState.userProfile);
        localStorage.setItem(CONFIG.KEYS.PROFILE, profilePayload);
        localStorage.setItem(CONFIG.KEYS.LOGIN_AT, Date.now().toString());

        if (remember) {
            localStorage.setItem(CONFIG.KEYS.REMEMBER, 'true');
            localStorage.removeItem(CONFIG.KEYS.SESSION);
        } else {
            localStorage.removeItem(CONFIG.KEYS.REMEMBER);
            sessionStorage.setItem(CONFIG.KEYS.SESSION, 'true');
        }
        playWelcomeAnimation(AppState.userProfile.name, showMainApp);
    } catch (e) {
        errEl.textContent = 'Login failed: ' + e.message;
        errEl.style.display = 'block';
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; }
    }
}

window.doUserLogout = function () {
    _clearSessionStorage();
    if (AppState.realtimeChannel) {
        try { AppState.realtimeChannel.unsubscribe(); } catch (e) { }
        AppState.realtimeChannel = null;
    }
    if (AppState.visitRealtimeChannel) {
        try { AppState.visitRealtimeChannel.unsubscribe(); } catch (e) { }
        AppState.visitRealtimeChannel = null;
    }
    if (AppState.notifInterval) {
        clearInterval(AppState.notifInterval);
        AppState.notifInterval = null;
    }

    AppState.loggedInUser = null;
    AppState.userProfile = { empId: '', name: '', email: '', team: '', area: '', contact: '', avatar: '' };
    AppState.visits = [];
    AppState.photos = [];

    stopCamera();
    document.getElementById('profile-menu-wrap').style.display = 'none';
    document.getElementById('profile-dropdown').classList.remove('show');
    loadAvatarUI();

    document.getElementById('main-app').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('login-username').value = '';
    document.getElementById('login-pass').value = '';
    document.getElementById('login-remember').checked = false;
    document.getElementById('login-error').style.display = 'none';

    document.getElementById('login-pass').type = 'password';
    document.getElementById('eye-icon').innerHTML = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>`;
}

window.togglePasswordVisibility = function () {
    const passInput = document.getElementById('login-pass');
    const eyeIcon = document.getElementById('eye-icon');

    if (passInput.type === 'password') {
        passInput.type = 'text';
        eyeIcon.innerHTML = `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>`;
    } else {
        passInput.type = 'password';
        eyeIcon.innerHTML = `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>`;
    }
}

// ============================================================
// DATABASE & STORAGE OPERATIONS
// ============================================================

window.resetAndFetch = function () {
    AppState.currentPage = 0;
    fetchVisitsWithSkeleton();
}

let searchTimeout;
window.debounceSearch = function () {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => { window.resetAndFetch(); }, 500);
}

async function loadVisitsFromDB() {
    try {
        const rangeStart = AppState.currentPage * CONFIG.PAGE_SIZE;
        const rangeEnd = (AppState.currentPage + 1) * CONFIG.PAGE_SIZE - 1;

        const empId = AppState.userProfile.empId;
        const bdeName = AppState.userProfile.name;
        const team = (AppState.userProfile.team || '').trim().toLowerCase();
        const isAdmin = (team === 'admin');

        const filterArea = document.getElementById('fl-area')?.value || '';
        const filterDate = document.getElementById('fl-date')?.value || '';
        const filterSearch = document.getElementById('fl-search')?.value.toLowerCase().trim() || '';
        const filterPosRaw = document.getElementById('fl-pos')?.value || '';
        const filterPos = filterPosRaw === '__other__'
            ? (document.getElementById('fl-pos-other')?.value.trim() || '')
            : filterPosRaw;
        let filters = `or=(req_status.is.null,req_status.neq.approved)`;

        if (!isAdmin) {
            if (empId && bdeName) {
                filters += `&or=(user_id.eq.${encodeURIComponent(empId)},bde.eq.${encodeURIComponent(bdeName)})`;
            } else if (empId) {
                filters += `&user_id=eq.${encodeURIComponent(empId)}`;
            } else if (bdeName) {
                filters += `&bde=eq.${encodeURIComponent(bdeName)}`;
            } else {
                filters += `&id=eq.00000000-0000-0000-0000-000000000000`;
            }
        }

        if (filterArea) filters += `&team=eq.${encodeURIComponent(filterArea)}`;
        if (filterDate) filters += `&date_visit=eq.${encodeURIComponent(filterDate)}`;
        if (filterSearch) filters += `&or=(name_of_outlet.ilike.*${encodeURIComponent(filterSearch)}*,visit_report.ilike.*${encodeURIComponent(filterSearch)}*)`;
        if (filterPos) filters += `&visit_report=ilike.*- ${encodeURIComponent(filterPos)}]*`;
        const countRes = await fetch(
            `${CONFIG.SUPABASE.URL}/rest/v1/visitation?${filters}&select=id`,
            {
                cache: 'no-store',
                headers: {
                    'apikey': CONFIG.SUPABASE.KEY,
                    'Authorization': 'Bearer ' + CONFIG.SUPABASE.KEY,
                    'Prefer': 'count=exact'
                }
            }
        );
        AppState.totalCount = parseInt(countRes.headers.get('content-range')?.split('/')[1] || '0', 10);
        AppState.totalPages = Math.max(1, Math.ceil(AppState.totalCount / CONFIG.PAGE_SIZE));

        const visitsData = await DB.query(
            `visitation?${filters}&select=*&order=date_visit.desc&limit=${CONFIG.PAGE_SIZE}&offset=${rangeStart}`,
            { headers: { 'Range': `${rangeStart}-${rangeEnd}`, 'Range-Unit': 'items' } }
        );
        const userIds = [...new Set((visitsData || []).map(v => v.user_id).filter(Boolean))];
        let usersMap = {};
        if (userIds.length > 0) {
            const usersData = await DB.select(
                'user_information',
                `select=user_id,sub_team&user_id=in.(${userIds.map(encodeURIComponent).join(',')})`
            );
            if (usersData) usersData.forEach(u => usersMap[u.user_id] = u.sub_team);
        }

        const formatted = (visitsData || []).map(v => {
            let parsedPhotos = [];
            try { parsedPhotos = v.visit_capture ? JSON.parse(v.visit_capture) : []; } catch (e) { }

            let extractedPerson = '', extractedPosition = '', extractedReason = v.visit_report || '';
            const reportMatch = extractedReason.match(/^\[Person Met:\s*(.*?)\s*-\s*(.*?)\]\n\n([\s\S]*)$/);
            if (reportMatch) {
                extractedPerson = reportMatch[1];
                extractedPosition = reportMatch[2];
                extractedReason = reportMatch[3];
            } else {
                extractedPerson = v.bde || '';
            }

            // แยกวันที่และเวลานัดหมายครั้งถัดไป
            let nextDateStr = null;
            const matchNext = (v.visit_result || '').match(/Schedule Next Visit:\s*([0-9]{1,2}\s[A-Za-z]{3}\s[0-9]{4}(?:\s[0-9]{2}:[0-9]{2})?)/);
            if (matchNext) {
                const d = new Date(matchNext[1]);
                if (!isNaN(d)) {
                    const year = d.getFullYear();
                    const month = String(d.getMonth() + 1).padStart(2, '0');
                    const day = String(d.getDate()).padStart(2, '0');
                    const hours = String(d.getHours()).padStart(2, '0');
                    const minutes = String(d.getMinutes()).padStart(2, '0');

                    if (matchNext[1].includes(':')) {
                        nextDateStr = `${year}-${month}-${day}T${hours}:${minutes}:00`;
                    } else {
                        nextDateStr = `${year}-${month}-${day}`;
                    }
                }
            }

            return {
                id: v.id,
                outlet: v.name_of_outlet || v.customer_id || '',
                area: v.team || '',
                person: extractedPerson,
                position: extractedPosition,
                date: v.date_visit || '',
                reason: extractedReason,
                result: v.visit_result || '',
                photos: parsedPhotos,
                creatorName: v.bde || 'Unknown BDE',
                creatorEmail: '',
                creatorPosition: '',
                is_deleted: v.is_deleted === true,
                delete_reason: v.delete_reason || '',
                req_status: v.req_status || null,
                userArea: usersMap[v.user_id] || '',
                next_visit_date: nextDateStr
            };
        });

        AppState.visits = formatted;
        updateCount();
    } catch (e) { console.error(e); }
}

window.goToPage = function (page) {
    if (page < 0 || page >= AppState.totalPages) return;
    AppState.currentPage = page;
    fetchVisitsWithSkeleton();
    document.getElementById('visit-list').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderPagination() {
    const container = document.getElementById('pagination-container');
    if (!container) return;
    const total = AppState.totalPages;
    const current = AppState.currentPage;

    if (total <= 1) { container.innerHTML = ''; return; }

    let pages = [];
    if (total <= 7) {
        for (let i = 0; i < total; i++) pages.push(i);
    } else {
        pages.push(0);
        if (current > 3) pages.push('...');
        for (let i = Math.max(1, current - 1); i <= Math.min(total - 2, current + 1); i++) pages.push(i);
        if (current < total - 4) pages.push('...');
        pages.push(total - 1);
    }

    const btnClass = (p) => p === current ? 'pagination-btn pagination-btn-active' : 'pagination-btn';
    const pageButtons = pages.map(p => p === '...' ? `<span class="pagination-ellipsis">…</span>` : `<button class="${btnClass(p)}" onclick="goToPage(${p})">${p + 1}</button>`).join('');

    container.innerHTML = `
        <div class="pagination-wrap">
            <button class="pagination-btn pagination-btn-nav" onclick="goToPage(${current - 1})" ${current === 0 ? 'disabled' : ''}>‹</button>
            ${pageButtons}
            <button class="pagination-btn pagination-btn-nav" onclick="goToPage(${current + 1})" ${current === total - 1 ? 'disabled' : ''}>›</button>
        </div>
        <div class="pagination-info">Page ${current + 1} of ${total}</div>
    `;
}

async function uploadPhotosToStorage(recordId) {
    let uploadedUrls = [];

    for (let i = 0; i < AppState.photos.length; i++) {
        try {
            const photo = AppState.photos[i];
            if (!photo.startsWith('data:')) {
                uploadedUrls.push(photo);
                continue;
            }
            const res = await fetch(photo);
            const blob = await res.blob();
            const fileName = `${recordId}/photo_${Date.now()}_${i}.jpg`;
            const publicUrl = await DB.uploadFile('visit_photos', fileName, blob);
            uploadedUrls.push(publicUrl);
        } catch (e) {
            console.error("Upload failed for photo", i, ":", e);
            toast(`Upload error: ${e.message}`, false);
        }
    }
    return uploadedUrls;
}

// ============================================================
// WATERMARK MODULE
// ============================================================
function applyWatermark(canvas, ctx) {
    const outletInput = document.getElementById('f-outlet-name');
    const outletName = (outletInput && outletInput.value) ? outletInput.value : 'No Outlet Selected';
    const empName = AppState.userProfile.name || 'Unknown BDE';

    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    const dateStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const fontSize = Math.max(12, Math.floor(canvas.width / 70));
    ctx.font = `600 ${fontSize}px "Inter", sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';

    const padding = 12;
    const x = canvas.width - padding;
    const y = canvas.height - padding;
    const lineH = fontSize * 1.4;

    ctx.fillStyle = 'white';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    ctx.fillText(`Date: ${dateStr}`, x, y);
    ctx.fillText(`By: ${empName}`, x, y - lineH);
    ctx.fillText(`Outlet: ${outletName}`, x, y - (lineH * 2));

    ctx.shadowColor = 'transparent';
}

// ============================================================
// CAMERA & MEDIA MODULE
// ============================================================
window.toggleCamera = async function () {
    if (AppState.isCameraLoading) return;
    AppState.currentFacingMode = AppState.currentFacingMode === 'environment' ? 'user' : 'environment';
    if (AppState.cameraStream) {
        AppState.cameraStream.getTracks().forEach(t => t.stop());
        AppState.cameraStream = null;
    }
    await window.startCamera();
}

window.startCamera = async function () {
    if (AppState.isCameraLoading) return;
    AppState.isCameraLoading = true;
    const btn = document.getElementById('btn-start-cam');
    if (btn) btn.disabled = true;

    const video = document.getElementById('camera-view');
    const modal = document.getElementById('camera-modal');
    updateMiniGalleryThumb();

    try {
        if (AppState.cameraStream) AppState.cameraStream.getTracks().forEach(t => t.stop());
        AppState.cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: AppState.currentFacingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false
        });
        video.srcObject = AppState.cameraStream;
        video.style.transform = AppState.currentFacingMode === 'user' ? 'scaleX(-1)' : 'none';
        modal.classList.add('open');
        updateModalCounter();
    } catch (err1) {
        try {
            AppState.cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            video.srcObject = AppState.cameraStream;
            video.style.transform = 'none';
            modal.classList.add('open');
            updateModalCounter();
        } catch (err2) { toast('Cannot access camera.', false); }
    } finally {
        AppState.isCameraLoading = false;
        if (btn) btn.disabled = false;
    }
}

window.stopCamera = function () {
    if (AppState.cameraStream) { AppState.cameraStream.getTracks().forEach(t => t.stop()); AppState.cameraStream = null; }
    document.getElementById('camera-modal').classList.remove('open');
    closeCameraGallery();
}

window.capturePhoto = function () {
    if (AppState.photos.length >= CONFIG.MAX_PHOTOS) { toast(`Max ${CONFIG.MAX_PHOTOS} photos allowed.`, false); return; }
    const video = document.getElementById('camera-view');
    const canvas = document.getElementById('camera-canvas');
    const ctx = canvas.getContext('2d');

    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    if (AppState.currentFacingMode === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    if (AppState.currentFacingMode === 'user') { ctx.setTransform(1, 0, 0, 1, 0, 0); }

    applyWatermark(canvas, ctx);

    AppState.photos.push(canvas.toDataURL('image/jpeg', 0.7));
    video.style.opacity = '0.3';
    setTimeout(() => { video.style.opacity = '1'; }, 150);

    updateModalCounter(); renderPreviews(); updateMiniGalleryThumb(); saveAutoSaveData();
    if (document.getElementById('m-photo-grid')) renderModalPhotos();
    if (AppState.photos.length >= CONFIG.MAX_PHOTOS) { toast(`Reached ${CONFIG.MAX_PHOTOS} photos maximum.`); setTimeout(window.stopCamera, 500); }
}

window.selectFromLibrary = function () {
    if (!CONFIG.ALLOW_LIBRARY_UPLOAD) { toast('Photo capture only.', false); return; }
    document.getElementById('library-input').click();
}

function compressImage(file, maxWidth = 1280, maxHeight = 1280, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = event => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width; let height = img.height;
                if (width > height) { if (width > maxWidth) { height = Math.round((height *= maxWidth / width)); width = maxWidth; } }
                else { if (height > maxHeight) { width = Math.round((width *= maxHeight / height)); height = maxHeight; } }
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                applyWatermark(canvas, ctx);

                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = error => reject(error);
        };
        reader.onerror = error => reject(error);
    });
}

window.handleLibrarySelection = async function (input) {
    if (!input.files || !input.files.length) return;
    const availableSlots = CONFIG.MAX_PHOTOS - AppState.photos.length;
    if (availableSlots <= 0) { toast(`Photo limit reached.`, false); input.value = ''; return; }

    const filesToUpload = Array.from(input.files).slice(0, availableSlots);
    toast('Processing images...', true);

    for (const file of filesToUpload) {
        if (!file.type.startsWith('image/')) continue;
        try { AppState.photos.push(await compressImage(file, 1280, 1280, 0.7)); } catch (e) { console.error("image processing failed:", e); }
    }
    input.value = '';
    renderPreviews(); updateModalCounter(); saveAutoSaveData();
    if (document.getElementById('m-photo-grid')) renderModalPhotos();
}

// ============================================================
// FORM & AUTOSAVE MODULE
// ============================================================
function bindAutoSave() {
    const inputs = ['f-customer', 'f-main-team', 'f-sub-team', 'f-person', 'f-position', 'f-pos-other', 'f-date', 'f-reason', 'f-result', 'f-next-date'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input',  () => { saveAutoSaveData(); updateSaveBtn(); });
            el.addEventListener('change', () => { saveAutoSaveData(); updateSaveBtn(); });
        }
    });
    document.querySelectorAll('.f-followup').forEach(cb => {
        cb.addEventListener('change', () => { saveAutoSaveData(); updateSaveBtn(); });
    });
    updateSaveBtn();
}

// ============================================================
// SAVE BUTTON STATE — disable until required fields are filled
// ============================================================
function updateSaveBtn() {
    const btn = document.getElementById('btn-save');
    if (!btn) return;

    const customer = document.getElementById('f-customer')?.value;
    const person   = document.getElementById('f-person')?.value?.trim();
    const position = document.getElementById('f-position')?.value;
    const date     = document.getElementById('f-date')?.value;
    const reason   = document.getElementById('f-reason')?.value?.trim();
    const result   = document.getElementById('f-result')?.value?.trim();
    const followupChecked = Array.from(document.querySelectorAll('.f-followup')).some(cb => cb.checked);
    const hasPhoto = AppState.photos.length > 0;

    let posOk = position && position !== '';
    if (position === '__other__') {
        posOk = !!document.getElementById('f-pos-other')?.value?.trim();
    }

    const resultOk = !!result || followupChecked;
    const ready = !!(customer && person && posOk && date && reason && resultOk && hasPhoto);

    btn.disabled = !ready;
    btn.style.opacity = ready ? '1' : '0.45';
    btn.style.cursor  = ready ? 'pointer' : 'not-allowed';
    btn.style.transform = '';
}

async function saveAutoSaveData() {
    if (AppState.isClearingForm) return;
    if (document.getElementById('tab-new').style.display === 'none') return;
    const data = {
        customerId: document.getElementById('f-customer').value,
        outletName: document.getElementById('f-outlet-name').value,
        mainTeam: document.getElementById('f-main-team').value,
        subTeam: document.getElementById('f-sub-team').value,
        person: document.getElementById('f-person').value,
        position: document.getElementById('f-position').value,
        posOther: document.getElementById('f-pos-other').value,
        date: document.getElementById('f-date').value,
        reason: document.getElementById('f-reason').value,
        result: document.getElementById('f-result').value,
        followups: Array.from(document.querySelectorAll('.f-followup')).map(cb => cb.checked),
        nextDate: document.getElementById('f-next-date').value,
        photos: AppState.photos
    };
    try { await localforage.setItem(CONFIG.KEYS.AUTOSAVE, data); } catch (e) { console.error("Autosave failed:", e); }
}

async function loadAutoSaveData() {
    try {
        const data = await localforage.getItem(CONFIG.KEYS.AUTOSAVE);
        if (!data) return;
        let hasData = false;

        const populateField = (id, val) => { if (val) { document.getElementById(id).value = val; hasData = true; } };

        if (data.customerId && AppState.tomSelectCustomer) {
            AppState.tomSelectCustomer.setValue(data.customerId, true);
            const opt = AppState.tomSelectCustomer.options[data.customerId];
            if (opt) document.getElementById('f-outlet-name').value = opt.outletName || '';
            hasData = true;
        }
        populateField('f-outlet-name', data.outletName);

        populateField('f-person', data.person);
        populateField('f-pos-other', data.posOther);
        populateField('f-reason', data.reason);
        populateField('f-result', data.result);

        if (data.date && AppState.fpDate) { AppState.fpDate.setDate(data.date); hasData = true; }
        if (data.nextDate && AppState.fpNextDate) { AppState.fpNextDate.setDate(data.nextDate); }

        if (data.position) {
            document.getElementById('f-position').value = data.position;
            document.getElementById('pos-other-wrap').style.display = data.position === '__other__' ? 'block' : 'none';
            hasData = true;
        }

        if (data.followups && data.followups.length > 0) {
            document.querySelectorAll('.f-followup').forEach((cb, i) => {
                cb.checked = data.followups[i];
                if (cb.checked) hasData = true;
                if (cb.id === 'cb-next-visit') document.getElementById('next-visit-wrap').style.display = cb.checked ? 'block' : 'none';
            });
        }

        if (data.photos && data.photos.length > 0) {
            AppState.photos = data.photos;
            renderPreviews(); updateModalCounter(); updateMiniGalleryThumb(); hasData = true;
        }

        if (hasData) { toast('Draft restored automatically.', true); }
        updateSaveBtn();
    } catch (e) { console.error("Failed to load autosave", e); }
}

window.clearForm = function () {
    AppState.isClearingForm = true;
    if (AppState.tomSelectCustomer) AppState.tomSelectCustomer.clear(true);
    document.getElementById('f-outlet-name').value = '';
    ['f-main-team', 'f-sub-team', 'f-person', 'f-pos-other', 'f-reason', 'f-result'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('f-position').value = '';
    document.getElementById('pos-other-wrap').style.display = 'none';
    if (AppState.fpDate) AppState.fpDate.setDate(today());
    if (AppState.fpNextDate) AppState.fpNextDate.clear();
    document.querySelectorAll('.f-followup').forEach(cb => cb.checked = false);
    document.getElementById('next-visit-wrap').style.display = 'none';

    AppState.photos = [];
    renderPreviews(); window.stopCamera();
    localforage.removeItem(CONFIG.KEYS.AUTOSAVE).finally(() => {
        AppState.isClearingForm = false;
        updateSaveBtn();
    });
}

// ============================================================
// SAVE & VALIDATION MODULE
// ============================================================
window.triggerSaveConfirm = function () {
    const customerSelect = document.getElementById('f-customer');
    if (!customerSelect.value) {
        toast('Please select a Customer / Outlet.', false);

        if (AppState.tomSelectCustomer && AppState.tomSelectCustomer.control) {
            const tsControl = AppState.tomSelectCustomer.control;
            tsControl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            AppState.tomSelectCustomer.focus();
            tsControl.classList.add('error-highlight');
            setTimeout(() => tsControl.classList.remove('error-highlight'), 2500);
        } else {
            customerSelect.focus();
        }
        return;
    }

    const requiredFields = [
        { id: 'f-main-team', name: 'Team' },
        { id: 'f-sub-team', name: 'Sub-Team/Area' },
        { id: 'f-person', name: 'Person You Met' },
        { id: 'f-position', name: 'Their Position' },
        { id: 'f-date', name: 'Visit Date' },
        { id: 'f-reason', name: 'Reason for Visit' }
    ];

    const posEl = document.getElementById('f-position');
    if (posEl && posEl.value === '__other__') requiredFields.push({ id: 'f-pos-other', name: 'Specify Position' });

    for (const field of requiredFields) {
        const el = document.getElementById(field.id);
        // f-main-team และ f-sub-team อาจถูก disabled และ value ว่างในบางกรณี
        // ให้ fallback ไปดู userProfile แทน
        let val = el ? el.value.trim() : '';
        if (!val && field.id === 'f-main-team') val = AppState.userProfile.team || '';
        if (!val && field.id === 'f-sub-team') val = AppState.userProfile.subTeam || AppState.userProfile.area || '';
        if (!val) {
            toast(`Please fill in: ${field.name}`, false);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus();
                el.classList.add('error-highlight'); setTimeout(() => el.classList.remove('error-highlight'), 2500);
            }
            return;
        }
    }

    let followUps = []; let fQuotation = false, fCall = false;
    document.querySelectorAll('.f-followup').forEach(cb => {
        if (cb.value === 'Send Quotation / Documents') fQuotation = cb.checked;
        if (cb.value === 'Call Back Later') fCall = cb.checked;
        if (cb.id === 'cb-next-visit') {
            if (cb.checked) {
                const nd = document.getElementById('f-next-date').value;
                followUps.push(nd ? `Schedule Next Visit: ${fmtDate(nd)}` : 'Schedule Next Visit');
            }
        } else if (cb.checked) followUps.push(cb.value);
    });

    const fNext = document.getElementById('cb-next-visit').checked;
    const fNextDate = document.getElementById('f-next-date').value;
    const resultEl = document.getElementById('f-result');
    const result = resultEl.value.trim();

    if (!result && followUps.length === 0) {
        toast('Please provide a Result or select a Follow-up.', false);
        resultEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); resultEl.focus();
        resultEl.classList.add('error-highlight'); setTimeout(() => resultEl.classList.remove('error-highlight'), 2500);
        return;
    }

    if (AppState.photos.length === 0) {
        toast('Please capture at least 1 photo.', false);
        const camSection = document.querySelector('.easy-camera-container');
        if (camSection) {
            camSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
            camSection.classList.add('error-highlight'); setTimeout(() => camSection.classList.remove('error-highlight'), 2500);
        }
        return;
    }

    const finalResultText = result + (followUps.length > 0 && result ? '\n\n' : '') +
        (followUps.length > 0 ? '[ Follow-up Actions ]\n- ' + followUps.join('\n- ') : '');

    AppState.pendingSaveData = {
        customerId: customerSelect.value,
        outlet: document.getElementById('f-outlet-name').value,
        mainTeam: document.getElementById('f-main-team').value,
        subTeam: document.getElementById('f-sub-team').value,
        person: document.getElementById('f-person').value.trim(),
        position: getPosition(),
        date: document.getElementById('f-date').value,
        reason: document.getElementById('f-reason').value.trim(),
        result: finalResultText,
        rawResult: result,
        rawFollowUps: { fQuotation, fCall, fNext, fNextDate }
    };

    renderConfirmModal();
    document.getElementById('save-confirm-overlay').classList.add('open');
}

window.executeSave = async function () {
    if (!AppState.pendingSaveData) return;

    if (document.getElementById('save-confirm-overlay').getAttribute('data-mode') === 'edit') {
        const mResult = document.getElementById('m-result').value.trim();
        let mFollowUps = [];
        if (document.getElementById('m-cb-quotation').checked) mFollowUps.push('Send Quotation / Documents');
        if (document.getElementById('m-cb-call').checked) mFollowUps.push('Call Back Later');
        if (document.getElementById('m-cb-next').checked) {
            const nd = document.getElementById('m-next-date').value;
            mFollowUps.push(nd ? `Schedule Next Visit: ${fmtDate(nd)}` : 'Schedule Next Visit');
        }

        const mFinalResultText = mResult + (mFollowUps.length > 0 && mResult ? '\n\n' : '') +
            (mFollowUps.length > 0 ? '[ Follow-up Actions ]\n- ' + mFollowUps.join('\n- ') : '');

        const posSel = document.getElementById('m-position-sel').value;

        AppState.pendingSaveData.mainTeam = document.getElementById('m-main-team').value;
        AppState.pendingSaveData.subTeam = document.getElementById('m-sub-team').value;
        AppState.pendingSaveData.date = document.getElementById('m-date').value;
        AppState.pendingSaveData.person = document.getElementById('m-person').value.trim();
        AppState.pendingSaveData.position = posSel === '__other__' ? document.getElementById('m-pos-other').value.trim() : posSel;
        AppState.pendingSaveData.reason = document.getElementById('m-reason').value.trim();
        AppState.pendingSaveData.result = mFinalResultText;

        if (!AppState.pendingSaveData.reason || !AppState.pendingSaveData.person || !AppState.pendingSaveData.position) {
            toast('Please fill in required fields.', false); return;
        }
        if (!mResult && mFollowUps.length === 0) { toast('Please provide a Result or select a Follow-up.', false); return; }
        if (AppState.photos.length === 0) { toast('Please add at least 1 photo before saving.', false); return; }
    }

    const saveBtn = document.querySelector('#save-confirm-actions .btn-primary');
    const originalBtnText = saveBtn ? saveBtn.textContent : 'Confirm & Save';

    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }
    toast('Uploading data...', true);

    try {
        const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString();

        const newUploadedUrls = await uploadPhotosToStorage(id);

        if (newUploadedUrls.length === 0 && AppState.photos.length > 0) {
            throw new Error("Failed to upload photos. Please check your connection.");
        }

        const payload = {
            id: id,
            customer_id: AppState.pendingSaveData.customerId,
            name_of_outlet: AppState.pendingSaveData.outlet,
            date_visit: AppState.pendingSaveData.date,
            visit_report: `[Person Met: ${AppState.pendingSaveData.person} - ${AppState.pendingSaveData.position}]\n\n${AppState.pendingSaveData.reason}`,
            visit_result: AppState.pendingSaveData.result,
            visit_capture: JSON.stringify(newUploadedUrls),
            user_id: AppState.userProfile.empId || '',
            team: AppState.pendingSaveData.mainTeam,
            bde: AppState.userProfile.name,
            status: 'COMPLETED'
        };

        await DB.insert('visitation', payload);

        toast('Visitation record saved successfully!');
        document.getElementById('save-confirm-overlay').classList.remove('open');
        window.clearForm();

        AppState.currentPage = 0;
        await loadVisitsFromDB();
        window.switchTab('list');

    } catch (err) {
        console.error("Save Execution Error:", err);
        toast('Failed to save: ' + err.message, false);
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = originalBtnText; }
    }
}

// ============================================================
// UI RENDERING MODULE
// ============================================================
function showMainApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-app').style.display = 'block';
    initApp();
    // เริ่มระบบแจ้งเตือนหลัง login
    setTimeout(() => {
        scheduleNotifications();
        if (AppState.notifInterval) clearInterval(AppState.notifInterval);
        AppState.notifInterval = setInterval(scheduleNotifications, 60000);
        setupVisitRealtime();
        renderNotifPanel();
    }, 1500);
}

window.switchTab = function (tab) {
    if (tab !== 'new') window.stopCamera();

    const tabs = ['new', 'list', 'calendar'];
    document.querySelectorAll('.sidebar-nav .tab').forEach((t, i) => {
        t.classList.toggle('active', tabs[i] === tab);
    });

    tabs.forEach(t => {
        const el = document.getElementById('tab-' + t);
        if (!el) return;
        el.classList.remove('tab-enter');
        if (t === tab) {
            el.style.display = '';
            // Force reflow so animation re-triggers
            void el.offsetWidth;
            el.classList.add('tab-enter');
        } else {
            el.style.display = 'none';
        }
    });

    const pageTitle = document.getElementById('page-title');
    if (pageTitle) {
        const lang = AppState.currentLang || 'en';
        const titles = {
            new: { en: 'New Visit', th: 'บันทึกการเยี่ยม' },
            list: { en: 'All Visits', th: 'ประวัติทั้งหมด' },
            calendar: { en: 'Calendar Schedule', th: 'ปฏิทินนัดหมาย' }
        };
        if (titles[tab]) pageTitle.textContent = titles[tab][lang] || titles[tab].en;
    }

    // แสดง rec-count เฉพาะหน้า All Visits (ทุก screen size)
    const recCount = document.getElementById('rec-count');
    if (recCount) {
        recCount.style.display = tab === 'list' ? 'inline-block' : 'none';
    }

    if (tab === 'list') { AppState.currentPage = 0; fetchVisitsWithSkeleton(); }

    if (tab === 'calendar') {
        setTimeout(() => {
            if (!AppState.calendarObj) {
                window.initCalendar();
            } else {
                AppState.calendarObj.render();
                window.updateCalendarEvents();
            }
        }, 100);
    }

    if (window.innerWidth <= 768) {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        if (sidebar) sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('show');
    }
};

window.toggleSidebar = function () {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('show');
};

async function fetchVisitsWithSkeleton() {
    document.getElementById('visit-list').innerHTML = '';
    document.getElementById('pagination-container').innerHTML = '';
    document.getElementById('visit-list-loading').style.display = 'block';
    await loadVisitsFromDB();
    document.getElementById('visit-list-loading').style.display = 'none';
    renderList(); renderPagination();
}

window.clearAllFilters = function () {
    const area = document.getElementById('fl-area');
    const pos  = document.getElementById('fl-pos');
    const search = document.getElementById('fl-search');
    const posOther = document.getElementById('fl-pos-other');
    if (area)   area.value = '';
    if (pos)    pos.value = '';
    if (search) search.value = '';
    if (posOther) { posOther.value = ''; posOther.style.display = 'none'; }
    if (AppState.fpFilterDate) AppState.fpFilterDate.clear();
    resetAndFetch();
};

window.renderList = function () {
    const area = document.getElementById('fl-area').value;
    let pos = document.getElementById('fl-pos').value;
    const q = document.getElementById('fl-search').value.toLowerCase();
    const filterDate = document.getElementById('fl-date') ? document.getElementById('fl-date').value : '';

    if (pos === '__other__') pos = document.getElementById('fl-pos-other') ? document.getElementById('fl-pos-other').value.toLowerCase().trim() : '';
    else pos = pos.toLowerCase();

    const filtered = AppState.visits.filter(v => {
        if (v.req_status === 'approved' || (v.is_deleted === true && v.req_status !== 'pending')) return false;
        if (area && v.area !== area) return false;
        if (pos && !v.position.toLowerCase().includes(pos)) return false;
        if (filterDate && v.date !== filterDate) return false;
        if (q && !v.outlet.toLowerCase().includes(q) && !v.person.toLowerCase().includes(q)) return false;
        return true;
    });

    const el = document.getElementById('visit-list');

    if (!filtered.length) {
        const hasFilters = area || pos || filterDate || q;
        const lang = AppState.currentLang || 'en';

        if (hasFilters) {
            // filtered but no results
            el.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                            <line x1="8" y1="11" x2="14" y2="11"/>
                        </svg>
                    </div>
                    <div class="empty-state-title">${lang === 'th' ? 'ไม่พบข้อมูลที่ตรงกัน' : 'No matching records'}</div>
                    <div class="empty-state-sub">${lang === 'th' ? 'ลองเปลี่ยน filter หรือล้างการค้นหา' : 'Try adjusting your filters or clearing the search'}</div>
                    <button class="empty-state-btn" onclick="clearAllFilters()">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        ${lang === 'th' ? 'ล้าง Filter' : 'Clear Filters'}
                    </button>
                </div>`;
        } else {
            // truly empty — no visits yet
            el.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                            <line x1="12" y1="18" x2="12" y2="12"/>
                            <line x1="9" y1="15" x2="15" y2="15"/>
                        </svg>
                    </div>
                    <div class="empty-state-title">${lang === 'th' ? 'ยังไม่มีการบันทึก' : 'No visits recorded yet'}</div>
                    <div class="empty-state-sub">${lang === 'th' ? 'เริ่มบันทึกการเยี่ยมลูกค้าครั้งแรกได้เลย' : 'Start by logging your first customer visit'}</div>
                    <button class="empty-state-btn" onclick="switchTab('new')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        ${lang === 'th' ? 'บันทึกการเยี่ยม' : 'New Visit'}
                    </button>
                </div>`;
        }
        return;
    }

    el.innerHTML = '';
    const template = document.getElementById('visit-card-template');

    filtered.forEach(v => {
        const isPending = v.req_status === 'pending';
        const clone = template.content.cloneNode(true);
        const card = clone.querySelector('.visit-card');

        if (isPending) card.classList.add('visit-card-pending');
        card.onclick = () => window.openDetail(v.id);

        clone.querySelector('.tpl-outlet').textContent = v.outlet;
        clone.querySelector('.tpl-area').textContent = v.area;

        const statusBadge = clone.querySelector('.tpl-status-badge');
        if (isPending) statusBadge.innerHTML = `<span class="badge badge-pending">Pending Delete</span>`;

        clone.querySelector('.tpl-date').textContent = fmtDate(v.date);
        clone.querySelector('.tpl-person').textContent = v.person;
        clone.querySelector('.tpl-pos').textContent = v.position;

        const reasonEl = clone.querySelector('.tpl-reason');
        reasonEl.textContent = v.reason.length > 120 ? v.reason.substring(0, 120) + '...' : v.reason;
        if (isPending) reasonEl.style.textDecoration = 'line-through';

        clone.querySelector('.tpl-thumbs').innerHTML = renderThumbStrip(v.photos);
        el.appendChild(clone);
    });
}

window.openDetail = function (id) {
    try {
        const v = AppState.visits.find(x => String(x.id) === String(id));
        if (!v) { alert("Error: Data not found."); return; }

        const isPending = v.req_status === 'pending';
        const visitInfo = [['Met With', `${v.person} (${v.position})`], ['Reason for Visit', v.reason], ['Result & Actions', v.result]];

        const renderFields = rows => rows.map(([l, val]) => `
            <div class="detail-field" style="margin-bottom: 20px;">
                <span class="detail-label">${l}</span>
                <span class="detail-value" style="background: var(--card-bg); padding: 12px 16px; border-radius: 8px; border: 1px solid var(--border-light); margin-top: 6px; display: block; color: var(--text-main);">${esc(val).replace(/\n/g, '<br>')}</span>
            </div>`).join('');

        const photosHtml = v.photos && v.photos.length ? `
            <div style="border-top:1px dashed var(--border-light); margin:24px 0 16px 0;"></div>
            <div class="detail-label" style="margin-bottom:12px;">ATTACHED PHOTOS (${v.photos.length})</div>
            <div class="detail-photos">${v.photos.map(p => `<div class="detail-photo" onclick="window.openLightbox('${p}')"><img src="${p}" style="cursor:zoom-in;"></div>`).join('')}</div>` : '';

        const userTeam = v.area || 'Unknown Team';
        const userArea = v.userArea ? ` • ${v.userArea}` : '';

        const creatorHtml = `
            <div style="margin-top: 24px; padding-top: 16px; border-top: 1px dashed var(--border-light);">
                <div class="detail-label" style="margin-bottom:12px;">RECORDED BY</div>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="width: 36px; height: 36px; border-radius: 50%; background: var(--primary); color: white; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 16px;">
                        ${(v.creatorName || '?').charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <div style="font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px;">${esc(v.creatorName || 'Unknown')}</div>
                        <div style="font-size: 12px; color: var(--text-muted); margin-top: 2px; font-weight: 500;">
                            ${esc(userTeam)}${esc(userArea)}
                        </div>
                    </div>
                </div>
            </div>`;

        const deleteBtnHtml = !isPending ? `
            <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border-light); text-align: center;">
                <button class="btn-secondary btn-danger" onclick="window.openDeleteRequest('${v.id}')" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    Request Delete
                </button>
            </div>` : '';

        document.getElementById('detail-content').innerHTML = `
            ${isPending ? `<div class="pending-warning" style="margin-bottom: 24px;"><strong>Pending deletion review.</strong><div>Reason: ${esc(v.delete_reason)}</div></div>` : ''}
            
            <div style="display: flex; flex-direction: column; gap: 16px; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid var(--border-light);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="detail-label" style="margin: 0;">DATE:</span>
                        <span style="font-size: 14px; font-weight: 600; color: var(--primary);">${fmtDate(v.date)}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="detail-label" style="margin: 0;">TEAM:</span>
                        <span class="badge badge-area" style="font-size: 11px; padding: 4px 12px; background: rgba(124, 144, 130, 0.1);">${esc(v.area)}</span>
                    </div>
                </div>

                <div>
                    <div class="detail-label" style="margin-bottom: 4px;">OUTLET / LOCATION</div>
                    <h2 style="font-size: 22px; font-weight: 700; color: var(--text-main); margin: 0; line-height: 1.2;">${esc(v.outlet)}</h2>
                </div>
            </div>

            <div style="${isPending ? 'opacity:0.6;' : ''}">${renderFields(visitInfo)}</div>
            ${photosHtml}${creatorHtml}${deleteBtnHtml}`;

        document.getElementById('detail-overlay').classList.add('open');
    } catch (e) { console.error(e); }
}

window.renderConfirmModal = function () {
    const photosHtml = `<div class="confirm-photo-grid">${AppState.photos.map(p => `<img src="${p}" onclick="window.openLightbox('${p}')" style="cursor:zoom-in;">`).join('')}</div>`;

    document.getElementById('save-confirm-text').innerHTML = `
        <div style="background: var(--bg-color); border: 1px solid var(--border-light); border-radius: 12px; padding: 1.25rem;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px dashed var(--border-light);">
                <div>
                    <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">Outlet & Location</div>
                    <div style="font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                        ${esc(AppState.pendingSaveData.outlet)}
                        <span class="badge badge-area" style="font-size: 11px;">${AppState.pendingSaveData.mainTeam} - ${AppState.pendingSaveData.subTeam}</span>
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">Date</div>
                    <div style="font-size: 13px; font-weight: 500; color: var(--primary);">${fmtDate(AppState.pendingSaveData.date)}</div>
                </div>
            </div>
            <div style="margin-bottom: 16px;">
                <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">Met With</div>
                <div style="font-size: 14px; display: flex; align-items: center; gap: 8px;">
                    <span style="color: var(--text-muted);">${esc(AppState.pendingSaveData.person)}</span> <span class="badge badge-pos">${esc(AppState.pendingSaveData.position)}</span>
                </div>
            </div>
            <div style="margin-bottom: 16px;">
                <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">Reason for Visit</div>
                <div style="font-size: 14px; line-height: 1.5; background: var(--card-bg); padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border-light);">${esc(AppState.pendingSaveData.reason).replace(/\n/g, '<br>')}</div>
            </div>
            <div style="margin-bottom: 16px;">
                <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">Result & Actions</div>
                <div style="font-size: 14px; line-height: 1.5; background: var(--card-bg); padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border-light);">${esc(AppState.pendingSaveData.result).replace(/\n/g, '<br>')}</div>
            </div>
            <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-light);">
                <div style="font-size: 12px; font-weight: 500;">Attached Photos: <span style="color: var(--primary); font-weight: 600;">${AppState.photos.length}</span></div>
                ${photosHtml}
            </div>
        </div>`;

    document.getElementById('save-confirm-actions').innerHTML = `
        <button class="btn-secondary" onclick="window.enableModalEdit()">Edit</button>
        <button class="btn-primary" onclick="window.executeSave()">Confirm & Save</button>
    `;
    document.getElementById('save-confirm-overlay').setAttribute('data-mode', 'static');
}

window.enableModalEdit = function () {
    const positions = ['CEO', 'CFO', 'OWNER', 'BARTENDER', 'F&B MANAGER', 'MANAGER'];
    const isOtherPos = AppState.pendingSaveData.position && !positions.includes(AppState.pendingSaveData.position);
    const posOptions = positions.map(p => `<option value="${p}" ${p === AppState.pendingSaveData.position ? 'selected' : ''}>${p}</option>`).join('');

    const f = AppState.pendingSaveData.rawFollowUps || {};

    document.getElementById('save-confirm-text').innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 12px; max-height: 65vh; overflow-y: auto; padding-right: 5px; text-align: left;">
            <div style="background: rgba(124, 144, 130, 0.1); color: var(--primary); padding: 10px; border-radius: 8px; font-size: 13px; font-weight: 500; margin-bottom: 4px; border: 1px solid var(--primary); display: flex; align-items: center; gap: 8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                Edit mode active
            </div>
            <div>
                <label style="font-size: 12px; color: var(--text-muted); font-weight: 500; margin-bottom: 4px; display: block;">Customer / Outlet</label>
                <input type="text" id="m-outlet" value="${esc(AppState.pendingSaveData.outlet)}" readonly style="width: 100%; padding: 10px 14px; border: 1px solid var(--border-light); border-radius: 8px; font-family: inherit; font-size: 14px; outline: none; background: rgba(0,0,0,0.05); color: var(--text-main); cursor: not-allowed;">
            </div>
            
            <div style="display: flex; gap: 10px;">
                <div style="flex: 1;">
                    <label style="font-size: 12px; color: var(--text-muted); font-weight: 500; margin-bottom: 4px; display: block;">Team</label>
                    <input type="text" id="m-main-team" value="${esc(AppState.pendingSaveData.mainTeam)}" readonly style="width: 100%; padding: 10px 14px; border: 1px solid var(--border-light); border-radius: 8px; font-family: inherit; font-size: 14px; outline: none; background: rgba(0,0,0,0.05); color: var(--text-main); cursor: not-allowed;">
                </div>
                <div style="flex: 1;">
                    <label style="font-size: 12px; color: var(--text-muted); font-weight: 500; margin-bottom: 4px; display: block;">Area / Sub-Team</label>
                    <input type="text" id="m-sub-team" value="${esc(AppState.pendingSaveData.subTeam)}" readonly style="width: 100%; padding: 10px 14px; border: 1px solid var(--border-light); border-radius: 8px; font-family: inherit; font-size: 14px; outline: none; background: rgba(0,0,0,0.05); color: var(--text-main); cursor: not-allowed;">
                </div>
            </div>

            <div>
                <label style="font-size: 12px; color: var(--text-muted); font-weight: 500; margin-bottom: 4px; display: block;">Date</label>
                <input type="text" id="m-date" value="${AppState.pendingSaveData.date}" style="width: 100%; padding: 10px 14px; border: 1px solid var(--primary); border-radius: 8px; font-family: inherit; font-size: 14px; outline: none; background: transparent; color: var(--text-main);">
            </div>
            <div style="display: flex; gap: 10px;">
                <div style="flex: 1;">
                    <label style="font-size: 12px; color: var(--text-muted); font-weight: 500; margin-bottom: 4px; display: block;">Met With</label>
                    <input type="text" id="m-person" value="${esc(AppState.pendingSaveData.person)}" style="width: 100%; padding: 10px 14px; border: 1px solid var(--primary); border-radius: 8px; font-family: inherit; font-size: 14px; outline: none; background: transparent; color: var(--text-main);">
                </div>
                <div style="flex: 1;">
                    <label style="font-size: 12px; color: var(--text-muted); font-weight: 500; margin-bottom: 4px; display: block;">Position</label>
                    <select id="m-position-sel" onchange="document.getElementById('m-pos-other-wrap').style.display = this.value === '__other__' ? 'block' : 'none'" style="width: 100%; padding: 10px 14px; border: 1px solid var(--primary); border-radius: 8px; font-family: inherit; font-size: 14px; outline: none; background: transparent; color: var(--text-main);">
                        <option value="">Select position</option>
                        ${posOptions}
                        <option value="__other__" ${isOtherPos ? 'selected' : ''}>ETC — Please Type</option>
                    </select>
                </div>
            </div>
            <div id="m-pos-other-wrap" style="display: ${isOtherPos ? 'block' : 'none'};">
                <input type="text" id="m-pos-other" value="${isOtherPos ? esc(AppState.pendingSaveData.position) : ''}" placeholder="Specify Position" style="width: 100%; padding: 10px 14px; border: 1px solid var(--primary); border-radius: 8px; font-family: inherit; font-size: 14px; outline: none; background: transparent; color: var(--text-main);">
            </div>
            <div>
                <label style="font-size: 12px; color: var(--text-muted); font-weight: 500; margin-bottom: 4px; display: block;">Reason for Visit</label>
                <textarea id="m-reason" rows="2" style="width: 100%; padding: 10px 14px; border: 1px solid var(--primary); border-radius: 8px; font-family: inherit; font-size: 14px; outline: none; resize: vertical; background: transparent; color: var(--text-main);">${esc(AppState.pendingSaveData.reason)}</textarea>
            </div>
            <div>
                <label style="font-size: 12px; color: var(--text-muted); font-weight: 500; margin-bottom: 4px; display: block;">Result of Visit</label>
                <textarea id="m-result" rows="2" style="width: 100%; padding: 10px 14px; border: 1px solid var(--primary); border-radius: 8px; font-family: inherit; font-size: 14px; outline: none; resize: vertical; background: transparent; color: var(--text-main);">${esc(AppState.pendingSaveData.rawResult || '')}</textarea>
            </div>
            <div style="margin-top: 4px; padding-bottom: 10px;">
                <label style="font-size: 12px; color: var(--text-muted); font-weight: 500; margin-bottom: 8px; display: block;">Follow-up Actions</label>
                <div style="display: flex; flex-direction: column; gap: 10px; background: var(--bg-color); padding: 12px; border-radius: 8px; border: 1px solid var(--border-light);">
                    <label style="font-size: 13px; display: flex; align-items: center; gap: 8px; cursor: pointer;">
                        <input type="checkbox" id="m-cb-quotation" ${f.fQuotation ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: var(--primary);"> Send Quotation/Docs
                    </label>
                    <label style="font-size: 13px; display: flex; align-items: center; gap: 8px; cursor: pointer;">
                        <input type="checkbox" id="m-cb-call" ${f.fCall ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: var(--primary);"> Call Back Later
                    </label>
                    <label style="font-size: 13px; display: flex; align-items: center; gap: 8px; cursor: pointer;">
                        <input type="checkbox" id="m-cb-next" ${f.fNext ? 'checked' : ''} onchange="document.getElementById('m-next-date-wrap').style.display = this.checked ? 'block' : 'none'" style="width: 18px; height: 18px; accent-color: var(--primary);"> Schedule Next Visit
                    </label>
                </div>
                <div id="m-next-date-wrap" style="display: ${f.fNext ? 'block' : 'none'}; margin-top: 10px; background: var(--bg-color); padding: 12px; border-radius: 8px; border: 1px solid var(--primary);">
                    <label style="font-size: 11px; color: var(--primary); display: block; margin-bottom: 6px;">Select Date for Next Visit:</label>
                    <input type="text" id="m-next-date" value="${f.fNextDate || today()}" style="width: 100%; padding: 10px 14px; border: 1px solid var(--primary); border-radius: 6px; font-family: inherit; font-size: 14px; outline: none; background: transparent; color: var(--text-main);">
                </div>
            </div>
            
            <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-light);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <label style="font-size: 12px; color: var(--text-muted); font-weight: 500;">Attached Photos (<span id="m-photo-count">${AppState.photos.length}</span>/${CONFIG.MAX_PHOTOS})</label>
                    <div style="display: flex; gap: 8px;">
                        <button type="button" class="btn-secondary" onclick="window.startCamera()" style="padding: 4px 12px; font-size: 11px; border-radius: 6px; border: 1px solid var(--primary); color: var(--primary);">Camera</button>
                        <button type="button" class="btn-secondary" onclick="window.selectFromLibrary()" style="padding: 4px 12px; font-size: 11px; border-radius: 6px; border: 1px solid var(--primary); color: var(--primary);">+ Library</button>
                    </div>
                </div>
                <div id="m-photo-grid" class="photo-previews"></div>
            </div>
        </div>
    `;

    document.getElementById('save-confirm-actions').innerHTML = `
        <button class="btn-secondary" onclick="window.renderConfirmModal()" style="color: var(--text-main);">Cancel Edit</button>
        <button class="btn-primary" onclick="window.executeSave()">Confirm & Save</button>
    `;
    document.getElementById('save-confirm-overlay').setAttribute('data-mode', 'edit');
    renderModalPhotos();

    flatpickr("#m-date", { altInput: true, altFormat: "d M Y", dateFormat: "Y-m-d", minDate: "today", maxDate: "today" });
    flatpickr("#m-next-date", {
        altInput: true,
        altFormat: "d M Y",
        dateFormat: "Y-m-d",
        minDate: "today",
        onReady: function (_, __, fp) {
            const cal = fp.calendarContainer;
            const timeRow = document.createElement('div');
            timeRow.className = 'fp-custom-time-row';
            timeRow.innerHTML = `
                <span class="fp-time-label">Time</span>
                <select id="fp-mnext-hour" class="fp-time-select">
                    ${Array.from({ length: 24 }, (_, i) => `<option value="${String(i).padStart(2, '0')}">${String(i).padStart(2, '0')}</option>`).join('')}
                </select>
                <span class="fp-time-sep">:</span>
                <select id="fp-mnext-min" class="fp-time-select">
                    ${['00', '15', '30', '45'].map(m => `<option value="${m}">${m}</option>`).join('')}
                </select>`;
            cal.appendChild(timeRow);
            document.getElementById('fp-mnext-hour').value = '09';
        },
        onClose: function (selectedDates, dateStr, fp) {
            if (!selectedDates[0]) return;
            const h = document.getElementById('fp-mnext-hour')?.value || '09';
            const m = document.getElementById('fp-mnext-min')?.value || '00';
            const d = selectedDates[0];
            const pad = n => String(n).padStart(2, '0');
            fp.input.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${h}:${m}`;
            fp.altInput.value = `${pad(d.getDate())} ${d.toLocaleString('en', { month: 'short' })} ${d.getFullYear()} ${h}:${m}`;
        }
    });
}

window.updateModalSubTeam = function (mainTeam) {
    const subSelect = document.getElementById('m-sub-team');
    subSelect.innerHTML = '';
    if (TEAM_STRUCTURE[mainTeam]) {
        TEAM_STRUCTURE[mainTeam].forEach(sub => {
            const opt = document.createElement('option'); opt.value = sub; opt.textContent = sub;
            subSelect.appendChild(opt);
        });
    }
}

function renderModalPhotos() {
    const grid = document.getElementById('m-photo-grid');
    const countEl = document.getElementById('m-photo-count');
    if (!grid) return;
    if (countEl) countEl.textContent = AppState.photos.length;
    if (AppState.photos.length > 0) {
        grid.innerHTML = AppState.photos.map((p, i) => `<div class="photo-thumb"><img src="${p}" onclick="window.openLightbox('${p}')"><button type="button" onclick="window.removeModalPhoto(${i})">✕</button></div>`).join('');
    } else {
        grid.innerHTML = `<div style="font-size: 12px; color: var(--danger); padding: 8px 0;">No photos attached.</div>`;
    }
}

window.removeModalPhoto = function (i) {
    AppState.photos.splice(i, 1);
    renderModalPhotos(); renderPreviews(); updateModalCounter(); updateMiniGalleryThumb(); saveAutoSaveData();
}

// ============================================================
// UTILITIES & HELPERS
// ============================================================
window.openLightbox = function (src) { document.getElementById('lb-img').src = src; document.getElementById('lightbox').classList.add('open'); }
window.closeLightbox = function () { document.getElementById('lightbox').classList.remove('open'); }
window.closeDetail = function () { document.getElementById('detail-overlay').classList.remove('open'); }
window.openDeleteRequest = function (id) { AppState.deleteTargetId = id; document.getElementById('delete-reason-input').value = ''; document.getElementById('delete-confirm-overlay').classList.add('open'); }
window.closeDeleteRequest = function () { AppState.deleteTargetId = null; document.getElementById('delete-confirm-overlay').classList.remove('open'); }
window.closeSaveConfirm = function () { document.getElementById('save-confirm-overlay').classList.remove('open'); AppState.pendingSaveData = null; }

// ============================================================
// REQUEST DELETE MODULE
// ============================================================
window.executeDeleteRequest = async function () {
    const id = AppState.deleteTargetId;
    const reasonInput = document.getElementById('delete-reason-input');
    const reason = reasonInput.value.trim();

    if (!reason) {
        toast('Please provide a reason for the delete request.', false);
        reasonInput.focus();
        return;
    }

    const btn = document.querySelector('#delete-confirm-overlay .btn-danger');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Sending...';

    try {
        await DB.insert('delete_requests', {
            visit_id: id,
            requested_by_email: AppState.userProfile.email || '-',
            requested_by_name: AppState.userProfile.name || 'Unknown',
            reason: reason,
            status: 'pending'
        });

        await DB.update('visitation', `id=eq.${encodeURIComponent(id)}`, {
            req_status: 'pending',
            delete_reason: reason,
            is_deleted: true
        });

        toast('Delete request submitted successfully.');
        window.closeDeleteRequest();
        window.closeDetail();
        window.resetAndFetch();
    } catch (err) {
        console.error(err);
        toast('An error occurred: ' + err.message, false);
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
};

function getPosition() { const s = document.getElementById('f-position').value; return s === '__other__' ? document.getElementById('f-pos-other').value.trim() : s; }
function bindPositionToggle() { document.getElementById('f-position').addEventListener('change', function () { document.getElementById('pos-other-wrap').style.display = this.value === '__other__' ? '' : 'none'; }); }

function esc(s) { if (s == null) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function today() { return new Date().toISOString().split('T')[0]; }
function fmtDate(d) {
    if (!d) return '';
    const dateObj = new Date(d);
    if (isNaN(dateObj)) return d;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${dateObj.getDate()} ${months[dateObj.getMonth()]} ${dateObj.getFullYear()}`;
}

function fmtDateTime(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function updateCount() {
    const el = document.getElementById('rec-count');
    if (!el) return;
    const count = AppState.totalCount || AppState.visits.length;
    el.textContent = count + (count === 1 ? ' record' : ' records');
}

function toast(msg, ok = true) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.style.background = ok ? 'var(--primary)' : 'var(--danger)';
    t.setAttribute('data-type', ok ? 'success' : 'error');
    t.textContent = msg;
    t.classList.remove('show');
    void t.offsetWidth; // force reflow to restart animation
    t.classList.add('show');
    clearTimeout(t._hideTimer);
    t._hideTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function loadAvatarUI() {
    const avatarData = AppState.userProfile.avatar;
    const imgLarge = document.getElementById('avatar-img');
    const textLarge = document.getElementById('avatar-text');
    const imgSmall = document.getElementById('avatar-small-img');
    const textSmall = document.getElementById('avatar-small-text');

    if (avatarData) {
        if (imgLarge) { imgLarge.src = avatarData; imgLarge.style.display = 'block'; }
        if (textLarge) { textLarge.style.display = 'none'; }
        if (imgSmall) { imgSmall.src = avatarData; imgSmall.style.display = 'block'; }
        if (textSmall) { textSmall.style.display = 'none'; }
    } else {
        if (imgLarge) { imgLarge.style.display = 'none'; }
        if (textLarge) { textLarge.style.display = 'block'; }
        if (imgSmall) { imgSmall.src = ''; imgSmall.style.display = 'none'; }
        if (textSmall) { textSmall.style.display = 'block'; }
    }
}

window.handleProfileUpload = async function (input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    if (!file.type.startsWith('image/')) return;

    toast('Updating profile picture...', true);

    try {
        const fileName = `avatar_${AppState.userProfile.empId}_${Date.now()}.jpg`;
        const publicUrl = await DB.uploadFile('avatars', fileName, file, file.type);

        await DB.update('user_information', `user_id=eq.${encodeURIComponent(AppState.userProfile.empId)}`, {
            avatar: publicUrl
        });

        AppState.userProfile.avatar = publicUrl;
        localStorage.setItem(CONFIG.KEYS.PROFILE, JSON.stringify(AppState.userProfile));

        loadAvatarUI();
        toast('Profile picture updated!');
    } catch (e) {
        console.error("Avatar Upload Error:", e);
        toast('Failed to update picture.', false);
    }
    input.value = '';
}

function updateModalCounter() { const el = document.getElementById('modal-photo-counter'); if (el) el.textContent = `${AppState.photos.length} / ${CONFIG.MAX_PHOTOS}`; }

function updateMiniGalleryThumb() {
    const recentThumb = document.getElementById('camera-recent-thumb');
    if (!recentThumb) return;
    if (AppState.photos.length > 0) { recentThumb.style.backgroundImage = `url(${AppState.photos[AppState.photos.length - 1]})`; recentThumb.style.opacity = '1'; }
    else { recentThumb.style.opacity = '0'; }
}

window.openCameraGallery = function () {
    if (AppState.photos.length === 0) return;
    document.getElementById('camera-header').style.display = 'none';
    document.getElementById('camera-body').style.display = 'none';
    document.getElementById('camera-footer').style.display = 'none';
    document.getElementById('camera-gallery').style.display = 'flex';
    renderCameraGallery();
}

window.closeCameraGallery = function () {
    document.getElementById('camera-header').style.display = 'flex';
    document.getElementById('camera-body').style.display = 'flex';
    document.getElementById('camera-footer').style.display = 'flex';
    document.getElementById('camera-gallery').style.display = 'none';
    updateMiniGalleryThumb();
}

function renderCameraGallery() {
    document.getElementById('cg-grid').innerHTML = AppState.photos.map((p, i) => `<div class="cg-item"><img src="${p}" onclick="window.openLightbox('${p}')"><button class="cg-delete" onclick="window.removePhotoFromGallery(${i})">✕</button></div>`).join('');
}

window.removePhotoFromGallery = function (i) {
    AppState.photos.splice(i, 1);
    renderPreviews(); updateModalCounter(); saveAutoSaveData();
    if (AppState.photos.length === 0) window.closeCameraGallery(); else renderCameraGallery();
}

function renderPreviews() {
    document.getElementById('photo-counter').textContent = `${AppState.photos.length} / ${CONFIG.MAX_PHOTOS}`;
    const previewContainer = document.getElementById('previews');
    const capturedSection = document.getElementById('captured-section');
    if (AppState.photos.length > 0) {
        capturedSection.style.display = 'block';
        previewContainer.innerHTML = AppState.photos.map((p, i) => `<div class="photo-thumb"><img src="${p}" onclick="window.openLightbox('${p}')"><button type="button" onclick="window.removePhoto(${i})">✕</button></div>`).join('');
    } else {
        capturedSection.style.display = 'none'; previewContainer.innerHTML = '';
    }
    updateSaveBtn();
}

window.removePhoto = function (i) { AppState.photos.splice(i, 1); renderPreviews(); updateModalCounter(); updateMiniGalleryThumb(); saveAutoSaveData(); }
function renderThumbStrip(ph) { if (!ph || !ph.length) return ''; return `<div class="vc-thumbs">${ph.slice(0, 5).map(p => `<div class="vc-thumb"><img src="${p}"></div>`).join('')}${ph.length > 5 ? `<div class="vc-thumb">+${ph.length - 5}</div>` : ''}</div>`; }

window.toggleProfileMenu = function () { document.getElementById('profile-dropdown').classList.toggle('show'); }
window.addEventListener('click', function (e) {
    const wrap = document.getElementById('profile-menu-wrap'); const dropdown = document.getElementById('profile-dropdown');
    if (wrap && dropdown && !wrap.contains(e.target)) dropdown.classList.remove('show');
});

function initDarkMode() {
    const savedTheme = localStorage.getItem('checklist_theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
        document.body.classList.add('dark-mode');
        document.querySelectorAll('.moon-icon').forEach(el => el.style.display = 'none');
        document.querySelectorAll('.sun-icon').forEach(el => el.style.display = 'block');
    }
}
window.toggleDarkMode = function () {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('checklist_theme', isDark ? 'dark' : 'light');
    document.querySelectorAll('.moon-icon').forEach(el => el.style.display = isDark ? 'none' : 'block');
    document.querySelectorAll('.sun-icon').forEach(el => el.style.display = isDark ? 'block' : 'none');
}

window.playWelcomeAnimation = function (name, callback) {
    const screen = document.getElementById('welcome-screen');
    const text = document.getElementById('welcome-text');
    const avatarText = document.getElementById('welcome-avatar-text');
    const avatarImg = document.getElementById('welcome-avatar-img');

    document.getElementById('login-screen').style.display = 'none';
    const firstName = name ? name.split(' ')[0] : 'User';
    text.textContent = `Hello, ${firstName}!`;

    if (AppState.userProfile.avatar) {
        if (avatarImg) {
            avatarImg.src = AppState.userProfile.avatar;
            avatarImg.style.display = 'block';
        }
        if (avatarText) avatarText.style.display = 'none';
    } else {
        if (avatarImg) avatarImg.style.display = 'none';
        if (avatarText) {
            avatarText.textContent = firstName.charAt(0).toUpperCase();
            avatarText.style.display = 'block';
        }
    }

    screen.classList.remove('welcome-fade-out', 'animate-welcome');
    screen.style.display = 'flex';
    setTimeout(() => {
        screen.classList.add('animate-welcome');
    }, 50);
    setTimeout(() => {
        screen.classList.add('welcome-fade-out');
        setTimeout(() => {
            screen.style.display = 'none';
            if (callback) callback();
        }, 500);
    }, 2000);
};

window.toggleSidebar = function () {
    document.querySelector('.sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('show');
}


// ============================================================
// REALTIME NOTIFICATION & CALENDAR MODULE (Supabase Edition)
// ============================================================

window.setupRealtime = function () {
    if (AppState.realtimeChannel) return;
    try {
        if (typeof window.supabase !== 'undefined') {
            const client = window.supabase.createClient(CONFIG.SUPABASE.URL, CONFIG.SUPABASE.KEY);
            AppState.realtimeChannel = client
                .channel('app-realtime')
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'visitation' }, (payload) => {
                    if (payload.new.user_id !== AppState.userProfile.empId) {
                        const badge = document.getElementById('notif-badge');
                        if (badge) badge.style.display = 'block';
                        toast(`New event: ${payload.new.name_of_outlet}`, true);
                    }
                    loadVisitsFromDB().then(() => { if (window.updateCalendarEvents) window.updateCalendarEvents(); });
                })
                .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'visitation' }, (payload) => {
                    if (payload.new.req_status === 'pending' && (!payload.old || payload.old.req_status !== 'pending')) {
                        const badge = document.getElementById('notif-badge');
                        if (badge) badge.style.display = 'block';
                        toast(`Delete Request: ${payload.new.bde || 'User'} @ ${payload.new.name_of_outlet}`, false);
                    }
                    loadVisitsFromDB().then(() => { if (window.updateCalendarEvents) window.updateCalendarEvents(); });
                })
                .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => {
                    if (AppState.calendarObj) AppState.calendarObj.refetchEvents();
                })
                .subscribe();
        } else {
            AppState.realtimeChannel = setInterval(() => {
                loadVisitsFromDB().then(() => { if (window.updateCalendarEvents) window.updateCalendarEvents(); });
            }, 30000);
        }
    } catch (e) {
        console.warn('Realtime setup failed, using polling fallback');
        AppState.realtimeChannel = setInterval(() => {
            loadVisitsFromDB().then(() => { if (window.updateCalendarEvents) window.updateCalendarEvents(); });
        }, 30000);
    }
};

// ============================================================
// ระบบที่ 3 — VISIT RECORDS REALTIME (Approve/Delete notif)
// ============================================================
window.setupVisitRealtime = function () {
    if (AppState.visitRealtimeChannel) return;
    if (typeof window.supabase === 'undefined') return;
    try {
        const empId = AppState.userProfile.empId;
        const client = window.supabase.createClient(CONFIG.SUPABASE.URL, CONFIG.SUPABASE.KEY);
        AppState.visitRealtimeChannel = client
            .channel('visit-records-realtime')
            .on('postgres_changes', {
                event: 'UPDATE', schema: 'public', table: 'visit_records'
            }, (payload) => {
                const rec = payload.new;
                // filter เฉพาะ user เจ้าของ
                if (rec.user_id && rec.user_id !== empId) return;
                const outlet = rec.outlet_name || rec.name_of_outlet || 'Visit';
                let icon = '', msg = '';
                if (rec.req_status === 'approved') {
                    icon = '✅'; msg = `${outlet} - Visit Approved`;
                } else if (rec.req_status === 'rejected') {
                    icon = '❌'; msg = `Visit Rejected`;
                }
                if (msg) {
                    _pushNotification(icon, msg);
                    toast(`${icon} ${msg}`, rec.req_status === 'approved');
                }
            })
            .on('postgres_changes', {
                event: 'DELETE', schema: 'public', table: 'visit_records'
            }, (payload) => {
                const rec = payload.old;
                if (rec.user_id && rec.user_id !== empId) return;
                _pushNotification('🗑️', 'Visit record deleted by admin');
                toast('🗑️ Visit record deleted by admin', false);
            })
            .subscribe();
    } catch (e) {
        console.warn('Visit realtime setup failed:', e);
    }
};

// ============================================================
// ระบบที่ 2 — SCHEDULE NOTIFICATIONS (remind before)
// ============================================================
window.scheduleNotifications = async function () {
    try {
        const uid = AppState.userProfile.empId;
        if (!uid) return;
        const now = Date.now();
        const twoHours = now + 2 * 3600000;

        // ดึง appointments ของ user ที่ start_at อยู่ในอนาคต + remind_minutes > 0
        const params = [
            `user_id=eq.${encodeURIComponent(uid)}`,
            `start_at=gte.${new Date().toISOString()}`,
            `remind_minutes=gt.0`,
            `status=neq.cancelled`,
            `select=id,title,outlet_name,start_at,remind_minutes`,
            `order=start_at.asc`
        ].join('&');
        const apts = await DB.select('appointments', params) || [];

        let hasSoon = false;
        for (const apt of apts) {
            const startMs = new Date(apt.start_at).getTime();
            if (startMs <= twoHours) hasSoon = true;

            const notifyAt = startMs - apt.remind_minutes * 60000;
            const key = `notified_apt_${apt.id}`;
            if (now >= notifyAt && !localStorage.getItem(key)) {
                localStorage.setItem(key, '1');
                const name = apt.outlet_name || apt.title || 'Appointment';
                const pad = n => String(n).padStart(2, '0');
                const d = new Date(startMs);
                const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
                const minsLeft = Math.round((startMs - now) / 60000);
                const label = minsLeft >= 60
                    ? `in ${Math.round(minsLeft / 60)}h`
                    : minsLeft > 0 ? `in ${minsLeft} min` : 'Now!';
                const msg = `${name} - ${timeStr} (${label})`;

                // Toast
                toast(msg, true);

                // Web Notification API
                _sendWebNotification('Visitation Reminder', msg);

                // เก็บใน notification panel
                _pushNotification('🔕', msg);
            }
        }

        // Badge dot ถ้ามีนัดใน 2 ชั่วโมงข้างหน้า
        const badge = document.getElementById('notif-badge');
        if (badge) badge.style.display = hasSoon ? 'block' : badge.style.display;

        // Request permission ครั้งแรก
        if (Notification && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    } catch (e) {
        console.warn('scheduleNotifications error:', e);
    }
};

function _sendWebNotification(title, body) {
    try {
        if (!('Notification' in window)) return;
        if (Notification.permission === 'granted') {
            new Notification(title, { body, icon: '/icon.png' });
        } else if (Notification.permission !== 'denied') {
            Notification.requestPermission().then(p => {
                if (p === 'granted') new Notification(title, { body, icon: '/icon.png' });
            });
        }
    } catch (e) { }
}

// ============================================================
// NOTIFICATION STORAGE & PANEL
// ============================================================
function _pushNotification(icon, message) {
    const notif = { icon, message, time: Date.now(), id: Date.now() + Math.random() };
    AppState.notifications.unshift(notif);
    if (AppState.notifications.length > 50) AppState.notifications = AppState.notifications.slice(0, 50);
    _saveNotifications();

    // แสดง badge
    const badge = document.getElementById('notif-badge');
    if (badge) badge.style.display = 'block';

    renderNotifPanel();
}

function _saveNotifications() {
    try {
        localStorage.setItem('visitation_notifications', JSON.stringify(AppState.notifications));
    } catch (e) { }
}

function _relativeTime(ms) {
    const diff = Math.round((Date.now() - ms) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
    return `${Math.floor(diff / 86400)} d ago`;
}

window.renderNotifPanel = function () {
    const list = document.getElementById('notif-list');
    if (!list) return;
    if (!AppState.notifications.length) {
        list.innerHTML = '<div class="notif-empty">No notifications</div>';
        return;
    }
    list.innerHTML = AppState.notifications.map(n => `
        <div class="notif-item">
            
            <div class="notif-content">
                <div class="notif-msg">${n.message}</div>
                <div class="notif-time">${_relativeTime(n.time)}</div>
            </div>
        </div>
    `).join('');
};

window.toggleNotifPanel = function () {
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    const isOpen = panel.style.display !== 'none';
    panel.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
        // ซ่อน badge เมื่อเปิด panel
        const badge = document.getElementById('notif-badge');
        if (badge) badge.style.display = 'none';
        renderNotifPanel();
    }
};

window.clearAllNotifications = function () {
    AppState.notifications = [];
    _saveNotifications();
    renderNotifPanel();
    const badge = document.getElementById('notif-badge');
    if (badge) badge.style.display = 'none';
};

// ปิด panel เมื่อคลิกนอก
window.addEventListener('click', function (e) {
    const panel = document.getElementById('notif-panel');
    const bell = document.getElementById('notif-bell');
    if (panel && bell && !bell.parentElement.contains(e.target)) {
        panel.style.display = 'none';
    }
});

// ============================================================
// CALENDAR DB — CRUD สำหรับ appointments table
// ============================================================
const CalendarDB = {
    async fetchRange(start, end) {
        const uid = AppState.userProfile.empId;
        if (!uid) return [];
        try {
            const params = [
                `user_id=eq.${encodeURIComponent(uid)}`,
                `start_at=gte.${start.toISOString()}`,
                `start_at=lt.${end.toISOString()}`,
                `status=neq.cancelled`,
                `select=*`,
                `order=start_at.asc`
            ].join('&');
            return await DB.select('appointments', params) || [];
        } catch (e) {
            console.error('CalendarDB.fetchRange:', e);
            return [];
        }
    },

    async create(payload) {
        const uid = AppState.userProfile.empId;
        const record = {
            title: payload.title,
            description: payload.description || null,
            start_at: payload.start,
            end_at: payload.end,
            all_day: payload.allDay || false,
            location: payload.location || null,
            color: payload.color || '#1E88E5',
            type: payload.type || 'personal',
            remind_minutes: parseInt(payload.remindMinutes) || 30,
            user_id: uid,
            created_by: uid,
            outlet_name: payload.outletName || null,
            visit_id: payload.visitId || null
        };
        const result = await DB.insert('appointments', record);
        return result && result[0];
    },

    async update(id, payload) {
        const record = {};
        if (payload.start !== undefined) record.start_at = payload.start;
        if (payload.end !== undefined) record.end_at = payload.end;
        if (payload.title !== undefined) record.title = payload.title;
        if (payload.color !== undefined) record.color = payload.color;
        if (payload.status !== undefined) record.status = payload.status;
        if (payload.description !== undefined) record.description = payload.description;
        if (payload.location !== undefined) record.location = payload.location;
        if (payload.type !== undefined) record.type = payload.type;
        if (payload.remindMinutes !== undefined) record.remind_minutes = parseInt(payload.remindMinutes);
        await DB.update('appointments', `id=eq.${id}`, record);
    },

    async delete(id) {
        await DB.query(`appointments?id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' });
    }
};

// ============================================================
// FULLCALENDAR INIT
// ============================================================
window.initCalendar = function () {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;

    AppState.calendarObj = new FullCalendar.Calendar(calendarEl, {
        initialView: 'timeGridWeek',
        themeSystem: 'standard',
        locale: 'en',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay,listMonth'
        },
        buttonText: { today: 'Today', month: 'Month', week: 'Week', day: 'Day', list: 'List' },
        dayHeaderFormat: { weekday: 'short', day: 'numeric' },
        height: 'calc(100vh - 160px)',

        // 🟢 เปิดใช้งานการลากคลุมช่วงเวลา + ลากเพื่อย้ายนัดหมาย
        nowIndicator: true,
        selectable: true,
        selectMirror: true,
        editable: true,

        slotMinTime: '06:00:00',
        slotMaxTime: '23:00:00',
        slotDuration: '00:30:00',
        displayEventTime: true,
        eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },

        // 🟢 เมื่อลากคลุมช่วงเวลาเสร็จ ให้เปิด Modal สร้างนัดหมาย
        select: function (info) {
            window.openAppointmentModal(info.start, info.end, info.allDay);
            AppState.calendarObj.unselect();
        },

        // 🟢 จัดการเมื่อ "ลาก" เพื่อเปลี่ยนวันหรือเวลา
        eventDrop: async function (info) {
            const ep = info.event.extendedProps;
            if (ep.isVisit) {
                info.revert();
                toast('Cannot move auto-generated appointments.', false);
                return;
            }
            try {
                await CalendarDB.update(ep.dbId, {
                    start: info.event.start.toISOString(),
                    end: info.event.end ? info.event.end.toISOString() : new Date(info.event.start.getTime() + 3600000).toISOString()
                });
                toast('Appointment moved.', true);
            } catch (err) {
                console.error(err);
                info.revert();
                toast('Could not change time: ' + err.message, false);
            }
        },

        // 🟢 จัดการเมื่อ "ยืด/หด" เวลา (Resize)
        eventResize: async function (info) {
            const ep = info.event.extendedProps;
            if (ep.isVisit) {
                info.revert();
                return;
            }
            try {
                await CalendarDB.update(ep.dbId, {
                    start: info.event.start.toISOString(),
                    // FIX: สร้างเวลาสำรอง +1 ชั่วโมง ถ้าลากแล้วค่า end หายไป
                    end: info.event.end ? info.event.end.toISOString() : new Date(info.event.start.getTime() + 3600000).toISOString()
                });
                toast('Appointment duration updated.', true);
            } catch (err) {
                console.error(err);
                info.revert();
                toast('Could not update time: ' + err.message, false);
            }
        },

        events: async function (info, successCallback, failureCallback) {
            try {
                // 1. Manual scheduled visits from appointments table
                const apts = await CalendarDB.fetchRange(info.start, info.end);
                const aptEvents = apts.map(a => {
                    const startMs = new Date(a.start_at).setHours(0, 0, 0, 0);
                    const endMs = a.end_at ? new Date(a.end_at).setHours(0, 0, 0, 0) : startMs;
                    const isSingleDay = (endMs - startMs) <= 86400000;
                    return {
                        id: a.id,
                        title: a.outlet_name || a.title,
                        start: isSingleDay ? new Date(a.start_at).toISOString().slice(0, 10) : a.start_at,
                        end: isSingleDay ? new Date(new Date(a.start_at).setDate(new Date(a.start_at).getDate() + 1)).toISOString().slice(0, 10) : a.end_at,
                        allDay: isSingleDay,
                        display: 'block',
                        backgroundColor: '#4CAF50',
                        borderColor: 'transparent',
                        textColor: '#FFF',
                        extendedProps: {
                            isVisit: false,
                            isSingleDay: isSingleDay,
                            originalStart: a.start_at,
                            originalEnd: a.end_at,
                            dbId: a.id,
                            description: a.description,
                            outletName: a.outlet_name || a.title,
                            location: a.location,
                            remindMinutes: a.remind_minutes
                        }
                    };
                });

                // 2. Auto events from "Schedule Next Visit" in saved visits
                const visitEvents = (AppState.visits || [])
                    .filter(v => v.next_visit_date)
                    .map(v => {
                        const startDate = new Date(v.next_visit_date).toISOString().slice(0, 10);
                        const endDate = new Date(new Date(v.next_visit_date).setDate(new Date(v.next_visit_date).getDate() + 1)).toISOString().slice(0, 10);
                        return {
                            id: 'visit_' + v.id,
                            title: v.outlet,
                            start: startDate,
                            end: endDate,
                            allDay: true,
                            display: 'block',
                            backgroundColor: '#E53935',
                            borderColor: 'transparent',
                            textColor: '#FFF',
                            editable: false,
                            extendedProps: { isVisit: true, visitId: v.id, outletName: v.outlet }
                        };
                    });

                successCallback([...aptEvents, ...visitEvents]);
            } catch (err) {
                console.error('Calendar fetch error:', err);
                failureCallback(err);
            }
        },

        eventClick: function (info) {
            const ep = info.event.extendedProps;
            if (ep.isVisit) {
                window.openDetail(ep.visitId || info.event.id.replace('visit_', ''));
            } else {
                window.showAppointmentReadOnly(info.event.id);
            }
        },

    });
    AppState.calendarObj.render();
};

// ============================================================
// APPOINTMENT READ-ONLY VIEW
// ============================================================

window.showAppointmentReadOnly = function (eventId) {
    if (!AppState.calendarObj) return;
    const event = AppState.calendarObj.getEventById(eventId);
    if (!event) return;

    const ep = event.extendedProps;
    // Use original timestamps if event was converted to allDay for display
    const startD = ep.originalStart ? new Date(ep.originalStart) : event.start;
    const endD = ep.originalEnd ? new Date(ep.originalEnd) : event.end;
    const pad = n => String(n).padStart(2, '0');

    const startDateStr = fmtDate(startD.toISOString());
    const startTimeStr = `${pad(startD.getHours())}:${pad(startD.getMinutes())}`;

    let dateDisplay = '';

    if (endD) {
        const endDateStr = fmtDate(endD.toISOString());
        const endTimeStr = `${pad(endD.getHours())}:${pad(endD.getMinutes())}`;

        if (startDateStr === endDateStr) {
            dateDisplay = `${startDateStr} <br> <span style="color:var(--primary); margin-top: 4px; display: inline-block;">${startTimeStr} - ${endTimeStr}</span>`;
        } else {
            dateDisplay = `${startDateStr} (${startTimeStr}) <br> <span style="color:var(--primary); margin-top: 4px; display: inline-block;">to ${endDateStr} (${endTimeStr})</span>`;
        }
    } else {
        dateDisplay = `${startDateStr} <br> <span style="color:var(--primary); margin-top: 4px; display: inline-block;">Start: ${startTimeStr}</span>`;
    }

    let remindText = 'No reminder';
    if (ep.remindMinutes > 0) {
        if (ep.remindMinutes >= 1440) remindText = `1 day`;
        else if (ep.remindMinutes >= 60) remindText = `${ep.remindMinutes / 60} hr`;
        else remindText = `${ep.remindMinutes} min`;
    }

    const html = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
            <div>
                <div class="detail-label" style="margin-bottom: 4px;">SCHEDULED VISIT</div>
                <h2 style="font-size: 20px; font-weight: 700; color: var(--text-main); margin: 0; line-height: 1.3;">${esc(event.title)}</h2>
            </div>
        </div>
        
        <div class="detail-field">
            <span class="detail-label">Date & Time</span>
            <span class="detail-value" style="background: var(--card-bg); padding: 12px; border-radius: 8px; border: 1px solid var(--border-light); margin-top: 6px; display: block; font-weight: 500;">
                ${dateDisplay}
            </span>
        </div>

        <div class="detail-field">
            <span class="detail-label">Remind Before</span>
            <span class="detail-value" style="background: var(--card-bg); padding: 12px; border-radius: 8px; border: 1px solid var(--border-light); margin-top: 6px; display: block;">
                ${remindText}
            </span>
        </div>

        ${ep.description ? `
        <div class="detail-field">
            <span class="detail-label">Note</span>
            <span class="detail-value" style="background: var(--card-bg); padding: 12px; border-radius: 8px; border: 1px solid var(--border-light); margin-top: 6px; display: block; white-space: pre-wrap;">${esc(ep.description)}</span>
        </div>
        ` : ''}

        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border-light); display: flex; gap: 10px;">
            <button class="btn-secondary" onclick="window.closeDetail()" style="flex: 1;">Close</button>
            <button class="btn-primary" onclick="window.triggerEditAppointment('${event.id}')" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                Edit
            </button>
        </div>
    `;
    document.getElementById('detail-content').innerHTML = html;
    document.getElementById('detail-overlay').classList.add('open');
}

window.triggerEditAppointment = function (eventId) {
    window.closeDetail();
    if (!AppState.calendarObj) return;
    const event = AppState.calendarObj.getEventById(eventId);
    if (event) {
        setTimeout(() => {
            window.openAppointmentDetail(event);
        }, 150);
    }
}

window.updateCalendarEvents = function () {
    if (AppState.calendarObj) AppState.calendarObj.refetchEvents();
};

// ============================================================
// APPOINTMENT MODAL — เปิดสร้างใหม่ (รองรับ 2 DatePickers)
// ============================================================
window.openAppointmentModal = function (start, end, allDay) {
    AppState.editingAptId = null;

    document.getElementById('apt-modal-title').textContent = 'Schedule Visit';
    document.getElementById('btn-apt-delete').style.display = 'none';
    document.getElementById('apt-note').value = '';

    const d = start ? new Date(start) : new Date();
    let endD = null; // เริ่มต้นให้วันจบเป็นค่าว่าง (ไม่บังคับ)

    if (allDay) {
        const diffDays = (end.getTime() - start.getTime()) / (1000 * 3600 * 24);
        if (diffDays > 1) {
            endD = new Date(end.getTime() - 24 * 60 * 60 * 1000);
            d.setHours(9, 0, 0);
            endD.setHours(17, 0, 0);
        } else {
            d.setHours(9, 0, 0);
        }
    } else {
        const diffMins = (end.getTime() - start.getTime()) / (1000 * 60);
        if (diffMins > 30) {
            endD = new Date(end);
        }
    }

    const startInput = document.getElementById('apt-start-date');
    const endInput = document.getElementById('apt-end-date');

    if (!startInput || !endInput) {
        alert('Missing HTML IDs: apt-start-date or apt-end-date.');
        if (AppState.calendarObj) AppState.calendarObj.unselect();
        return;
    }

    if (!window._aptStartDatePicker) {
        window._aptStartDatePicker = flatpickr(startInput, { altInput: true, altFormat: 'd M Y', dateFormat: 'Y-m-d' });
        window._aptEndDatePicker = flatpickr(endInput, { altInput: true, altFormat: 'd M Y', dateFormat: 'Y-m-d' });
    }

    window._aptStartDatePicker.setDate(d, true);

    if (endD) {
        window._aptEndDatePicker.setDate(endD, true);
    } else {
        window._aptEndDatePicker.clear();
    }

    const pad = n => String(n).padStart(2, '0');

    const startH = pad(d.getHours());
    const startM = ['00', '15', '30', '45'].reduce((prev, curr) =>
        Math.abs(parseInt(curr) - d.getMinutes()) < Math.abs(parseInt(prev) - d.getMinutes()) ? curr : prev);
    document.getElementById('apt-hour').value = startH;
    document.getElementById('apt-minute').value = startM;

    const fallbackEnd = endD || new Date(d.getTime() + 3600000);
    const endH = pad(Math.min(23, fallbackEnd.getHours()));
    const endM = ['00', '15', '30', '45'].reduce((prev, curr) =>
        Math.abs(parseInt(curr) - fallbackEnd.getMinutes()) < Math.abs(parseInt(prev) - fallbackEnd.getMinutes()) ? curr : prev);
    document.getElementById('apt-end-hour').value = endH;
    document.getElementById('apt-end-minute').value = endM;

    document.getElementById('apt-remind-select').value = '30';
    const outletSel = document.getElementById('apt-outlet-select');
    if (outletSel?._tomSelect) outletSel._tomSelect.clear();

    loadAptOutlets();
    document.getElementById('appointment-modal').classList.add('open');
};

// ============================================================
// APPOINTMENT MODAL — เปิดแก้ไข (รองรับ 2 DatePickers)
// ============================================================
window.openAppointmentDetail = function (event) {
    const ep = event.extendedProps;
    AppState.editingAptId = ep.dbId;

    document.getElementById('apt-modal-title').textContent = 'Edit Visit';
    document.getElementById('btn-apt-delete').style.display = 'inline-flex';
    document.getElementById('apt-note').value = ep.description || '';

    // Use original timestamps if event was converted to allDay for display
    const d = ep.originalStart ? new Date(ep.originalStart) : (event.start || new Date());
    let endD = ep.originalEnd ? new Date(ep.originalEnd) : (event.end ? new Date(event.end) : new Date(d.getTime() + 3600000));

    if (event.allDay && event.end) {
        endD = new Date(event.end.getTime() - 24 * 60 * 60 * 1000);
    }

    if (!window._aptStartDatePicker) {
        window._aptStartDatePicker = flatpickr('#apt-start-date', {
            altInput: true, altFormat: 'd M Y', dateFormat: 'Y-m-d'
        });
        window._aptEndDatePicker = flatpickr('#apt-end-date', {
            altInput: true, altFormat: 'd M Y', dateFormat: 'Y-m-d'
        });
    }
    window._aptStartDatePicker.setDate(d, true);
    window._aptEndDatePicker.setDate(endD, true);

    const pad = n => String(n).padStart(2, '0');

    document.getElementById('apt-hour').value = pad(d.getHours());
    document.getElementById('apt-minute').value = ['00', '15', '30', '45'].reduce((prev, curr) =>
        Math.abs(parseInt(curr) - d.getMinutes()) < Math.abs(parseInt(prev) - d.getMinutes()) ? curr : prev);

    document.getElementById('apt-end-hour').value = pad(Math.min(23, endD.getHours()));
    document.getElementById('apt-end-minute').value = ['00', '15', '30', '45'].reduce((prev, curr) =>
        Math.abs(parseInt(curr) - endD.getMinutes()) < Math.abs(parseInt(prev) - endD.getMinutes()) ? curr : prev);

    const remindVal = ep.remindMinutes !== undefined ? ep.remindMinutes : 30;
    const remindSel = document.getElementById('apt-remind-select');
    if (remindSel) remindSel.value = String(remindVal);

    loadAptOutlets(ep.outletName || ep.location || '');
    document.getElementById('appointment-modal').classList.add('open');
};

// ============================================================
// SAVE / UPDATE (บันทึกข้ามวันได้)
// ============================================================
window.saveAppointment = async function () {
    const outletSel = document.getElementById('apt-outlet-select');
    const ts = outletSel?._tomSelect;
    const outletId = ts ? ts.getValue() : (outletSel?.value || '');
    const outletName = ts?.options[outletId]?.text || outletId || '';
    if (!outletId) { toast('Please select an outlet.', false); return; }

    const startDateVal = window._aptStartDatePicker?.input?.value || document.getElementById('apt-start-date').value;
    const endDateVal = window._aptEndDatePicker?.input?.value || document.getElementById('apt-end-date').value;

    if (!startDateVal) { toast('Please select a start date.', false); return; }

    const h = document.getElementById('apt-hour').value;
    const m = document.getElementById('apt-minute').value;
    const startDt = new Date(`${startDateVal}T${h}:${m}:00`);

    // FIX: ใช้ startDate เป็นค่าสำรอง ถ้าผู้ใช้ไม่ได้เลือก endDate
    const targetEndDate = endDateVal ? endDateVal : startDateVal;

    const eh = document.getElementById('apt-end-hour').value;
    const em = document.getElementById('apt-end-minute').value;
    const endDt = new Date(`${targetEndDate}T${eh}:${em}:00`);

    if (endDt <= startDt) {
        toast('End date/time must be after the start.', false);
        return;
    }

    const payload = {
        title: outletName,
        description: document.getElementById('apt-note').value.trim() || null,
        location: outletId,
        outlet_name: outletName,
        color: '#4CAF50',
        type: 'visit',
        remindMinutes: parseInt(document.getElementById('apt-remind-select')?.value || '30'),
        start: startDt.toISOString(),
        end: endDt.toISOString(), // ตรงนี้จะไม่เป็น null อีกต่อไป
        allDay: false
    };

    const btn = document.getElementById('btn-apt-save');
    btn.disabled = true; btn.textContent = 'Saving...';

    try {
        if (AppState.editingAptId) {
            await CalendarDB.update(AppState.editingAptId, payload);
            toast('Updated.', true);
        } else {
            await CalendarDB.create(payload);
            toast('Visit scheduled.', true);
        }
        document.getElementById('appointment-modal').classList.remove('open');
        if (AppState.calendarObj) AppState.calendarObj.refetchEvents();
    } catch (e) {
        toast('Error: ' + e.message, false);
    } finally {
        btn.disabled = false; btn.textContent = 'Save';
    }
};

// ============================================================
// DELETE
// ============================================================
window.deleteAppointment = async function () {
    if (!AppState.editingAptId) return;
    if (!confirm('Delete this appointment?')) return;
    try {
        await CalendarDB.delete(AppState.editingAptId);
        document.getElementById('appointment-modal').classList.remove('open');
        if (AppState.calendarObj) AppState.calendarObj.refetchEvents();
        toast('Appointment deleted.', true);
    } catch (e) {
        toast('Failed to delete: ' + e.message, false);
    }
};

// ============================================================
// HELPER
// ============================================================
function _fmtDTDisplay(isoStr) {
    if (!isoStr) return '';
    try {
        const d = new Date(isoStr);
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const pad = n => String(n).padStart(2, '0');
        return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return isoStr; }
}

// ============================================================
// APPOINTMENT MODAL UI HELPERS (ระบบปรับเวลาอัตโนมัติ)
// ============================================================
window.autoSetEndTime = function () {
    const startVal = document.getElementById('apt-start-date')?.value;
    const endVal = document.getElementById('apt-end-date')?.value;

    // ข้ามการคำนวณปรับเวลาอัตโนมัติ ถ้านัดหมายข้ามวัน (ป้องกันการเด้งเปลี่ยนเวลาเอง)
    if (startVal && endVal && startVal !== endVal) return;

    const sh = parseInt(document.getElementById('apt-hour').value || '9');
    const sm = parseInt(document.getElementById('apt-minute').value || '0');
    const endH = document.getElementById('apt-end-hour');
    const endM = document.getElementById('apt-end-minute');
    if (!endH || !endM) return;

    const curEH = parseInt(endH.value || '10');
    const curEM = parseInt(endM.value || '0');

    if (curEH * 60 + curEM <= sh * 60 + sm) {
        const newH = Math.min(23, sh + 1);
        endH.value = String(newH).padStart(2, '0');
        endM.value = String(sm).padStart(2, '0');
    }
};

window.selectAptType = function (el, type) {
    document.querySelectorAll('.apt-type-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('apt-type').value = type;
    _toggleAptLocationUI(type);
};

function _toggleAptLocationUI(type) {
    const locationWrap = document.getElementById('apt-location-wrap');
    const outletWrap = document.getElementById('apt-outlet-wrap');
    if (!locationWrap || !outletWrap) return;
    if (type === 'visit') {
        locationWrap.style.display = 'none';
        outletWrap.style.display = 'flex';
        loadAptOutlets();
    } else {
        locationWrap.style.display = '';
        outletWrap.style.display = 'none';
    }
}

async function loadAptOutlets(selectValue) {
    const selectEl = document.getElementById('apt-outlet-select');
    if (!selectEl) return;

    if (selectEl._tomSelect && !selectValue) { return; }
    if (selectEl._tomSelect && selectValue) {
        selectEl._tomSelect.setValue(selectValue, true);
        return;
    }

    try {
        const team = (AppState.userProfile.team || '').trim().toLowerCase();
        const isAdmin = team === 'admin';
        const empId = AppState.userProfile.empId;
        const bdeName = AppState.userProfile.name;

        let params = `select=customer_id,name_of_outlet&status=neq.INACTIVE&order=name_of_outlet.asc`;
        if (!isAdmin) {
            if (empId && bdeName)
                params += `&or=(user_id.eq.${encodeURIComponent(empId)},bde.eq.${encodeURIComponent(bdeName)})`;
            else if (empId) params += `&user_id=eq.${encodeURIComponent(empId)}`;
            else if (bdeName) params += `&bde=eq.${encodeURIComponent(bdeName)}`;
        }

        const data = await DB.select('customer_information', params);
        const options = (data || []).map(c => ({
            value: c.customer_id,
            text: c.name_of_outlet,
            searchText: `${c.customer_id} ${c.name_of_outlet}`,
            outletName: c.name_of_outlet
        }));

        if (selectEl._tomSelect) selectEl._tomSelect.destroy();

        const ts = new TomSelect(selectEl, {
            options: options,
            items: selectValue ? [selectValue] : [],
            valueField: 'value',
            labelField: 'text',
            searchField: ['text', 'searchText'],
            sortField: { field: 'text', direction: 'asc' },
            placeholder: 'Search outlet...',
            allowEmptyOption: true,
            maxOptions: 500,
            maxItems: 1,
            plugins: ['clear_button'],
            render: {
                option: function (item, escape) {
                    return `<div><span style="color:var(--text-muted);font-size:11px;margin-right:6px;">${escape(item.value)}</span>${escape(item.text)}</div>`;
                },
                item: function (item, escape) {
                    return `<div>${escape(item.text)}</div>`;
                }
            }
        });
        selectEl._tomSelect = ts;
    } catch (e) {
        console.error('loadAptOutlets error:', e);
    }
}

window.selectAptColor = function (el, color) {
    document.querySelectorAll('.apt-swatch').forEach(s => s.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('apt-color').value = color;
};

// ============================================================
// I18N — FULL-SITE LANGUAGE SWITCHER (EN / TH)
// ============================================================
AppState.currentLang = 'en';

const I18N = {
    en: {
        // Sidebar nav
        nav_new_visit: 'New Visit',
        nav_all_visits: 'All Visits',
        nav_calendar: 'Calendar',
        dark_mode: 'Dark Mode',
        light_mode: 'Light Mode',
        // Login
        sign_in: 'Sign In',
        username: 'Username',
        password: 'Password',
        remember_me: 'Remember me',
        submit: 'SUBMIT',
        // Header
        records: 'records',
        notifications: 'Notifications',
        clear_all: 'Clear all',
        // Profile
        team: 'Team',
        area: 'Area',
        email: 'Email',
        contact: 'Contact',
        logout: 'Logout',
        // Visit form
        visit_info: 'Visit Information',
        customer_outlet: 'Customer / Outlet',
        person_met: 'Person You Met',
        their_position: 'Their Position',
        specify_pos: 'Specify Position',
        visit_date: 'Visit Date',
        reason_visit: 'Reason for Visit',
        result_visit: 'Result of Visit',
        followup: 'Follow-up Actions',
        followup_quotation: 'Send Quotation/Docs',
        followup_callback: ' Call Back Later',
        followup_schedule: 'Schedule Next Visit',
        select_next_date: 'Select Date for Next Visit:',
        live_evidence: 'Live Evidence',
        capture_hint: 'Capture or select up to 10 photos',
        captured_photos: 'Captured Photos (Click to view)',
        clear: 'Clear',
        save_visit: 'Save Visit',
        // Filters
        all_areas: 'All areas',
        all_positions: 'All positions',
        filter_by_date: 'Filter by date',
        search_outlet: 'Search outlet...',
        type_search_pos: 'Type to search position...',
        // Calendar legend
        legend_scheduled: 'Scheduled',
        legend_visit_rec: 'From visit record',
        schedule_visit: 'Schedule Visit',
        // Modals
        review_visit: 'Review Visit Details',
        edit: 'Edit',
        confirm_save: 'Confirm & Save',
        delete_request: 'Delete Request',
        delete_reason: 'Reason for delete request:',
        cancel: 'Cancel',
        confirm_delete: 'Confirm Delete',
        save: 'Save',
        delete: 'Delete',
        remind_before: 'Remind before',
        no_reminder: 'No reminder',
        // Apt modal fields
        start_date: 'Start date',
        end_date: 'End date (optional)',
        note_optional: 'Note (optional)',
        // Calendar buttons
        _fc_today: 'Today',
        _fc_month: 'Month',
        _fc_week: 'Week',
        _fc_day: 'Day',
        _fc_list: 'List',
    },
    th: {
        // Sidebar nav
        nav_new_visit: 'บันทึกการเยี่ยม',
        nav_all_visits: 'ประวัติทั้งหมด',
        nav_calendar: 'ปฏิทิน',
        dark_mode: 'โหมดมืด',
        light_mode: 'โหมดสว่าง',
        // Login
        sign_in: 'เข้าสู่ระบบ',
        username: 'ชื่อผู้ใช้',
        password: 'รหัสผ่าน',
        remember_me: 'จดจำฉัน',
        submit: 'เข้าสู่ระบบ',
        // Header
        records: 'รายการ',
        notifications: 'การแจ้งเตือน',
        clear_all: 'ล้างทั้งหมด',
        // Profile
        team: 'ทีม',
        area: 'พื้นที่',
        email: 'อีเมล',
        contact: 'ติดต่อ',
        logout: 'ออกจากระบบ',
        // Visit form
        visit_info: 'ข้อมูลการเยี่ยม',
        customer_outlet: 'ลูกค้า / สาขา',
        person_met: 'ผู้ที่พบ',
        their_position: 'ตำแหน่ง',
        specify_pos: 'ระบุตำแหน่ง',
        visit_date: 'วันที่เยี่ยม',
        reason_visit: 'วัตถุประสงค์',
        result_visit: 'ผลการเยี่ยม',
        followup: 'การติดตาม',
        followup_quotation: 'ส่งใบเสนอราคา/เอกสาร',
        followup_callback: ' โทรกลับภายหลัง',
        followup_schedule: 'นัดหมายเยี่ยมครั้งต่อไป',
        select_next_date: 'เลือกวันนัดหมายครั้งถัดไป:',
        live_evidence: 'หลักฐานสด',
        capture_hint: 'ถ่ายหรือเลือกสูงสุด 10 รูป',
        captured_photos: 'รูปถ่าย (กดเพื่อดู)',
        clear: 'ล้างข้อมูล',
        save_visit: 'บันทึก',
        // Filters
        all_areas: 'ทุกพื้นที่',
        all_positions: 'ทุกตำแหน่ง',
        filter_by_date: 'กรองตามวันที่',
        search_outlet: 'ค้นหาสาขาหรือหมายเหตุ...',
        type_search_pos: 'พิมพ์เพื่อค้นหาตำแหน่ง...',
        // Calendar legend
        legend_scheduled: 'นัดหมาย',
        legend_visit_rec: 'จากการเยี่ยม',
        schedule_visit: 'นัดหมายเยี่ยม',
        // Modals
        review_visit: 'ตรวจสอบข้อมูล',
        edit: 'แก้ไข',
        confirm_save: 'ยืนยันและบันทึก',
        delete_request: 'ขอลบรายการ',
        delete_reason: 'เหตุผลในการลบ:',
        cancel: 'ยกเลิก',
        confirm_delete: 'ยืนยันการลบ',
        save: 'บันทึก',
        delete: 'ลบ',
        remind_before: 'แจ้งเตือนก่อน',
        no_reminder: 'ไม่แจ้งเตือน',
        // Apt modal fields
        start_date: 'วันเริ่มต้น',
        end_date: 'วันสิ้นสุด (ไม่บังคับ)',
        note_optional: 'หมายเหตุ (ไม่บังคับ)',
        // Calendar buttons
        _fc_today: 'วันนี้',
        _fc_month: 'เดือน',
        _fc_week: 'สัปดาห์',
        _fc_day: 'วัน',
        _fc_list: 'รายการ',
    }
};

window.toggleCalendarLang = function () {
    const newLang = AppState.currentLang === 'en' ? 'th' : 'en';
    AppState.currentLang = newLang;
    _applyLang(newLang);
};

function _applyLang(lang) {
    const dict = I18N[lang];
    if (!dict) return;

    // --- Toggle button label (show language you'll switch TO) ---
    const label = document.getElementById('lang-toggle-label');
    if (label) label.textContent = lang === 'en' ? 'TH' : 'EN';

    // --- Apply all [data-i18n] text nodes ---
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (dict[key] !== undefined) el.textContent = dict[key];
    });

    // --- Apply [data-i18n-placeholder] placeholders ---
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (dict[key] !== undefined) el.placeholder = dict[key];
    });

    // --- Inputs without data-i18n-placeholder (use id map) ---
    const phMap = {
        'f-person': lang === 'en' ? 'Full name' : 'ชื่อ-นามสกุล',
        'f-pos-other': lang === 'en' ? 'Enter position' : 'ระบุตำแหน่ง',
        'f-date': lang === 'en' ? 'Select Date' : 'เลือกวันที่',
        'f-reason': lang === 'en' ? 'Purpose of this visit...' : 'วัตถุประสงค์การเยี่ยม...',
        'f-result': lang === 'en' ? 'Outcomes, agreements, follow-ups...' : 'ผลลัพธ์, ข้อตกลง, การติดตาม...',
        'f-next-date': lang === 'en' ? 'Select Date' : 'เลือกวันที่',
        'fl-date': lang === 'en' ? 'Filter by date' : 'กรองตามวันที่',
        'fl-pos-other': lang === 'en' ? 'Type to search position...' : 'พิมพ์เพื่อค้นหาตำแหน่ง...',
        'fl-search': lang === 'en' ? 'Search outlet...' : 'ค้นหาสาขาหรือหมายเหตุ...',
        'delete-reason-input': lang === 'en' ? 'e.g., Duplicated entry...' : 'เช่น รายการซ้ำ...',
    };
    for (const [id, ph] of Object.entries(phMap)) {
        const el = document.getElementById(id);
        if (el) el.placeholder = ph;
    }

    // --- Select option[0] text (filter dropdowns) ---
    const flArea = document.getElementById('fl-area');
    if (flArea && flArea.options[0]) flArea.options[0].text = dict.all_areas;
    const flPos = document.getElementById('fl-pos');
    if (flPos && flPos.options[0]) flPos.options[0].text = dict.all_positions;

    // --- Remind select options ---
    const remindSel = document.getElementById('apt-remind-select');
    if (remindSel) {
        const opts = lang === 'en'
            ? ['No reminder', '15 min', '30 min', '1 hour', '1 day']
            : ['ไม่แจ้งเตือน', '15 นาที', '30 นาที', '1 ชั่วโมง', '1 วัน'];
        Array.from(remindSel.options).forEach((o, i) => { if (opts[i]) o.text = opts[i]; });
    }

    // --- Update page title to match active tab + current lang ---
    const pageTitleEl = document.getElementById('page-title');
    if (pageTitleEl) {
        const activeTab = document.querySelector('.tab.active');
        if (activeTab) {
            const span = activeTab.querySelector('[data-i18n]');
            if (span) {
                const titleMap = {
                    nav_new_visit: { en: 'New Visit', th: 'บันทึกการเยี่ยม' },
                    nav_all_visits: { en: 'All Visits', th: 'ประวัติทั้งหมด' },
                    nav_calendar: { en: 'Calendar Schedule', th: 'ปฏิทินนัดหมาย' }
                };
                const key = span.getAttribute('data-i18n');
                if (titleMap[key]) pageTitleEl.textContent = titleMap[key][lang] || titleMap[key].en;
            }
        }
    }

    // --- FullCalendar locale ---
    if (AppState.calendarObj) {
        AppState.calendarObj.setOption('locale', lang);
        AppState.calendarObj.setOption('buttonText', {
            today: dict._fc_today,
            month: dict._fc_month,
            week: dict._fc_week,
            day: dict._fc_day,
            list: dict._fc_list,
        });
    }

    // --- Save preference ---
    try { localStorage.setItem('visitation_lang', lang); } catch (e) { }
}

// Auto-load saved language on startup
(function initLang() {
    try {
        const saved = localStorage.getItem('visitation_lang') || 'en';
        AppState.currentLang = saved;
        if (saved !== 'en') {
            // Wait for DOM to be ready
            const apply = () => _applyLang(saved);
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', apply);
            } else {
                setTimeout(apply, 400);
            }
        }
    } catch (e) { }
})();
