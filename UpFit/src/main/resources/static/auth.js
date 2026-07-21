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

// [B] edit by smsong : 로그인 유지(슬라이딩 만료) —
//   토큰 만료가 다가오면 서버에 갱신 요청해 새 토큰으로 교체한다.
//   앱을 계속 쓰는 한(혹은 주기적으로 복귀하는 한) 로그인이 유지된다.
var REFRESH_LEAD_MS = 5 * 60 * 1000;   // 만료 5분 전부터 갱신 대상
var refreshing = null;                 // 진행 중 갱신 Promise(중복 방지)

function apiBase() {
    try { return (window.APP_CONFIG && window.APP_CONFIG.BACKEND_BASE) || ''; } catch (_) { return ''; }
}
function saveToken(token) {
    try { localStorage.setItem(TOKEN_KEY, token); } catch (_) {}
}
// 서버에 토큰 갱신 요청. 성공 시 새 토큰 저장 후 true, 실패 시 false.
function refreshToken() {
    if (refreshing) return refreshing;   // 이미 진행 중이면 그 결과를 공유
    var cur = getToken();
    if (!cur) return Promise.resolve(false);
    refreshing = fetch(apiBase() + '/user/refresh', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + cur }
    }).then(function (res) {
        if (!res.ok) return false;
        return res.json().then(function (data) {
            // JWTDTO 는 { token 또는 accessToken 또는 jwt, user } 형태일 수 있어 넓게 수용
            var nt = data && (data.token || data.accessToken || data.jwt || data.access_token);
            if (nt) {
                saveToken(nt);
                // 사용자 정보도 함께 오면 갱신
                try {
                    var u = data.user || data.userDTO || data.userDto;
                    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
                } catch (_) {}
                scheduleExpiry();   // 새 만료 기준으로 재스케줄
                return true;
            }
            return false;
        });
    }).catch(function () { return false; })
      .then(function (ok) { refreshing = null; return ok; });
    return refreshing;
}
// 만료가 임박했으면(또는 이미 지났지만 갱신 가능하면) 갱신을 시도한다.
//   반환: 유효 세션 확보 성공 여부(Promise<boolean>)
function ensureFreshToken() {
    var t = getToken();
    if (!t) return Promise.resolve(false);
    var exp = expiresAt(t);
    if (!exp) return Promise.resolve(true);          // exp 불명 → 서버 판단에 맡김
    var left = exp - Date.now();
    if (left > REFRESH_LEAD_MS) return Promise.resolve(true);   // 아직 여유
    if (left <= 0) {
        // 이미 만료 — 서버 refresh 는 만료 토큰을 거부하므로 재로그인 필요
        return Promise.resolve(false);
    }
    return refreshToken();   // 만료 임박 → 갱신
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

// [B] edit by smsong : 만료 전 자동 갱신 스케줄(로그인 유지).
//   만료 5분 전에 깨어나 갱신을 시도한다. 성공하면 새 토큰으로 재스케줄(계속 유지),
//   실패(서버 거부/오프라인)하면 그때 만료 시각에 맞춰 세션을 정리한다.
function scheduleExpiry() {
    if (expireTimer) clearTimeout(expireTimer);
    var exp = expiresAt();
    if (!exp) return;
    var now = Date.now();
    var left = exp - now;
    if (left <= 0) { invalidSession(); return; }

    // 갱신 시점 = 만료 5분 전(그보다 적게 남았으면 최대한 빨리)
    var refreshAt = Math.max(left - REFRESH_LEAD_MS, 0);
    expireTimer = setTimeout(function () {
        refreshToken().then(function (ok) {
            if (ok) return;   // 성공 → refreshToken 안에서 scheduleExpiry 재호출됨
            // 실패 → 남은 시간 뒤 세션 만료 처리(그 전에 복귀하면 visibilitychange 가 재시도)
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
    // [B][E] edit by smsong : 로그인 유지 — 갱신 API
    refreshToken: refreshToken,
    ensureFreshToken: ensureFreshToken
};

// <html data-require-auth> 인 페이지는 즉시 게이트
if (document.documentElement.hasAttribute('data-require-auth')) requireLogin();

// 백그라운드 복귀 시: 아직 유효하면 갱신을 시도해 세션을 이어간다.
//   완전히 만료됐을 때만 재로그인으로 보낸다.
document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    if (!document.documentElement.hasAttribute('data-require-auth')) return;
    if (hasValidSession()) {
        // 유효하지만 만료가 가까우면 미리 갱신
        ensureFreshToken();
        scheduleExpiry();
    } else {
        invalidSession();
    }
});

})();
// [E] edit by smsong
