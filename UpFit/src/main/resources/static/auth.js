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

// 남은 시간 뒤 자동 만료 처리 (토큰 30분)
function scheduleExpiry() {
    if (expireTimer) clearTimeout(expireTimer);
    var exp = expiresAt();
    if (!exp) return;
    var left = exp - Date.now();
    if (left <= 0) { invalidSession(); return; }
    // setTimeout 최대치(약 24.8일) 보호
    expireTimer = setTimeout(function () { invalidSession(); }, Math.min(left, 2147483000));
}

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
    scheduleExpiry: scheduleExpiry
};

// <html data-require-auth> 인 페이지는 즉시 게이트
if (document.documentElement.hasAttribute('data-require-auth')) requireLogin();

// 백그라운드 복귀 시 만료 재검사 (탭을 오래 열어둔 경우)
document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (!document.documentElement.hasAttribute('data-require-auth')) return;
    if (!hasValidSession()) invalidSession();
});

})();
// [E] edit by smsong
