// ============================================================
// APP CONFIGURATION & CONSTANTS
// ============================================================
const CONFIG = {
    KEYS: {
        PROFILE: 'outlet_profile_v1',
        SESSION: 'checklist_user_session',
        REMEMBER: 'checklist_user_remember',
        AUTOSAVE: 'checklist_autosave_v1'
    },
    SUPABASE: {
        URL: 'https://bvonujjvovziubyhqsjx.supabase.co',
        KEY: 'sb_publishable_GBw0pKHMLihSSfRTpnxuTw_e0OC1hYD'
    },
    PAGE_SIZE: 5,
    MAX_PHOTOS: 10,
    ALLOW_LIBRARY_UPLOAD: true
};

// ============================================================
// SUPABASE REST CLIENT (ไม่ใช้ Auth SDK — เรียก REST ตรงๆ)
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

    // Supabase Storage upload (ยังคงใช้ fetch ตรงๆ)
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
    totalPages: 1,
    totalCount: 0,
    fpDate: null,
    fpNextDate: null,
    fpFilterDate: null,
    isClearingForm: false
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
        const hasSession = localStorage.getItem(CONFIG.KEYS.REMEMBER) || sessionStorage.getItem(CONFIG.KEYS.SESSION);

        if (!rawProfile || !hasSession) return false;

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

        showMainApp();
        return true;
    } catch (e) {
        console.error("Session check error:", e);
        return false;
    }
}

function initApp() {
    AppState.fpDate = flatpickr("#f-date", {
        altInput: true, altFormat: "d M Y", dateFormat: "Y-m-d", defaultDate: "today", minDate: "today", maxDate: "today"
    });

    AppState.fpNextDate = flatpickr("#f-next-date", {
        altInput: true, altFormat: "d M Y", dateFormat: "Y-m-d", minDate: "today"
    });

    AppState.fpFilterDate = flatpickr("#fl-date-wrap", {
        wrap: true, altInput: true, altFormat: "d M Y", dateFormat: "Y-m-d",
        onChange: function() { resetAndFetch(); }
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
        cbNext.addEventListener('change', function() {
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
            placeholder: options.length > 0 ? '-- Select outlet --' : 'ไม่พบรายชื่อร้านค้า',
            allowEmptyOption: true,
            maxOptions: 500,
            maxItems: 1,
            plugins: ['clear_button'],
            render: {
                option: function(item, escape) {
                    return `<div><span style="color:var(--text-muted);font-size:11px;margin-right:6px;">${escape(item.value)}</span>${escape(item.text)}</div>`;
                },
                item: function(item, escape) {
                    return `<div>${escape(item.text)}</div>`;
                }
            },
            onChange: function(value) {
                const opt = options.find(o => o.value === value);
                document.getElementById('f-outlet-name').value = opt ? opt.outletName : '';
                saveAutoSaveData();
            }
        });

    } catch (e) {
        console.error("Load customers error:", e);
    }
}

window.handleFilterPosChange = function() {
    const pos = document.getElementById('fl-pos').value;
    const otherInput = document.getElementById('fl-pos-other');
    if (pos === '__other__') {
        otherInput.style.display = 'block'; otherInput.focus();
    } else {
        otherInput.style.display = 'none'; otherInput.value = '';
    }
    resetAndFetch();
}

// ============================================================
// AUTHENTICATION MODULE
// ============================================================
window.doUserLogin = async function() {
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
        // query user_information พร้อม join users เพื่อดึง password_hash
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

        // ตรวจสอบ is_active
        if (info.users && info.users.is_active === false) {
            errEl.textContent = 'This account has been disabled. Please contact admin.';
            errEl.style.display = 'block';
            return;
        }

        // เทียบ password กับ password_hash ใน users table
        const storedHash = info.users?.password_hash || '';
        const isValid = storedHash === pass;
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
            avatar: ''
        };

        const profilePayload = JSON.stringify(AppState.userProfile);
        localStorage.setItem(CONFIG.KEYS.PROFILE, profilePayload);

        if (remember) {
            localStorage.setItem(CONFIG.KEYS.REMEMBER, 'true');
        } else {
            localStorage.removeItem(CONFIG.KEYS.REMEMBER);
            sessionStorage.setItem(CONFIG.KEYS.SESSION, 'true');
        }

        // เล่น Animation ก่อน แล้วค่อยเข้า showMainApp
        playWelcomeAnimation(AppState.userProfile.name, showMainApp); 
    } catch (e) {
        errEl.textContent = 'Login failed: ' + e.message;
        errEl.style.display = 'block';
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; }
    }
}

