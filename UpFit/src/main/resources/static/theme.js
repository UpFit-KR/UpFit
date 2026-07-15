/* ============================================================
   UpFit — theme.js  (공통 테마 모듈)
   ------------------------------------------------------------
   · 모든 페이지(index / login / oauth-redirect / main)에서 공유
   · 기본값: 라이트
   · 기기별 유지: localStorage('UF_THEME') — 사용자가 바꾼 값이 계속 남음
   · <head> 에서 가장 먼저 로드해야 화면 깜빡임(FOUC)이 없음
   ============================================================ */
// [B] edit by smsong
(function () {
'use strict';

var KEY = 'UF_THEME';
var DEFAULT_THEME = 'light';          // ★ 기본값 = 라이트
var THEME_COLOR = { light: '#eef2f8', dark: '#071120' };
var LOGO = { light: 'icons/upfit-light.png', dark: 'icons/upfit.png' };

var listeners = [];

function normalize(t) { return (t === 'light' || t === 'dark') ? t : null; }

function read() {
    try { return normalize(localStorage.getItem(KEY)); } catch (_) { return null; }
}
function write(t) {
    try { localStorage.setItem(KEY, t); } catch (_) {}
}

// 저장된 값이 있으면 그 값, 없으면 기본값(라이트)
function current() { return read() || DEFAULT_THEME; }

function logoSrc(theme) { return LOGO[normalize(theme) || current()]; }

// data-theme-logo 속성이 붙은 <img> 를 현재 테마 로고로 교체
function refreshLogos(theme) {
    var src = logoSrc(theme);
    var imgs = document.querySelectorAll('[data-theme-logo]');
    for (var i = 0; i < imgs.length; i++) {
        var img = imgs[i];
        // 라이트 로고 파일이 없을 경우 다크 로고로 자동 폴백
        img.onerror = function () { this.onerror = null; this.src = LOGO.dark; };
        if (img.getAttribute('src') !== src) img.setAttribute('src', src);
    }
}

/**
 * 테마 적용
 * @param {string} theme    'light' | 'dark'
 * @param {boolean} persist true 면 localStorage 에 저장(기기에 계속 남음)
 */
function apply(theme, persist) {
    theme = normalize(theme) || DEFAULT_THEME;

    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_COLOR[theme]);

    if (persist) write(theme);

    refreshLogos(theme);
    for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](theme); } catch (_) {}
    }
    return theme;
}

function toggle() { return apply(current() === 'light' ? 'dark' : 'light', true); }
function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }

// ── 즉시 적용 (DOM 파싱 전 <head> 단계에서 실행) ──
apply(current(), false);

// 로고 <img> 는 body 파싱 후에 존재하므로 한 번 더
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { refreshLogos(); });
} else {
    refreshLogos();
}

// 다른 탭/창에서 테마를 바꾸면 즉시 동기화
window.addEventListener('storage', function (e) {
    if (e.key === KEY && normalize(e.newValue)) apply(e.newValue, false);
});

window.UpFitTheme = {
    KEY: KEY,
    current: current,
    apply: apply,
    toggle: toggle,
    logoSrc: logoSrc,
    refreshLogos: refreshLogos,
    onChange: onChange
};

})();
// [E] edit by smsong
