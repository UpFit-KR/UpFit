// =====================================================
// UpFit — 소셜 로그인
// 프론트가 각 소셜의 인가 URL을 직접 생성 (PKCE 미사용)
// 설정값은 config.js 의 window.APP_CONFIG 에서 읽음.
// ⚠ login.html 에서 config.js 를 login.js 보다 먼저 로드해야 함.
// =====================================================

const CFG = window.APP_CONFIG || {};
const SUCCESS_REDIRECT = 'main.html';

const OAUTH = {
    kakao: {
        authorizeUrl: 'https://kauth.kakao.com/oauth/authorize',
        clientId: CFG.KAKAO_CLIENT_ID
    },
    naver: {
        authorizeUrl: 'https://nid.naver.com/oauth2.0/authorize',
        clientId: CFG.NAVER_CLIENT_ID
    },
    google: {
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        clientId: CFG.GOOGLE_CLIENT_ID,
        scope: 'openid email profile'
    }
};

// =====================================================
// 로그인 시작 — PKCE 없이 인가 URL 생성
// =====================================================
function startSocialLogin(provider) {
    if (!window.APP_CONFIG) { showToast('설정 파일을 불러오지 못했습니다'); return; }

    const cfg = OAUTH[provider];
    if (!cfg) { showToast('지원하지 않는 로그인 방식입니다'); return; }
    if (!cfg.clientId || cfg.clientId.startsWith('YOUR_')) {
        showToast(`${labelOf(provider)} 클라이언트가 설정되지 않았습니다.`);
        return;
    }

    const redirectUri = CFG.FRONT_LOGIN_BASE;

    const state = provider + '__' + randomState();
    sessionStorage.setItem('provider', provider);

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: cfg.clientId,
        redirect_uri: redirectUri,
        state: state
    });
    if (cfg.scope) params.set('scope', cfg.scope);

    // ⚠ code_challenge 미포함 → PKCE 미적용 (백엔드 수동 교환과 호환)
    window.location.href = `${cfg.authorizeUrl}?${params.toString()}`;
}

function labelOf(p) { return { kakao: '카카오', naver: '네이버', google: '구글' }[p] || p; }

function randomState() {
    if (window.crypto && crypto.getRandomValues) {
        const a = new Uint8Array(12);
        crypto.getRandomValues(a);
        return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
    }
    return Math.random().toString(36).slice(2);
}

// =====================================================
// 이벤트 바인딩
// =====================================================
document.querySelectorAll('.social-btn').forEach(btn => {
    btn.addEventListener('click', () => startSocialLogin(btn.dataset.provider));
});

// [B] edit by smsong
// 이미 로그인된 상태(토큰 유효)면 바로 main 으로,
// 토큰이 남아 있으나 만료된 경우엔 조용히 세션만 정리하고 로그인 화면 유지.
(function checkExistingSession() {
    const Auth = window.UpFitAuth;
    if (!Auth) return;
    if (Auth.hasValidSession()) { window.location.replace(SUCCESS_REDIRECT); return; }
    if (Auth.getToken()) Auth.clearSession();   // 만료 토큰 잔여물 제거
})();
// [E] edit by smsong

// =====================================================
// TOAST
// =====================================================
function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
}