window.doUserLogout = function() {
    sessionStorage.removeItem(CONFIG.KEYS.SESSION);
    localStorage.removeItem(CONFIG.KEYS.REMEMBER);
    localStorage.removeItem(CONFIG.KEYS.PROFILE);

    // ยกเลิก Realtime channel ถ้ามี
    if (AppState.realtimeChannel) {
        try { AppState.realtimeChannel.unsubscribe(); } catch(e) {}
        AppState.realtimeChannel = null;
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

window.togglePasswordVisibility = function() {
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

window.resetAndFetch = function() {
    AppState.currentPage = 0;
    fetchVisitsWithSkeleton();
}

let searchTimeout;
window.debounceSearch = function() {
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

        // สร้าง base filter string
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

        // ดึงข้อมูลพร้อม count ในคราวเดียว
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

        // ดึง sub_team ของ users ที่เกี่ยวข้อง
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
            try { parsedPhotos = v.visit_capture ? JSON.parse(v.visit_capture) : []; } catch(e) {}

            let extractedPerson = '', extractedPosition = '', extractedReason = v.visit_report || '';
            const reportMatch = extractedReason.match(/^\[Person Met:\s*(.*?)\s*-\s*(.*?)\]\n\n([\s\S]*)$/);
            if (reportMatch) {
                extractedPerson = reportMatch[1];
                extractedPosition = reportMatch[2];
                extractedReason = reportMatch[3];
            } else {
                extractedPerson = v.bde || '';
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
                userArea: usersMap[v.user_id] || ''
            };
        });

        AppState.visits = formatted;
        updateCount();
    } catch (e) { console.error(e); }
}

window.goToPage = function(page) {
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

function setupRealtime() {
    if (AppState.realtimeChannel) return;
    try {
        // ใช้ Supabase JS SDK realtime ถ้ามี ไม่ก็ polling แทน
        if (typeof window.supabase !== 'undefined') {
            const client = window.supabase.createClient(CONFIG.SUPABASE.URL, CONFIG.SUPABASE.KEY);
            AppState.realtimeChannel = client
                .channel('app-realtime')
                .on('postgres_changes', { event: '*', schema: 'public', table: 'visitation' }, () => loadVisitsFromDB())
                .subscribe();
        } else {
            // Fallback: polling ทุก 30 วินาที
            AppState.realtimeChannel = setInterval(() => loadVisitsFromDB(), 30000);
        }
    } catch(e) {
        console.warn('Realtime setup failed, using polling fallback');
        AppState.realtimeChannel = setInterval(() => loadVisitsFromDB(), 30000);
    }
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
// CAMERA & MEDIA MODULE
// ============================================================
window.toggleCamera = async function() {
    if (AppState.isCameraLoading) return;
    AppState.currentFacingMode = AppState.currentFacingMode === 'environment' ? 'user' : 'environment';
    if (AppState.cameraStream) {
        AppState.cameraStream.getTracks().forEach(t => t.stop());
        AppState.cameraStream = null;
    }
    await window.startCamera();
}

window.startCamera = async function() {
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

window.stopCamera = function() {
    if (AppState.cameraStream) { AppState.cameraStream.getTracks().forEach(t => t.stop()); AppState.cameraStream = null; }
    document.getElementById('camera-modal').classList.remove('open');
    closeCameraGallery(); 
}

window.capturePhoto = function() {
    if (AppState.photos.length >= CONFIG.MAX_PHOTOS) { toast(`Max ${CONFIG.MAX_PHOTOS} photos allowed.`, false); return; }
    const video = document.getElementById('camera-view');
    const canvas = document.getElementById('camera-canvas');
    const ctx = canvas.getContext('2d');
    
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    if (AppState.currentFacingMode === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    if (AppState.currentFacingMode === 'user') { ctx.setTransform(1, 0, 0, 1, 0, 0); }

    AppState.photos.push(canvas.toDataURL('image/jpeg', 0.7));
    video.style.opacity = '0.3';
    setTimeout(() => { video.style.opacity = '1'; }, 150);

    updateModalCounter(); renderPreviews(); updateMiniGalleryThumb(); saveAutoSaveData(); 
    if (document.getElementById('m-photo-grid')) renderModalPhotos();
    if (AppState.photos.length >= CONFIG.MAX_PHOTOS) { toast(`Reached ${CONFIG.MAX_PHOTOS} photos maximum.`); setTimeout(window.stopCamera, 500); }
}

window.selectFromLibrary = function() {
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
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = error => reject(error);
        };
        reader.onerror = error => reject(error);
    });
}

window.handleLibrarySelection = async function(input) {
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
        if (el) { el.addEventListener('input', saveAutoSaveData); el.addEventListener('change', saveAutoSaveData); }
    });
    document.querySelectorAll('.f-followup').forEach(cb => { cb.addEventListener('change', saveAutoSaveData); });
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
    } catch (e) { console.error("Failed to load autosave", e); }
}

window.clearForm = function() {
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
    });
}

