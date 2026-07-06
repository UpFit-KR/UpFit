const API_BASE_URL = (window.APP_CONFIG && window.APP_CONFIG.BACKEND_BASE);

// 공통 fetch 응답 처리
async function handleResponse(res) {
    // 인증 만료/실패 → 로그인 페이지로
    if (res.status === 401 || res.status === 403) {
        redirectToLogin('세션이 만료되었습니다. 다시 로그인해주세요.');
        throw new Error('인증이 만료되었습니다');
    }
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        // JWT/인증 관련 오류가 500 등으로 와도 로그인 페이지로 유도
        if (/jwt|token|expired|signature|malformed|unauthor|forbidden|authentication/i.test(text)) {
            redirectToLogin('세션이 만료되었습니다. 다시 로그인해주세요.');
            throw new Error('인증이 만료되었습니다');
        }
        throw new Error(text || (res.status + ' ' + res.statusText));
    }
    if (res.status === 204) return null;
    return res.json();
}

// ★ login.js / oauth-redirect.html 이 토큰을 저장하는 키와 동일하게 맞춤
const TOKEN_KEY = 'accessToken';

// 저장된 JWT 토큰
function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }

// JWT payload 디코드 (base64url) — 서버 호출 없이 토큰 내용을 읽음
function decodeJwt(token) {
    try {
        const part = token.split('.')[1];
        if (!part) return null;
        let b64 = part.replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        const json = decodeURIComponent(
            atob(b64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
        );
        return JSON.parse(json);
    } catch { return null; }
}

// 현재 로그인된 사용자 uid
// 1) JWT 토큰의 subject 에서 추출  2) 저장된 currentUser 객체에서 추출
function getUid() {
    const t = getToken();
    if (t) {
        const p = decodeJwt(t);
        // 백엔드 JwtTokenProvider가 uid를 subject(sub)에 넣음. 다르면 후보 조정.
        if (p && (p.sub || p.uid || p.username)) return p.sub || p.uid || p.username;
    }
    // oauth-redirect.html 이 저장한 사용자 객체(UserDTO)에서 uid 추출
    try {
        const cu = JSON.parse(localStorage.getItem('currentUser') || 'null');
        if (cu && cu.uid) return cu.uid;
    } catch (_) {}
    return '';
}

// 토큰 존재 + 만료 여부 검사
function isTokenValid() {
    const t = getToken();
    if (!t) return false;
    const p = decodeJwt(t);
    if (!p) return false;
    if (p.exp && Date.now() >= p.exp * 1000) return false; // 만료됨
    return true;
}

// 인증 헤더 (JWT를 Authorization 헤더로 전송)
function authHeaders(withJson) {
    const h = {};
    if (withJson) h['Content-Type'] = 'application/json';
    const t = getToken();
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
}

// 로그인 페이지로 이동 (토큰 없음/만료 시)
let _authRedirecting = false;
function redirectToLogin(msg) {
    if (_authRedirecting) return;   // 같은 페이지 안에서 중복 알림 방지
    _authRedirecting = true;
    alert(msg || '토큰이 만료되었거나 존재하지 않습니다. 다시 로그인해주세요.');
    logout();                       // accessToken 제거 → login.js가 되튕기지 않음 (루프 방지)
    location.href = 'login.html';
}

// 토큰이 유효하지 않으면 로그인 페이지로 보냄. 유효하면 true 반환
function requireAuthOrRedirect() {
    if (!isTokenValid()) { redirectToLogin(); return false; }
    return true;
}

// 로그인(아이디/비번) — 소셜 로그인을 쓰면 사용 안 함. 콘솔 테스트용으로만 유지.
async function login(uid, password) {
    const res = await fetch(`${API_BASE_URL}/user/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, password })
    });
    if (!res.ok) throw new Error('로그인 실패 (' + res.status + ')');
    const jwt = await res.json(); // JWTDTO: { token, user ... }
    if (!jwt.token) throw new Error('토큰을 받지 못했습니다 (JWTDTO 필드명 확인)');
    localStorage.setItem(TOKEN_KEY, jwt.token);
    if (jwt.user) localStorage.setItem('currentUser', JSON.stringify(jwt.user));
    return jwt;
}

// 로그아웃 확인 — "로그아웃을 진행하시겠습니까?" 후 진행
function confirmLogout() {
    if (!confirm('로그아웃을 진행하시겠습니까?')) return;
    logout();
    location.href = 'login.html';
}

// 로그아웃: 저장된 인증 정보 전부 제거 (login.js가 토큰 존재만 보고 되돌리는 루프 방지)
function logout() {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('auth');
}

// ★ 메인 페이지 진입 즉시 토큰 확인 — 없거나 만료면 안내 후 login.html로 이동
requireAuthOrRedirect();

// 백엔드 API 호출 모음 (모든 요청에 uid + JWT 포함)
const Api = {
    // 건물 (/building)
    getBuildings: () =>
        fetch(`${API_BASE_URL}/building/all/${getUid()}`, { headers: authHeaders() }).then(handleResponse),
    getBuilding: (id) =>
        fetch(`${API_BASE_URL}/building/id/${getUid()}/${id}`, { headers: authHeaders() }).then(handleResponse),
    createBuilding: (dto, mediaFiles) => {
        const fd = new FormData();
        fd.append('uid', getUid());                       // @RequestPart("uid") String
        fd.append('buildingData', JSON.stringify(dto));   // @RequestPart("buildingData") String
        (mediaFiles || []).forEach(f => fd.append('mediaData', f));  // @RequestPart("mediaData") List<MultipartFile> (여러 장, 선택)
        // FormData 전송 시 Content-Type은 브라우저가 boundary와 함께 자동 설정 → authHeaders()만 사용
        return fetch(`${API_BASE_URL}/building`, { method: 'POST', headers: authHeaders(), body: fd }).then(handleResponse);
    },
    updateBuilding: (dto, mediaFiles) => {
        const fd = new FormData();
        fd.append('uid', getUid());
        fd.append('buildingData', JSON.stringify(dto));   // dto.mediaURLs = 유지할 기존 이미지 목록, dto.id 포함
        (mediaFiles || []).forEach(f => fd.append('mediaData', f));  // 새로 추가 업로드할 파일들
        return fetch(`${API_BASE_URL}/building`, { method: 'PUT', headers: authHeaders(), body: fd }).then(handleResponse);
    },
    deleteBuilding: (id) =>
        fetch(`${API_BASE_URL}/building/delete/${getUid()}/${id}`, { method: 'DELETE', headers: authHeaders() }).then(handleResponse),
    // 휴지통 (소프트 삭제 / 복원 / 영구삭제)
    getTrash: () =>
        fetch(`${API_BASE_URL}/building/trash/${getUid()}`, { headers: authHeaders() }).then(handleResponse),
    restoreBuilding: (id) =>
        fetch(`${API_BASE_URL}/building/restore/${getUid()}/${id}`, { method: 'PUT', headers: authHeaders() }).then(handleResponse),
    permanentlyDeleteBuilding: (id) =>
        fetch(`${API_BASE_URL}/building/trash/${getUid()}/${id}`, { method: 'DELETE', headers: authHeaders() }).then(handleResponse),
    searchBuildings: (keyword) =>
        fetch(`${API_BASE_URL}/building/search/${getUid()}?keyword=${encodeURIComponent(keyword)}`, { headers: authHeaders() }).then(handleResponse),

    // 호실 (/unit)
    createUnit: (buildingId, dto) =>
        fetch(`${API_BASE_URL}/unit/${getUid()}/building/${buildingId}`, { method: 'POST', headers: authHeaders(true), body: JSON.stringify(dto) }).then(handleResponse),
    updateUnit: (id, dto) =>
        fetch(`${API_BASE_URL}/unit/${getUid()}/${id}`, { method: 'PUT', headers: authHeaders(true), body: JSON.stringify(dto) }).then(handleResponse),
    deleteUnit: (id) =>
        fetch(`${API_BASE_URL}/unit/delete/${getUid()}/${id}`, { method: 'DELETE', headers: authHeaders() }).then(handleResponse),

    // 사용자 (/user)
    // 공개 프로필 카드 조회 — 매물 등록자 등 "다른 사용자"의 이름/프로필을 가져옴
    getUserProfile: (uid) =>
        fetch(`${API_BASE_URL}/user/profile/${encodeURIComponent(uid)}`, { headers: authHeaders() }).then(handleResponse),
    // 회원 수정 (프로필 사진 변경) — userData(JSON 문자열) + 선택적 mediaData(파일) 멀티파트 전송
    updateUser: (userDTO, file) => {
        const fd = new FormData();
        fd.append('userData', JSON.stringify(userDTO));   // @RequestPart("userData") String
        if (file) fd.append('mediaData', file);           // @RequestPart(value="mediaData", required=false)
        return fetch(`${API_BASE_URL}/user`, { method: 'PUT', headers: authHeaders(), body: fd }).then(handleResponse);
    },

    // 권한 (권한 관리 기능)
    myPermission: () =>
        fetch(`${API_BASE_URL}/user/permission/${getUid()}`, { headers: authHeaders() }).then(handleResponse),
    listPermissions: () =>
        fetch(`${API_BASE_URL}/user/admin/permissions/${getUid()}`, { headers: authHeaders() }).then(handleResponse),
    updatePermission: (targetId, dto) =>
        fetch(`${API_BASE_URL}/user/admin/permissions/${getUid()}/${targetId}`, { method: 'PUT', headers: authHeaders(true), body: JSON.stringify(dto) }).then(handleResponse),

    // 계약자·임차인 관리 (중개사 전용)
    getTenants: () =>
        fetch(`${API_BASE_URL}/tenant/${getUid()}`, { headers: authHeaders() }).then(handleResponse),
    createTenant: (dto) =>
        fetch(`${API_BASE_URL}/tenant/${getUid()}`, { method: 'POST', headers: authHeaders(true), body: JSON.stringify(dto) }).then(handleResponse),
    updateTenant: (id, dto) =>
        fetch(`${API_BASE_URL}/tenant/${getUid()}/${id}`, { method: 'PUT', headers: authHeaders(true), body: JSON.stringify(dto) }).then(handleResponse),
    deleteTenant: (id) =>
        fetch(`${API_BASE_URL}/tenant/${getUid()}/${id}`, { method: 'DELETE', headers: authHeaders() }).then(handleResponse),

    // 장소 검색 (/api/search/place) — 네이버 지역검색 프록시. 지도 중심(lat/lng)을 주면 가까운 순으로 정렬됨
    searchPlace: (query, lat, lng) => {
        let qs = `query=${encodeURIComponent(query)}`;
        if (lat != null && lng != null) qs += `&lat=${lat}&lng=${lng}`;
        return fetch(`${API_BASE_URL}/api/search/place?${qs}`, { headers: authHeaders() }).then(handleResponse);
    },
};

// 전역 상태 (서버에서 불러온 건물 목록 캐시)
let state = { buildings: [] };

// =====================================================
// 사용자 프로필 헬퍼 (설정 화면 · 매물 등록자 표시 공용)
// =====================================================
// 로그인 시 저장된 사용자 객체(UserDTO) 읽기/쓰기 — name, profileURL, provider 등 포함
function getCurrentUser() {
    try { return JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch (_) { return null; }
}
function setCurrentUser(u) {
    try { localStorage.setItem('currentUser', JSON.stringify(u)); } catch (_) {}
}

// =====================================================
// 권한 (생성/조회/수정/삭제) — 관리자 uid 고정, 그 외는 서버에서 받은 권한으로 게이팅
// =====================================================
const ADMIN_UID = '3635939452';
let _myPerms = null;   // { admin, canCreate, canRead, canUpdate, canDelete }

function isAdminUser() {
    const u = getCurrentUser();
    return !!(u && u.uid === ADMIN_UID);
}
// 중개사 여부 — 관리자이거나 역할이 broker (권한 로드 전에는 사무소 정보로 임시 판정)
function isBroker() {
    const u = getCurrentUser();
    if (u && u.uid === ADMIN_UID) return true;
    if (_myPerms && _myPerms.role) return _myPerms.role === 'broker';
    return !!(u && u.agencyName && String(u.agencyName).trim());
}
// 현재 로그인 유저의 유효 권한. 관리자는 항상 전체 허용. 로드 전 기본값은 조회만 허용.
function myPerms() {
    if (isAdminUser()) return { admin: true, canCreate: true, canRead: true, canUpdate: true, canDelete: true };
    if (_myPerms) return _myPerms;
    return { admin: false, canCreate: false, canRead: true, canUpdate: false, canDelete: false };
}
async function loadMyPermission() {
    const u = getCurrentUser();
    if (!u || !u.uid) { _myPerms = null; return; }
    if (u.uid === ADMIN_UID) { _myPerms = { admin: true, canCreate: true, canRead: true, canUpdate: true, canDelete: true }; return; }
    try { _myPerms = await Api.myPermission(); } catch (_) { /* 실패 시 기본값 유지 */ }
}

// 권한에 따라 전역 UI(건물 추가 버튼 등) 반영
function applyPermUI() {
    const p = myPerms();
    const add = document.getElementById('add-btn-float');
    if (add) add.style.display = p.canCreate ? '' : 'none';
    // '관리자'(계약자 관리) 탭은 중개사에게만 노출
    const adminTab = document.querySelector('.nav-tab[data-tab="stats"]');
    if (adminTab) adminTab.style.display = isBroker() ? '' : 'none';
}

// HTML/속성 이스케이프 (이름에 <, ", & 등이 들어가도 마크업이 깨지지 않게)
function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// [B] edit by smsong - 라인 스타일 SVG 아이콘 (하단 네비와 동일한 stroke 라인 톤)
// 기본 이모지(✏️🔒📷✕✓👤 등) 대신 사용. currentColor 상속 → 텍스트 색을 그대로 따름.
const ICON_PATHS = {
    trash:   '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    info:    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    restore: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
    edit:    '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',
    lock:    '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    camera:  '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="3.5"/>',
    check:   '<polyline points="20 6 9 17 4 12"/>',
    close:   '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    plus:    '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    user:    '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    back:    '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
    pin:     '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    building:'<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="9" y1="22" x2="9" y2="18"/><line x1="15" y1="22" x2="15" y2="18"/><line x1="8" y1="6" x2="10" y2="6"/><line x1="14" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="10" y2="14"/><line x1="14" y1="14" x2="16" y2="14"/>',
    map:     '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>',
    agency:  '<path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/><path d="M3 9h18"/>',
    phone:   '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7A2 2 0 0 1 22 16.9z"/>',
    // 건물 유형 아이콘 (단독&다중 / 다세대 / 오피스텔 / 상가)
    house:      '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    multiplex:  '<path d="M3 21V9l5-4 5 4v12"/><path d="M13 21V11l4-3 4 3v10"/><path d="M6 13h1.5M6 16.5h1.5M9.5 13h1.5M9.5 16.5h1.5"/>',
    officetel:  '<rect x="6" y="3" width="12" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>',
    commercial: '<path d="M4 9l1.2-4h13.6L20 9"/><path d="M5 9v11h14V9"/><path d="M3.5 9h17"/><path d="M9.5 20v-5h5v5"/>'
};
// icon(name, size, extraStyle) → inline SVG 문자열
function icon(name, size, extraStyle) {
    const sz = size || 16;
    const sw = sz <= 18 ? 2 : 1.8;
    return `<svg class="ic ic-${name}" width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="none" `
        + `stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" `
        + `style="vertical-align:middle;flex-shrink:0;${extraStyle || ''}" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
}
// 건물 유형 → 라인 아이콘 (기본 이모지 대체)
const TYPE_ICON_NAME = { house: 'house', multiplex: 'multiplex', officetel: 'officetel', apartment: 'officetel', neighborhood: 'commercial', commercial: 'commercial' };
function typeIcon(type, size, color) {
    return `<span style="display:inline-flex;align-items:center;color:${color || '#1a56db'};">`
        + icon(TYPE_ICON_NAME[type] || 'building', size || 22) + `</span>`;
}
// [E] edit by smsong

// 소셜 로그인 제공자 → 표시 정보(라벨/색상)
function providerInfo(p) {
    switch (String(p || '').toLowerCase()) {
        case 'kakao':  return { label: '카카오', color: '#191600', bg: '#FEE500', border: '' };
        case 'naver':  return { label: '네이버', color: '#ffffff', bg: '#03C75A', border: '' };
        case 'google': return { label: '구글',  color: '#374151', bg: '#ffffff', border: '#e5e7eb' };
        default:        return { label: '이메일', color: '#374151', bg: '#f3f4f6', border: '' };
    }
}
function providerBadge(p) {
    const i = providerInfo(p);
    return `<span class="provider-badge" style="background:${i.bg};color:${i.color};${i.border ? `border:1px solid ${i.border};` : ''}">${i.label}</span>`;
}
function providerLoginText(p) {
    return `${providerInfo(p).label} 계정으로 로그인됨`;
}

// 아바타(프로필 원형) — 이미지가 있으면 사진, 없거나 로드 실패하면 이름 첫 글자
function avatarHTML(profile, sizePx) {
    const url = profile && profile.profileURL ? profile.profileURL : '';
    const name = (profile && (profile.name || profile.nickname)) || '';
    // [B] edit by smsong - 이름이 없으면 기본 이모지(👤) 대신 라인 SVG 유저 아이콘 사용
    const initial = name ? escapeHtml(name.trim().charAt(0)) : icon('user', Math.round((sizePx || 40) * 0.5));
    // [E] edit by smsong
    const sz = sizePx || 40;
    // 이미지는 실패해도 영구 제거하지 않고 retryAvatarImg() 로 재시도 (GCS 일시 오류/동시요청 대응).
    // 성공하면 onload 로 이니셜을 가리고, 끝내 실패하면 이미지가 숨겨져 밑에 깔린 이니셜이 보인다.
    return `<div class="avatar" style="width:${sz}px;height:${sz}px;font-size:${Math.round(sz * 0.42)}px;">
        <span class="avatar-initial">${initial}</span>
        ${url ? `<img class="avatar-img" src="${escapeHtml(url)}" alt="" decoding="async" onerror="retryAvatarImg(this)">` : ''}
    </div>`;
}

// 프로필 이미지 로드 실패 시: 제거하지 말고 캐시버스터로 몇 번 재시도. 계속 실패할 때만 숨김(이니셜 노출).
function retryAvatarImg(img) {
    const MAX = 3;
    if (!img.dataset.base) img.dataset.base = (img.getAttribute('src') || '').split('?_r=')[0];
    const n = parseInt(img.dataset.retry || '0', 10);
    if (n >= MAX) { img.style.display = 'none'; return; }
    img.dataset.retry = String(n + 1);
    const base = img.dataset.base;
    setTimeout(() => {
        img.style.display = '';                       // 재시도 위해 다시 표시
        img.src = base + (base.indexOf('?') >= 0 ? '&' : '?') + '_r=' + Date.now();  // GCS는 알 수 없는 쿼리 무시
    }, 200 * (n + 1));
}

// 매물 등록자 프로필 캐시 (uid -> {name, profileURL, provider, agency...})
const _ownerCache = {};

// [B] edit by smsong - 소유자 식별자 추출/비교 견고화
// 백엔드가 등록자 식별자를 어떤 필드명(ownerUid/uid/ownerId/writerUid/owner/user_id)으로,
// 또 uid(문자열) 혹은 id(숫자) 중 무엇으로 내려도 "내 매물"을 올바르게 판별하도록 함.
function ownerIdOf(obj) {
    if (!obj) return '';
    const v = obj.ownerUid ?? obj.uid ?? obj.userUid ?? obj.ownerId ?? obj.writerUid ?? obj.owner ?? obj.user_id ?? obj.userId;
    return v == null ? '' : String(v);
}
function myIds() {
    const me = getCurrentUser() || {};
    return [getUid(), me.uid, me.id, me.userId, me.name]
        .filter(v => v != null && v !== '')
        .map(String);
}
// 현재 로그인 사용자가 이 오브젝트(건물/호실)의 작성자인지 확인
function isMine(obj) {
    const owner = ownerIdOf(obj);
    if (!owner) return false;
    return myIds().includes(owner);
}
// [E] edit by smsong

async function fetchOwnerProfile(obj) {
    // [B] edit by smsong - uid 문자열 또는 건물/호실 객체 모두 허용
    const uid = (obj && typeof obj === 'object') ? ownerIdOf(obj) : (obj || '');
    // [E] edit by smsong
    if (!uid) return null;
    if (_ownerCache[uid]) return _ownerCache[uid];
    const me = getCurrentUser();
    if (me && myIds().includes(String(uid))) { _ownerCache[uid] = me; return me; }   // 본인이면 로컬 정보 사용
    try {
        const p = await Api.getUserProfile(uid);
        _ownerCache[uid] = p || { uid };
        return _ownerCache[uid];
    } catch (_) {
        return { uid };   // 실패 시 uid 만으로 표시
    }
}

// 서버에서 전체 건물(+호실)을 불러와 state에 저장
async function loadData(isInitial) {
    if (isInitial) { try { await loadMyPermission(); } catch (_) {} }   // 내 권한 먼저 로드(버튼 게이팅용)
    try {
        const buildings = await Api.getBuildings();
        // 백엔드 id(Long) -> 문자열로 정규화 (기존 '=== id' 비교 로직 그대로 동작)
        (buildings || []).forEach(b => {
            b.id = String(b.id);
            b.units = (b.units || []).map(u => ({ ...u, id: String(u.id) }));
            // 계약 만료일이 지난(당일 포함) 임차중/만기임박 호실은 자동으로 '공실' 처리
            b.units.forEach(u => { u.status = effectiveStatus(u); });
        });
        state.buildings = buildings || [];
    } catch (e) {
        state.buildings = [];
        if (_authRedirecting) return state;   // 이미 로그인 페이지로 이동 중
        if (isInitial) {
            // 메인 진입 시 데이터 로드 실패(서버가 토큰 거부/500/연결 실패) → 로그인으로
            redirectToLogin('세션이 만료되었거나 서버에 연결할 수 없습니다. 다시 로그인해주세요.');
        } else if (typeof showToast === 'function') {
            showToast('서버 연결 실패: ' + e.message);
        }
    }
    return state;
}

// =====================================================
// MAP
// =====================================================
let map; // 네이버는 geocoder 객체를 따로 선언할 필요가 없습니다.
let markers = [];
let overlays = [];
let pickerMode = false;
let pickerLatlng = null;
let currentBuilding = null;
let activeFilter = 'all';
let activeTab = 'map';
let listMineOnly = false;   // '내 목록' 탭이면 내 건물만 표시

const STATUS_COLOR = { empty: '#dc2626', occupied: '#0d9451', expiring: '#d97706' };
const STATUS_LABEL = { empty: '공실', occupied: '임차', expiring: '만기임박' };
const TYPE_EMOJI = { house: '🏠', multiplex: '🏘️', officetel: '🏢', apartment: '🏬', neighborhood: '🏪', commercial: '🛍️' };
const TYPE_LABEL = { house: '단독&다중', multiplex: '다세대', officetel: '오피스텔', apartment: '아파트', neighborhood: '근린생활시설', commercial: '상가' };

// 거래유형 (sale=매매 / jeonse=전세 / monthly=월세)
const DEAL_LABEL = { sale: '매매', jeonse: '전세', monthly: '월세' };
const DEAL_COLOR = { sale: '#7c3aed', jeonse: '#1a56db', monthly: '#0d9451' }; // 매매 보라 · 전세 블루 · 월세 그린
const DEAL_CODES = ['sale', 'jeonse', 'monthly'];

// 거래유형 결정: 명시값이 있으면 그대로, 없으면(구 데이터) 가격으로 추정.
//  · 월세>0  → 월세(monthly)
//  · 보증금만 → 전세(jeonse)
//  · 매매는 가격만으론 전세와 구분 불가 → 명시값에만 의존
function inferDeal(o) {
    if (o && o.dealType && DEAL_LABEL[o.dealType]) return o.dealType;
    const rent = (o && o.rent) || 0, dep = (o && o.deposit) || 0;
    if (rent > 0) return 'monthly';
    if (dep > 0) return 'jeonse';
    return 'monthly';
}
// 거래유형 배지(작은 색상 칩)
function dealBadge(o, sizePx) {
    const d = inferDeal(o);
    const fs = sizePx || 10.5;
    return `<span class="deal-badge" style="--dc:${DEAL_COLOR[d]};font-size:${fs}px;">${DEAL_LABEL[d]}</span>`;
}

// 계약 만료일이 지나면(만기일 당일 포함) 자동으로 '공실'로 간주.
//  · 저장값을 바꾸지 않고 "표시상" 자동 전환 → 새로고침/cron 없이 항상 최신.
function effectiveStatus(u) {
    if (!u) return 'empty';
    if (u.status !== 'empty' && u.contractEnd) {
        const end = new Date(u.contractEnd);
        if (!isNaN(end)) {
            const today = new Date();
            const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            const e0 = new Date(end.getFullYear(), end.getMonth(), end.getDate());
            if (e0 <= t0) return 'empty';   // 만기일이 되면(=오늘 이상이면) 공실
        }
    }
    return u.status || 'empty';
}

// 역지오코딩 v2 응답으로 "지번 주소"를 만든다. (도로명 미사용)
//  예) "서울특별시 강남구 역삼동 681-1"
//  · address.jibunAddress 우선, 비어 있으면 results 의 'addr' 결과로 직접 조합.
//  · 지번이 정말 없는 위치에서만 최후로 도로명을 반환(빈 주소 방지).
function buildFullAddress(v2) {
    if (!v2) return '';
    const a = v2.address || {};
    let jibun = (a.jibunAddress || '').trim();
    if (!jibun && Array.isArray(v2.results)) {
        v2.results.forEach(r => { if (r.name === 'addr' && !jibun) jibun = composeAddrFromResult(r); });
    }
    if (jibun) return jibun;

    // 지번이 없을 때만 도로명 폴백
    let road = (a.roadAddress || '').trim();
    if (!road && Array.isArray(v2.results)) {
        v2.results.forEach(r => { if (r.name === 'roadaddr' && !road) road = composeAddrFromResult(r); });
    }
    return road;
}

// reverseGeocode results 한 건(region+land)으로 주소 문자열 조합
function composeAddrFromResult(r) {
    if (!r) return '';
    const rg = r.region || {}, land = r.land || {};
    const region = [rg.area1, rg.area2, rg.area3, rg.area4]
        .map(x => x && x.name).filter(Boolean).join(' ');
    const num = land.number1
        ? land.number1 + (land.number2 && land.number2 !== '0' ? '-' + land.number2 : '')
        : '';
    if (r.name === 'roadaddr') {
        // 도로명: 시/도 구 + 도로명(land.name) + 건물번호
        const head = [rg.area1, rg.area2].map(x => x && x.name).filter(Boolean).join(' ');
        let s = [head, land.name, num].filter(Boolean).join(' ').trim();
        if (land.addition0 && land.addition0.value) s += ' (' + land.addition0.value + ')'; // 건물명
        return s;
    }
    // 지번
    return [region, num].filter(Boolean).join(' ').trim();
}

async function initMap() {
    if (!requireAuthOrRedirect()) return;
    const container = document.getElementById('map');

    // Fallback center: Seoul (네이버 좌표계)
    const center = new naver.maps.LatLng(37.5665, 126.9780);

    // 네이버 지도 생성 (줌 레벨 14가 카카오의 7 정도와 비슷합니다)
    map = new naver.maps.Map(container, {
        center: center,
        zoom: 14,
        zoomControl: false // 커스텀 버튼을 쓰므로 기본 컨트롤은 숨김
    });

    naver.maps.Event.addListener(map, 'click', function(e) {
        if (pickerMode) {
            pickerLatlng = e.coord; // 네이버는 e.coord에 좌표가 담깁니다.
            togglePickerImmersive(); // 위치 설정 중에도 탭하면 상단(검색/안내)·하단 메뉴가 숨고 버튼이 내려감
            return;
        }
        // 시트가 펼쳐져 있으면 peek로 내리고, 아니면(어느 탭이든) 상/하단 메뉴 토글(몰입 모드)
        if (Sheet.isOpen()) { Sheet.dismiss(); return; }
        toggleImmersive();
    });

    // 사용자가 직접 지도를 움직이면, 뒤늦게 도착한 현재위치로 화면이 튀지 않도록 자동 센터링 취소
    naver.maps.Event.addListener(map, 'dragstart', function () { _suppressAutoCenter = true; });

    // 줌/이동이 멈출 때마다 픽셀 거리 기준으로 다시 묶음 → 확대하면 자동으로 풀림
    naver.maps.Event.addListener(map, 'idle', scheduleRenderMarkers);

    await loadData(true);
    renderMarkers();
    updateStats();
    showBuildingList();
    applyPermUI();
    showSheet('');

    // Zoom controls (네이버는 숫자가 클수록 확대됩니다. 카카오와 반대)
    document.getElementById('zoom-in-btn').onclick = () => map.setZoom(map.getZoom() + 1);
    document.getElementById('zoom-out-btn').onclick = () => map.setZoom(map.getZoom() - 1);
    document.getElementById('my-location-btn').onclick = gotoMyLocation;
    document.getElementById('add-btn-float').onclick = toggleMapPicker;
    document.getElementById('map-picker-confirm').onclick = confirmPickerLocation;

    // 현재 위치 추적 시작(파란 점). iOS가 아니면 나침반도 바로 연결
    startGeolocationTracking();
    if (!(typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function')) {
        ensureOrientationPermission();
    }

    // 처음 진입 시: 현재 위치로 지도 중심 이동 (권한 거부/실패 시 기본 서울 중심 유지)
    centerOnCurrentLocationOnce();
}

function gotoMyLocation() {
    ensureOrientationPermission();           // iOS: 사용자 제스처에서 나침반 권한 요청
    _suppressAutoCenter = true;              // 버튼으로 직접 이동하면 자동 센터링은 더 이상 불필요
    if (!navigator.geolocation) { showToast('위치 권한이 필요합니다'); return; }
    navigator.geolocation.getCurrentPosition(pos => {
        const latlng = new naver.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
        updateGeoMarker(latlng, pos.coords.heading);
        map.setCenter(latlng);
        map.setZoom(16); // 내 위치는 확대해서 보여줌
    }, () => showToast('위치 권한이 필요합니다'), { enableHighAccuracy: true });
    if (geoWatchId == null) startGeolocationTracking();
}

// 처음 지도 로드 시 1회: 현재 위치를 받아 지도 중심을 그 위치로 이동.
// 사용자가 이미 지도를 움직였다면(_suppressAutoCenter) 화면을 가로채지 않는다.
function centerOnCurrentLocationOnce() {
    if (!navigator.geolocation || !map) return;
    navigator.geolocation.getCurrentPosition(pos => {
        if (_suppressAutoCenter) return;     // 그 사이 사용자가 지도를 조작했으면 중단
        const latlng = new naver.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
        updateGeoMarker(latlng, pos.coords.heading);
        map.setCenter(latlng);
        map.setZoom(16);
    }, () => { /* 거부/실패 → 기본 서울 중심 유지 */ },
       { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
}

// =====================================================
// 현재 위치 + 방향(나침반) — 네이버 지도앱 스타일
// =====================================================
let geoMarker = null;
let geoWatchId = null;
let geoHeading = 0;
let _oriAsked = false;
let _suppressAutoCenter = false;   // 사용자가 지도를 직접 움직이면 초기 자동 센터링 취소

// 지도 로드시 현재 위치 추적 시작 → 파란 점 + 방향 부채꼴 표시
function startGeolocationTracking() {
    if (!navigator.geolocation || !map) return;
    if (geoWatchId != null) return;
    geoWatchId = navigator.geolocation.watchPosition(pos => {
        const latlng = new naver.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
        updateGeoMarker(latlng, pos.coords.heading);
    }, () => {}, { enableHighAccuracy: true, maximumAge: 1000, timeout: 12000 });
}

function geoMarkerContent() {
    return '' +
        '<div class="geo-loc-marker">' +
        '  <div class="geo-loc-beam" id="geo-loc-beam"></div>' +
        '  <div class="geo-loc-pulse"></div>' +
        '  <div class="geo-loc-dot"></div>' +
        '</div>';
}

function updateGeoMarker(latlng, gpsHeading) {
    if (!map) return;
    if (!geoMarker) {
        geoMarker = new naver.maps.Marker({
            position: latlng,
            map: map,
            zIndex: 1000,
            clickable: false,
            icon: {
                content: geoMarkerContent(),
                size: new naver.maps.Size(44, 44),
                anchor: new naver.maps.Point(22, 22)
            }
        });
    } else {
        geoMarker.setPosition(latlng);
    }
    // GPS 이동방향이 있으면 그것도 반영(걷는 중)
    if (typeof gpsHeading === 'number' && !isNaN(gpsHeading)) {
        geoHeading = gpsHeading;
        applyGeoHeading();
    }
}

function applyGeoHeading() {
    const beam = document.getElementById('geo-loc-beam');
    if (beam) beam.style.transform = 'rotate(' + geoHeading + 'deg)';
}

// 기기 방향(나침반) 핸들러 — iOS의 webkitCompassHeading 우선, 그 외엔 alpha 변환
function _onDeviceOrientation(e) {
    let hd = null;
    if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) {
        hd = e.webkitCompassHeading;                       // iOS: 이미 북=0, 시계방향
    } else if (e.alpha != null && !isNaN(e.alpha)) {
        hd = (360 - e.alpha) % 360;                        // Android 등: 북 기준으로 변환
    }
    if (hd != null) { geoHeading = hd; applyGeoHeading(); }
}

function _attachOrientation() {
    window.addEventListener('deviceorientationabsolute', _onDeviceOrientation, true);
    window.addEventListener('deviceorientation', _onDeviceOrientation, true);
}

// iOS 13+ 는 사용자 제스처에서 권한 요청 필요
function ensureOrientationPermission() {
    if (_oriAsked) return;
    _oriAsked = true;
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
            .then(state => { if (state === 'granted') _attachOrientation(); })
            .catch(() => {});
    } else {
        _attachOrientation();
    }
}

// 금액(만원) → "X.X억" / "X천만" 표기. 불필요한 .0 은 제거.
function formatEok(manwon) {
    if (!manwon || manwon <= 0) return '';
    if (manwon >= 10000) {                       // 1억 이상 → 억 단위
        const eok = Math.round((manwon / 10000) * 10) / 10;   // 소수 1자리 반올림
        return (Number.isInteger(eok) ? String(eok) : eok.toFixed(1)) + '억';
    }
    return manwon.toLocaleString() + '만';        // 1억 미만 → 만원 그대로
}

// 등록일 표시 — DB의 datetime을 받아 날짜만 (YYYY.MM.DD)
function formatDate(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    if (isNaN(d)) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}.${m}.${dd}`;
}

// 마커/요약용 가격 라벨. 거래유형에 따라 "매매 16억" / "전세 2.4억" / "월세 2.4억/50".
// 관리비(manage)는 표시하지 않는다.
function formatPriceLabel(b) {
    const deal = inferDeal(b);
    const dep = b.deposit || 0;
    const rent = b.rent || 0;
    const depStr = formatEok(dep);
    if (deal === 'sale')   return depStr ? `매매 ${depStr}` : '';
    if (deal === 'jeonse') return depStr ? (rent > 0 ? `전세 ${depStr}/${rent}` : `전세 ${depStr}`) : '';
    // monthly
    if (rent > 0) return depStr ? `월세 ${depStr}/${rent}` : `월세 ${rent}`;
    return depStr ? `전세 ${depStr}` : '';   // 월세인데 월세액이 0이면 사실상 전세로 표기
}

// 매물(건물) 마커 2번째 줄 — 매물엔 가격이 없으므로 호실 요약을 표시
function buildingMarkerSub(b) {
    const s = getUnitStats(b);
    if (s.total === 0) return '';
    return s.empty > 0 ? `호실 ${s.total} · 공실 ${s.empty}` : `호실 ${s.total}`;
}

// 마커용 약식 가격 — 매매:"매 12.4억" / 월세:"월 30/78" / 전세:"전 2.4억"
function formatMarkerPrice(b) {
    const deal = inferDeal(b);
    const dep = b.deposit || 0, rent = b.rent || 0;
    const depStr = formatEok(dep);
    if (deal === 'sale')   return depStr ? `매 ${depStr}` : '매';
    if (deal === 'jeonse') return depStr ? (rent > 0 ? `전 ${depStr}/${rent}` : `전 ${depStr}`) : '전';
    // monthly
    if (rent > 0) return depStr ? `월 ${depStr}/${rent}` : `월 ${rent}`;
    return depStr ? `전 ${depStr}` : '';   // 월세인데 월세액이 0이면 사실상 전세
}

// =====================================================
// MARKER + CLUSTERING
//  · 화면 픽셀 거리(CLUSTER_PX) 기준으로 가까운 매물을 한 개의 동그라미(숫자) 마커로 묶는다.
//  · 픽셀 거리 기준이므로 "확대할수록" 점들이 화면에서 멀어져 자동으로 풀린다(declustering).
//  · 클러스터 마커를 누르면 그 안의 매물들이 하단 시트에 목록으로 펼쳐진다.
// =====================================================
const CLUSTER_PX = 64;          // 이 픽셀 거리 안에 있으면 한 덩어리로 묶음(매물 간 최소 간격 기준점)
let clusterGroups = {};         // { 키: [건물id, ...] } — 클러스터 클릭 시 목록 복원용
let _markerRaf = 0;             // idle 연타 디바운스용

// 단일 건물 → 가격 말풍선 마커 (제목 1줄 + 가격 1줄, 각 줄은 가로로만 — 절대 줄바꿈 안 됨)
function addBuildingMarker(b) {
    const unitStats = getUnitStats(b);
    const dominant = unitStats.empty > 0 ? 'empty' : (unitStats.expiring > 0 ? 'expiring' : 'occupied');
    const color = STATUS_COLOR[dominant];
    const priceLabel = formatMarkerPrice(b);          // 매 12.4억 / 월 30/78 / 전 2.4억
    const priceColor = DEAL_COLOR[inferDeal(b)] || '#1a56db';

    const content = `
      <div onclick="selectBuilding('${b.id}')" style="
        position:relative; cursor:pointer;
        background:white; border:2px solid ${color};
        border-radius:9px; padding:3px 8px;
        box-shadow:0 2px 7px rgba(0,0,0,0.16);
        font-family:-apple-system,sans-serif;
        width:max-content; max-width:200px; text-align:center;
        transform:translateX(-50%) translateY(-100%);
        margin-bottom:7px;
      ">
        <div style="font-size:10.5px;font-weight:700;color:#111;line-height:1.25;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(b.name)}</div>
        ${priceLabel ? `<div style="font-size:11px;color:${priceColor};font-weight:800;margin-top:1px;letter-spacing:-0.2px;line-height:1.25;white-space:nowrap;">${escapeHtml(priceLabel)}</div>` : ''}
        <div style="position:absolute;bottom:-6px;left:50%;transform:translateX(-50%);
          width:0;height:0;border-left:6px solid transparent;
          border-right:6px solid transparent;border-top:6px solid ${color};">
        </div>
      </div>
    `;

    const overlay = new naver.maps.Marker({
        position: new naver.maps.LatLng(b.lat, b.lng),
        map: map,
        icon: {
            content: content,
            size: new naver.maps.Size(52, 34),
            anchor: new naver.maps.Point(0, 0) // CSS transform으로 중심을 맞췄으므로 0,0
        }
    });
    overlays.push(overlay);
}

// 여러 건물 → 숫자 동그라미(클러스터) 마커
function addClusterMarker(key, members) {
    // 묶인 매물의 상태를 합쳐 대표 색상 결정 (공실>만기>임차 우선)
    let anyEmpty = false, anyExpiring = false;
    members.forEach(b => {
        const s = getUnitStats(b);
        if (s.empty > 0) anyEmpty = true;
        if (s.expiring > 0) anyExpiring = true;
    });
    const color = anyEmpty ? STATUS_COLOR.empty : (anyExpiring ? STATUS_COLOR.expiring : STATUS_COLOR.occupied);

    // 묶인 매물 개수에 따라 동그라미 크기 살짝 키움
    const n = members.length;
    const size = n >= 100 ? 54 : (n >= 10 ? 48 : 42);

    // 중심 좌표 = 멤버 좌표 평균
    let lat = 0, lng = 0;
    members.forEach(b => { lat += b.lat; lng += b.lng; });
    lat /= n; lng /= n;

    const content = `
      <div onclick="openCluster('${key}')" class="cluster-marker"
           style="--c:${color}; width:${size}px; height:${size}px; font-size:${n >= 100 ? 13 : 14}px;">
        <span class="cluster-count">${n}</span>
      </div>`;

    const overlay = new naver.maps.Marker({
        position: new naver.maps.LatLng(lat, lng),
        map: map,
        zIndex: 50,
        icon: {
            content: content,
            size: new naver.maps.Size(size, size),
            anchor: new naver.maps.Point(0, 0) // CSS transform: translate(-50%,-50%) 로 중심 정렬
        }
    });
    overlays.push(overlay);
}

// 현재 줌/화면 기준으로 건물들을 픽셀 거리로 묶는다(그리디).
// 투영을 못 구하면(아주 이른 시점 등) 클러스터 없이 개별 마커로 폴백.
function clusterBuildings(list) {
    const proj = map && map.getProjection && map.getProjection();
    if (!proj || typeof proj.fromCoordToOffset !== 'function') {
        return list.map(b => ({ members: [b] }));
    }
    const pts = list.map(b => {
        let p = null;
        try { p = proj.fromCoordToOffset(new naver.maps.LatLng(b.lat, b.lng)); } catch (_) {}
        return { b, x: p ? p.x : null, y: p ? p.y : null };
    });
    if (!pts.every(p => p.x != null && p.y != null)) {
        return list.map(b => ({ members: [b] }));   // 투영 실패 → 폴백
    }
    const R2 = CLUSTER_PX * CLUSTER_PX;
    const used = new Array(pts.length).fill(false);
    const clusters = [];
    for (let i = 0; i < pts.length; i++) {
        if (used[i]) continue;
        used[i] = true;
        const group = [pts[i].b];
        for (let j = i + 1; j < pts.length; j++) {
            if (used[j]) continue;
            const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y;
            if (dx * dx + dy * dy <= R2) { used[j] = true; group.push(pts[j].b); }
        }
        clusters.push({ members: group });
    }
    return clusters;
}

function renderMarkers() {
    overlays.forEach(o => o.setMap(null));
    overlays = [];
    clusterGroups = {};
    if (!map) return;
    if (!myPerms().canRead) { applyPermUI(); return; }   // 조회 권한 없으면 마커 표시 안 함

    const visible = state.buildings.filter(matchesFilter);
    const clusters = clusterBuildings(visible);
    clusters.forEach((c, idx) => {
        if (c.members.length === 1) {
            addBuildingMarker(c.members[0]);
        } else {
            const key = 'cl' + idx;
            clusterGroups[key] = c.members.map(b => b.id);
            addClusterMarker(key, c.members);
        }
    });
}

// idle(이동/줌 멈춤) 마다 다시 클러스터링 — 같은 프레임 연타는 1회로 합침
function scheduleRenderMarkers() {
    if (_markerRaf) return;
    _markerRaf = requestAnimationFrame(() => { _markerRaf = 0; renderMarkers(); });
}

// 클러스터 동그라미 클릭 → 그 안의 매물들을 하단 시트에 목록으로 펼침
function openCluster(key) {
    const ids = clusterGroups[key] || [];
    const items = ids.map(id => state.buildings.find(b => b.id === id)).filter(Boolean);
    if (!items.length) return;

    // 클러스터 중심으로 살짝 이동(목록과 위치 감각을 맞춤)
    if (map && items.length) {
        let lat = 0, lng = 0;
        items.forEach(b => { lat += b.lat; lng += b.lng; });
        map.panTo(new naver.maps.LatLng(lat / items.length, lng / items.length));
    }
    showClusterList(items);
    markTab('map');
    Sheet.open('building', 'full');
}

// 클러스터 안의 매물 목록 — 하단 메뉴 '목록'과 동일한 카드 스타일 재사용
function showClusterList(items) {
    document.getElementById('sheet-title').textContent = '이 위치의 매물';
    document.getElementById('sheet-subtitle').textContent = `${items.length}개 매물이 모여 있습니다`;
    const body = document.getElementById('sheet-body');
    body.innerHTML = items.map(buildingListItemHTML).join('');
    hydrateOwnerNames(body);
}

function matchesFilter(b) {
    if (activeFilter === 'all') return true;
    // 거래유형 필터: 매물의 대표 거래유형 기준
    if (DEAL_CODES.includes(activeFilter)) {
        return inferDeal(b) === activeFilter;
    }
    if (['house', 'multiplex', 'officetel', 'apartment', 'neighborhood', 'commercial'].includes(activeFilter)) {
        return b.type === activeFilter;
    }
    const s = getUnitStats(b);
    if (activeFilter === 'empty') return s.empty > 0;
    if (activeFilter === 'occupied') return s.occupied > 0;
    if (activeFilter === 'expiring') return s.expiring > 0;
    return true;
}

function getUnitStats(b) {
    const units = b.units || [];
    const eff = units.map(effectiveStatus);   // 만기일 지난 호실은 자동 공실 처리
    return {
        empty: eff.filter(s => s === 'empty').length,
        occupied: eff.filter(s => s === 'occupied').length,
        expiring: eff.filter(s => s === 'expiring').length,
        total: units.length
    };
}

function selectBuilding(id) {
    if (!myPerms().canRead) { showToast('조회 권한이 없습니다'); return; }
    currentBuilding = state.buildings.find(b => b.id === id);
    if (!currentBuilding) return;

    if (typeof map !== 'undefined' && map) {
        // 카카오 LatLng를 네이버 LatLng로 변경
        map.panTo(new naver.maps.LatLng(currentBuilding.lat, currentBuilding.lng));
    }
    showBuildingDetail(currentBuilding);
    showSheet('center');
}

// =====================================================
// STATS
// =====================================================
function updateStats() {
    // 상단 통계바는 제거됨 — 해당 요소가 있을 때만 갱신
    let totalEmpty = 0, totalOccupied = 0, totalExpiring = 0;
    state.buildings.forEach(b => {
        const s = getUnitStats(b);
        totalEmpty += s.empty;
        totalOccupied += s.occupied;
        totalExpiring += s.expiring;
    });
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('cnt-all', state.buildings.length);
    set('cnt-empty', totalEmpty);
    set('cnt-occupied', totalOccupied);
    set('cnt-expiring', totalExpiring);
}

// =====================================================
// BOTTOM SHEET — 네이버 지도 스타일(손가락을 따라 부드럽게 + 스냅)
//  스냅 지점: full(전체) → half(약 2/3 지점에서 걸림) → closed(완전히 내려감)
// =====================================================
const Sheet = (function () {
    const el = document.getElementById('bottom-sheet');
    const handle = document.getElementById('sheet-handle');
    const header = document.getElementById('sheet-header');

    let mode = 'building';     // 'building' | 'tab'
    let current = 'closed';    // 'full' | 'half' | 'peek' | 'closed'
    let dragging = false;
    let startY = 0, startPx = 0, lastY = 0, lastT = 0, vel = 0;

    const PEEK = 156;          // peek 상태에서 화면에 남겨둘 시트 높이(px) — "위에 살짝만"

    // 시트 높이/화면 높이를 기준으로 각 스냅 지점의 translateY(px)를 계산
    function metrics() {
        const A = (el.parentElement && el.parentElement.clientHeight) || window.innerHeight;
        const H = el.offsetHeight || A * 0.88;
        return {
            full: 0,                                         // 맨 위로 올라온 상태
            half: Math.max(0, Math.round(H - A * 0.45)),     // 중간 지점에서 걸림
            peek: Math.max(0, Math.round(H - PEEK)),         // 아래로 다 내려도 살짝 남김(완전히 안 닫힘)
            closed: Math.round(H + 24)                        // 완전히 숨김(몰입모드/초기 진입 애니메이션용)
        };
    }
    function curTranslate() {
        const m = /translateY\(([-0-9.]+)px\)/.exec(el.style.transform || '');
        return m ? parseFloat(m[1]) : metrics()[current];
    }
    function apply(px, animate) {
        el.style.transition = animate
            ? 'transform 0.42s cubic-bezier(0.32,0.72,0,1)'   // 부드러운 감속(네이버 느낌)
            : 'none';
        el.style.transform = 'translateY(' + px + 'px)';
    }
    function snap(name, animate) {
        current = name;
        apply(metrics()[name], animate !== false);
        el.classList.toggle('sheet-open', name !== 'closed');
    }

    function open(m, target) {
        mode = m;
        el.dataset.mode = m;
        setImmersive(false);                       // 시트가 열리면 상/하단 UI는 보이게
        target = target || 'full';
        if (current === 'closed') {
            apply(metrics().closed, false);        // 아래에서 시작
            void el.offsetHeight;                  // reflow → 진입 애니메이션 보장
            requestAnimationFrame(() => snap(target, true));
        } else {
            snap(target, true);
        }
    }
    // 아래로 다 내려도 완전히 닫지 않고 peek(살짝 남김)으로 — 사용중인 폼이 사라지지 않게
    function collapse() {
        if (current === 'closed') {
            apply(metrics().closed, false);
            void el.offsetHeight;
            requestAnimationFrame(() => snap('peek', true));
        } else {
            snap('peek', true);
        }
        // peek은 '닫힘'이 아니므로 currentBuilding(사용중인 폼 컨텍스트)을 유지한다
    }
    // 화면 밖으로 완전히 숨김(위치설정/몰입모드 전환 등 특수한 경우만)
    function hardClose() {
        snap('closed', true);
        currentBuilding = null;
    }
    function dismiss() { collapse(); }            // 호환용: dismiss=peek로 수렴
    function isOpen() { return current === 'full' || current === 'half'; }  // 펼쳐진 상태만 '열림'
    function isPeek() { return current === 'peek'; }

    // ---------- 드래그(터치/마우스 공용) ----------
    function down(e) {
        dragging = true;
        startY = lastY = (e.touches ? e.touches[0].clientY : e.clientY);
        lastT = Date.now(); vel = 0;
        startPx = curTranslate();
        el.style.transition = 'none';              // 드래그 중엔 손가락을 1:1로 따라오게
        document.body.style.userSelect = 'none';
    }
    function move(e) {
        if (!dragging) return;
        const y = (e.touches ? e.touches[0].clientY : e.clientY);
        const max = metrics().peek;                // 아래로는 peek까지만(완전히 안 닫힘)
        const px = Math.max(0, Math.min(startPx + (y - startY), max));
        el.style.transform = 'translateY(' + px + 'px)';
        const now = Date.now(), dt = now - lastT;
        if (dt > 0) vel = (y - lastY) / dt;        // +면 아래 방향 속도
        lastY = y; lastT = now;
        if (e.cancelable) e.preventDefault();
    }
    function up() {
        if (!dragging) return;
        dragging = false;
        document.body.style.userSelect = '';
        const m = metrics();
        const pos = curTranslate();
        const TH = 0.55;                            // 플릭 속도 임계값(px/ms)
        let target;
        if (vel > TH) {                             // 아래로 빠르게 → 한 단계 내림(최하단은 peek)
            target = current === 'full' ? 'half' : 'peek';
        } else if (vel < -TH) {                     // 위로 빠르게 → 한 단계 올림
            target = current === 'peek' ? 'half' : 'full';
        } else {                                    // 천천히 놓으면 가장 가까운 지점으로 스냅
            const cand = (m.half > 4 && m.half < m.peek - 4)
                ? ['full', 'half', 'peek'] : ['full', 'peek'];
            target = cand.reduce((a, b) =>
                Math.abs(m[b] - pos) < Math.abs(m[a] - pos) ? b : a, cand[0]);
        }
        snap(target, true);
    }

    [handle, header].forEach(t => {
        if (!t) return;
        t.addEventListener('touchstart', down, { passive: true });
        t.addEventListener('mousedown', down);
    });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchend', up);
    window.addEventListener('mouseup', up);
    window.addEventListener('resize', () => { if (isOpen()) snap(current, false); });

    return { open, collapse, dismiss, hardClose, snap, isOpen, isPeek };
})();

// 기존 호출부 호환: ''=peek(살짝 남김), 'full'=탭 시트, 그 외('center'/'half'/'peek')=건물 상세
function showSheet(state_) {
    if (!state_) { Sheet.collapse(); return; }   // 완전히 닫지 않고 peek
    if (state_ === 'full') { Sheet.open('tab', 'full'); return; }
    Sheet.open('building', 'full');
}
function closeSheet() {
    // ✕(닫기)도 완전히 닫지 않고 목록을 살짝 남긴 peek 상태로
    markTab('map');
    showBuildingList();
    Sheet.collapse();
    currentBuilding = null;
}

function showBuildingList() {
    if (!myPerms().canRead) {
        document.getElementById('sheet-title').textContent = '조회 권한 없음';
        document.getElementById('sheet-subtitle').textContent = '관리자에게 조회 권한을 요청하세요';
        document.getElementById('sheet-body').innerHTML =
            `<div class="empty-state"><div class="empty-state-icon">${icon('lock',56,'color:#9ca3af;')}</div>` +
            `<div class="empty-state-title">조회 권한이 없습니다</div>` +
            `<div class="empty-state-sub">관리자가 조회 권한을 켜면 목록이 표시됩니다</div></div>`;
        return;
    }
    let list = state.buildings.filter(matchesFilter);
    if (listMineOnly) list = list.filter(isMine);           // 내 목록: 내 건물만
    const dealName = DEAL_LABEL[activeFilter];
    const baseTitle = listMineOnly ? '내 건물 목록' : '전체 목록';
    document.getElementById('sheet-title').textContent = dealName ? `${dealName} 매물` : baseTitle;
    document.getElementById('sheet-subtitle').textContent =
        (activeFilter === 'all')
            ? (listMineOnly ? `내 건물 ${list.length}개` : `총 ${state.buildings.length}개 건물`)
            : `${list.length}개 매물 (필터 적용중)`;

    const body = document.getElementById('sheet-body');
    if (list.length === 0) {
        const msg = state.buildings.length === 0 ? '등록된 건물이 없습니다' : '조건에 맞는 매물이 없습니다';
        const sub = state.buildings.length === 0 ? '+ 버튼을 눌러 첫 번째 건물을 추가해보세요' : '상단 필터를 바꿔보세요';
        body.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">${icon('building',56,'color:#9ca3af;')}</div>
      <div class="empty-state-title">${msg}</div>
      <div class="empty-state-sub">${sub}</div>
    </div>`;
        return;
    }

    body.innerHTML = list.map(buildingListItemHTML).join('');
    hydrateOwnerNames(body); // [B/E] edit by smsong - 목록 잠금 배지의 등록자 이름 채우기
}

// 건물 목록 카드 1개 마크업 — 목록 탭 / 클러스터 목록에서 공용으로 사용
function buildingListItemHTML(b) {
    const s = getUnitStats(b);
    const pct = s.total > 0 ? Math.round((s.occupied / s.total) * 100) : 0;
    const emoji = typeIcon(b.type, 26); // [B/E] edit by smsong - 유형 라인 아이콘(기본 이모지 대체)
    // 실제 오브젝트에 첨부된 첫 번째 이미지를 썸네일로 사용 (없거나 로드 실패 시 타입 이모지)
    const firstImg = (b.mediaURLs && b.mediaURLs.length) ? b.mediaURLs[0] : '';
    const thumb = firstImg
        ? `<div class="building-thumb has-img"><img src="${firstImg}" alt="" loading="lazy" onerror="this.remove();this.parentElement.classList.remove('has-img')"><span class="building-thumb-emoji">${emoji}</span></div>`
        : `<div class="building-thumb"><span class="building-thumb-emoji">${emoji}</span></div>`;
    return `<div class="building-list-item" onclick="selectBuilding('${b.id}')">
      ${thumb}
      <div style="flex:1;min-width:0;">
        <div class="building-list-name" style="display:flex;align-items:center;gap:6px;">${dealBadge(b)}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${b.name}</span></div>
        <div class="building-list-addr">${b.address}</div>
        <div style="margin-top:4px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          ${formatPriceLabel(b) ? `<span style="font-size:11.5px;color:#1a56db;font-weight:800;letter-spacing:-0.2px;">${formatPriceLabel(b)}</span>` : ''}
          <span style="font-size:11px;color:#6b7280;font-weight:700;">${TYPE_LABEL[b.type] || ''}</span>
          ${isMine(b)
        ? '<span style="font-size:10.5px;color:#1a56db;background:#e8f0fe;font-weight:700;padding:1px 7px;border-radius:10px;">내 매물</span>'
        : (ownerIdOf(b) ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:10.5px;color:#6b7280;background:#f3f4f6;font-weight:600;padding:1px 7px;border-radius:10px;">${icon('lock', 11)} ${ownerNameSpan(b)}</span>` : '')}
          ${s.empty > 0 ? `<span style="font-size:11px;color:#dc2626;font-weight:600;">공실 ${s.empty}</span>` : ''}
          ${s.expiring > 0 ? `<span style="font-size:11px;color:#d97706;font-weight:600;">만기 ${s.expiring}</span>` : ''}
        </div>
      </div>
      <div class="building-occupancy">
        <div class="occupancy-pct">${pct}%</div>
        <div class="occupancy-label">점유율</div>
        <div class="occupancy-bar"><div class="occupancy-fill" style="width:${pct}%"></div></div>
      </div>
    </div>`;
}

// 현재 로그인 사용자가 이 오브젝트(건물/호실)의 작성자인지 확인 → 위쪽 isMine()으로 통합됨

// [B] edit by smsong - 잠금 라벨의 등록자 표시를 uid가 아닌 name 으로. 이름은 비동기로 채움.
function ownerNameSpan(obj, fallback) {
    const oid = ownerIdOf(obj);
    return `<span class="owner-name-async" data-owner-uid="${escapeHtml(oid)}">${escapeHtml(fallback || '다른 사용자')}</span>`;
}
async function hydrateOwnerNames(root) {
    const scope = root || document;
    const spans = scope.querySelectorAll('.owner-name-async[data-owner-uid]:not([data-filled])');
    for (const el of spans) {
        const oid = el.dataset.ownerUid;
        el.dataset.filled = '1';
        if (!oid) continue;
        try {
            const p = await fetchOwnerProfile(oid);
            el.textContent = (p && (p.name || p.nickname)) || '다른 사용자';
        } catch (_) {}
    }
}
// [E] edit by smsong

function showBuildingDetail(b) {
    const s = getUnitStats(b);
    const totalRent = b.units.filter(u => u.status === 'occupied').reduce((sum, u) => sum + (u.rent || 0), 0);
    const totalDeposit = b.units.filter(u => u.status !== 'empty').reduce((sum, u) => sum + (u.deposit || 0), 0);

    document.getElementById('sheet-title').textContent = b.name;
    document.getElementById('sheet-subtitle').textContent = (b.address || '');

    const body = document.getElementById('sheet-body');
    body.innerHTML = `
    ${renderGallery(b)}
    <!-- 매물 등록자 + 공인중개사사무소 통합 카드 (비동기 채움) -->
    <div class="owner-agency-card" id="ownercard-${b.id}">
      <div class="oa-top">
        ${avatarHTML(null, 40)}
        <div style="min-width:0;flex:1;">
          <div class="owner-card-label">매물 등록자</div>
          <div class="owner-card-name">불러오는 중…</div>
        </div>
      </div>
    </div>
    <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      ${isMine(b) ? `
      ${myPerms().canUpdate ? `<button onclick="openEditBuilding('${b.id}')" style="display:inline-flex;align-items:center;gap:5px;padding:7px 14px;border-radius:8px;border:1px solid #e5e7eb;background:#fff;font-size:13px;font-weight:600;color:#374151;cursor:pointer;">${icon('edit',15)} 건물 수정</button>` : ''}
      ${myPerms().canCreate ? `<button onclick="openAddUnit('${b.id}')" style="display:inline-flex;align-items:center;gap:4px;padding:7px 14px;border-radius:8px;border:none;background:#1a56db;font-size:13px;font-weight:600;color:#fff;cursor:pointer;">${icon('plus',15)} 호실 추가</button>` : ''}
      ` : `
      <div style="display:inline-flex;align-items:center;gap:5px;padding:7px 12px;border-radius:8px;background:#f3f4f6;color:#6b7280;font-size:12.5px;font-weight:600;">${icon('lock',14)} ${ownerNameSpan(b)}님의 매물 · 조회 전용</div>
      `}
      <button onclick="switchTab('list')" style="display:inline-flex;align-items:center;gap:4px;padding:7px 14px;border-radius:8px;border:1px solid #e5e7eb;background:#fff;font-size:13px;font-weight:600;color:#6b7280;cursor:pointer;">${icon('back',15)} 목록</button>
    </div>

    <!-- 주소(풀주소·지번 포함) + 건물 유형 -->
    <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:12px;padding:10px 12px;background:#f9fafb;border-radius:10px;">
      <span style="font-size:12px;font-weight:700;color:#6b7280;flex-shrink:0;">주소</span>
      <span style="font-size:14px;font-weight:600;color:#111827;">${b.address || '-'}</span>
      <span style="margin-left:auto;font-size:11px;font-weight:700;color:#1a56db;background:#e8f0fe;padding:2px 8px;border-radius:10px;flex-shrink:0;">${TYPE_LABEL[b.type] || ''}</span>
    </div>
    ${b.createdAt ? `<div style="font-size:11.5px;color:#9ca3af;margin:-6px 0 12px 2px;">등록일 ${formatDate(b.createdAt)}</div>` : ''}

    <!-- 대표 거래유형 + 금액 -->
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
      ${dealBadge(b, 12)}
      <span style="font-size:15px;font-weight:800;color:#1a56db;letter-spacing:-0.3px;">${formatPriceLabel(b) || '가격 미입력'}</span>
    </div>
    <div class="building-info-grid" style="grid-template-columns:repeat(${(inferDeal(b) !== 'sale' && (b.rent || 0) > 0) ? 3 : 2},1fr);">
      <div class="info-card">
        <div class="info-card-label">${inferDeal(b) === 'sale' ? '매매가' : inferDeal(b) === 'jeonse' ? '전세금' : '보증금'}</div>
        <div class="info-card-value">${(b.deposit || 0).toLocaleString()}만원</div>
      </div>
      ${(inferDeal(b) !== 'sale' && (b.rent || 0) > 0) ? `
      <div class="info-card">
        <div class="info-card-label">월세</div>
        <div class="info-card-value">${(b.rent || 0).toLocaleString()}만원</div>
      </div>` : ''}
      <div class="info-card">
        <div class="info-card-label">관리비</div>
        <div class="info-card-value">${(b.manage || 0).toLocaleString()}만원</div>
      </div>
    </div>

    ${(b.parkingAvailable || b.petAllowed || b.jeonseLoanAvailable) ? `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
      ${b.parkingAvailable ? '<span class="opt-chip">주차</span>' : ''}
      ${b.petAllowed ? '<span class="opt-chip">애완</span>' : ''}
      ${b.jeonseLoanAvailable ? `<span class="opt-chip on">전세대출${b.jeonseLoanType ? ' · ' + b.jeonseLoanType.split(',').map(s => s.trim()).filter(Boolean).join(', ') : ''}</span>` : ''}
    </div>` : ''}

    ${renderUnitStatus(b)}
  `;
    hydrateOwnerCard(b);
    hydrateOwnerNames(body); // [B/E] edit by smsong - 조회전용 잠금 라벨 등록자 이름 채우기
}

// =====================================================
// 호실 현황 — 점유율 스택바 + 범례 + 상태 레일 카드 (앱 톤: 블루/라운드/라인 아이콘)
// =====================================================
function renderUnitStatus(b) {
    const units = b.units || [];
    const s = getUnitStats(b);
    const total = s.total || 0;
    const occPct = total > 0 ? Math.round((s.occupied / s.total) * 100) : 0;

    // 점유율 스택바 (임차=초록 / 만기임박=주황 / 공실=빨강)
    const seg = (n, varName) => n > 0
        ? `<div class="uf-seg" style="flex:${n};background:var(${varName});"></div>` : '';
    const barInner = total > 0
        ? seg(s.occupied, '--green') + seg(s.expiring, '--amber') + seg(s.empty, '--red')
        : '<div class="uf-seg" style="flex:1;background:var(--gray-200);"></div>';

    // 범례 칩 — 0개인 상태는 흐리게
    const leg = (label, n, cls) =>
        `<span class="uf-leg ${n > 0 ? cls : 'is-zero'}"><i class="uf-dot ${cls}"></i>${label} <b>${n}</b></span>`;

    const head = `
      <div class="uf-head">
        <div class="uf-head-title">호실 현황 <span class="uf-total">${total}</span></div>
        <div class="uf-occ"><b>${occPct}%</b><span>점유</span></div>
      </div>
      <div class="uf-bar">${barInner}</div>
      <div class="uf-legend">
        ${leg('임차', s.occupied, 'occupied')}
        ${leg('만기임박', s.expiring, 'expiring')}
        ${leg('공실', s.empty, 'empty')}
      </div>`;

    if (units.length === 0) {
        return `<div class="uf-block">
          ${head}
          <div class="uf-empty">${icon('building', 30, 'color:var(--gray-300);')}<span>등록된 호실이 없습니다</span></div>
        </div>`;
    }

    const rows = units.map(u => {
        const deal = inferDeal(u);
        const st = effectiveStatus(u);   // 만기일 지나면 자동 공실
        let rent;
        if (st === 'empty') {
            rent = `<div class="uf-rent-main uf-rent-empty">비어있음</div>`;
        } else if (deal === 'sale') {
            rent = `<div class="uf-rent-main">${(u.deposit || 0).toLocaleString()}<i>만</i></div>
                    <div class="uf-rent-sub">매매</div>`;
        } else if (deal === 'jeonse') {
            rent = `<div class="uf-rent-main">${(u.deposit || 0).toLocaleString()}<i>만</i></div>
                    <div class="uf-rent-sub">전세</div>`;
        } else {
            rent = `<div class="uf-rent-main">${u.rent > 0 ? u.rent.toLocaleString() + '<i>만</i>' : '월세'}</div>
                    <div class="uf-rent-sub">보 ${(u.deposit || 0).toLocaleString()}</div>`;
        }
        return `
          <button type="button" class="uf-unit ${st}" onclick="openUnitDetail('${b.id}','${u.id}')">
            <span class="uf-rail"></span>
            <span class="uf-chip">${STATUS_LABEL[st]}</span>
            <span class="uf-unit-main">
              <span class="uf-unit-name">${escapeHtml(u.name || '')}<i class="uf-deal" style="--dc:${DEAL_COLOR[deal]};">${DEAL_LABEL[deal]}</i></span>
              <span class="uf-unit-sub">${u.area}㎡</span>
            </span>
            <span class="uf-rent">${rent}</span>
            <span class="uf-go">${icon('back', 15, 'transform:rotate(180deg);color:var(--gray-300);')}</span>
          </button>`;
    }).join('');

    return `<div class="uf-block">
      ${head}
      <div class="uf-list">${rows}</div>
    </div>`;
}

// 매물 등록자 카드 채우기 — 등록자 프로필을 비동기로 불러와 이름/사진/제공자 표시
async function hydrateOwnerCard(b) {
    const el = document.getElementById('ownercard-' + b.id);
    if (!el) return;
    // [B] edit by smsong - 등록자 식별을 객체 기반으로, 표시 이름은 name 우선
    const p = await fetchOwnerProfile(b);
    const name = (p && (p.name || p.nickname)) || '알 수 없음';
    // [E] edit by smsong
    const mine = isMine(b);
    el.innerHTML = `
      <div class="oa-top">
        ${avatarHTML(p, 40)}
        <div style="min-width:0;flex:1;">
          <div class="owner-card-label">매물 등록자</div>
          <div class="owner-card-name">${escapeHtml(name)}${mine ? '<span class="owner-you">나</span>' : ''}</div>
        </div>
      </div>
      ${agencySectionHTML(p)}
    `;
}

// 통합 카드 내부의 사무소 섹션 (구분선 + 이름/전화/주소). 정보 없으면 '' 반환.
function agencySectionHTML(p) {
    if (!p) return '';
    const name = p.agencyName, phone = p.agencyPhone, addr = p.agencyAddress;
    if (!name && !phone && !addr) return '';
    const row = (ic, val, isTel) => val ? `
      <div class="oa-row">
        <span class="oa-row-ic">${icon(ic, 15)}</span>
        ${isTel ? `<a href="tel:${escapeHtml(String(val).replace(/[^0-9+]/g, ''))}" class="oa-tel">${escapeHtml(val)}</a>`
            : `<span>${escapeHtml(val)}</span>`}
      </div>` : '';
    return `
      <div class="oa-agency">
        <div class="oa-agency-label">${icon('agency', 14)} 공인중개사사무소</div>
        ${name ? `<div class="oa-agency-name">${escapeHtml(name)}</div>` : ''}
        ${row('phone', phone, true)}
        ${row('pin', addr, false)}
      </div>`;
}

// [B] edit by smsong - 공인중개사사무소(이름/전화/주소) 표시 카드. 정보가 하나도 없으면 렌더 안 함.
function agencyCardHTML(p) {
    if (!p) return '';
    const name = p.agencyName, phone = p.agencyPhone, addr = p.agencyAddress;
    if (!name && !phone && !addr) return '';
    const row = (ic, val, isTel) => val ? `
      <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:#374151;">
        <span style="color:#1a56db;display:inline-flex;">${icon(ic, 15)}</span>
        ${isTel ? `<a href="tel:${escapeHtml(String(val).replace(/[^0-9+]/g,''))}" style="color:#1a56db;text-decoration:none;font-weight:600;">${escapeHtml(val)}</a>`
                : `<span>${escapeHtml(val)}</span>`}
      </div>` : '';
    return `
      <div style="margin-bottom:12px;padding:12px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;text-align:left;">
        <div style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:#6b7280;margin-bottom:8px;">
          ${icon('agency',14)} 공인중개사사무소
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${name ? `<div style="font-size:14px;font-weight:700;color:#111827;">${escapeHtml(name)}</div>` : ''}
          ${row('phone', phone, true)}
          ${row('pin', addr, false)}
        </div>
      </div>`;
}
// [E] edit by smsong

// =====================================================
// MODALS — Building
// =====================================================
function startAddBuilding() {
    // Enter picker mode
    pickerMode = true;
    pickerLatlng = map.getCenter();
    document.getElementById('map-picker-bar').classList.add('show');
    document.getElementById('map-picker-crosshair').classList.add('show');
    document.getElementById('map-picker-confirm').classList.add('show');
    document.getElementById('map-picker-search').classList.add('show');
    document.getElementById('picker-search-input').value = '';
    document.getElementById('picker-search-results').classList.remove('show');
    const addBtn = document.getElementById('add-btn-float');
    addBtn.classList.add('picking');      // + → × (취소 아이콘)
    addBtn.title = '위치 설정 취소';
    document.getElementById('app').classList.add('picker-active'); // 상단바 숨기고 검색창을 그 자리에
    document.getElementById('app').classList.remove('chrome-hidden'); // 항상 검색/안내바 보이는 상태로 시작
    Sheet.hardClose();                    // 위치 설정 중엔 시트를 완전히 내려 지도를 비움
    document.getElementById('sheet-body').innerHTML = `<div class="empty-state"><div class="empty-state-icon">${icon('pin',56,'color:#9ca3af;')}</div><div class="empty-state-title">지도를 이동하여 위치 설정</div><div class="empty-state-sub">건물 위치를 지도 위에서 직접 설정하세요</div></div>`;
}

// + 버튼 토글: 활성 상태면 취소, 아니면 위치 설정 시작
function toggleMapPicker() {
    if (pickerMode) cancelMapPicker();
    else startAddBuilding();
}

// 위치 설정(피커) 취소 → 상단 안내바/확인 버튼 숨기고 + 버튼 원래대로
function cancelMapPicker() {
    pickerMode = false;
    document.getElementById('map-picker-bar').classList.remove('show');
    document.getElementById('map-picker-crosshair').classList.remove('show');
    document.getElementById('map-picker-confirm').classList.remove('show');
    document.getElementById('map-picker-search').classList.remove('show');
    document.getElementById('picker-search-results').classList.remove('show');
    const addBtn = document.getElementById('add-btn-float');
    addBtn.classList.remove('picking');
    addBtn.title = '건물 추가';
    document.getElementById('app').classList.remove('picker-active'); // 상단바 복원
    document.getElementById('app').classList.remove('chrome-hidden');
    showBuildingList();
    Sheet.collapse();                     // 취소하면 목록을 다시 살짝 띄움(peek)
}

function confirmPickerLocation() {
    const center = map.getCenter();
    pickerLatlng = center;
    pickerMode = false;
    document.getElementById('map-picker-bar').classList.remove('show');
    document.getElementById('map-picker-crosshair').classList.remove('show');
    document.getElementById('map-picker-confirm').classList.remove('show');
    document.getElementById('map-picker-search').classList.remove('show');
    document.getElementById('picker-search-results').classList.remove('show');
    const addBtn = document.getElementById('add-btn-float');
    addBtn.classList.remove('picking');
    addBtn.title = '건물 추가';
    document.getElementById('app').classList.remove('picker-active'); // 상단바 복원
    document.getElementById('app').classList.remove('chrome-hidden');

    // 네이버 Reverse Geocoding 호출
    //  · orders 를 지정하지 않으면 행정구역 코드만 와서 지번/도로명이 비어버린다.
    //    → 도로명(roadaddr) + 지번(addr) 을 명시해 풀주소를 받는다.
    naver.maps.Service.reverseGeocode({
        coords: center,
        orders: 'roadaddr,addr'   // 지번(addr) 확보 — 상수 미정의 SDK 대비 문자열로 직접 지정
    }, function(status, response) {
        let addr = '';
        if (status === naver.maps.Service.Status.OK) {
            // 지번 주소로 저장 — 예: "서울특별시 강남구 역삼동 681-1"
            addr = buildFullAddress(response.v2);
        }
        // 좌표를 전달할 때 네이버는 .lat() .lng() 함수를 사용합니다.
        openBuildingForm(null, center.lat(), center.lng(), addr);
    });
}

// ===== 건물 이미지(여러 장) 관리 =====
const MAX_BUILDING_IMAGES = 10;   // 건물당 첨부 가능한 최대 이미지 수
let bfKeepUrls = [];   // 건물 수정 시 "유지할" 기존 이미지 URL 목록
let bfNewFiles = [];   // 새로 추가한 파일(File) 목록

// 건물 상세 이미지 갤러리 — 가로 스와이프 캐러셀 (스크롤 스냅 + 점 인디케이터)
function renderGallery(b) {
    const arr = (b && b.mediaURLs) ? b.mediaURLs : [];
    if (!arr.length) return '';
    const gid = 'gal-' + (b && b.id ? b.id : Math.random().toString(36).slice(2));
    const safeName = (b && b.name ? b.name : '').replace(/"/g, '&quot;');

    const slides = arr.map((u, i) => `
      <div class="gal-slide">
        <img src="${u}" alt="${safeName}"
             ${i === 0 ? `onload="fitGalleryHeight('${gid}', this)"` : ''}
             onclick="openImageViewer('${u}')" onerror="this.parentElement.style.display='none'">
      </div>`).join('');

    // 이미지가 2장 이상일 때만 카운터/점/화살표 표시
    const counter = arr.length > 1 ? `<div class="gal-counter" id="${gid}-cnt">1 / ${arr.length}</div>` : '';
    const dots = arr.length > 1
        ? `<div class="gal-dots" id="${gid}-dots">${arr.map((_, i) => `<span class="gal-dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>`
        : '';
    // 웹(마우스)에서 스와이프가 안 되므로 이전/다음 화살표로 넘긴다
    const navs = arr.length > 1 ? `
      <button class="gal-nav prev" onclick="galleryNav('${gid}',-1,${arr.length},event)" aria-label="이전 사진">${icon('back', 20)}</button>
      <button class="gal-nav next" onclick="galleryNav('${gid}',1,${arr.length},event)" aria-label="다음 사진">${icon('back', 20, 'transform:rotate(180deg);')}</button>` : '';

    return `<div class="gallery-wrap">
      <div class="gal-track" id="${gid}" onscroll="onGalleryScroll('${gid}', ${arr.length})">${slides}</div>
      ${navs}
      ${counter}
      ${dots}
    </div>`;
}

// 이전/다음 버튼 → 한 장씩 부드럽게 스크롤(스냅)
function galleryNav(gid, dir, total, ev) {
    if (ev) ev.stopPropagation();
    const track = document.getElementById(gid);
    if (!track) return;
    const w = track.clientWidth || 1;
    let idx = Math.round(track.scrollLeft / w) + dir;
    idx = Math.max(0, Math.min(total - 1, idx));
    track.scrollTo({ left: idx * w, behavior: 'smooth' });
}

// 캐러셀 스크롤 위치 → 카운터/점 인디케이터 갱신
function onGalleryScroll(gid, total) {
    const track = document.getElementById(gid);
    if (!track || !track.clientWidth) return;
    const idx = Math.round(track.scrollLeft / track.clientWidth);
    const cnt = document.getElementById(gid + '-cnt');
    if (cnt) cnt.textContent = (idx + 1) + ' / ' + total;
    const dots = document.getElementById(gid + '-dots');
    if (dots) Array.from(dots.children).forEach((d, i) => d.classList.toggle('active', i === idx));
}

// 첫 이미지 비율에 맞춰 캐러셀 높이를 설정 → 첫 장은 딱 맞고 나머지는 그 안에 전체가 보임(contain)
function fitGalleryHeight(gid, img) {
    const track = document.getElementById(gid);
    if (!track || !img || !img.naturalWidth) return;
    const w = track.clientWidth || track.offsetWidth;
    if (!w) return;
    let h = w * img.naturalHeight / img.naturalWidth;
    const maxH = Math.round(window.innerHeight * 0.7);   // 세로 사진이 화면을 다 먹지 않도록 상한
    if (h > maxH) h = maxH;
    track.style.height = Math.round(h) + 'px';
}

// 폼: 유지 중인 기존 이미지 썸네일 (X로 제거)
function renderBfExisting() {
    const box = document.getElementById('bf-existing');
    if (!box) return;
    if (!bfKeepUrls.length) { box.innerHTML = '<div class="bf-empty">기존 사진 없음</div>'; return; }
    box.innerHTML = bfKeepUrls.map((u, i) => `
      <div class="bf-thumb">
        <img src="${u}" onerror="this.parentElement.style.display='none'">
        <button type="button" class="bf-thumb-del" onclick="removeBfImage(${i})">${icon('close',14)}</button>
      </div>`).join('');
}

function removeBfImage(idx) {
    bfKeepUrls.splice(idx, 1);
    renderBfExisting();
    updateBfCount();
}

// 폼: 파일 선택 시 누적 추가 (최대 MAX_BUILDING_IMAGES 장 제한)
function addBfFiles(e) {
    const picked = Array.from((e.target && e.target.files) ? e.target.files : []);
    const room = MAX_BUILDING_IMAGES - (bfKeepUrls.length + bfNewFiles.length);
    if (room <= 0) {
        showToast(`최대 ${MAX_BUILDING_IMAGES}장만 첨부 가능합니다`);
        e.target.value = '';
        return;
    }
    if (picked.length > room) {
        showToast(`최대 ${MAX_BUILDING_IMAGES}장만 첨부 가능합니다 (지금 ${room}장까지 추가)`);
    }
    bfNewFiles = bfNewFiles.concat(picked.slice(0, room));
    e.target.value = '';   // 같은 파일 재선택 가능 + 선택 누적
    renderBfNewPreview();
    updateBfCount();
}

// 폼: 새로 추가한 파일 미리보기 (✕로 제거)
function renderBfNewPreview() {
    const box = document.getElementById('bf-new-preview');
    if (!box) return;
    box.innerHTML = bfNewFiles.map((f, i) => `
      <div class="bf-thumb">
        <img src="${URL.createObjectURL(f)}">
        <button type="button" class="bf-thumb-del" onclick="removeBfNewFile(${i})">${icon('close',14)}</button>
        <span class="bf-thumb-new">NEW</span>
      </div>`).join('');
}

function removeBfNewFile(idx) {
    bfNewFiles.splice(idx, 1);
    renderBfNewPreview();
    updateBfCount();
}

// 현재 첨부 수 라벨 갱신 (기존 유지 + 신규)
function updateBfCount() {
    const el = document.getElementById('bf-count');
    if (el) el.textContent = (bfKeepUrls.length + bfNewFiles.length) + ' / ' + MAX_BUILDING_IMAGES;
}

function openBuildingForm(building, lat, lng, addr) {
    const isEdit = !!building;
    bfKeepUrls = (building && building.mediaURLs) ? building.mediaURLs.slice() : [];
    bfNewFiles = [];
    document.getElementById('modal-title').textContent = isEdit ? '건물 수정' : '건물 추가';

    document.getElementById('modal-body').innerHTML = `
    <div class="form-section-title">기본 정보</div>
    <div class="form-group">
      <label class="form-label">건물명 *</label>
      <input id="f-name" class="form-input" type="text" placeholder="예: 강남 상가빌딩" value="${building ? building.name : ''}">
    </div>
    <div class="form-group">
      <label class="form-label">주소</label>
      <input id="f-addr" class="form-input" type="text" placeholder="주소" value="${building ? (building.address || '') : (addr || '')}">
    </div>
    <div class="form-group">
      <label class="form-label">건물 유형</label>
      <select id="f-type" class="form-select">
        <option value="house" ${(!building || building.type==='house')?'selected':''}>단독&다중</option>
        <option value="multiplex" ${building && building.type==='multiplex'?'selected':''}>다세대</option>
        <option value="officetel" ${building && building.type==='officetel'?'selected':''}>오피스텔</option>
        <option value="apartment" ${building && building.type==='apartment'?'selected':''}>아파트</option>
        <option value="neighborhood" ${building && building.type==='neighborhood'?'selected':''}>근린생활시설</option>
        <option value="commercial" ${building && building.type==='commercial'?'selected':''}>상가</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">대표 거래유형 *</label>
      <div class="deal-selector" id="f-deal-selector">
        <div class="deal-option" data-deal="sale" onclick="selectDeal('f','sale')">매매</div>
        <div class="deal-option" data-deal="jeonse" onclick="selectDeal('f','jeonse')">전세</div>
        <div class="deal-option" data-deal="monthly" onclick="selectDeal('f','monthly')">월세</div>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" id="f-deposit-label">보증금 (만원)</label>
      <input id="f-deposit" class="form-input" type="number" min="0" placeholder="예: 1000" value="${building ? (building.deposit || '') : ''}">
    </div>
    <div class="form-row">
      <div class="form-group" id="f-rent-group">
        <label class="form-label">월세 (만원)</label>
        <input id="f-rent" class="form-input" type="number" min="0" placeholder="예: 50" value="${building ? (building.rent || '') : ''}">
      </div>
      <div class="form-group">
        <label class="form-label">관리비 (만원)</label>
        <input id="f-manage" class="form-input" type="number" min="0" placeholder="예: 5" value="${building ? (building.manage || '') : ''}">
      </div>
    </div>
    ${isEdit ? `
    <div class="form-group">
      <label class="form-label">현재 사진 <span style="font-weight:400;color:#9ca3af;">(${icon('close',11)} 눌러 제거)</span></label>
      <div id="bf-existing" class="bf-thumb-wrap"></div>
    </div>` : ''}
    <div class="form-group">
      <label class="form-label">옵션</label>
      <div class="toggle-row">
        <button type="button" id="f-parking" class="toggle-btn ${building && building.parkingAvailable ? 'on' : ''}" onclick="this.classList.toggle('on')"><span class="tg-dot"></span>주차</button>
        <button type="button" id="f-pet" class="toggle-btn ${building && building.petAllowed ? 'on' : ''}" onclick="this.classList.toggle('on')"><span class="tg-dot"></span>애완</button>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">전세 대출</label>
      <button type="button" id="f-jeonse-loan" class="toggle-btn full ${building && building.jeonseLoanAvailable ? 'on' : ''}" onclick="toggleJeonseLoan()"><span class="tg-dot"></span>전세 대출 가능</button>
      <div class="toggle-row" id="f-jeonse-loan-types" style="flex-wrap:wrap;margin-top:8px;display:${building && building.jeonseLoanAvailable ? 'flex' : 'none'};">
        ${(() => {
        const sel = new Set(((building && building.jeonseLoanType) || '').split(',').map(s => s.trim()).filter(Boolean));
        return ['HUG', 'HF', 'SGI', '버팀목', 'LH'].map(v =>
            `<button type="button" class="toggle-btn ${sel.has(v) ? 'on' : ''}" data-loan="${v}" onclick="this.classList.toggle('on')" style="flex:0 0 auto;padding:8px 14px;">${v}</button>`).join('');
    })()}
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">사진/미디어 <span style="font-weight:400;color:#9ca3af;">(최대 ${MAX_BUILDING_IMAGES}장 · <span id="bf-count">0 / ${MAX_BUILDING_IMAGES}</span>)</span></label>
      <input id="f-media" class="form-input" type="file" accept="image/*,video/*" multiple onchange="addBfFiles(event)">
      <div id="bf-new-preview" class="bf-thumb-wrap"></div>
    </div>
  `;

    document.getElementById('modal-footer').innerHTML = `
    ${isEdit && myPerms().canDelete ? `<button class="btn-danger" onclick="deleteBuilding('${building.id}')">삭제</button>` : ''}
    <button class="btn-secondary" onclick="closeModal()">취소</button>
    <button class="btn-primary" onclick="saveBuilding('${isEdit ? building.id : ''}', ${lat||building?.lat}, ${lng||building?.lng})">저장</button>
  `;

    renderBfExisting();   // 수정 시 기존 이미지 썸네일 표시
    updateBfCount();
    selectDeal('f', isEdit ? inferDeal(building) : 'monthly');   // 대표 거래유형 초기 상태(라벨/월세칸)
    showModal();
}

function openEditBuilding(id) {
    const b = state.buildings.find(b => b.id === id);
    if (!isMine(b)) { showToast('본인이 등록한 매물만 수정할 수 있습니다'); return; }
    if (b) openBuildingForm(b, b.lat, b.lng, b.address);
}

async function saveBuilding(id, lat, lng) {
    if (_isSubmitting) return;                 // 진행 중이면 중복 호출 차단
    const name = document.getElementById('f-name').value.trim();
    if (!name) { showToast('건물명을 입력하세요'); return; }

    const jeonseLoanAvailable = document.getElementById('f-jeonse-loan').classList.contains('on');
    const dealType = selectedDeal('f');
    const dto = {
        name,
        address: document.getElementById('f-addr').value.trim(),
        type: document.getElementById('f-type').value,
        dealType,
        deposit: parseInt(document.getElementById('f-deposit').value) || 0,
        rent: dealType === 'sale' ? 0 : (parseInt(document.getElementById('f-rent').value) || 0),
        manage: parseInt(document.getElementById('f-manage').value) || 0,
        jeonseLoanAvailable,
        jeonseLoanType: jeonseLoanAvailable
            ? Array.from(document.querySelectorAll('#f-jeonse-loan-types .toggle-btn.on')).map(x => x.dataset.loan).join(',')
            : null,
        parkingAvailable: document.getElementById('f-parking').classList.contains('on'),
        petAllowed: document.getElementById('f-pet').classList.contains('on'),
        lat: parseFloat(lat), lng: parseFloat(lng)
    };

    const mediaFiles = bfNewFiles;            // 새로 추가한 파일들
    dto.mediaURLs = bfKeepUrls;               // 유지할 기존 이미지 목록 (제거된 건 빠져있음)
    if (bfKeepUrls.length + mediaFiles.length > MAX_BUILDING_IMAGES) {
        showToast(`최대 ${MAX_BUILDING_IMAGES}장만 첨부 가능합니다`);
        return;
    }

    showLoading(id ? '건물 정보를 저장하는 중…' : '건물을 추가하는 중…');
    try {
        if (id) {
            dto.id = id;
            await Api.updateBuilding(dto, mediaFiles);   // 유지목록 + 새 파일들
        } else {
            await Api.createBuilding(dto, mediaFiles);
        }
        await loadData();
        closeModal();
        renderMarkers();
        updateStats();
        showBuildingList();
        showSheet('center');
        showToast(id ? '건물 정보가 수정되었습니다' : '건물이 추가되었습니다');
    } catch (e) {
        showToast('저장 실패: ' + e.message);
    } finally {
        hideLoading();
    }
}

async function deleteBuilding(id) {
    if (_isSubmitting) return;
    const b = state.buildings.find(b => b.id === id);
    if (b && !isMine(b)) { showToast('본인이 등록한 매물만 삭제할 수 있습니다'); return; }
    if (!confirm('이 매물을 휴지통으로 이동할까요?\n휴지통에서 30일이 지나면 자동으로 영구 삭제됩니다.')) return;
    showLoading('휴지통으로 이동하는 중…');
    try {
        await Api.deleteBuilding(id);
        await loadData();
        closeModal();
        renderMarkers();
        updateStats();
        showBuildingList();
        showSheet('center');
        currentBuilding = null;
        showToast('휴지통으로 이동되었습니다');
    } catch (e) {
        showToast('삭제 실패: ' + e.message);
    } finally {
        hideLoading();
    }
}

// =====================================================
// MODALS — Unit
// =====================================================
function openAddUnit(buildingId) {
    const b = state.buildings.find(b => b.id === buildingId);
    if (!isMine(b)) { showToast('본인이 등록한 매물에만 호실을 추가할 수 있습니다'); return; }
    openUnitForm(buildingId, null);
}

function openUnitDetail(buildingId, unitId) {
    const b = state.buildings.find(b => b.id === buildingId);
    const u = b.units.find(u => u.id === unitId);
    if (!u) return;

    document.getElementById('modal-title').textContent = `${u.name} 상세`;

    const statusColors = { empty: '#dc2626', occupied: '#0d9451', expiring: '#d97706' };
    const statusBg = { empty: '#fee2e2', occupied: '#d1fae5', expiring: '#fef3c7' };
    const st = effectiveStatus(u);
    const d = inferDeal(u);
    const ddayHtml = u.contractEnd ? (() => {
        const daysLeft = Math.ceil((new Date(u.contractEnd) - new Date()) / 86400000);
        const color = daysLeft < 90 ? '#dc2626' : daysLeft < 180 ? '#d97706' : '#0d9451';
        const dateStr = String(u.contractEnd).replace(/-/g, '.');   // 2026-07-30 → 2026.07.30
        return `<div style="padding:10px 12px;background:#f9fafb;border-radius:10px;font-size:13px;margin-top:8px;color:${color};font-weight:600;">${dateStr} 만기</div>`;
    })() : '';

    document.getElementById('modal-body').innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
      <div style="display:inline-block;padding:5px 12px;border-radius:20px;background:${statusBg[st]};color:${statusColors[st]};font-size:13px;font-weight:700;">${STATUS_LABEL[st]}</div>
      ${dealBadge(u, 12)}
    </div>

    <div class="form-section-title">기본 정보</div>
    <div class="building-info-grid">
      <div class="info-card"><div class="info-card-label">호실</div><div class="info-card-value">${escapeHtml(u.name || '')}</div></div>
      <div class="info-card"><div class="info-card-label">면적</div><div class="info-card-value">${u.area}㎡</div></div>
      <div class="info-card"><div class="info-card-label">유형</div><div class="info-card-value">${TYPE_LABEL[u.type] || {residential:'주거용',office:'사무용'}[u.type] || u.type}</div></div>
      <div class="info-card"><div class="info-card-label">거래</div><div class="info-card-value">${DEAL_LABEL[d]}</div></div>
    </div>
    ${u.createdAt ? `<div style="font-size:11.5px;color:#9ca3af;margin-top:10px;">등록일 ${formatDate(u.createdAt)}</div>` : ''}

    <div class="form-section-title" style="margin-top:16px;">계약 정보</div>
    <div class="building-info-grid">
      <div class="info-card"><div class="info-card-label">${d === 'sale' ? '매매가' : d === 'jeonse' ? '전세금' : '보증금'}</div><div class="info-card-value">${u.deposit ? u.deposit.toLocaleString()+'만원' : '—'}</div></div>
      ${(d !== 'sale' && (u.rent || 0) > 0) ? `<div class="info-card"><div class="info-card-label">월세</div><div class="info-card-value">${u.rent.toLocaleString()}만원</div></div>` : ''}
      <div class="info-card"><div class="info-card-label">관리비</div><div class="info-card-value">${u.manage ? u.manage+'만원' : '—'}</div></div>
      <div class="info-card"><div class="info-card-label">계약기간</div><div class="info-card-value" style="font-size:12px;">${u.contractStart ? u.contractStart+'~'+u.contractEnd : '—'}</div></div>
    </div>
    ${ddayHtml}

    <div class="form-section-title" style="margin-top:16px;">메모</div>
    <div style="padding:12px;background:#f9fafb;border-radius:10px;font-size:14px;color:#374151;min-height:60px;">
      ${u.memo ? escapeHtml(u.memo) : '<span style="color:#9ca3af;">메모가 없습니다</span>'}
    </div>
  `;

    document.getElementById('modal-footer').innerHTML = `
    <button class="btn-secondary" onclick="closeModal()">닫기</button>
    ${isMine(u)
        ? `${myPerms().canUpdate ? `<button class="btn-primary" onclick="openUnitForm('${buildingId}','${unitId}')">수정</button>` : ''}`
        : `<span style="display:inline-flex;align-items:center;gap:4px;font-size:12.5px;color:#9ca3af;align-self:center;padding:0 6px;">${icon('lock',13)} ${ownerNameSpan(u)}님이 등록한 호실</span>`}
  `;
    showModal();
    hydrateOwnerNames(document.getElementById('modal')); // [B/E] edit by smsong
}

function switchUnitTab(tab) {
    document.querySelectorAll('.unit-tab').forEach((t,i) => {
        t.classList.toggle('active', ['info','contract','memo'][i] === tab);
    });
    renderUnitTab(tab);
}

function renderUnitTab(tab) {
    const { u } = window._unitTabData;
    const c = document.getElementById('unit-tab-content');

    const statusColors = { empty: '#dc2626', occupied: '#0d9451', expiring: '#d97706' };
    const statusBg = { empty: '#fee2e2', occupied: '#d1fae5', expiring: '#fef3c7' };

    if (tab === 'info') {
        c.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <div style="display:inline-block;padding:5px 12px;border-radius:20px;background:${statusBg[effectiveStatus(u)]};color:${statusColors[effectiveStatus(u)]};font-size:13px;font-weight:700;">
          ${STATUS_LABEL[effectiveStatus(u)]}
        </div>
        ${dealBadge(u, 12)}
      </div>
      <div class="building-info-grid">
        <div class="info-card"><div class="info-card-label">호실</div><div class="info-card-value">${u.name}</div></div>
        <div class="info-card"><div class="info-card-label">면적</div><div class="info-card-value">${u.area}㎡</div></div>
        <div class="info-card"><div class="info-card-label">유형</div><div class="info-card-value">${TYPE_LABEL[u.type] || {residential:'주거용',office:'사무용'}[u.type] || u.type}</div></div>
        <div class="info-card"><div class="info-card-label">거래</div><div class="info-card-value">${DEAL_LABEL[inferDeal(u)]}</div></div>
      </div>
      ${u.createdAt ? `<div style="font-size:11.5px;color:#9ca3af;margin-top:10px;">등록일 ${formatDate(u.createdAt)}</div>` : ''}
    `;
    } else if (tab === 'contract') {
        const d = inferDeal(u);
        c.innerHTML = `
      <div class="building-info-grid">
        <div class="info-card"><div class="info-card-label">${d === 'sale' ? '매매가' : d === 'jeonse' ? '전세금' : '보증금'}</div><div class="info-card-value">${u.deposit ? u.deposit.toLocaleString()+'만원' : '—'}</div></div>
        ${(d !== 'sale' && (u.rent || 0) > 0) ? `<div class="info-card"><div class="info-card-label">월세</div><div class="info-card-value">${u.rent.toLocaleString()}만원</div></div>` : ''}
        <div class="info-card"><div class="info-card-label">관리비</div><div class="info-card-value">${u.manage ? u.manage+'만원' : '—'}</div></div>
        <div class="info-card"><div class="info-card-label">계약기간</div>
          <div class="info-card-value" style="font-size:12px;">${u.contractStart ? u.contractStart+'~'+u.contractEnd : '—'}</div>
        </div>
      </div>
      ${u.contractEnd ? (() => {
            const daysLeft = Math.ceil((new Date(u.contractEnd) - new Date()) / 86400000);
            const color = daysLeft < 90 ? '#dc2626' : daysLeft < 180 ? '#d97706' : '#0d9451';
            return `<div style="padding:10px 12px;background:#f9fafb;border-radius:10px;font-size:13px;margin-top:8px;color:${color};font-weight:600;">
          만기까지 D-${daysLeft > 0 ? daysLeft : '만기'}
        </div>`;
        })() : ''}
    `;
    } else {
        c.innerHTML = `<div style="padding:12px;background:#f9fafb;border-radius:10px;font-size:14px;color:#374151;min-height:80px;">
      ${u.memo || '<span style="color:#9ca3af;">메모가 없습니다</span>'}
    </div>`;
    }
}

function openUnitForm(buildingId, unitId) {
    const b = state.buildings.find(b => b.id === buildingId);
    const u = unitId ? b.units.find(u => u.id === unitId) : null;
    if (unitId && !isMine(u)) { showToast('본인이 등록한 호실만 수정할 수 있습니다'); return; }
    if (!unitId && !isMine(b)) { showToast('본인이 등록한 매물에만 호실을 추가할 수 있습니다'); return; }
    const isEdit = !!u;

    document.getElementById('modal-title').textContent = isEdit ? '호실 수정' : '호실 추가';
    document.getElementById('modal-body').innerHTML = `
    <div class="form-section-title">기본 정보</div>
    <div class="form-group">
      <label class="form-label">호실명 *</label>
      <input id="uf-name" class="form-input" placeholder="예: 101호" value="${u ? u.name : ''}">
      <input id="uf-floor" type="hidden" value="${u ? u.floor : 1}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">면적 (㎡)</label>
        <input id="uf-area" class="form-input" type="number" placeholder="㎡" value="${u ? u.area : ''}">
      </div>
      <div class="form-group">
        <label class="form-label">유형</label>
        <select id="uf-type" class="form-select">
          <option value="house" ${(!u || u.type==='house')?'selected':''}>단독&다중</option>
          <option value="multiplex" ${u && u.type==='multiplex'?'selected':''}>다세대</option>
          <option value="officetel" ${u && u.type==='officetel'?'selected':''}>오피스텔</option>
          <option value="apartment" ${u && u.type==='apartment'?'selected':''}>아파트</option>
          <option value="neighborhood" ${u && u.type==='neighborhood'?'selected':''}>근린생활시설</option>
          <option value="commercial" ${u && u.type==='commercial'?'selected':''}>상가</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">현황</label>
      <div class="status-selector">
        <div class="status-option ${!u || u.status==='empty'?'selected':''}" data-status="empty" onclick="selectStatus('empty')">공실</div>
        <div class="status-option ${u && u.status==='occupied'?'selected':''}" data-status="occupied" onclick="selectStatus('occupied')">임차중</div>
      </div>
    </div>

    <div class="form-section-title">거래 · 금액 정보</div>
    <input id="uf-tenant" type="hidden" value="${u ? (u.tenant || '') : ''}">
    <div class="form-group">
      <label class="form-label">거래유형</label>
      <div class="deal-selector" id="uf-deal-selector">
        <div class="deal-option" data-deal="sale" onclick="selectDeal('uf','sale')">매매</div>
        <div class="deal-option" data-deal="jeonse" onclick="selectDeal('uf','jeonse')">전세</div>
        <div class="deal-option" data-deal="monthly" onclick="selectDeal('uf','monthly')">월세</div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label" id="uf-deposit-label">보증금 (만원)</label>
        <input id="uf-deposit" class="form-input" type="number" placeholder="0" value="${u ? u.deposit : ''}">
      </div>
      <div class="form-group" id="uf-rent-group">
        <label class="form-label">월세 (만원)</label>
        <input id="uf-rent" class="form-input" type="number" placeholder="0" value="${u ? u.rent : ''}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">관리비 (만원)</label>
      <input id="uf-manage" class="form-input" type="number" placeholder="0" value="${u ? u.manage : ''}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">계약 시작</label>
        <input id="uf-start" class="form-input" type="date" value="${u ? u.contractStart : ''}">
      </div>
      <div class="form-group">
        <label class="form-label">계약 만료</label>
        <input id="uf-end" class="form-input" type="date" value="${u ? u.contractEnd : ''}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">메모</label>
      <textarea id="uf-memo" class="form-textarea">${u ? u.memo : ''}</textarea>
    </div>
  `;

    document.getElementById('modal-footer').innerHTML = `
    ${isEdit && myPerms().canDelete ? `<button class="btn-danger" onclick="deleteUnit('${buildingId}','${unitId}')">삭제</button>` : ''}
    <button class="btn-secondary" onclick="closeModal()">취소</button>
    <button class="btn-primary" onclick="saveUnit('${buildingId}','${isEdit ? unitId : ''}')">저장</button>
  `;

    selectDeal('uf', isEdit ? inferDeal(u) : 'monthly');   // 거래유형 초기 상태
    showModal();
}

function selectStatus(status) {
    document.querySelectorAll('.status-option').forEach(el => {
        el.classList.toggle('selected', el.dataset.status === status);
    });
}

// 전세 대출 가능 토글 — 켜지면 대출 종류 콤보박스 노출
function toggleJeonseLoan() {
    const btn = document.getElementById('f-jeonse-loan');
    const box = document.getElementById('f-jeonse-loan-types');
    const on = btn.classList.toggle('on');
    if (box) box.style.display = on ? 'flex' : 'none';
}

// 거래유형 선택 — scope='f'(건물) 또는 'uf'(호실).
//  · 선택 토글 + 보증금 라벨 변경(매매가/전세금/보증금) + 월세 입력칸 표시/숨김
function selectDeal(scope, code) {
    const sel = document.getElementById(scope + '-deal-selector');
    if (sel) sel.querySelectorAll('.deal-option').forEach(o =>
        o.classList.toggle('selected', o.dataset.deal === code));
    const depLabel = document.getElementById(scope + '-deposit-label');
    if (depLabel) depLabel.textContent =
        code === 'sale' ? '매매가 (만원)' : code === 'jeonse' ? '전세금 (만원)' : '보증금 (만원)';
    const rentGroup = document.getElementById(scope + '-rent-group');
    if (rentGroup) rentGroup.style.display = (code === 'sale') ? 'none' : '';   // 매매만 월세 숨김 (전세·월세는 월세 입력 허용)
}
function selectedDeal(scope) {
    return document.querySelector('#' + scope + '-deal-selector .deal-option.selected')?.dataset.deal || 'monthly';
}

async function saveUnit(buildingId, unitId) {
    if (_isSubmitting) return;                 // 진행 중이면 중복 호출 차단
    const name = document.getElementById('uf-name').value.trim();
    if (!name) { showToast('호실명을 입력하세요'); return; }

    const status = document.querySelector('.status-option.selected')?.dataset.status || 'empty';
    const dealType = selectedDeal('uf');
    const dto = {
        name, status, dealType,
        floor: parseInt(document.getElementById('uf-floor').value) || 1,
        area: parseFloat(document.getElementById('uf-area').value) || 0,
        type: document.getElementById('uf-type').value,
        tenant: document.getElementById('uf-tenant').value.trim(),
        deposit: parseInt(document.getElementById('uf-deposit').value) || 0,
        rent: dealType === 'sale' ? 0 : (parseInt(document.getElementById('uf-rent').value) || 0),
        manage: parseInt(document.getElementById('uf-manage').value) || 0,
        contractStart: document.getElementById('uf-start').value,
        contractEnd: document.getElementById('uf-end').value,
        memo: document.getElementById('uf-memo').value.trim()
    };

    showLoading(unitId ? '호실 정보를 저장하는 중…' : '호실을 추가하는 중…');
    try {
        if (unitId) {
            await Api.updateUnit(unitId, dto);
        } else {
            await Api.createUnit(buildingId, dto);
        }
        await loadData();
        const b = state.buildings.find(x => x.id === buildingId);
        closeModal();
        renderMarkers();
        updateStats();
        if (b) { showBuildingDetail(b); showSheet('center'); currentBuilding = b; }
        showToast(unitId ? '호실 정보가 수정되었습니다' : '호실이 추가되었습니다');
    } catch (e) {
        showToast('저장 실패: ' + e.message);
    } finally {
        hideLoading();
    }
}

async function deleteUnit(buildingId, unitId) {
    if (_isSubmitting) return;
    const b = state.buildings.find(b => b.id === buildingId);
    const u = b && b.units.find(u => u.id === unitId);
    if (u && !isMine(u)) { showToast('본인이 등록한 호실만 삭제할 수 있습니다'); return; }
    if (!confirm('이 호실을 삭제하시겠습니까?')) return;
    showLoading('호실을 삭제하는 중…');
    try {
        await Api.deleteUnit(unitId);
        await loadData();
        const b = state.buildings.find(x => x.id === buildingId);
        closeModal();
        renderMarkers();
        updateStats();
        if (b) { showBuildingDetail(b); currentBuilding = b; }
        showToast('호실이 삭제되었습니다');
    } catch (e) {
        showToast('삭제 실패: ' + e.message);
    } finally {
        hideLoading();
    }
}

// =====================================================
// 관리자 탭 — 계약자·임차인 관리 리스트 (중개사 전용)
// =====================================================
let _tenants = [];   // 계약자 목록 캐시

function showStatsView() {   // (하단 '관리자' 탭 진입점 — 기존 호출부 호환 위해 이름 유지)
    const body = document.getElementById('sheet-body');
    document.getElementById('sheet-title').textContent = '계약자 임차인 관리 리스트';
    document.getElementById('sheet-subtitle').textContent = '중개사 전용 · 계약자/임차인 정보 관리';

    if (!isBroker()) {
        body.innerHTML = `<div class="empty-state">
          <div class="empty-state-icon">${icon('lock', 56, 'color:#9ca3af;')}</div>
          <div class="empty-state-title">중개사 전용 기능입니다</div>
          <div class="empty-state-sub">‘내 정보 수정’에서 공인중개사사무소 정보를 등록하면 이용할 수 있습니다</div>
        </div>`;
        return;
    }

    body.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
        <button onclick="openTenantForm()" style="display:inline-flex;align-items:center;gap:5px;padding:8px 14px;border-radius:9px;border:none;background:#1a56db;color:#fff;font-size:13px;font-weight:700;cursor:pointer;">${icon('plus', 15)} 계약자 추가</button>
      </div>
      <div id="tenant-list"><div style="padding:24px;text-align:center;color:#9ca3af;font-size:13px;">불러오는 중…</div></div>
    `;
    loadTenants();
}

async function loadTenants() {
    const box = document.getElementById('tenant-list');
    try {
        _tenants = (await Api.getTenants()) || [];
        _tenants.forEach(t => t.id = String(t.id));
    } catch (e) {
        _tenants = [];
        if (box) box.innerHTML = `<div style="padding:20px;text-align:center;color:#dc2626;font-size:13px;">불러오기 실패: ${escapeHtml(e.message)}</div>`;
        return;
    }
    renderTenantList();
}

function renderTenantList() {
    const box = document.getElementById('tenant-list');
    if (!box) return;
    if (!_tenants.length) {
        box.innerHTML = `<div class="empty-state">
          <div class="empty-state-icon">${icon('user', 52, 'color:#9ca3af;')}</div>
          <div class="empty-state-title">등록된 계약자가 없습니다</div>
          <div class="empty-state-sub">‘계약자 추가’로 첫 계약자를 등록해보세요</div>
        </div>`;
        return;
    }
    box.innerHTML = _tenants.map(t => {
        const priceLine = (t.rent > 0)
            ? `보 ${(t.deposit || 0).toLocaleString()} / 월 ${t.rent.toLocaleString()}`
            : `보증금 ${(t.deposit || 0).toLocaleString()}만`;
        const period = (t.contractStart || t.contractEnd) ? `${t.contractStart || '?'} ~ ${t.contractEnd || '?'}` : '';
        return `<div class="tenant-card" onclick="openTenantForm('${t.id}')">
          <div class="tenant-top">
            <div class="tenant-bldg">${escapeHtml(t.buildingName || '건물 미입력')}${t.unitName ? ` <span class="tenant-unit">${escapeHtml(t.unitName)}</span>` : ''}</div>
            <div class="tenant-phone">${icon('phone', 13)} ${escapeHtml(t.phone || '-')}</div>
          </div>
          <div class="tenant-meta">
            <span class="tenant-price">${priceLine}${(t.manage || 0) > 0 ? ` · 관리 ${t.manage}만` : ''}</span>
            ${period ? `<span class="tenant-period">${escapeHtml(period)}</span>` : ''}
          </div>
        </div>`;
    }).join('');
}

// 계약자 추가/수정 폼 (건물/호실 추가와 동일한 모달 스타일)
function openTenantForm(id) {
    const t = id ? _tenants.find(x => x.id === id) : null;
    const isEdit = !!t;
    document.getElementById('modal-title').textContent = isEdit ? '계약자 수정' : '계약자 추가';
    const f = (label, fid, val, ph, type) => `
      <div class="form-group">
        <label class="form-label">${label}</label>
        <input id="${fid}" class="form-input" type="${type || 'text'}" placeholder="${ph || ''}" value="${val != null ? escapeHtml(String(val)) : ''}">
      </div>`;
    document.getElementById('modal-body').innerHTML = `
      ${f('전화번호', 'tf-phone', t ? t.phone : '', '010-0000-0000', 'tel')}
      ${f('건물명', 'tf-bldg', t ? t.buildingName : '', '예: 강남빌딩')}
      ${f('호실', 'tf-unit', t ? t.unitName : '', '예: 201호')}
      <div class="form-row">
        ${f('보증금 (만원)', 'tf-deposit', t ? (t.deposit || '') : '', '0', 'number')}
        ${f('월세 (만원)', 'tf-rent', t ? (t.rent || '') : '', '0', 'number')}
      </div>
      ${f('관리비 (만원)', 'tf-manage', t ? (t.manage || '') : '', '0', 'number')}
      <div class="form-row">
        ${f('계약 시작', 'tf-start', t ? t.contractStart : '', '', 'date')}
        ${f('계약 만료', 'tf-end', t ? t.contractEnd : '', '', 'date')}
      </div>
    `;
    document.getElementById('modal-footer').innerHTML = `
      ${isEdit && myPerms().canDelete ? `<button class="btn-danger" onclick="deleteTenant('${t.id}')">삭제</button>` : ''}
      <button class="btn-secondary" onclick="closeModal()">취소</button>
      <button class="btn-primary" onclick="saveTenant('${isEdit ? t.id : ''}')">저장</button>
    `;
    showModal();
}

async function saveTenant(id) {
    if (_isSubmitting) return;
    const phone = document.getElementById('tf-phone').value.trim();
    const buildingName = document.getElementById('tf-bldg').value.trim();
    if (!phone && !buildingName) { showToast('전화번호 또는 건물명을 입력하세요'); return; }
    const dto = {
        phone,
        buildingName,
        unitName: document.getElementById('tf-unit').value.trim(),
        deposit: parseInt(document.getElementById('tf-deposit').value) || 0,
        rent: parseInt(document.getElementById('tf-rent').value) || 0,
        manage: parseInt(document.getElementById('tf-manage').value) || 0,
        contractStart: document.getElementById('tf-start').value,
        contractEnd: document.getElementById('tf-end').value
    };
    showLoading(id ? '계약자 정보를 저장하는 중…' : '계약자를 추가하는 중…');
    try {
        if (id) await Api.updateTenant(id, dto);
        else await Api.createTenant(dto);
        closeModal();
        await loadTenants();
        showToast(id ? '계약자 정보가 수정되었습니다' : '계약자가 추가되었습니다');
    } catch (e) {
        showToast('저장 실패: ' + e.message);
    } finally {
        hideLoading();
    }
}

async function deleteTenant(id) {
    if (_isSubmitting) return;
    if (!confirm('이 계약자를 삭제하시겠습니까?')) return;
    showLoading('계약자를 삭제하는 중…');
    try {
        await Api.deleteTenant(id);
        closeModal();
        await loadTenants();
        showToast('계약자가 삭제되었습니다');
    } catch (e) {
        showToast('삭제 실패: ' + e.message);
    } finally {
        hideLoading();
    }
}

function showSettingsView() {
    document.getElementById('sheet-title').textContent = '내 프로필';
    document.getElementById('sheet-subtitle').textContent = '로그인한 계정 정보';

    const me = getCurrentUser() || {};
    const name = me.name || me.nickname || '이름 없음';

    document.getElementById('sheet-body').innerHTML = `
    <div class="profile-page">
      <!-- 위에 작게: 현재 어떤 소셜 로그인으로 로그인했는지 -->
      <div class="profile-provider">
        ${providerBadge(me.provider)}
        <span>${providerLoginText(me.provider)}</span>
      </div>

      <!-- 로그인된 사용자 프로필(사진) -->
      ${avatarHTML(me, 96)}

      <!-- name 값 -->
      <div class="profile-name">${escapeHtml(name)}</div>
      ${me.email ? `<div class="profile-sub">${escapeHtml(me.email)}</div>` : ''}

      <!-- [B] edit by smsong - 내 공인중개사사무소 정보 요약 -->
      ${agencyCardHTML(me) || `<div style="margin:6px 0 2px;font-size:12.5px;color:#9ca3af;">공인중개사사무소 정보가 없습니다. ‘내 정보 수정’에서 등록하세요.</div>`}
      <!-- [E] edit by smsong -->

      <input type="file" id="profile-file" accept="image/*" style="display:none" onchange="changeProfilePhoto(event)">
      <div class="profile-actions">
        <button class="btn-secondary" onclick="document.getElementById('profile-file').click()" style="display:inline-flex;align-items:center;justify-content:center;gap:6px;">${icon('camera',16)} 프로필 사진 변경</button>
        <button class="btn-secondary" onclick="openProfileEdit()" style="display:inline-flex;align-items:center;justify-content:center;gap:6px;">${icon('edit',16)} 내 정보 수정</button>
        <button class="btn-secondary" onclick="openTrash()" style="display:inline-flex;align-items:center;justify-content:center;gap:6px;">${icon('trash',16)} 휴지통</button>
        <button class="profile-logout" onclick="confirmLogout()">로그아웃</button>
        ${isAdminUser() ? `<button class="btn-secondary" onclick="openPermissionManager()" style="display:inline-flex;align-items:center;justify-content:center;gap:6px;margin-top:4px;">${icon('lock',16)} 권한 관리</button>` : ''}
      </div>
    </div>
  `;
}

// =====================================================
// 권한 관리 (관리자 전용) — 유저 목록 + 생성/조회/수정/삭제 토글
// =====================================================
async function openPermissionManager() {
    if (!isAdminUser()) { showToast('관리자만 접근할 수 있습니다'); return; }
    document.getElementById('modal-title').textContent = '권한 관리';
    document.getElementById('modal-body').innerHTML =
        '<div style="padding:28px;text-align:center;color:#9ca3af;font-size:13px;">유저 목록 불러오는 중…</div>';
    document.getElementById('modal-footer').innerHTML = '';   // 닫기 버튼/영역 제거 (헤더 X로 닫기)
    showModal();
    try {
        const list = await Api.listPermissions();
        renderPermissionList(list || []);
    } catch (e) {
        document.getElementById('modal-body').innerHTML =
            `<div style="padding:24px;text-align:center;color:#dc2626;font-size:13px;">불러오기 실패: ${escapeHtml(e.message)}</div>`;
    }
}

function renderPermissionList(list) {
    if (!list.length) {
        document.getElementById('modal-body').innerHTML =
            '<div style="padding:24px;text-align:center;color:#9ca3af;">등록된 유저가 없습니다</div>';
        return;
    }
    document.getElementById('modal-body').innerHTML =
        `<div style="font-size:12px;color:#6b7280;margin-bottom:10px;">각 유저의 역할을 정하고 <b>저장</b>을 누르세요. · <b>일반유저</b>=조회만 · <b>중개인</b>=생성·조회·수정·삭제 + 계약자 관리 · <b>관리자</b>=전체(고정)</div>` +
        list.map(u => {
            const role = u.admin ? 'admin' : (u.role || 'regular');
            return `
      <div class="perm-row" data-user-id="${u.userId}">
        <div class="perm-user">
          <div class="perm-name">${escapeHtml(u.name || u.nickname || u.uid)}${u.admin ? '<span class="perm-admin">관리자</span>' : ''}</div>
        </div>
        ${u.admin ? '<span class="perm-locked">관리자 (고정)</span>' : `
        <div class="perm-toggles" role="group">
          <button type="button" class="perm-btn ${role === 'regular' ? 'on' : ''}" data-role="regular" onclick="selectRole(this)">일반유저</button>
          <button type="button" class="perm-btn ${role === 'broker' ? 'on' : ''}" data-role="broker" onclick="selectRole(this)">중개인</button>
        </div>
        <button class="perm-save" onclick="savePermission(${u.userId}, this)">저장</button>`}
      </div>`;
        }).join('');
}

// 역할 버튼 단일 선택 (같은 행 안에서 하나만 on)
function selectRole(btn) {
    const row = btn.closest('.perm-row');
    if (!row) return;
    row.querySelectorAll('.perm-btn[data-role]').forEach(b => b.classList.toggle('on', b === btn));
}

async function savePermission(userId, btn) {
    if (_isSubmitting) return;                 // 진행 중이면 중복 차단
    const row = btn.closest('.perm-row');
    if (!row) return;
    const sel = row.querySelector('.perm-btn[data-role].on');
    const role = sel ? sel.dataset.role : 'regular';
    showLoading('권한을 저장하는 중…');          // 전체 로딩 오버레이(다른 조작 차단)
    try {
        await Api.updatePermission(userId, { role });
        showToast('역할을 저장했습니다');
    } catch (e) {
        showToast('저장 실패: ' + e.message);
    } finally {
        hideLoading();
    }
}

// [B] edit by smsong - 회원정보 수정 모달 (이름/닉네임/이메일/휴대폰/주소 + 공인중개사사무소 이름/전화/주소)
function openProfileEdit() {
    const me = getCurrentUser() || {};
    const field = (id, label, val, ph, type) => `
      <div style="margin-bottom:12px;">
        <label class="form-label" for="${id}">${label}</label>
        <input id="${id}" type="${type || 'text'}" class="form-input" value="${escapeHtml(val || '')}" placeholder="${escapeHtml(ph || '')}" autocomplete="off">
      </div>`;
    document.getElementById('modal-title').textContent = '내 정보 수정';
    document.getElementById('modal-body').innerHTML = `
      ${field('pe-name', '이름', me.name, '실명')}
      ${field('pe-nickname', '닉네임', me.nickname, '닉네임')}
      ${field('pe-email', '이메일', me.email, 'example@email.com', 'email')}
      ${field('pe-phone', '휴대폰', me.phone, '010-0000-0000', 'tel')}
      ${field('pe-address', '주소', me.address, '주소')}
      <div style="display:flex;align-items:center;gap:6px;margin:18px 0 10px;font-size:13px;font-weight:800;color:#1a56db;">
        ${icon('agency',16)} 공인중개사사무소 정보
      </div>
      ${field('pe-agency-name', '사무소 이름', me.agencyName, '○○공인중개사사무소')}
      ${field('pe-agency-phone', '사무소 전화번호', me.agencyPhone, '02-000-0000', 'tel')}
      ${field('pe-agency-address', '사무소 주소', me.agencyAddress, '사무소 주소')}
    `;
    document.getElementById('modal-footer').innerHTML = `
      <button class="btn-secondary" onclick="closeModal()">취소</button>
      <button class="btn-primary" onclick="saveProfileEdit()">저장</button>
    `;
    showModal();
}

async function saveProfileEdit() {
    if (_isSubmitting) return;
    const me = getCurrentUser();
    if (!me || !me.uid) { showToast('로그인 정보를 찾을 수 없습니다'); return; }
    const v = id => (document.getElementById(id)?.value || '').trim();
    // uid/id 는 식별/권한용으로 반드시 함께 전송. 나머지는 입력값으로 부분 업데이트.
    const dto = {
        uid: me.uid,
        id: me.id,
        name: v('pe-name') || me.name,
        nickname: v('pe-nickname'),
        email: v('pe-email'),
        phone: v('pe-phone'),
        address: v('pe-address'),
        agencyName: v('pe-agency-name'),
        agencyPhone: v('pe-agency-phone'),
        agencyAddress: v('pe-agency-address')
    };
    try {
        showLoading('내 정보를 저장하는 중…');
        const updated = await Api.updateUser(dto);   // 파일 없이 JSON 부분 업데이트
        const merged = Object.assign({}, me, updated || dto);
        // 이 폼은 프로필 사진을 수정하지 않는다. 서버 응답에 profileURL/provider 가
        // null/빈 값으로 와도 기존 값을 유지해, 정보 수정 직후 프로필 이미지가
        // 잠깐 안 보이는 문제를 방지한다. (DB 값은 그대로이므로 기존 값이 정답)
        if (me.profileURL && !merged.profileURL) merged.profileURL = me.profileURL;
        if (me.provider && !merged.provider) merged.provider = me.provider;
        setCurrentUser(merged);
        _ownerCache[me.uid] = merged;
        closeModal();
        showSettingsView();
        showToast('내 정보가 저장되었습니다');
    } catch (err) {
        showToast('저장 실패: ' + err.message);
    } finally {
        hideLoading();
    }
}
// [E] edit by smsong

// 프로필 사진 변경 — 선택한 이미지를 회원수정 API(PUT /user)로 업로드하고 화면/캐시 갱신
async function changeProfilePhoto(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';                 // 같은 파일 재선택 가능하게 초기화
    if (!file) return;
    if (_isSubmitting) return;
    const me = getCurrentUser();
    if (!me || !me.uid) { showToast('로그인 정보를 찾을 수 없습니다'); return; }
    showLoading('프로필 사진을 업로드하는 중…');
    try {
        // name 은 함께 보내 기존 값 유지(부분 업데이트). 사진 외 다른 정보는 서버가 그대로 둠.
        const updated = await Api.updateUser({ uid: me.uid, id: me.id, name: me.name }, file);
        const merged = Object.assign({}, me, updated || {});   // 응답(UserDTO)의 새 profileURL 반영
        setCurrentUser(merged);
        _ownerCache[me.uid] = merged;     // 매물 등록자 카드 캐시도 갱신
        showSettingsView();
        showToast('프로필 사진이 변경되었습니다');
    } catch (err) {
        showToast('변경 실패: ' + err.message);
    } finally {
        hideLoading();
    }
}

function saveKakaoKey() {
    const key = document.getElementById('kakao-key').value.trim();
    if (key) { localStorage.setItem('kakao_key', key); location.reload(); }
}

function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'hakbangnote_backup_' + new Date().toISOString().slice(0,10) + '.json';
    a.click();
}

function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
        if (_isSubmitting) return;
        showLoading('데이터를 가져오는 중…');
        try {
            const imported = JSON.parse(ev.target.result);
            if (!imported.buildings) { showToast('올바른 파일 형식이 아닙니다'); return; }
            // 각 건물을 호실 포함하여 서버에 생성 (BuildingDTO가 중첩 units 지원)
            for (const b of imported.buildings) {
                const dto = {
                    name: b.name, address: b.address, detailAddress: b.detailAddress, type: b.type,
                    lat: b.lat, lng: b.lng, memo: b.memo,
                    units: (b.units || []).map(u => ({
                        floor: u.floor, name: u.name, type: u.type, status: u.status,
                        area: u.area, tenant: u.tenant, deposit: u.deposit, rent: u.rent,
                        manage: u.manage, contractStart: u.contractStart,
                        contractEnd: u.contractEnd, memo: u.memo
                    }))
                };
                await Api.createBuilding(dto);
            }
            await loadData();
            renderMarkers();
            updateStats();
            showBuildingList();
            showToast('데이터를 가져왔습니다');
        } catch (err) { showToast('가져오기 실패: ' + err.message); }
        finally { hideLoading(); }
    };
    reader.readAsText(file);
}

async function resetData() {
    if (_isSubmitting) return;
    if (!confirm('서버의 모든 건물·호실 데이터가 삭제됩니다. 계속하시겠습니까?')) return;
    showLoading('전체 데이터를 초기화하는 중…');
    try {
        for (const b of [...state.buildings]) {
            await Api.deleteBuilding(b.id);
        }
        await loadData();
        renderMarkers();
        updateStats();
        showBuildingList();
        showToast('전체 데이터가 초기화되었습니다');
    } catch (e) {
        showToast('초기화 실패: ' + e.message);
    } finally {
        hideLoading();
    }
}

// =====================================================
// 네이버 부동산 매물 JSON 가져오기
// =====================================================
function openImportNaver() {
    document.getElementById('modal-title').textContent = '네이버 매물 가져오기';
    document.getElementById('modal-body').innerHTML = `
    <div style="font-size:13px;color:#6b7280;margin-bottom:10px;line-height:1.6;">
      네이버 부동산 매물의 JSON 데이터를 붙여넣으면 건물·호실로 자동 변환됩니다.
      같은 건물명이 이미 있으면 그 건물에 호실로 추가됩니다.
    </div>
    <textarea id="naver-json" class="form-textarea" style="min-height:200px;font-family:monospace;font-size:12px;" placeholder='{ "articleDetail": { ... }, "articleAddition": { ... } }'></textarea>
  `;
    document.getElementById('modal-footer').innerHTML = `
    <button class="btn-secondary" onclick="closeModal()">취소</button>
    <button class="btn-primary" onclick="importNaverJson()">변환하여 추가</button>
  `;
    showModal();
}

// 네이버 매물 JSON → 앱 건물/호실 구조로 변환
function convertNaverArticle(raw) {
    const d = raw.articleDetail || {};
    const add = raw.articleAddition || {};
    const floor = raw.articleFloor || {};
    const space = raw.articleSpace || {};
    const price = raw.articlePrice || {};
    const admin = raw.administrationCostInfo || {};

    // 건물명 / 주소 / 좌표
    const buildingName = d.articleName
        || ((d.aptName || '') + ' ' + (d.buildingName || '')).trim()
        || '이름없는 건물';
    const address = ((d.exposureAddress || add.exposureAddress || '') + ' ' + (d.detailAddress || '')).trim();
    const lat = parseFloat(d.latitude || add.latitude) || 0;
    const lng = parseFloat(d.longitude || add.longitude) || 0;

    // 건물 유형 매핑 (상가류 → commercial, 오피스텔 → officetel, 다세대/빌라 → multiplex, 나머지 → house)
    const typeCode = d.realestateTypeCode || add.realEstateTypeCode || '';
    let btype = 'house';
    if (['SG', 'SMS', 'GM', 'GJCG', 'SUG'].includes(typeCode)) btype = 'commercial';
    else if (['OPST'].includes(typeCode)) btype = 'officetel';
    else if (['DSD', 'VL', 'YR', 'DDDG'].includes(typeCode)) btype = 'multiplex';

    // 층
    const floorInfo = add.floorInfo || ''; // 예: "3/25"
    const unitFloor = parseInt((floorInfo.split('/')[0] || '').replace(/[^0-9]/g, ''))
        || parseInt(floor.correspondingFloorCount) || 1;
    const totalFloors = parseInt(floor.totalFloorCount)
        || parseInt((floorInfo.split('/')[1] || '').replace(/[^0-9]/g, '')) || 1;

    // 면적 (전용 우선)
    const area = space.exclusiveSpace || parseFloat(d.area2) || space.supplySpace || parseFloat(d.area1) || 0;

    // 가격 (만원 단위)
    const deposit = price.warrantPrice || price.dealPrice || 0;
    const rent = price.rentPrice || 0;

    // 관리비 (원 → 만원)
    let manage = 0;
    if (admin.etcFeeDetails && admin.etcFeeDetails.etcFeeAmount) {
        manage = Math.round(admin.etcFeeDetails.etcFeeAmount / 10000);
    }

    // 거래유형
    const tradeType = d.tradeTypeName || add.tradeTypeName || '';

    // 호실명 (네이버 매물엔 호수가 없어 층 기준으로 생성)
    const unitName = unitFloor + '층 매물';

    // 메모 구성
    const memoParts = [];
    if (tradeType) memoParts.push(tradeType);
    if (d.roomCount) memoParts.push(`방${d.roomCount}/욕실${d.bathroomCount || 0}`);
    const dir = add.direction || d.direction;
    if (dir) memoParts.push(dir);
    if (d.articleFeatureDescription) memoParts.push(d.articleFeatureDescription.trim());
    if (d.moveInTypeName) memoParts.push(d.moveInTypeName);
    if (add.cpName) memoParts.push('출처:' + add.cpName);
    const unitMemo = memoParts.join(' | ');

    // 건물 메모 (단지 정보)
    const bmemoParts = [];
    if (d.aptHouseholdCount) bmemoParts.push(`${d.aptHouseholdCount}세대`);
    if (d.aptUseApproveYmd) bmemoParts.push(`${d.aptUseApproveYmd.slice(0, 4)}년 준공`);
    if (d.aptParkingCountPerHousehold) bmemoParts.push(`세대당주차 ${d.aptParkingCountPerHousehold}`);
    const buildingMemo = bmemoParts.join(' · ');

    const unit = {
        id: 'u' + Date.now() + Math.floor(Math.random() * 1000),
        floor: unitFloor,
        name: unitName,
        type: btype,
        status: 'occupied', // 가격 정보를 화면에 보이게 하기 위해 occupied로 (임차인은 비움)
        area: Math.round(area * 100) / 100,
        tenant: '',
        deposit, rent, manage,
        contractStart: '',
        contractEnd: '',
        memo: unitMemo
    };

    return { buildingName, address, lat, lng, btype, totalFloors, buildingMemo, unit };
}

async function importNaverJson() {
    if (_isSubmitting) return;
    const txt = document.getElementById('naver-json').value.trim();
    if (!txt) { showToast('JSON을 붙여넣으세요'); return; }

    let raw;
    try { raw = JSON.parse(txt); } catch { showToast('JSON 형식이 올바르지 않습니다'); return; }
    if (!raw.articleDetail && !raw.articleAddition) {
        showToast('네이버 매물 데이터가 아닙니다');
        return;
    }

    const c = convertNaverArticle(raw);

    showLoading('네이버 매물을 가져오는 중…');
    try {
        // 같은 건물명이 있으면 그 건물에 호실 추가, 없으면 새 건물 생성
        const existing = state.buildings.find(x => x.name === c.buildingName);
        const isNew = !existing;
        let buildingId;

        if (!existing) {
            const created = await Api.createBuilding({
                name: c.buildingName, address: c.address, type: c.btype,
                lat: c.lat, lng: c.lng, memo: c.buildingMemo,
                units: []
            });
            buildingId = String(created.id);
        } else {
            buildingId = existing.id;
        }

        await Api.createUnit(buildingId, c.unit);
        await loadData();
        closeModal();
        renderMarkers();
        updateStats();
        showToast(isNew ? `'${c.buildingName}' 건물이 추가되었습니다` : `'${c.buildingName}'에 호실이 추가되었습니다`);

        if (typeof map !== 'undefined' && map) switchTab('map');
        selectBuilding(buildingId);
    } catch (e) {
        showToast('가져오기 실패: ' + e.message);
    } finally {
        hideLoading();
    }
}

// =====================================================
// UI HELPERS
// =====================================================
function markTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
}

function switchTab(tab) {
    if (pickerMode) cancelMapPicker();   // 다른 탭으로 가면 위치 설정 모드 해제
    applyPermUI();                       // 권한에 따라 추가 버튼 표시/숨김

    if (tab === 'map') {
        markTab('map');
        listMineOnly = false;
        showBuildingList();              // 지도와 함께 보일 목록을 peek 콘텐츠로
        Sheet.collapse();                // 완전히 닫지 않고 살짝 남김(peek)
        return;
    }

    // 목록/내목록/임차인관리/설정 — 지도를 배경에 깔아둔 채 시트(폼)로 띄움 (네이버 지도 스타일)
    markTab(tab);
    if (tab === 'list') { listMineOnly = false; showBuildingList(); }
    else if (tab === 'mylist') { listMineOnly = true; showBuildingList(); }
    else if (tab === 'stats') showStatsView();
    else if (tab === 'settings') showSettingsView();
    Sheet.open('tab', 'full');
}

// ===== 몰입 모드 — 지도 탭에서 지도를 누르면 상/하단 메뉴가 위아래로 사라짐 =====
function setImmersive(on) {
    // 웹(데스크톱) 모드에서는 몰입 모드(상/하단 숨김)를 쓰지 않음 — 패널/지도/헤더 항상 표시
    if (document.documentElement.classList.contains('mode-web')) return;
    const app = document.getElementById('app');
    if (app) app.classList.toggle('chrome-hidden', on);
    if (on) closeFilterPanel();
}
function toggleImmersive() {
    const app = document.getElementById('app');
    setImmersive(!(app && app.classList.contains('chrome-hidden')));
}

// 위치 설정(피커) 중 화면 탭 → 상단(검색/안내바)·하단 메뉴를 숨기고 버튼을 내림(다시 탭하면 복귀)
function togglePickerImmersive() {
    const app = document.getElementById('app');
    if (!app) return;
    app.classList.toggle('chrome-hidden');
    closeFilterPanel();
}

// ===== 필터 패널 — 상단 필터 버튼에서 쑥 나오고 다시 누르면 쑥 들어감 =====
function openFilterPanel() {
    const p = document.getElementById('filter-panel');
    const b = document.getElementById('filter-btn');
    if (p) p.classList.add('show');
    if (b) b.classList.add('active');
}
function closeFilterPanel() {
    const p = document.getElementById('filter-panel');
    const b = document.getElementById('filter-btn');
    if (p) p.classList.remove('show');
    if (b) b.classList.remove('active');
}
function toggleFilterPanel() {
    const p = document.getElementById('filter-panel');
    (p && p.classList.contains('show')) ? closeFilterPanel() : openFilterPanel();
}

function showModal() {
    // 모달을 열 때 항상 맨 위에서 시작 (이전 모달의 스크롤 위치가 남지 않도록)
    const mb = document.getElementById('modal-body');
    if (mb) mb.scrollTop = 0;
    const mo = document.getElementById('modal-overlay');
    if (mo) mo.scrollTop = 0;
    document.getElementById('modal-overlay').classList.add('show');
}

function closeModal() {
    document.getElementById('modal-overlay').classList.remove('show');
}

function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}

// =====================================================
// 로딩 오버레이 — 매물/호실 저장 등 API 진행 중 전체 화면을 덮어
//  · 모든 클릭을 가로채 다른 버튼을 못 누르게 막고(중복 호출 방지)
//  · _isSubmitting 가드로 함수 진입 자체도 차단(이중 안전장치)
//  · HTML 수정 없이 첫 호출 때 오버레이 DOM을 동적으로 만든다.
// =====================================================
let _isSubmitting = false;

function showLoading(text) {
    _isSubmitting = true;
    let el = document.getElementById('loading-overlay');
    if (!el) {
        el = document.createElement('div');
        el.id = 'loading-overlay';
        el.innerHTML =
            '<div class="loading-box">' +
            '  <div class="loading-spinner"></div>' +
            '  <div class="loading-text"></div>' +
            '</div>';
        document.body.appendChild(el);
    }
    el.querySelector('.loading-text').textContent = text || '처리 중…';
    // 진행 중 클릭을 흡수 (캡처 단계에서 막아 버튼 onclick 도달 차단)
    requestAnimationFrame(() => el.classList.add('show'));
}

function hideLoading() {
    _isSubmitting = false;
    const el = document.getElementById('loading-overlay');
    if (el) el.classList.remove('show');
}

// =====================================================
// SEARCH
// =====================================================
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');

// ===== 장소 검색 공용 헬퍼 =====
// 현재 지도 중심 좌표 (장소를 "가까운 순"으로 정렬하는 기준)
function mapCenter() {
    try { if (typeof map !== 'undefined' && map) { const c = map.getCenter(); return { lat: c.lat(), lng: c.lng() }; } } catch (_) {}
    return { lat: null, lng: null };
}
// 입력 디바운스 (검색창 키 입력마다 서버를 때리지 않도록)
function debounce(fn, ms) {
    let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
}
// 카테고리 "음식점>한식" → "음식점 · 한식"
function fmtCategory(c) { return (c || '').replace(/>/g, ' · '); }

// 선택한 장소로 지도 이동.
//  · 지역검색 mapx/mapy(±1e7)는 오차가 있어, 도로명/지번 주소로 재지오코딩한 좌표를 우선 사용
//  · isPicker=true 면 "위치 설정(피커)" 중심을 옮김(건물 위치로 설정), 아니면 일반 패닝
function gotoPlace(p, isPicker) {
    if (!p) return;
    const apply = (lat, lng) => {
        if (typeof naver === 'undefined' || !map) return;
        const ll = new naver.maps.LatLng(lat, lng);
        if (isPicker) {
            map.setCenter(ll); map.setZoom(17); pickerLatlng = ll;
            if (typeof pickerSearchResults !== 'undefined' && pickerSearchResults) pickerSearchResults.classList.remove('show');
        } else {
            map.panTo(ll); map.setZoom(16);
            searchResults.classList.remove('show');
        }
    };
    const addr = (p.roadAddress || p.jibunAddress || '').trim();
    if (addr && typeof naver !== 'undefined') {
        naver.maps.Service.geocode({ query: addr }, function (status, response) {
            if (status === naver.maps.Service.Status.OK && response.v2.addresses.length > 0) {
                const a = response.v2.addresses[0];
                apply(parseFloat(a.y), parseFloat(a.x));
            } else if (p.lat != null && p.lng != null) {
                apply(p.lat, p.lng);                 // 지오코딩 실패 → 지역검색 좌표로 폴백
            } else {
                showToast('위치를 찾을 수 없습니다');
            }
        });
    } else if (p.lat != null && p.lng != null) {
        apply(p.lat, p.lng);
    } else {
        showToast('위치를 찾을 수 없습니다');
    }
}

// 장소 검색 결과를 검색창 드롭다운 HTML로 (places 배열은 onclick 에서 인덱스로 참조 → 따옴표 이스케이프 문제 없음)
function renderPlaceItems(places, onclickFnName) {
    return (places || []).map((p, i) => `
    <div class="search-result-item" onclick="${onclickFnName}(${i})">
      <div>${escapeHtml(p.name)}${p.category ? ` <span class="search-cat">${escapeHtml(fmtCategory(p.category))}</span>` : ''}</div>
      <div class="search-result-sub">${escapeHtml(p.roadAddress || p.jibunAddress || '')}</div>
    </div>`).join('');
}

// ===== 상단 검색창 — 내 건물(로컬) + 장소(가까운 순) =====
let _topbarPlaces = [];
let _topbarSeq = 0;     // 빠른 타이핑 시 늦게 도착한 응답이 최신 결과를 덮어쓰지 않도록
function selectTopbarPlace(i) {
    const p = _topbarPlaces[i];
    if (!p) return;
    searchInput.value = p.name;
    gotoPlace(p, false);
}

const _runTopbarPlaceSearch = debounce((q, seq) => {
    const c = mapCenter();
    Api.searchPlace(q, c.lat, c.lng).then(places => {
        if (seq !== _topbarSeq) return;             // 더 최신 검색이 있으면 무시
        _topbarPlaces = places || [];
        const buildingHtml = searchInput.dataset.buildingHtml || '';
        const placeHtml = renderPlaceItems(_topbarPlaces, 'selectTopbarPlace');
        const combined = buildingHtml + placeHtml;
        searchResults.innerHTML = combined;
        searchResults.classList.toggle('show', !!combined);
    }).catch(() => { /* 장소 검색 실패 시 건물 결과만 유지 */ });
}, 250);

searchInput.addEventListener('input', e => {
    const raw = e.target.value.trim();
    const q = raw.toLowerCase();
    if (!q) { searchResults.classList.remove('show'); searchInput.dataset.buildingHtml = ''; return; }

    // 1) 내 건물(로컬) 즉시 표시
    const localResults = state.buildings.filter(b =>
        b.name.toLowerCase().includes(q) || (b.address || '').toLowerCase().includes(q)
    );
    const buildingHtml = localResults.map(b => `
    <div class="search-result-item" onclick="selectBuilding('${b.id}');searchResults.classList.remove('show');searchInput.value='${(b.name || '').replace(/'/g, '')}'">
      <div>${escapeHtml(b.name)}</div>
      <div class="search-result-sub">${escapeHtml(b.address || '')}</div>
    </div>`).join('');
    searchInput.dataset.buildingHtml = buildingHtml;
    searchResults.innerHTML = buildingHtml;
    searchResults.classList.toggle('show', !!buildingHtml);

    // 2) 장소(상호명) 검색 — 지도 중심 기준 가까운 순 (디바운스)
    if (raw.length >= 1) { _topbarSeq++; _runTopbarPlaceSearch(raw, _topbarSeq); }
});

// 함수 이름과 줌 레벨 로직 네이버로 변경
function gotoNaverResult(lat, lng) {
    map.panTo(new naver.maps.LatLng(lat, lng));
    map.setZoom(16);
}

// 이미지 확대 보기 (라이트박스)
function openImageViewer(url) {
    const v = document.getElementById('image-viewer');
    const img = document.getElementById('image-viewer-img');
    if (!v || !img) return;
    img.src = url;
    v.classList.add('show');
}
function closeImageViewer() {
    const v = document.getElementById('image-viewer');
    if (v) v.classList.remove('show');
}

// =====================================================
// 위치 설정(피커) 모드 — 주소 검색으로 지도 이동
// 지도 중심(크로스헤어)이 곧 설정 위치이므로, 검색 위치로 중심을 옮긴다
// =====================================================
const pickerSearchInput = document.getElementById('picker-search-input');
const pickerSearchResults = document.getElementById('picker-search-results');

// 검색 결과 위치로 지도 중심 이동 → 그 지점이 건물 위치로 설정됨
function gotoPickerResult(lat, lng) {
    const latlng = new naver.maps.LatLng(lat, lng);
    map.setCenter(latlng);
    map.setZoom(17);
    pickerLatlng = latlng;
    pickerSearchResults.classList.remove('show');
}

// 위치 설정(피커) 장소 결과 — 인덱스로 참조 (전역: 인라인 onclick 에서 호출)
let _pickerPlaces = [];
function selectPickerPlace(i) {
    const p = _pickerPlaces[i];
    if (!p) return;
    if (pickerSearchInput) pickerSearchInput.value = p.name;
    gotoPlace(p, true);   // 피커 중심을 그 장소로 이동 → 건물 위치로 설정
}

if (pickerSearchInput) {
    let _pSeq = 0;             // 최신 검색만 반영
    let _placeHtml = '';       // 장소(상호명) 결과 HTML
    let _addrHtml = '';        // 주소(지오코딩) 결과 HTML
    function renderPicker() {
        const combined = _placeHtml + _addrHtml;
        pickerSearchResults.innerHTML = combined;
        pickerSearchResults.classList.toggle('show', !!combined);
    }
    // 장소 검색(가까운 순) — 디바운스로 호출
    const runPickerPlace = debounce((q, seq) => {
        const c = mapCenter();
        Api.searchPlace(q, c.lat, c.lng).then(places => {
            if (seq !== _pSeq) return;
            _pickerPlaces = places || [];
            _placeHtml = renderPlaceItems(_pickerPlaces, 'selectPickerPlace');
            renderPicker();
        }).catch(() => { /* 장소 검색 실패 시 주소 결과만 유지 */ });
    }, 250);

    // 입력 시: 장소(가까운 순) + 주소 후보를 함께 표시
    pickerSearchInput.addEventListener('input', e => {
        const q = e.target.value.trim();
        if (!q || typeof naver === 'undefined') {
            _placeHtml = ''; _addrHtml = ''; _pickerPlaces = [];
            pickerSearchResults.classList.remove('show');
            return;
        }
        _pSeq++; const seq = _pSeq;

        // 1) 주소 후보(지오코딩)
        naver.maps.Service.geocode({ query: q }, function (status, response) {
            if (seq !== _pSeq) return;
            if (status === naver.maps.Service.Status.OK && response.v2.addresses.length > 0) {
                _addrHtml = response.v2.addresses.slice(0, 5).map(p => {
                    const label = (p.roadAddress || p.jibunAddress || '').replace(/'/g, '');
                    return `<div class="search-result-item" onclick="gotoPickerResult('${p.y}','${p.x}');document.getElementById('picker-search-input').value='${label}';">
                        <div>${escapeHtml(p.roadAddress || p.jibunAddress)}</div>
                        <div class="search-result-sub">${escapeHtml(p.jibunAddress || '')}</div>
                    </div>`;
                }).join('');
            } else {
                _addrHtml = '';
            }
            renderPicker();
        });

        // 2) 장소(상호명) — 지도 중심 기준 가까운 순
        runPickerPlace(q, seq);
    });

    // Enter → 장소 결과가 있으면 가장 가까운 장소로, 없으면 주소 첫 결과로 이동
    pickerSearchInput.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const q = pickerSearchInput.value.trim();
        if (!q || typeof naver === 'undefined') return;
        if (_pickerPlaces.length) { selectPickerPlace(0); return; }
        naver.maps.Service.geocode({ query: q }, function (status, response) {
            if (status === naver.maps.Service.Status.OK && response.v2.addresses.length > 0) {
                const p = response.v2.addresses[0];
                gotoPickerResult(p.y, p.x);
                pickerSearchInput.value = p.roadAddress || p.jibunAddress || q;
            } else {
                showToast('결과를 찾을 수 없습니다');
            }
        });
    });
}

document.addEventListener('click', e => {
    if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
        searchResults.classList.remove('show');
    }
});

// =====================================================
// FILTER
// =====================================================
// =====================================================
// FILTER — 상단 필터 버튼 + 떠오르는 필터 패널
// =====================================================
(function initFilter() {
    const btn = document.getElementById('filter-btn');
    const panel = document.getElementById('filter-panel');

    if (btn) btn.addEventListener('click', e => { e.stopPropagation(); toggleFilterPanel(); });

    document.querySelectorAll('#filter-panel .filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('#filter-panel .filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            activeFilter = chip.dataset.filter;
            renderMarkers();
            // 목록을 보고 있으면 분류 결과를 바로 반영 (지도 시트의 목록 peek 포함)
            if (!currentBuilding) showBuildingList();
            closeFilterPanel();
        });
    });

    // 패널 바깥을 누르면 닫힘
    document.addEventListener('click', e => {
        if (panel && panel.classList.contains('show') &&
            !panel.contains(e.target) && !(btn && btn.contains(e.target))) {
            closeFilterPanel();
        }
    });
})();

// =====================================================
// INIT
// =====================================================
// 네이버 지도 키가 없거나 로드 실패 시 보여줄 안내 화면
async function showMapFallback() {
    if (!requireAuthOrRedirect()) return;
    document.getElementById('map').innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;background:#f9fafb;padding:30px;text-align:center;">
      <div style="margin-bottom:16px;color:#9ca3af;">${icon('map',48,'color:#9ca3af;')}</div>
      <div style="font-size:16px;font-weight:700;color:#374151;margin-bottom:8px;">네이버 지도 API 키가 필요합니다</div>
      <div style="font-size:13px;color:#6b7280;margin-bottom:20px;line-height:1.6;">
        1. ncloud.com (네이버 클라우드 플랫폼) 접속<br>
        2. Application 생성 (Maps) → Client ID 복사<br>
        3. config.js 의 NAVER_MAP_CLIENT_ID 값 교체<br>
      </div>
      <button onclick="switchTab('settings')" style="padding:12px 24px;background:#1a56db;color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;">API 키 설정하기</button>
    </div>
  `;
    await loadData(true);
    showBuildingList();
    showSheet('');
    updateStats();
}

// PWA: offline support hint
window.addEventListener('online', () => showToast('인터넷에 연결되었습니다'));
window.addEventListener('offline', () => showToast('오프라인 모드 — 데이터는 로컬에 저장됩니다'));
// =====================================================
// 반응형 모드 — 앱(모바일/PWA) vs 웹(데스크톱)
//  · 설치형 PWA(standalone) 또는 좁은 화면  → 앱 모드 (기존 모바일 UI 그대로)
//  · 넓은 데스크톱 브라우저               → 웹 모드 (좌측 패널 + 우측 지도)
//  · <html> 에 mode-web / mode-app 클래스를 토글하고, CSS 가 레이아웃을 분기한다.
// =====================================================
(function initResponsiveMode() {
    const WEB_MIN_WIDTH = 1024;   // 이 폭 이상 + 비-PWA 일 때만 웹 레이아웃

    function isStandalone() {
        return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
            || window.navigator.standalone === true;   // iOS 홈화면 추가 앱
    }
    function isWeb() {
        return !isStandalone() && window.innerWidth >= WEB_MIN_WIDTH;
    }
    function apply() {
        const root = document.documentElement;
        const web = isWeb();
        const changed = root.classList.contains('mode-web') !== web;
        root.classList.toggle('mode-web', web);
        root.classList.toggle('mode-app', !web);
        // 모드가 바뀌면 현재 탭 내용을 다시 그려 레이아웃/썸네일을 새로 반영
        if (changed) {
            try {
                if (typeof activeTab !== 'undefined' && activeTab === 'stats' && typeof showStatsView === 'function') showStatsView();
                else if (typeof activeTab !== 'undefined' && activeTab === 'settings' && typeof showSettingsView === 'function') showSettingsView();
                else if (typeof showBuildingList === 'function') showBuildingList();
            } catch (e) { /* 초기 로드 시점 등은 무시 */ }
        }
    }

    apply();   // main.js 파싱 시점에 1차 적용 (initMap 보다 먼저 클래스 확정)
    let t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(apply, 150); });
    if (window.matchMedia) {
        try { window.matchMedia('(display-mode: standalone)').addEventListener('change', apply); } catch (e) {}
    }
})();

// =====================================================
// 화면 전환 시 항상 맨 위로 스크롤
//  · 시트 콘텐츠(#sheet-body)가 통째로 교체될 때(=목록↔상세↔현황↔설정, 매물 간 이동 등) scrollTop=0
//  · 직속 자식 교체만 감지(childList) → 등록자/사무소 카드의 비동기 hydrate(하위 노드 변경)에는 반응하지 않아
//    사용자가 읽는 중 스크롤이 갑자기 튀지 않는다.
//  · 모달(#modal-body)은 showModal() 에서 별도로 초기화한다.
// =====================================================
(function initScrollReset() {
    const sb = document.getElementById('sheet-body');
    if (!sb || !('MutationObserver' in window)) return;
    let raf = 0;
    const mo = new MutationObserver(() => {
        // 같은 프레임 내 여러 mutation 을 한 번으로 합쳐 맨 위로
        if (raf) return;
        raf = requestAnimationFrame(() => { raf = 0; sb.scrollTop = 0; });
    });
    mo.observe(sb, { childList: true });   // subtree:false → 하위 카드 hydrate 에는 미반응
})();

// =====================================================
// 휴지통 (소프트 삭제된 매물) — 설정 메뉴에서 진입
//  · 삭제 시 휴지통으로 이동 → 30일 후 자동 영구 삭제
//  · 여기서 복원 또는 즉시 완전 삭제 가능
// =====================================================
const TRASH_RETENTION_DAYS = 30;

function trashDaysLeft(deletedAtMillis) {
    if (!deletedAtMillis) return TRASH_RETENTION_DAYS;
    const purgeAt = deletedAtMillis + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    return Math.max(0, Math.ceil((purgeAt - Date.now()) / (24 * 60 * 60 * 1000)));
}

async function openTrash() {
    document.getElementById('modal-title').textContent = '휴지통';
    document.getElementById('modal-body').innerHTML = `
      <div class="trash-note">${icon('info', 15)}<span>휴지통의 매물은 삭제 후 <b>${TRASH_RETENTION_DAYS}일</b>이 지나면 자동으로 영구 삭제됩니다.</span></div>
      <div id="trash-list"><div class="trash-loading">불러오는 중…</div></div>`;
    document.getElementById('modal-footer').innerHTML = `<button class="btn-secondary" onclick="closeModal()">닫기</button>`;
    showModal();
    try {
        const items = await Api.getTrash();
        renderTrashList(items || []);
    } catch (e) {
        const el = document.getElementById('trash-list');
        if (el) el.innerHTML = `<div class="trash-loading" style="color:#dc2626;">불러오기 실패: ${escapeHtml(e.message)}</div>`;
    }
}

function renderTrashList(items) {
    const el = document.getElementById('trash-list');
    if (!el) return;
    if (!items.length) {
        el.innerHTML = `<div class="empty-state" style="padding:28px 0;">
            <div class="empty-state-icon">${icon('trash', 48, 'color:#9ca3af;')}</div>
            <div class="empty-state-title">휴지통이 비어 있습니다</div></div>`;
        return;
    }
    el.innerHTML = items.map(b => {
        const left = trashDaysLeft(b.deletedAt);
        const emoji = TYPE_EMOJI[b.type] || '🏢';
        const firstImg = (b.mediaURLs && b.mediaURLs.length) ? b.mediaURLs[0] : '';
        const thumb = firstImg
            ? `<div class="building-thumb has-img"><img src="${escapeHtml(firstImg)}" alt="" onerror="this.remove();this.parentElement.classList.remove('has-img')"><span class="building-thumb-emoji">${emoji}</span></div>`
            : `<div class="building-thumb"><span class="building-thumb-emoji">${emoji}</span></div>`;
        return `<div class="trash-item">
            ${thumb}
            <div style="flex:1;min-width:0;">
              <div class="trash-item-name">${escapeHtml(b.name || '(이름 없음)')}</div>
              <div class="trash-item-sub">${escapeHtml(b.address || '')}</div>
              <div class="trash-item-left">${left > 0 ? `${left}일 후 영구 삭제` : '곧 영구 삭제됩니다'}</div>
            </div>
            <div class="trash-actions">
              <button class="trash-btn restore" onclick="restoreFromTrash('${b.id}')">${icon('restore', 14)} 복원</button>
              <button class="trash-btn purge" onclick="purgeFromTrash('${b.id}')">${icon('trash', 14)} 완전삭제</button>
            </div>
          </div>`;
    }).join('');
}

async function restoreFromTrash(id) {
    if (_isSubmitting) return;
    showLoading('매물을 복원하는 중…');
    try {
        await Api.restoreBuilding(id);
        await loadData();
        renderMarkers();
        updateStats();
        if (typeof showBuildingList === 'function') showBuildingList();
        const items = await Api.getTrash();
        renderTrashList(items || []);
        showToast('매물을 복원했습니다');
    } catch (e) {
        showToast('복원 실패: ' + e.message);
    } finally {
        hideLoading();
    }
}

async function purgeFromTrash(id) {
    if (_isSubmitting) return;
    if (!confirm('이 매물을 완전히 삭제할까요?\n영구 삭제되며 복구할 수 없습니다.')) return;
    showLoading('영구 삭제하는 중…');
    try {
        await Api.permanentlyDeleteBuilding(id);
        const items = await Api.getTrash();
        renderTrashList(items || []);
        showToast('영구 삭제되었습니다');
    } catch (e) {
        showToast('삭제 실패: ' + e.message);
    } finally {
        hideLoading();
    }
}
