/* ============================================================
   UpFit — auth.js  (공통 인증 모듈)
   ------------------------------------------------------------
   · JWT(accessToken, 만료 30분) 보관/검증 담당
   · <html data-require-auth> 가 붙은 페이지는 로드 즉시 게이트 실행
       → 토큰이 없거나 만료되었으면 alert 후 login.html 로 강제 이동
   · <head> 에서 theme.js 다음에 로드
   ============================================================ */
// [B] edit by smsong
(function () {
'use strict';

var TOKEN_KEY = 'accessToken';
var USER_KEY = 'currentUser';
var AUTH_KEY = 'auth';
var DEVICE_ID_KEY = 'deviceId';       // [B][E] edit by smsong : 기기 고유 ID
var DEVICE_NAME_KEY = 'deviceName';   // [B][E] edit by smsong : 사용자 지정 기기 이름
var LOGIN_PAGE = 'login.html';
var EXPIRE_MSG = '토큰이 만료되었거나 존재하지 않습니다.\n다시 로그인해 주세요.';

var redirecting = false;
var expireTimer = null;

// ---------- 저장소 ----------
function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; }
}
function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (_) { return null; }
}

// [B] edit by smsong : 기기 식별 — 최초 1회 무작위 ID 생성 후 보관(기기 재설치 전까지 유지).
function getDeviceId() {
    try {
        var id = localStorage.getItem(DEVICE_ID_KEY);
        if (!id) {
            id = (window.crypto && crypto.randomUUID)
                ? crypto.randomUUID()
                : 'dev-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
            localStorage.setItem(DEVICE_ID_KEY, id);
        }
        return id;
    } catch (_) { return 'dev-unknown'; }
}
function getDeviceName() {
    try { return localStorage.getItem(DEVICE_NAME_KEY) || ''; } catch (_) { return ''; }
}
function setDeviceName(name) {
    try { localStorage.setItem(DEVICE_NAME_KEY, name || ''); } catch (_) {}
}
// User-Agent 로 기본 기기 이름 추정(입력 전 placeholder/기본값용)
function guessDeviceName() {
    var ua = navigator.userAgent || '';
    var os = /iPhone/.test(ua) ? 'iPhone'
           : /iPad/.test(ua) ? 'iPad'
           : /Android/.test(ua) ? 'Android'
           : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
           : /Windows/.test(ua) ? 'Windows PC'
           : /Linux/.test(ua) ? 'Linux' : '기기';
    var br = /CriOS|Chrome/.test(ua) ? 'Chrome'
           : /FxiOS|Firefox/.test(ua) ? 'Firefox'
           : /Edg/.test(ua) ? 'Edge'
           : /Safari/.test(ua) ? 'Safari' : '';
    return br ? (os + ' · ' + br) : os;
}
// [E] edit by smsong


// ---------- JWT 디코딩 ----------
function decodeBase64Url(str) {
    var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    // UTF-8 복원 (한글 클레임 대응)
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    try { return new TextDecoder('utf-8').decode(bytes); } catch (_) { return bin; }
}
function getPayload(token) {
    var t = token || getToken();
    if (!t) return null;
    var parts = t.split('.');
    if (parts.length < 2) return null;
    try { return JSON.parse(decodeBase64Url(parts[1])); } catch (_) { return null; }
}

// ---------- 만료 판정 ----------
function expiresAt(token) {
    var p = getPayload(token);
    return (p && p.exp) ? p.exp * 1000 : 0;   // ms, 0 = 알 수 없음
}
function isExpired(token) {
    var t = token || getToken();
    if (!t) return true;
    var exp = expiresAt(t);
    if (!exp) return false;                   // exp 클레임이 없으면 서버 401 로 판정
    return Date.now() >= exp;
}
function hasValidSession() {
    var t = getToken();
    return !!t && !isExpired(t);
}