// ============================================================
// SAVE & VALIDATION MODULE
// ============================================================
window.triggerSaveConfirm = function() {
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
        if (!el || !el.value.trim()) {
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

window.executeSave = async function() {
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

        toast('✅ Visitation record saved successfully!');
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
}

window.switchTab = function(tab) {
    if (tab !== 'new') window.stopCamera();
    document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', (tab === 'new' && i === 0) || (tab === 'list' && i === 1)));
    document.getElementById('tab-new').style.display = tab === 'new' ? '' : 'none';
    document.getElementById('tab-list').style.display = tab === 'list' ? '' : 'none';

    if (tab === 'list') { AppState.currentPage = 0; fetchVisitsWithSkeleton(); }
}

async function fetchVisitsWithSkeleton() {
    document.getElementById('visit-list').innerHTML = ''; 
    document.getElementById('pagination-container').innerHTML = '';
    document.getElementById('visit-list-loading').style.display = 'block'; 
    await loadVisitsFromDB();
    document.getElementById('visit-list-loading').style.display = 'none';
    renderList(); renderPagination();
}

window.renderList = function() {
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
    if (!filtered.length) { el.innerHTML = `<div class="empty-state"><p>No records found.</p></div>`; return; }

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

window.openDetail = function(id) {
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
            ${isPending ? `<div class="pending-warning" style="margin-bottom: 24px;"><strong>⚠️ Pending deletion review.</strong><div>Reason: ${esc(v.delete_reason)}</div></div>` : ''}
            
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

window.renderConfirmModal = function() {
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
                <div style="font-size: 14px; line-height: 1.5; background: var(--card-bg); padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border-light);">${esc(AppState.pendingSaveData.reason).replace(/\n/g,'<br>')}</div>
            </div>
            <div style="margin-bottom: 16px;">
                <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">Result & Actions</div>
                <div style="font-size: 14px; line-height: 1.5; background: var(--card-bg); padding: 10px 14px; border-radius: 8px; border: 1px solid var(--border-light);">${esc(AppState.pendingSaveData.result).replace(/\n/g,'<br>')}</div>
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

window.enableModalEdit = function() {
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
    flatpickr("#m-next-date", { altInput: true, altFormat: "d M Y", dateFormat: "Y-m-d", minDate: "today" });
}

window.updateModalSubTeam = function(mainTeam) {
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
        grid.innerHTML = `<div style="font-size: 12px; color: var(--danger); padding: 8px 0;">⚠️ No photos attached.</div>`;
    }
}

window.removeModalPhoto = function(i) {
    AppState.photos.splice(i, 1);
    renderModalPhotos(); renderPreviews(); updateModalCounter(); updateMiniGalleryThumb(); saveAutoSaveData(); 
}

// ============================================================
// UTILITIES & HELPERS
// ============================================================
window.openLightbox = function(src) { document.getElementById('lb-img').src = src; document.getElementById('lightbox').classList.add('open'); }
window.closeLightbox = function() { document.getElementById('lightbox').classList.remove('open'); }
window.closeDetail = function() { document.getElementById('detail-overlay').classList.remove('open'); }
window.openDeleteRequest = function(id) { AppState.deleteTargetId = id; document.getElementById('delete-reason-input').value = ''; document.getElementById('delete-confirm-overlay').classList.add('open'); }
window.closeDeleteRequest = function() { AppState.deleteTargetId = null; document.getElementById('delete-confirm-overlay').classList.remove('open'); }
window.closeSaveConfirm = function() { document.getElementById('save-confirm-overlay').classList.remove('open'); AppState.pendingSaveData = null; }

// ============================================================
// REQUEST DELETE MODULE
// ============================================================
window.executeDeleteRequest = async function() {
    const id = AppState.deleteTargetId;
    const reasonInput = document.getElementById('delete-reason-input');
    const reason = reasonInput.value.trim();

    if (!reason) {
        toast('กรุณาระบุเหตุผลในการขอลบข้อมูล', false);
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

        toast('✅ ส่งคำร้องขอลบข้อมูลสำเร็จ');
        window.closeDeleteRequest();
        window.closeDetail();
        window.resetAndFetch();
    } catch (err) {
        console.error(err);
        toast('เกิดข้อผิดพลาด: ' + err.message, false);
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
};

function getPosition() { const s = document.getElementById('f-position').value; return s === '__other__' ? document.getElementById('f-pos-other').value.trim() : s; }
function bindPositionToggle() { document.getElementById('f-position').addEventListener('change', function() { document.getElementById('pos-other-wrap').style.display = this.value === '__other__' ? '' : 'none'; }); }

function esc(s) { if (s == null) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function today() { return new Date().toISOString().split('T')[0]; }
function fmtDate(d) { 
    if (!d) return ''; 
    const dateObj = new Date(d);
    if (isNaN(dateObj)) return d; 
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; 
    return `${dateObj.getDate()} ${months[dateObj.getMonth()]} ${dateObj.getFullYear()}`; 
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
    t.textContent = msg; t.style.background = ok ? 'var(--primary)' : 'var(--danger)'; 
    t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3500); 
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

window.handleProfileUpload = async function(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    if (!file.type.startsWith('image/')) return;
    toast('Updating profile picture...', true);
    try {
        const dataUrl = await fileToDataUrl(file);
        AppState.userProfile.avatar = dataUrl;
        localStorage.setItem(CONFIG.KEYS.PROFILE, JSON.stringify(AppState.userProfile));
        loadAvatarUI(); toast('Profile picture updated!');
    } catch (e) { toast('Failed to update picture.', false); }
    input.value = '';
}

function updateModalCounter() { const el = document.getElementById('modal-photo-counter'); if (el) el.textContent = `${AppState.photos.length} / ${CONFIG.MAX_PHOTOS}`; }

function updateMiniGalleryThumb() {
    const recentThumb = document.getElementById('camera-recent-thumb');
    if (!recentThumb) return;
    if (AppState.photos.length > 0) { recentThumb.style.backgroundImage = `url(${AppState.photos[AppState.photos.length - 1]})`; recentThumb.style.opacity = '1'; } 
    else { recentThumb.style.opacity = '0'; }
}

window.openCameraGallery = function() {
    if (AppState.photos.length === 0) return;
    document.getElementById('camera-header').style.display = 'none';
    document.getElementById('camera-body').style.display = 'none';
    document.getElementById('camera-footer').style.display = 'none';
    document.getElementById('camera-gallery').style.display = 'flex';
    renderCameraGallery();
}

window.closeCameraGallery = function() {
    document.getElementById('camera-header').style.display = 'flex';
    document.getElementById('camera-body').style.display = 'flex';
    document.getElementById('camera-footer').style.display = 'flex';
    document.getElementById('camera-gallery').style.display = 'none';
    updateMiniGalleryThumb();
}

function renderCameraGallery() {
    document.getElementById('cg-grid').innerHTML = AppState.photos.map((p, i) => `<div class="cg-item"><img src="${p}" onclick="window.openLightbox('${p}')"><button class="cg-delete" onclick="window.removePhotoFromGallery(${i})">✕</button></div>`).join('');
}

window.removePhotoFromGallery = function(i) {
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
}

window.removePhoto = function(i) { AppState.photos.splice(i, 1); renderPreviews(); updateModalCounter(); updateMiniGalleryThumb(); saveAutoSaveData(); }
function renderThumbStrip(ph) { if (!ph || !ph.length) return ''; return `<div class="vc-thumbs">${ph.slice(0, 5).map(p => `<div class="vc-thumb"><img src="${p}"></div>`).join('')}${ph.length > 5 ? `<div class="vc-thumb">+${ph.length - 5}</div>` : ''}</div>`; }

window.toggleProfileMenu = function() { document.getElementById('profile-dropdown').classList.toggle('show'); }
window.addEventListener('click', function(e) {
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
window.toggleDarkMode = function() {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('checklist_theme', isDark ? 'dark' : 'light');
    document.querySelectorAll('.moon-icon').forEach(el => el.style.display = isDark ? 'none' : 'block');
    document.querySelectorAll('.sun-icon').forEach(el => el.style.display = isDark ? 'block' : 'none');
}

window.playWelcomeAnimation = function(name, callback) {
    const screen = document.getElementById('welcome-screen');
    const text = document.getElementById('welcome-text');
    const avatar = document.getElementById('welcome-avatar');
    
    // ซ่อนหน้า Login
    document.getElementById('login-screen').style.display = 'none';
    
    // ดึงชื่อคำแรกมาแสดง (ตัดช่องว่าง)
    const firstName = name ? name.split(' ')[0] : 'User';
    text.textContent = `Hello, ${firstName}!`;
    avatar.textContent = firstName.charAt(0).toUpperCase(); // ใช้ตัวอักษรแรก
    
    // รีเซ็ตคลาสและแสดงหน้า Welcome
    screen.classList.remove('welcome-fade-out', 'animate-welcome');
    screen.style.display = 'flex';
    
    // เริ่มแอนิเมชันเด้งขึ้นมา
    setTimeout(() => {
        screen.classList.add('animate-welcome');
    }, 50);
    
    // โชว์ค้างไว้ 2 วินาที แล้ว Fade out ค่อยเข้าแอปหลัก
    setTimeout(() => {
        screen.classList.add('welcome-fade-out');
        setTimeout(() => {
            screen.style.display = 'none';
            if(callback) callback(); // เรียกคำสั่งเข้าหน้าแอปหลัก (showMainApp)
        }, 500); // รอให้ Fade out จบ (0.5 วินาที)
    }, 2000); 
};
