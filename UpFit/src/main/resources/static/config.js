// =====================================================
// 설정 파일 (민감한 값)
// 이 파일은 .gitignore에 등록되어 깃허브에 올라가지 않습니다.
// 배포 시에는 이 파일을 직접 포함시켜야 합니다.
// login.js / app.js 보다 먼저 로드되어야 합니다.
// =====================================================
window.APP_CONFIG = {
  BACKEND_BASE: "http://localhost:8085",
  FRONT_LOGIN_BASE: "http://localhost:8085/oauth-redirect.html",

  // 카카오맵 JavaScript 키 (developers.kakao.com에서 발급)
  KAKAO_MAP_KEY: "046ef56e58ee82b96797fa0018d905d8",
  KAKAO_CLIENT_ID: "3a6ef922dcd15e13142329eec951ec27",

  // 네이버 / 구글 OAuth client_id (백엔드 application.yml 및 콘솔 등록값과 동일해야 함)
  NAVER_MAP_CLIENT_ID: "xqvojw9yik",
  NAVER_CLIENT_ID: "J2waa_Pv28kxS2VDPvLH",
  GOOGLE_CLIENT_ID: "60115705118-vj649sq4vuadcl7aipasj8mtammbq557.apps.googleusercontent.com",
};