// [B] edit by smsong : 로그인 유지(슬라이딩 만료) — 만료 임박 시 서버에 갱신 요청해 새 토큰으로 교체.
var REFRESH_LEAD_MS = 5 * 60 * 1000;
var refreshing = null;
function apiBase() {
    try { return (window.APP_CONFIG && window.APP_CONFIG.BACKEND_BASE) || ''; } catch (_) { return ''; }
}
function saveToken(token) { try { localStorage.setItem(TOKEN_KEY, token); } catch (_) {} }
function refreshToken() {
    if (refreshing) return refreshing;
    var cur = getToken();
    if (!cur) return Promise.resolve(false);
    refreshing = fetch(apiBase() + '/user/refresh', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + cur }
    }).then(function (res) {
        if (!res.ok) return false;
        return res.json().then(function (data) {
            var nt = data && (data.token || data.accessToken || data.jwt || data.access_token);
            if (nt) {
                saveToken(nt);
                try { var u = data.user || data.userDTO || data.userDto; if (u) localStorage.setItem(USER_KEY, JSON.stringify(u)); } catch (_) {}
                scheduleExpiry();
                return true;
            }
            return false;
        });
    }).catch(function () { return false; })
      .then(function (ok) { refreshing = null; return ok; });
    return refreshing;
}
function ensureFreshToken() {
    var t = getToken();
    if (!t) return Promise.resolve(false);
    var exp = expiresAt(t);
    if (!exp) return Promise.resolve(true);
    var left = exp - Date.now();
    if (left > REFRESH_LEAD_MS) return Promise.resolve(true);
    if (left <= 0) return Promise.resolve(false);
    return refreshToken();
}
// [E] edit by smsong


// ---------- 사용자 식별자 ----------
// 우선순위: currentUser.uid → JWT 클레임(uid / userId / id / sub)
function getUid() {
    var u = getUser();
    if (u && u.uid) return String(u.uid);
    var p = getPayload();
    if (!p) return '';
    var v = p.uid || p.userId || p.id || p.sub;
    return v != null ? String(v) : '';
}

// ---------- 세션 정리 ----------
function clearSession() {
    try {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(AUTH_KEY);
        sessionStorage.removeItem('provider');
        sessionStorage.removeItem('usedCode');
    } catch (_) {}
}

/**
 * 세션 무효 처리 — 알림 1회 후 login.html 로 강제 리다이렉트
 * @param {string} [msg] 사용자에게 보여줄 메시지
 */
function invalidSession(msg) {
    if (redirecting) return;
    redirecting = true;
    if (expireTimer) { clearTimeout(expireTimer); expireTimer = null; }
    clearSession();
    alert(msg || EXPIRE_MSG);
    window.location.replace(LOGIN_PAGE);
}

// 로그아웃(알림 없이 이동)
function logout() {
    if (redirecting) return;
    redirecting = true;
    clearSession();
    window.location.replace(LOGIN_PAGE);
}

/**
 * 인증 필수 페이지 게이트.
 * 토큰이 없거나 만료 → 알림 후 login.html
 * @returns {boolean} 유효 세션이면 true
 */
function requireLogin() {
    if (!hasValidSession()) { invalidSession(); return false; }
    scheduleExpiry();
    return true;
}

// [B] edit by smsong : 만료 전 자동 갱신 스케줄(로그인 유지). 만료 5분 전 갱신 시도.
function scheduleExpiry() {
    if (expireTimer) clearTimeout(expireTimer);
    var exp = expiresAt();
    if (!exp) return;
    var left = exp - Date.now();
    if (left <= 0) { invalidSession(); return; }
    var refreshAt = Math.max(left - REFRESH_LEAD_MS, 0);
    expireTimer = setTimeout(function () {
        refreshToken().then(function (ok) {
            if (ok) return;
            var rem = expiresAt() - Date.now();
            if (rem <= 0) { invalidSession(); return; }
            expireTimer = setTimeout(function () { invalidSession(); }, Math.min(rem, 2147483000));
        });
    }, Math.min(refreshAt, 2147483000));
}
// [E] edit by smsong

window.UpFitAuth = {
    LOGIN_PAGE: LOGIN_PAGE,
    getToken: getToken,
    getUser: getUser,
    getUid: getUid,
    getPayload: getPayload,
    expiresAt: expiresAt,
    isExpired: isExpired,
    hasValidSession: hasValidSession,
    clearSession: clearSession,
    invalidSession: invalidSession,
    logout: logout,
    requireLogin: requireLogin,
    scheduleExpiry: scheduleExpiry,
    // [B][E] edit by smsong : 로그인 유지 + 기기 관리
    refreshToken: refreshToken,
    ensureFreshToken: ensureFreshToken,
    getDeviceId: getDeviceId,
    getDeviceName: getDeviceName,
    setDeviceName: setDeviceName,
    guessDeviceName: guessDeviceName
};

// <html data-require-auth> 인 페이지는 즉시 게이트
if (document.documentElement.hasAttribute('data-require-auth')) requireLogin();

// [B][E] edit by smsong : 백그라운드 복귀 시 — 유효하면 갱신 시도로 이어가고, 만료면 재로그인
document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (!document.documentElement.hasAttribute('data-require-auth')) return;
    if (hasValidSession()) { ensureFreshToken(); scheduleExpiry(); }
    else invalidSession();
});

})();
// [E] edit by smsong
