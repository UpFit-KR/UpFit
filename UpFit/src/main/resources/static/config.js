// =====================================================
// UpFit — 런타임 설정
// Vercel/배포 환경변수로 이 파일을 생성하거나, 로컬에서 직접 값 채워서 사용.
// login.js / oauth-redirect.html 보다 먼저 로드되어야 함.
// =====================================================
window.APP_CONFIG = {
    // 소셜 로그인 클라이언트 ID (미설정 시 'YOUR_...' 그대로 두면 버튼이 안내 토스트 표시)
    KAKAO_CLIENT_ID:  'YOUR_KAKAO_CLIENT_ID',
    NAVER_CLIENT_ID:  'YOUR_NAVER_CLIENT_ID',
    GOOGLE_CLIENT_ID: 'YOUR_GOOGLE_CLIENT_ID',

    // 소셜 인가 후 돌아올 프론트 콜백 (oauth-redirect.html 의 절대 URL)
    FRONT_LOGIN_BASE: 'http://localhost:8080/oauth-redirect.html',

    // 스프링부트 백엔드 베이스 URL
    BACKEND_BASE: 'http://localhost:8080'
};
