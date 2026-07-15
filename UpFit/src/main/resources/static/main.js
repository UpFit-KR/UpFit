/* ============================================================
   UpFit — main.js
   ------------------------------------------------------------
   · 5탭(홈/운동/식단/변화/내정보) 단일 페이지
   · 비교: 같은 종목의 직전 세션 대비 볼륨 등락을 증권형으로 표시
             (증가=빨강 ▲ / 감소=파랑 ▼)
   ------------------------------------------------------------
   [B] edit by smsong
   · 인증 필수: 토큰(30분 만료)이 없거나 만료되면 알림 후 login.html 로 이동
     → auth.js(<head>)에서 1차 게이트, 여기서 2차 확인 + API 401/403 처리
   · 로컬 데모(샘플 시드) 모드 / 사용자 정보 기본값('회원' 등) 전부 제거
   · 테마는 theme.js(window.UpFitTheme)가 전담 (기본 라이트, 기기에 영속)

   · [v2 구조 개편] 날짜 → 운동 기록(세션) → 운동
     - 운동을 하나씩 만들지 않고, 날짜 안에 "운동 기록(세션)"을 만든다.
       세션이 시작/종료 시각 · 총 운동 시간 · 컨디션(0~100)을 보유.
     - 하루에 세션 여러 개 가능(오전/오후/저녁) → 달력 날짜 클릭 시 세션 목록 표시.
     - 세션 하나 안에서 운동을 여러 개 먼저 만들어 두고 한 번에 저장.
     - 백엔드: /session/{uid} (WorkoutSessionController)

   · [바텀시트 3단 스냅] 네이버 지도앱 방식
     1차 full   : 전체 화면
     2차 half   : 화면의 2/3만 걸침 (열릴 때 기본값)
     3차 closed : 완전히 내림
     그립/헤더 드래그 + 본문 최상단에서 아래로 당기기로 단계 이동.
   [E] edit by smsong
   ============================================================ */

(function () {
'use strict';

// ============================================================
//  [B] edit by smsong — 인증 게이트 (가장 먼저)
// ============================================================
var Auth = window.UpFitAuth;
if (!Auth) {                     // auth.js 미로드 방지
    alert('인증 모듈을 불러오지 못했습니다. 다시 로그인해 주세요.');
    window.location.replace('login.html');
    return;
}
if (!Auth.requireLogin()) return;   // 토큰 없음/만료 → 알림 + login.html

const UID = Auth.getUid();
if (!UID) {
    // 토큰은 있으나 사용자 식별자를 찾을 수 없는 경우 → 기본값으로 대체하지 않고 세션 무효 처리
    Auth.invalidSession('사용자 정보를 확인할 수 없습니다.\n다시 로그인해 주세요.');
    return;
}
// [E] edit by smsong

// ---------- 상수 ----------
const LOCAL_KEY = 'UF_LOCAL_V1_' + UID;   // 체중·신체정보 등 백엔드 미연동 항목 (사용자별 로컬 보관)
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const MEAL_TYPES = [
    { key: 'breakfast', label: '아침' },
    { key: 'lunch',     label: '점심' },
    { key: 'dinner',    label: '저녁' },
    { key: 'snack',     label: '간식' }
];
// [B] edit by smsong : 운동 부위 타입(하나의 운동에 여러 개 체크 가능)
const BODY_PARTS = ['가슴', '등중앙', '광배', '이두', '삼두', '하체', '복근'];
// 컨디션 기본값(신규 세션)
const DEFAULT_CONDITION = 70;
// [E] edit by smsong

// ============================================================
//  백엔드 연동 (운동 기록/식단/종목 — users.id 를 외래키로 사용)
// ============================================================
const CFG = window.APP_CONFIG || {};
const BACKEND_BASE = CFG.BACKEND_BASE || '';

async function apiReq(method, path, body) {
    const token = Auth.getToken();
    // 요청 직전에도 만료 확인 (30분 토큰)
    if (!token || Auth.isExpired(token)) { Auth.invalidSession(); const e = new Error('AUTH'); e.auth = true; throw e; }

    const res = await fetch(BACKEND_BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: body != null ? JSON.stringify(body) : undefined
    });
    if (res.status === 401 || res.status === 403) {
        Auth.invalidSession();                     // 서버가 거부 → 알림 + login.html
        const e = new Error('AUTH'); e.auth = true; throw e;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
}
// [B] edit by smsong : /workout/* → /session/* 로 전면 교체 (세션 구조)
const api = {
    listSessions:    ()          => apiReq('GET',    `/session/${UID}`),
    sessionsOfDate:  (date)      => apiReq('GET',    `/session/${UID}/date/${encodeURIComponent(date)}`),
    addSession:      (d)         => apiReq('POST',   `/session/${UID}`, d),
    updSession:      (id, d)     => apiReq('PUT',    `/session/${UID}/${id}`, d),
    delSession:      (id)        => apiReq('DELETE', `/session/${UID}/${id}`),
    reorderSessions: (date, ids) => apiReq('PUT',    `/session/${UID}/reorder?date=${encodeURIComponent(date)}`, ids),
    listMeals:     ()   => apiReq('GET',    `/meal/${UID}`),
    addMeal:       (d)  => apiReq('POST',   `/meal/${UID}`, d),
    delMeal:       (id) => apiReq('DELETE', `/meal/${UID}/${id}`),
    listExercises: ()   => apiReq('GET',    `/exercise/${UID}`),
    addExercise:   (nm) => apiReq('POST',   `/exercise/${UID}`, { name: nm }),
    delExercise:   (id) => apiReq('DELETE', `/exercise/${UID}/${id}`)
};

// ---------- DTO ↔ 화면 레코드 매핑 ----------
function partsToArr(s) { return (s ? String(s).split(',') : []).map(x => x.trim()).filter(Boolean); }

function fromWorkoutDTO(d) {
    return {
        id: d.id, sessionId: d.sessionId,
        exercise: d.exercise, weight: d.weight, reps: d.reps, sets: d.sets,
        memo: d.memo || '', bodyParts: partsToArr(d.bodyParts), bodyweight: !!d.bodyweight,
        sortOrder: d.sortOrder == null ? null : d.sortOrder
    };
}
function toWorkoutDTO(w) {
    return {
        id: (w.id == null ? null : w.id),     // id 유지 → 서버가 수정/신규를 구분
        exercise: w.exercise, weight: w.weight, reps: w.reps, sets: w.sets,
        memo: w.memo || '', bodyParts: (w.bodyParts || []).join(','), bodyweight: !!w.bodyweight
    };
}
// 세션(운동 기록) — 화면 레코드는 sessionDate → date, conditionScore → condition 으로 축약
function fromSessionDTO(d) {
    return {
        id: d.id,
        date: d.sessionDate,
        startTime: d.startTime || '',
        endTime: d.endTime || '',
        durationMin: d.durationMin == null ? null : d.durationMin,
        condition: d.conditionScore == null ? null : d.conditionScore,
        title: d.title || '',
        memo: d.memo || '',
        sortOrder: d.sortOrder == null ? null : d.sortOrder,
        workouts: (d.workouts || []).map(fromWorkoutDTO)
    };
}
function toSessionDTO(s) {
    return {
        sessionDate: s.date,
        startTime: s.startTime || null,
        endTime: s.endTime || null,
        durationMin: s.durationMin == null ? null : s.durationMin,
        conditionScore: s.condition == null ? null : s.condition,
        title: s.title || null,
        memo: s.memo || '',
        workouts: (s.workouts || []).map(toWorkoutDTO)
    };
}
// [E] edit by smsong
function fromMealDTO(d)    { return { id: d.id, date: d.mealDate, mealType: d.mealType, name: d.name, kcal: d.kcal, carb: d.carb, protein: d.protein, fat: d.fat }; }
function toMealDTO(r)      { return { mealDate: r.date, mealType: r.mealType, name: r.name, kcal: r.kcal, carb: r.carb, protein: r.protein, fat: r.fat }; }
let exIdByName = {};   // 종목명 → 서버 id (삭제용)

// ---------- 날짜/시간 유틸 ----------
function pad(n) { return String(n).padStart(2, '0'); }
function toDateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayStr() { return toDateStr(new Date()); }
function shiftDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return toDateStr(d); }
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function fmtKorean(s) { const d = parseDate(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`; }
function fmtHeaderDate() { const d = new Date(); return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일`; }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function nowTimeStr() { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

// [B] edit by smsong : 운동 시간 표기 유틸
function timeToMin(t) {
    if (!t || !/^\d{1,2}:\d{2}/.test(t)) return null;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}
// 시작~종료 → 분 (자정 넘김 보정). 서버와 동일 규칙.
function spanMinutes(start, end) {
    const s = timeToMin(start), e = timeToMin(end);
    if (s == null || e == null) return null;
    let d = e - s;
    if (d < 0) d += 24 * 60;
    return d;
}
function fmtDur(min) {
    if (min == null) return '';
    const h = Math.floor(min / 60), m = min % 60;
    if (h && m) return `${h}시간 ${m}분`;
    if (h) return `${h}시간`;
    return `${m}분`;
}
function fmtTimeRange(s) {
    if (s.startTime && s.endTime) return `${s.startTime} ~ ${s.endTime}`;
    if (s.startTime) return `${s.startTime} 시작`;
    if (s.endTime) return `${s.endTime} 종료`;
    return '시간 미기록';
}
function condLabel(c) {
    if (c == null) return '미기록';
    if (c >= 85) return '최상';
    if (c >= 65) return '좋음';
    if (c >= 40) return '보통';
    if (c >= 20) return '나쁨';
    return '최악';
}
// 컨디션 → 색 (낮음 빨강 → 높음 초록)
function condColor(c) {
    if (c == null) return 'var(--text-mute)';
    if (c >= 65) return 'var(--accent-2)';
    if (c >= 40) return 'var(--meal-breakfast)';
    return 'var(--up)';
}
// [E] edit by smsong

// ---------- 상태 ----------
let state = null;
const ui = {
    workoutView: 'calendar',           // 'calendar' | 'list'
    dietView: 'calendar',
    workoutCal: firstOfThisMonth(),
    dietCal: firstOfThisMonth(),
    workoutSel: todayStr(),
    dietSel: todayStr(),
    changeExercise: null
};
function firstOfThisMonth() { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; }

// [B] edit by smsong : workouts → sessions (세션이 운동을 품는 구조)
function blankState() { return { exercises: [], sessions: [], meals: [], bodyLogs: [], profile: {} }; }
// [E] edit by smsong

// [B] edit by smsong : 로그인 사용자 정보 반영 — 기본값 대체 없음(없으면 빈 값으로 둠)
function applyCurrentUser() {
    const cu = Auth.getUser();
    if (!cu) return;
    state.profile.name = cu.name || cu.nickname || cu.username || '';
    state.profile.email = cu.email || '';
}
// [E] edit by smsong

// 체중·신체정보(백엔드 미연동) 로컬 로드/저장
function loadLocalExtras() {
    try {
        const o = JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}');
        state.bodyLogs = o.bodyLogs || [];
        if (o.name) state.profile.name = state.profile.name || o.name;
        if (o.height != null) state.profile.height = o.height;
        if (o.targetWeight != null) state.profile.targetWeight = o.targetWeight;
    } catch (_) { state.bodyLogs = []; }
}
function saveLocalExtras() {
    try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify({
            bodyLogs: state.bodyLogs,
            name: state.profile.name,
            height: state.profile.height,
            targetWeight: state.profile.targetWeight
        }));
    } catch (_) {}
}

// 메인 로드: 백엔드 조회 (폴백 없음)
async function load() {
    state = blankState();
    applyCurrentUser();

    const [ss, ms, exs] = await Promise.all([api.listSessions(), api.listMeals(), api.listExercises()]);
    state.sessions = (ss || []).map(fromSessionDTO);
    state.meals = (ms || []).map(fromMealDTO);
    state.exercises = (exs || []).map(e => e.name);
    exIdByName = {};
    (exs || []).forEach(e => { exIdByName[e.name] = e.id; });
    loadLocalExtras();   // 체중/신체정보는 로컬
}

// ============================================================
//  데이터 조작
// ============================================================
// [B] edit by smsong : 세션 단위 저장/삭제
function upsertSessionLocal(rec) {
    const i = state.sessions.findIndex(s => String(s.id) === String(rec.id));
    if (i >= 0) state.sessions[i] = rec; else state.sessions.push(rec);
}
async function saveSessionRec(draft) {
    const dto = toSessionDTO(draft);
    const res = draft.id ? await api.updSession(draft.id, dto) : await api.addSession(dto);
    const rec = fromSessionDTO(res);
    upsertSessionLocal(rec);
    return rec;
}
async function delSessionRec(id) {
    await api.delSession(id);
    state.sessions = state.sessions.filter(s => String(s.id) !== String(id));
}
// [E] edit by smsong
async function addMealRec(rec) {
    const dto = await api.addMeal(toMealDTO(rec));
    state.meals.push(fromMealDTO(dto));
}
async function delMealRec(id) {
    await api.delMeal(id);
    state.meals = state.meals.filter(m => String(m.id) !== String(id));
}
async function addExerciseType(name) {
    const dto = await api.addExercise(name);
    state.exercises.push(dto.name); exIdByName[dto.name] = dto.id;
}
// 체중/신체정보(로컬 항목) 저장
function persistExtras() { saveLocalExtras(); }

// 에러 메시지 표준화
function errMsg(err, fallback) {
    if (err && err.auth) return '로그인이 만료되었어요. 다시 로그인해 주세요';
    return fallback || '문제가 발생했어요';
}

// ---------- 계산 ----------
function volumeOf(w) { return (w.weight || 0) * (w.reps || 0) * (w.sets || 0); }

// [B] edit by smsong : 세션 기준 집계
function sessionVolume(s) { return (s.workouts || []).reduce((a, w) => a + volumeOf(w), 0); }
function sessionSets(s) { return (s.workouts || []).reduce((a, w) => a + (w.sets || 0), 0); }
function sessionBodyParts(s) {
    const set = new Set();
    (s.workouts || []).forEach(w => (w.bodyParts || []).forEach(p => set.add(p)));
    return BODY_PARTS.filter(p => set.has(p));
}
// 세션의 총 운동 시간: 저장값 우선, 없으면 시작~종료로 계산
function sessionDuration(s) {
    if (s.durationMin != null) return s.durationMin;
    return spanMinutes(s.startTime, s.endTime);
}
// 같은 날짜 내 세션 순서: sortOrder → 시작시각 → id
function cmpSessionInDay(a, b) {
    const sa = a.sortOrder == null ? 1e9 : a.sortOrder;
    const sb = b.sortOrder == null ? 1e9 : b.sortOrder;
    if (sa !== sb) return sa - sb;
    const ta = a.startTime || '99:99', tb = b.startTime || '99:99';
    if (ta !== tb) return ta < tb ? -1 : 1;
    return (Number(a.id) || 0) - (Number(b.id) || 0);
}
function sessionsByDate(date) { return state.sessions.filter(s => s.date === date).slice().sort(cmpSessionInDay); }
// 전체 세션을 시간순(날짜 → 세션 순서)으로
function orderedSessions() {
    return state.sessions.slice().sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return cmpSessionInDay(a, b);
    });
}
function workoutsOfDate(date) { return sessionsByDate(date).reduce((acc, s) => acc.concat(s.workouts || []), []); }
function dayBodyParts(date) {
    const set = new Set();
    workoutsOfDate(date).forEach(w => (w.bodyParts || []).forEach(p => set.add(p)));
    return BODY_PARTS.filter(p => set.has(p));
}
function volumeOfDate(date) { return sessionsByDate(date).reduce((a, s) => a + sessionVolume(s), 0); }
function setsOfDate(date) { return sessionsByDate(date).reduce((a, s) => a + sessionSets(s), 0); }
function durationOfDate(date) {
    const list = sessionsByDate(date).map(sessionDuration).filter(v => v != null);
    return list.length ? list.reduce((a, b) => a + b, 0) : null;
}
// 하루 평균 컨디션 (기록된 세션만)
function conditionOfDate(date) {
    const list = sessionsByDate(date).map(s => s.condition).filter(v => v != null);
    if (!list.length) return null;
    return Math.round(list.reduce((a, b) => a + b, 0) / list.length);
}
function totalWorkoutCount() { return state.sessions.reduce((a, s) => a + (s.workouts || []).length, 0); }
// [E] edit by smsong

// [B] edit by smsong : 종목별 "세션" 상세 집계 (최고무게 / 총횟수 / 총세트 / 볼륨)
//   날짜가 아닌 실제 운동 기록(세션) 단위로 비교 → 하루 2회 운동해도 각각 비교된다.
function exerciseSessionStats(exercise) {
    const out = [];
    orderedSessions().forEach(s => {
        const ws = (s.workouts || []).filter(w => w.exercise === exercise);
        if (!ws.length) return;
        let top = 0, reps = 0, sets = 0, vol = 0;
        ws.forEach(w => {
            top = Math.max(top, w.weight || 0);
            reps += (w.reps || 0) * (w.sets || 0);   // 총 반복수 = 횟수 × 세트
            sets += (w.sets || 0);
            vol += volumeOf(w);
        });
        out.push({ id: s.id, date: s.date, startTime: s.startTime, topWeight: top, totalReps: reps, totalSets: sets, volume: vol });
    });
    return out;
}
// 특정 종목 · 특정 세션의 "직전 세션" 볼륨 (없으면 null)
function prevExerciseVolume(exercise, sessionId) {
    const st = exerciseSessionStats(exercise);
    const i = st.findIndex(x => String(x.id) === String(sessionId));
    if (i > 0) return st[i - 1].volume;
    if (i === 0) return null;                                   // 이 종목의 첫 세션
    return st.length ? st[st.length - 1].volume : null;         // 아직 저장 안 된 초안 → 최근 세션과 비교
}
// [E] edit by smsong

// 등락 칩 HTML (증가=빨강 ▲, 감소=파랑 ▼, 유지=–, 최초=NEW)
function deltaChip(cur, prev, unit) {
    unit = unit || '';
    if (prev == null) return `<span class="delta new">NEW</span>`;
    const d = Math.round((cur - prev) * 10) / 10;
    if (d > 0) return `<span class="delta up"><span class="arw">▲</span>${d}${unit}</span>`;
    if (d < 0) return `<span class="delta down"><span class="arw">▼</span>${Math.abs(d)}${unit}</span>`;
    return `<span class="delta flat">– 유지</span>`;
}

function mealsByDate(date) { return state.meals.filter(m => m.date === date); }
function kcalOfDate(date) { return mealsByDate(date).reduce((s, m) => s + (m.kcal || 0), 0); }

// ============================================================
//  렌더링
// ============================================================
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// [B] edit by smsong : 차트 색을 CSS 변수에서 읽어 테마에 따라 자동 전환
function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
}
// [E] edit by smsong

function render() {
    // [B] edit by smsong : 이름이 없으면 인사말 자체를 숨김 ('회원' 같은 기본값 사용 안 함)
    const nm = state.profile.name || '';
    const hello = document.getElementById('hdrHello');
    document.getElementById('hdrName').textContent = nm;
    if (hello) hello.style.display = nm ? '' : 'none';
    // [E] edit by smsong
    document.getElementById('hdrDate').textContent = fmtHeaderDate();
    renderHome();
    renderWorkout();
    renderDiet();
    renderChange();
    renderProfile();
}

// ---------- 홈 ----------
function renderHome() {
    const t = todayStr();
    const vol = volumeOfDate(t), sets = setsOfDate(t), kcal = kcalOfDate(t);
    // [B] edit by smsong : 오늘 운동 시간/컨디션 요약 추가
    const dur = durationOfDate(t), cond = conditionOfDate(t);
    // [E] edit by smsong

    // 관심종목형 성장 리스트: 종목별 최근 세션 + 직전 세션 대비 등락
    const rows = state.exercises.map(ex => {
        const ss = exerciseSessionStats(ex);
        if (!ss.length) return null;
        const last = ss[ss.length - 1];
        const prev = ss.length > 1 ? ss[ss.length - 2].volume : null;
        return { ex, date: last.date, volume: last.volume, prev };
    }).filter(Boolean).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);

    const todayMeals = mealsByDate(t);

    let html = `
    <div class="section">
        <div class="stat-grid">
            <div class="stat-card">
                <div class="ico">${icon('dumbbell')}</div>
                <div class="val tabnum">${vol}<span class="unit">kg</span></div>
                <div class="lbl">오늘 볼륨</div>
            </div>
            <div class="stat-card">
                <div class="ico">${icon('layers')}</div>
                <div class="val tabnum">${sets}<span class="unit">세트</span></div>
                <div class="lbl">오늘 세트</div>
            </div>
            <div class="stat-card">
                <div class="ico">${icon('flame')}</div>
                <div class="val tabnum">${kcal}<span class="unit">kcal</span></div>
                <div class="lbl">오늘 섭취</div>
            </div>
        </div>
    </div>`;

    // [B] edit by smsong : 오늘의 운동 기록(세션) 요약 — 시간/컨디션이 한눈에
    html += `
    <div class="section">
        <div class="section-head">
            <h2>오늘 운동</h2>
            <span class="sub">${dur != null ? '총 ' + fmtDur(dur) : '기록 없음'}${cond != null ? ' · 컨디션 ' + cond : ''}</span>
        </div>`;
    const todaySessions = sessionsByDate(t);
    if (todaySessions.length) {
        html += `<div class="sess-list">${todaySessions.map(s => sessionCardHtml(s, false)).join('')}</div>`;
    } else {
        html += `<div class="card">${emptyBlock('dumbbell', '오늘 운동 기록이 없어요', '운동 탭에서 오늘의 기록을 시작하세요')}</div>`;
    }
    html += `</div>`;
    // [E] edit by smsong

    html += `
    <div class="section">
        <div class="section-head">
            <h2>최근 성장</h2>
            <span class="sub">직전 세션 대비 볼륨</span>
        </div>
        <div class="card">`;

    if (rows.length) {
        html += rows.map(r => `
            <div class="watch-row">
                <div class="wr-mid">
                    <div class="wr-name">${esc(r.ex)}</div>
                    <div class="wr-sub">최근 ${fmtKorean(r.date)}</div>
                </div>
                <div class="wr-vol">
                    <div class="v tabnum">${r.volume}<span class="u"> kg</span></div>
                    <div style="margin-top:4px">${deltaChip(r.volume, r.prev, 'kg')}</div>
                </div>
            </div>`).join('');
    } else {
        html += emptyBlock('dumbbell', '아직 운동 기록이 없어요', '운동 탭에서 첫 기록을 남겨보세요');
    }
    html += `</div></div>`;

    // 오늘 식단
    html += `
    <div class="section">
        <div class="section-head">
            <h2>오늘 식단</h2>
            <span class="sub tabnum">${todayMeals.length}개 · ${kcal} kcal</span>
        </div>
        <div class="card">`;
    if (todayMeals.length) {
        html += todayMeals.map(m => `
            <div class="watch-row">
                <div class="wr-mid">
                    <div class="wr-name">${mealBadge(m.mealType)} ${esc(m.name)}</div>
                </div>
                <div class="wr-vol"><div class="v tabnum">${m.kcal}<span class="u"> kcal</span></div></div>
            </div>`).join('');
    } else {
        html += emptyBlock('utensils', '오늘 식단 기록이 없어요', '식단 탭에서 오늘 먹은 음식을 기록하세요');
    }
    html += `</div></div>`;

    document.getElementById('view-home').innerHTML = html;
}

// ---------- 운동 ----------
function renderWorkout() {
    let html = `
    <div class="view-title">운동 기록</div>
    <div class="view-desc">날짜 안에 운동 기록을 만들고, 그 안에 운동을 담아 관리해요. 하루에 여러 번 기록할 수 있어요.</div>
    <div class="section-head">
        <div class="seg" id="workoutSeg">
            <button data-v="calendar" class="${ui.workoutView === 'calendar' ? 'active' : ''}">달력</button>
            <button data-v="list" class="${ui.workoutView === 'list' ? 'active' : ''}">목록</button>
        </div>
        <button class="icon-btn" id="addSessionBtn">${icon('plus')} 기록</button>
    </div>`;

    html += ui.workoutView === 'calendar' ? workoutCalendarHtml() : workoutListHtml();
    document.getElementById('view-workout').innerHTML = html;

    // 이벤트
    document.getElementById('addSessionBtn').onclick =
        () => openSessionEditor(null, ui.workoutView === 'calendar' ? ui.workoutSel : todayStr());
    document.querySelectorAll('#workoutSeg button').forEach(b => b.onclick = () => { ui.workoutView = b.dataset.v; renderWorkout(); });
    bindCalendar('workout');
    wireReorder();   // [B][E] edit by smsong : 세션 드래그 순서 변경 활성화
}

// [B] edit by smsong : 날짜별 운동 기록(세션) 목록에 드래그 순서 변경 연결(서버 저장 → 기기 간 동기화)
function wireReorder() {
    document.querySelectorAll('#view-workout .reorder-list[data-reorder-date]').forEach(list => {
        enableDragReorder(list, ids => commitReorder(list.dataset.reorderDate, ids));
    });
}

// 드래그로 만든 순서를 서버에 저장. 성공 시 sortOrder 를 응답값으로 갱신,
// 실패 시 서버 기준으로 되돌리기 위해 다시 렌더.
async function commitReorder(date, ids) {
    try {
        const updated = await api.reorderSessions(date, ids.map(Number));
        const orderMap = {};
        (updated || []).forEach(d => { orderMap[String(d.id)] = d.sortOrder; });
        state.sessions.forEach(s => {
            if (orderMap[String(s.id)] != null) s.sortOrder = orderMap[String(s.id)];
        });
        toast('순서를 저장했어요');
    } catch (err) {
        toast(errMsg(err, '순서 저장에 실패했어요'));
        renderWorkout();   // 낙관적 DOM 변경을 서버 기준으로 되돌림
    }
}

// 포인터 기반 드래그 순서 변경 (모바일 터치 + 마우스 공통).
// 대상 행을 position:fixed 로 띄우고, 같은 높이의 자리표시자로 슬롯을 유지하며 이동.
// onCommit(ids) 은 서버 저장(세션 목록) 또는 로컬 배열 정렬(시트 안 운동 목록)에 쓰인다.
function enableDragReorder(listEl, onCommit) {
    listEl.querySelectorAll('.drag-handle').forEach(handle => {
        handle.addEventListener('pointerdown', onDown);
    });

    function onDown(e) {
        if (e.button != null && e.button > 0) return;   // 좌클릭/터치만
        const row = e.target.closest('[data-reorder-id]');
        if (!row) return;
        e.preventDefault();
        e.stopPropagation();

        const handle = e.currentTarget;
        const pointerId = e.pointerId;
        const rect = row.getBoundingClientRect();
        const grabOffset = e.clientY - rect.top;

        // 슬롯 유지용 자리표시자
        const ph = document.createElement('div');
        ph.className = 'rec-placeholder';
        ph.style.height = rect.height + 'px';
        row.parentNode.insertBefore(ph, row.nextSibling);

        // 대상 행을 화면에 고정
        row.classList.add('dragging');
        row.style.position = 'fixed';
        row.style.left = rect.left + 'px';
        row.style.top = rect.top + 'px';
        row.style.width = rect.width + 'px';
        row.style.margin = '0';

        try { handle.setPointerCapture(pointerId); } catch (_) {}

        function onMove(ev) {
            row.style.top = (ev.clientY - grabOffset) + 'px';
            const others = [].slice.call(listEl.querySelectorAll('[data-reorder-id]')).filter(x => x !== row);
            let placed = false;
            for (let i = 0; i < others.length; i++) {
                const r = others[i].getBoundingClientRect();
                if (ev.clientY < r.top + r.height / 2) { listEl.insertBefore(ph, others[i]); placed = true; break; }
            }
            if (!placed) listEl.appendChild(ph);
        }

        function onUp() {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            try { handle.releasePointerCapture(pointerId); } catch (_) {}
            // 원상 복구 + 자리표시자 위치에 삽입
            row.classList.remove('dragging');
            row.style.position = ''; row.style.left = ''; row.style.top = ''; row.style.width = ''; row.style.margin = '';
            listEl.insertBefore(row, ph);
            ph.remove();
            const ids = [].slice.call(listEl.querySelectorAll('[data-reorder-id]')).map(x => x.dataset.reorderId);
            onCommit(ids);
        }

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
    }
}

// 달력 셀: 세션 수만큼 점(최대 3개) → 하루에 여러 번 운동한 날이 구분된다
function workoutCalendarHtml() {
    const cal = calendarGrid(ui.workoutCal, ui.workoutSel, date => {
        const n = sessionsByDate(date).length;
        if (!n) return '';
        const dots = Math.min(n, 3);
        let s = '<span class="dots">';
        for (let i = 0; i < dots; i++) s += '<i class="dot"></i>';
        s += '</span>';
        return s;
    }, date => sessionsByDate(date).length > 0);

    const sel = ui.workoutSel;
    const list = sessionsByDate(sel);
    const dur = durationOfDate(sel);

    let detail = `<div class="cal-day-detail">
        <div class="day-head">
            <div class="d-date">${fmtKorean(sel)}</div>
            <div class="d-sum tabnum">${list.length ? `기록 ${list.length} · 볼륨 ${volumeOfDate(sel)} kg${dur != null ? ' · ' + fmtDur(dur) : ''}` : ''}</div>
        </div>`;
    const parts = dayBodyParts(sel);
    if (parts.length) detail += `<div class="day-parts">부위 · ${parts.join(' · ')}</div>`;
    detail += list.length
        ? `<div class="sess-list reorder-list" data-reorder-date="${sel}">${list.map(s => sessionCardHtml(s, true)).join('')}</div>`
        : emptyBlock('dumbbell', '이 날은 기록이 없어요', '＋ 기록 버튼으로 운동 기록을 만드세요');
    detail += `</div>`;

    return `<div class="card">${cal}</div>${detail}`;
}

function workoutListHtml() {
    const dates = [...new Set(state.sessions.map(s => s.date))].sort((a, b) => a < b ? 1 : -1);
    if (!dates.length) return emptyBlock('dumbbell', '아직 운동 기록이 없어요', '오른쪽 위 ＋ 기록으로 시작하세요');
    return dates.map(date => {
        const parts = dayBodyParts(date);
        const dur = durationOfDate(date);
        return `
        <div class="day-group">
            <div class="day-head">
                <div class="d-date">${fmtKorean(date)}</div>
                <div class="d-sum tabnum">기록 ${sessionsByDate(date).length} · 볼륨 ${volumeOfDate(date)} kg${dur != null ? ' · ' + fmtDur(dur) : ''}</div>
            </div>
            ${parts.length ? `<div class="day-parts">부위 · ${parts.join(' · ')}</div>` : ''}
            <div class="sess-list reorder-list" data-reorder-date="${date}">
                ${sessionsByDate(date).map(s => sessionCardHtml(s, true)).join('')}
            </div>
        </div>`;
    }).join('');
}

// 운동 기록(세션) 카드. 탭하면 상세 시트가 아래에서 위로 올라온다.
function sessionCardHtml(s, draggable) {
    const vol = sessionVolume(s);
    const dur = sessionDuration(s);
    const parts = sessionBodyParts(s);
    const n = (s.workouts || []).length;
    const c = s.condition;
    return `
    <div class="sess" data-reorder-id="${s.id}" data-open-session="${s.id}">
        ${draggable ? `<div class="drag-handle" title="드래그하여 순서 변경">${icon('grip')}</div>` : ''}
        <div class="sess-main">
            <div class="sess-top">
                <span class="sess-time tabnum">${icon('clock')}${esc(fmtTimeRange(s))}</span>
                ${dur != null ? `<span class="sess-dur tabnum">${fmtDur(dur)}</span>` : ''}
            </div>
            ${s.title ? `<div class="sess-title">${esc(s.title)}</div>` : ''}
            ${parts.length ? `<div class="sess-parts">${parts.map(p => `<span class="bp">${esc(p)}</span>`).join('')}</div>` : ''}
            <div class="cond-line">
                <span class="cond-cap">컨디션</span>
                <span class="cond-bar"><i style="width:${c == null ? 0 : c}%;background:${condColor(c)}"></i></span>
                <span class="cond-num tabnum" style="color:${condColor(c)}">${c == null ? '—' : c}</span>
            </div>
        </div>
        <div class="sess-right">
            <div class="sess-vol tabnum">${vol}<span class="u"> kg</span></div>
            <div class="sess-cnt tabnum">운동 ${n}</div>
            <span class="sess-chev">${icon('chevR')}</span>
        </div>
    </div>`;
}

// 세션 안의 운동 한 줄 (상세 시트 내부에서 사용)
function workoutRowHtml(w, sessionId, k) {
    const vol = volumeOf(w);
    const prev = prevExerciseVolume(w.exercise, sessionId);
    const weightTxt = w.bodyweight ? '맨몸' : `${w.weight}kg`;
    const tags = (w.bodyParts || []).map(p => `<span class="bp">${esc(p)}</span>`);
    if (w.bodyweight) tags.push(`<span class="bw">맨몸</span>`);
    return `
    <div class="rec" data-reorder-id="${k}">
        <div class="drag-handle" title="드래그하여 순서 변경">${icon('grip')}</div>
        <div class="rec-main">
            <div class="rec-title">${esc(w.exercise)} ${deltaChip(vol, prev, 'kg')}</div>
            <div class="rec-detail tabnum">${weightTxt} × ${w.reps}회 × ${w.sets}세트${w.memo ? ' · ' + esc(w.memo) : ''}</div>
            ${tags.length ? `<div class="rec-tags">${tags.join('')}</div>` : ''}
        </div>
        <div class="rec-right">
            <div class="rec-vol tabnum">${vol}<span class="u"> kg</span></div>
            <div class="rec-acts">
                <button class="rec-del" data-edit-w="${k}" title="수정">${icon('pencil')}</button>
                <button class="rec-del" data-rm-w="${k}" title="삭제">${icon('trash')}</button>
            </div>
        </div>
    </div>`;
}
// [E] edit by smsong

// ---------- 식단 ----------
function renderDiet() {
    let html = `
    <div class="view-title">식단 기록</div>
    <div class="view-desc">끼니별로 먹은 음식과 칼로리를 기록하세요.</div>
    <div class="section-head">
        <div class="seg" id="dietSeg">
            <button data-v="calendar" class="${ui.dietView === 'calendar' ? 'active' : ''}">달력</button>
            <button data-v="list" class="${ui.dietView === 'list' ? 'active' : ''}">목록</button>
        </div>
        <button class="icon-btn" id="addMealBtn">${icon('plus')} 기록</button>
    </div>`;

    html += ui.dietView === 'calendar' ? dietCalendarHtml() : dietListHtml();
    document.getElementById('view-diet').innerHTML = html;

    document.getElementById('addMealBtn').onclick = () => openMealSheet(ui.dietView === 'calendar' ? ui.dietSel : todayStr());
    document.querySelectorAll('#dietSeg button').forEach(b => b.onclick = () => { ui.dietView = b.dataset.v; renderDiet(); });
    bindCalendar('diet');
}

function dietCalendarHtml() {
    const cal = calendarGrid(ui.dietCal, ui.dietSel, date => {
        const k = kcalOfDate(date);
        return k > 0 ? `<span class="kcal-tag tabnum">${k}</span>` : '';
    }, date => kcalOfDate(date) > 0);

    let detail = `<div class="cal-day-detail">
        <div class="day-head"><div class="d-date">${fmtKorean(ui.dietSel)}</div>
        <div class="d-sum tabnum">${kcalOfDate(ui.dietSel)} kcal</div></div>`;
    const recs = mealsByDate(ui.dietSel);
    detail += recs.length ? recs.map(m => mealRecHtml(m)).join('') :
        emptyBlock('utensils', '이 날은 기록이 없어요', '＋ 기록 버튼으로 추가하세요');
    detail += `</div>`;
    return `<div class="card">${cal}</div>${detail}`;
}

function dietListHtml() {
    const dates = [...new Set(state.meals.map(m => m.date))].sort((a, b) => a < b ? 1 : -1);
    if (!dates.length) return emptyBlock('utensils', '아직 식단 기록이 없어요', '오른쪽 위 ＋ 기록으로 시작하세요');
    return dates.map(date => `
        <div class="day-group">
            <div class="day-head">
                <div class="d-date">${fmtKorean(date)}</div>
                <div class="d-sum tabnum">${kcalOfDate(date)} kcal</div>
            </div>
            ${mealsByDate(date).map(m => mealRecHtml(m)).join('')}
        </div>`).join('');
}

function mealRecHtml(m) {
    return `
    <div class="rec">
        <div class="rec-main">
            <div class="rec-title">${mealBadge(m.mealType)} ${esc(m.name)}</div>
            ${(m.carb || m.protein || m.fat) ? `<div class="rec-detail tabnum">탄 ${m.carb}g · 단 ${m.protein}g · 지 ${m.fat}g</div>` : ''}
        </div>
        <div class="rec-right">
            <div class="rec-vol tabnum">${m.kcal}<span class="u"> kcal</span></div>
            <button class="rec-del" data-del-meal="${m.id}">${icon('trash')}</button>
        </div>
    </div>`;
}

function mealBadge(key) {
    const t = MEAL_TYPES.find(x => x.key === key) || { key: 'snack', label: '기타' };
    return `<span class="meal-badge ${t.key}">${t.label}</span>`;
}

// ---------- 변화(그래프) ----------
function renderChange() {
    // [B] edit by smsong : 차트 색상 = 테마 변수
    const C_VOL = cssVar('--chart-volume', '#38bdf8');
    const C_WEIGHT = cssVar('--chart-weight', '#2dd4a0');
    const C_KCAL = cssVar('--chart-kcal', '#fbbf24');
    const C_TARGET = cssVar('--chart-target', '#ff5a6a');
    const C_COND = cssVar('--chart-cond', '#8b5cf6');
    // [E] edit by smsong

    // 종목 셀렉트 (볼륨 추이)
    const exsWithData = state.exercises.filter(ex => exerciseSessionStats(ex).length);
    if (!ui.changeExercise || !exsWithData.includes(ui.changeExercise)) ui.changeExercise = exsWithData[0] || null;

    let html = `
    <div class="view-title">변화</div>
    <div class="view-desc">기록이 쌓일수록 그래프가 선명해져요.</div>`;

    // 1) 종목별 성장 분석 : 직전 세션 대비 무게·횟수·세트·볼륨 등락(상승=빨강/하락=파랑) + 추이 그래프
    html += `<div class="section">
        <div class="section-head"><h2>종목별 성장 분석</h2></div>
        <div class="card">`;
    if (exsWithData.length) {
        html += `<select class="select-pill" id="changeExSelect" style="margin-bottom:14px;width:100%">
            ${exsWithData.map(ex => `<option value="${esc(ex)}" ${ex === ui.changeExercise ? 'selected' : ''}>${esc(ex)}</option>`).join('')}
        </select>`;

        const stats = exerciseSessionStats(ui.changeExercise);
        const last = stats[stats.length - 1];
        const prev = stats.length > 1 ? stats[stats.length - 2] : null;

        html += `<div class="cmp-meta">최근 ${fmtKorean(last.date)}${last.startTime ? ' ' + last.startTime : ''}${prev ? ` · 직전(${fmtKorean(prev.date)}${prev.startTime ? ' ' + prev.startTime : ''}) 대비` : ' · 첫 기록'}</div>`;
        html += `<div class="cmp-list">
            <div class="cmp-row"><span class="cmp-k">최고 무게</span><div class="cmp-right"><span class="cmp-v tabnum">${last.topWeight}kg</span>${deltaChip(last.topWeight, prev ? prev.topWeight : null, 'kg')}</div></div>
            <div class="cmp-row"><span class="cmp-k">총 횟수</span><div class="cmp-right"><span class="cmp-v tabnum">${last.totalReps}회</span>${deltaChip(last.totalReps, prev ? prev.totalReps : null, '회')}</div></div>
            <div class="cmp-row"><span class="cmp-k">총 세트</span><div class="cmp-right"><span class="cmp-v tabnum">${last.totalSets}세트</span>${deltaChip(last.totalSets, prev ? prev.totalSets : null, '세트')}</div></div>
            <div class="cmp-row"><span class="cmp-k">총 볼륨</span><div class="cmp-right"><span class="cmp-v tabnum">${last.volume}kg</span>${deltaChip(last.volume, prev ? prev.volume : null, 'kg')}</div></div>
        </div>`;

        // 최고 무게 추이
        html += `<div class="chart-sub-title" style="margin-top:18px">최고 무게 추이</div>`;
        html += lineChart(stats.map(s => ({ label: labelMd(s.date), value: s.topWeight })), { color: C_WEIGHT, unit: 'kg' });
        // 볼륨 추이
        html += `<div class="chart-sub-title" style="margin-top:18px">볼륨 추이</div>`;
        html += lineChart(stats.map(s => ({ label: labelMd(s.date), value: s.volume })), { color: C_VOL, unit: 'kg' });
        html += chartLegend([[C_WEIGHT, '최고 무게 (kg)'], [C_VOL, '볼륨 (kg)']]);
    } else {
        html += emptyBlock('chart', '표시할 운동 데이터가 없어요', '운동을 기록하면 성장 분석이 표시돼요');
    }
    html += `</div></div>`;

    // [B] edit by smsong : 2) 컨디션 · 운동 시간 추이 (세션 구조에서 새로 생긴 지표)
    html += `<div class="section">
        <div class="section-head"><h2>컨디션 · 운동 시간</h2><span class="sub">최근 기록순</span></div>
        <div class="card">`;
    const condSeries = orderedSessions().filter(s => s.condition != null).slice(-14);
    const durSeries = orderedSessions().filter(s => sessionDuration(s) != null).slice(-14);
    if (condSeries.length) {
        html += `<div class="chart-sub-title">컨디션 (0~100)</div>`;
        html += lineChart(condSeries.map(s => ({ label: labelMd(s.date), value: s.condition })), { color: C_COND, unit: '', fixedMin: 0, fixedMax: 100 });
    }
    if (durSeries.length) {
        html += `<div class="chart-sub-title" style="margin-top:18px">운동 시간 (분)</div>`;
        html += lineChart(durSeries.map(s => ({ label: labelMd(s.date), value: sessionDuration(s) })), { color: C_VOL, unit: '분' });
    }
    if (condSeries.length || durSeries.length) {
        html += chartLegend([[C_COND, '컨디션'], [C_VOL, '운동 시간 (분)']]);
    } else {
        html += emptyBlock('chart', '컨디션·시간 데이터가 없어요', '운동 기록에 시간과 컨디션을 남겨보세요');
    }
    html += `</div></div>`;
    // [E] edit by smsong

    // 3) 체중 변화
    html += `<div class="section">
        <div class="section-head"><h2>체중 변화</h2>${state.profile.targetWeight ? `<span class="sub">목표 ${state.profile.targetWeight}kg</span>` : ''}</div>
        <div class="card">`;
    const bl = state.bodyLogs.slice().sort((a, b) => a.date < b.date ? -1 : 1);
    if (bl.length) {
        html += lineChart(bl.map(b => ({ label: labelMd(b.date), value: b.weight })), { color: C_WEIGHT, unit: 'kg', target: state.profile.targetWeight, targetColor: C_TARGET });
        html += chartLegend([[C_WEIGHT, '체중 (kg)']].concat(state.profile.targetWeight ? [[C_TARGET, '목표']] : []));
        html += `<button class="btn sm block" id="addBodyBtn" style="margin-top:14px">오늘 체중 기록</button>`;
    } else {
        html += emptyBlock('chart', '체중 기록이 없어요', '아래 버튼으로 오늘 체중을 남겨보세요');
        html += `<button class="btn grad block" id="addBodyBtn" style="margin-top:14px">오늘 체중 기록</button>`;
    }
    html += `</div></div>`;

    // 4) 칼로리 추이 (최근 14일)
    html += `<div class="section">
        <div class="section-head"><h2>칼로리 추이</h2><span class="sub">최근 14일</span></div>
        <div class="card">`;
    const days = [];
    for (let i = 13; i >= 0; i--) days.push(shiftDays(-i));
    const kcalPoints = days.map(d => ({ label: labelMd(d), value: kcalOfDate(d) }));
    if (kcalPoints.some(p => p.value > 0)) {
        html += lineChart(kcalPoints, { color: C_KCAL, unit: 'kcal', everyLabel: 3 });
        html += chartLegend([[C_KCAL, '섭취 칼로리 (kcal)']]);
    } else {
        html += emptyBlock('chart', '식단 데이터가 없어요', '식단을 기록하면 칼로리 추이가 그려져요');
    }
    html += `</div></div>`;

    document.getElementById('view-change').innerHTML = html;

    const sel = document.getElementById('changeExSelect');
    if (sel) sel.onchange = () => { ui.changeExercise = sel.value; renderChange(); };
    const bb = document.getElementById('addBodyBtn');
    if (bb) bb.onclick = openBodySheet;
}

function labelMd(s) { const d = parseDate(s); return `${d.getMonth() + 1}/${d.getDate()}`; }

// ---------- 내 정보 ----------
function renderProfile() {
    const p = state.profile;
    // [B] edit by smsong : 통계 기준을 세션 구조에 맞춰 변경
    const totalSessions = state.sessions.length;
    const totalWorkouts = totalWorkoutCount();
    // [E] edit by smsong
    const lastWeight = state.bodyLogs.length ? state.bodyLogs.slice().sort((a, b) => a.date < b.date ? 1 : -1)[0].weight : null;

    // [B] edit by smsong : 이름/이메일 기본 문구 제거 — 값이 없으면 표시하지 않음
    const nm = p.name || '';
    const em = p.email || '';
    document.getElementById('view-profile').innerHTML = `
    <div class="view-title">내 정보</div>
    <div class="view-desc">프로필과 앱 설정을 관리해요.</div>

    ${(nm || em) ? `<div class="profile-top">
        <div class="pt-txt">
            ${nm ? `<div class="pt-name">${esc(nm)}</div>` : ''}
            ${em ? `<div class="pt-email">${esc(em)}</div>` : ''}
        </div>
    </div>` : ''}

    <div class="section">
        <div class="section-head"><h2>신체 정보</h2><button class="btn sm" id="editBodyBtn">수정</button></div>
        <div class="card">
            <div class="kv"><span class="k">키</span><span class="v tabnum">${p.height ? p.height + ' cm' : '—'}</span></div>
            <div class="kv"><span class="k">현재 체중</span><span class="v tabnum">${lastWeight != null ? lastWeight + ' kg' : '—'}</span></div>
            <div class="kv"><span class="k">목표 체중</span><span class="v tabnum">${p.targetWeight ? p.targetWeight + ' kg' : '—'}</span></div>
        </div>
    </div>

    <div class="section">
        <div class="section-head"><h2>기록 통계</h2></div>
        <div class="stat-grid">
            <div class="stat-card"><div class="val tabnum">${totalSessions}</div><div class="lbl">운동 기록</div></div>
            <div class="stat-card"><div class="val tabnum">${totalWorkouts}</div><div class="lbl">누적 운동</div></div>
            <div class="stat-card"><div class="val tabnum">${state.exercises.length}</div><div class="lbl">등록 종목</div></div>
        </div>
    </div>

    <div class="section">
        <div class="card menu-card">
            <button class="menu-item" id="profileSetBtn">
                <span class="mi-ico">${icon('user')}</span>
                <span class="mi-label">프로필 설정</span>
                <span class="mi-chev">${icon('chevR')}</span>
            </button>
            <button class="menu-item" id="settingsBtn">
                <span class="mi-ico">${icon('gear')}</span>
                <span class="mi-label">설정</span>
                <span class="mi-chev">${icon('chevR')}</span>
            </button>
        </div>
    </div>

    <div class="section">
        <div class="card">
            <button class="btn block" id="logoutBtn">로그아웃</button>
        </div>
    </div>`;

    document.getElementById('editBodyBtn').onclick = openProfileSheet;
    document.getElementById('profileSetBtn').onclick = openProfileSheet;
    document.getElementById('settingsBtn').onclick = openSettingsSheet;
    // [B] edit by smsong : 세션 정리는 auth.js 로 일원화
    document.getElementById('logoutBtn').onclick = () => Auth.logout();
    // [E] edit by smsong
}

// ============================================================
//  달력
// ============================================================
function calendarGrid(cal, selDate, cellExtra, hasFn) {
    const { y, m } = cal;
    const first = new Date(y, m, 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const today = todayStr();

    let cells = '';
    // 요일 헤더
    WEEKDAYS.forEach((d, i) => {
        cells += `<div class="cal-dow ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${d}</div>`;
    });
    // 앞 공백
    for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell empty"></div>`;
    // 날짜
    for (let d = 1; d <= daysInMonth; d++) {
        const ds = `${y}-${pad(m + 1)}-${pad(d)}`;
        const cls = ['cal-cell'];
        if (hasFn && hasFn(ds)) cls.push('has');
        if (ds === today) cls.push('today');
        if (ds === selDate) cls.push('selected');
        cells += `<div class="${cls.join(' ')}" data-date="${ds}">
            <span class="dnum">${d}</span>${cellExtra ? cellExtra(ds) : ''}
        </div>`;
    }

    return `
    <div class="cal-head">
        <div class="cal-title tabnum">${y}년 ${m + 1}월</div>
        <div class="cal-nav">
            <button data-cal-prev>${icon('chevL')}</button>
            <button data-cal-today>${icon('dot')}</button>
            <button data-cal-next>${icon('chevR')}</button>
        </div>
    </div>
    <div class="cal-grid">${cells}</div>`;
}

function bindCalendar(kind) {
    const root = document.getElementById(kind === 'workout' ? 'view-workout' : 'view-diet');
    const calState = kind === 'workout' ? ui.workoutCal : ui.dietCal;
    const rerender = kind === 'workout' ? renderWorkout : renderDiet;

    const prev = root.querySelector('[data-cal-prev]');
    const next = root.querySelector('[data-cal-next]');
    const todayBtn = root.querySelector('[data-cal-today]');
    if (prev) prev.onclick = () => { calState.m--; if (calState.m < 0) { calState.m = 11; calState.y--; } rerender(); };
    if (next) next.onclick = () => { calState.m++; if (calState.m > 11) { calState.m = 0; calState.y++; } rerender(); };
    if (todayBtn) todayBtn.onclick = () => {
        const d = new Date(); calState.y = d.getFullYear(); calState.m = d.getMonth();
        if (kind === 'workout') ui.workoutSel = todayStr(); else ui.dietSel = todayStr();
        rerender();
    };
    root.querySelectorAll('.cal-cell[data-date]').forEach(c => c.onclick = () => {
        if (kind === 'workout') ui.workoutSel = c.dataset.date; else ui.dietSel = c.dataset.date;
        rerender();
    });
}

// ============================================================
//  SVG 라인 차트 (의존성 없음)
// ============================================================
function lineChart(points, opts) {
    opts = opts || {};
    const W = 320, H = 170, padL = 8, padR = 8, padT = 14, padB = 26;
    if (!points || points.length === 0) return emptyBlock('chart', '데이터가 없어요', '');
    if (points.length === 1) {
        return `<div style="text-align:center;padding:26px 0;color:var(--text-dim)">
            <div style="font-size:26px;font-weight:800" class="tabnum">${points[0].value}${opts.unit || ''}</div>
            <div style="font-size:12px;margin-top:6px">데이터가 2개 이상이면 추이 그래프가 그려져요</div></div>`;
    }

    const vals = points.map(p => p.value);
    let min = Math.min(...vals), max = Math.max(...vals);
    if (opts.target != null) { min = Math.min(min, opts.target); max = Math.max(max, opts.target); }
    // [B] edit by smsong : 컨디션처럼 눈금이 고정된 지표용 (0~100 축 고정)
    if (opts.fixedMin != null) min = opts.fixedMin;
    if (opts.fixedMax != null) max = opts.fixedMax;
    // [E] edit by smsong
    if (min === max) { min -= 1; max += 1; }
    const range = max - min || 1;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const x = i => padL + (innerW * i) / (points.length - 1);
    const y = v => padT + innerH - ((v - min) / range) * innerH;

    const color = opts.color || cssVar('--chart-volume', '#38bdf8');
    const gid = 'g' + Math.random().toString(36).slice(2, 7);

    let path = '', area = '';
    points.forEach((p, i) => {
        const cmd = i === 0 ? 'M' : 'L';
        path += `${cmd}${x(i).toFixed(1)} ${y(p.value).toFixed(1)} `;
    });
    area = path + `L${x(points.length - 1).toFixed(1)} ${padT + innerH} L${x(0).toFixed(1)} ${padT + innerH} Z`;

    // 목표선
    let targetLine = '';
    if (opts.target != null) {
        const ty = y(opts.target).toFixed(1);
        const tc = opts.targetColor || cssVar('--chart-target', '#ff5a6a');
        targetLine = `<line x1="${padL}" y1="${ty}" x2="${W - padR}" y2="${ty}" stroke="${tc}" stroke-width="1.2" stroke-dasharray="4 4" opacity="0.7"/>`;
    }

    // 점 + 값
    let dots = '';
    points.forEach((p, i) => {
        dots += `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.2" fill="${color}"/>`;
    });
    // 마지막 값 라벨
    const li = points.length - 1;
    dots += `<text x="${x(li).toFixed(1)}" y="${(y(points[li].value) - 8).toFixed(1)}" text-anchor="end" fill="${color}" font-size="11" font-weight="700">${points[li].value}${opts.unit || ''}</text>`;

    // x축 라벨 — [B] edit by smsong : 테마 변수 사용(style 로 지정해야 var() 가 안전하게 적용됨)
    const every = opts.everyLabel || Math.ceil(points.length / 6);
    let labels = '';
    points.forEach((p, i) => {
        if (i % every === 0 || i === points.length - 1) {
            labels += `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" style="fill:var(--text-mute)" font-size="9.5">${p.label}</text>`;
        }
    });
    // [E] edit by smsong

    return `<div class="chart-wrap"><svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity="0.28"/>
            <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient></defs>
        ${targetLine}
        <path d="${area}" fill="url(#${gid})"/>
        <path d="${path}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        ${dots}${labels}
    </svg></div>`;
}

function chartLegend(items) {
    return `<div class="chart-legend">${items.map(([c, l]) => `<span class="lg"><i style="background:${c}"></i>${l}</span>`).join('')}</div>`;
}

// ============================================================
//  [B] edit by smsong — 바텀시트 (네이버 지도앱식 3단 스냅)
//    1차 full   : 전체 화면
//    2차 half   : 화면의 2/3만 걸침 (기본 열림 단계)
//    3차 closed : 완전히 내림
//  · .sheet 자체를 화면 높이로 두고 translateY 로 단계를 표현한다.
//  · 그립/헤더 영역은 항상 드래그, 본문은 스크롤 최상단에서 아래로 당길 때만 드래그.
//  · 놓았을 때 이동 속도(플링)가 빠르면 다음 단계로, 아니면 가장 가까운 단계로 스냅.
// ============================================================
const sheet = document.getElementById('sheet');
const backdrop = document.getElementById('sheetBackdrop');

const HALF_RATIO = 0.34;      // 아래로 34% 내림 → 화면의 약 2/3 노출
const FLING_V = 0.55;         // px/ms 이상이면 플링으로 간주
const SNAP_ORDER = ['full', 'half', 'closed'];

let sheetSnap = 'closed';
let sheetY = 0;
let sheetCloseTimer = null;

function sheetH() { return sheet.offsetHeight || window.innerHeight; }
function snapPoints() {
    const h = sheetH();
    return { full: 0, half: Math.round(h * HALF_RATIO), closed: h };
}
function nearestSnap(y) {
    const p = snapPoints();
    let best = 'half', bestD = Infinity;
    SNAP_ORDER.forEach(k => {
        const d = Math.abs(p[k] - y);
        if (d < bestD) { bestD = d; best = k; }
    });
    return best;
}
function applyY(y) {
    sheetY = y;
    sheet.style.transform = `translateX(-50%) translateY(${y}px)`;
}
function setSnap(name, animate) {
    const p = snapPoints();
    if (p[name] == null) name = 'half';
    sheetSnap = name;
    sheet.classList.toggle('dragging', animate === false);
    sheet.classList.toggle('full', name === 'full');
    sheet.classList.toggle('open', name !== 'closed');
    backdrop.classList.toggle('open', name !== 'closed');
    applyY(p[name]);
    if (animate === false) requestAnimationFrame(() => sheet.classList.remove('dragging'));
}

function openSheet(html, opts) {
    opts = opts || {};
    clearTimeout(sheetCloseTimer);
    sheet.innerHTML = `
        <div class="sheet-drag" id="sheetDrag">
            <div class="sheet-grip"></div>
            ${opts.title ? `<h3>${opts.title}</h3>` : ''}
            ${opts.desc ? `<div class="sheet-desc">${opts.desc}</div>` : ''}
        </div>
        <div class="sheet-body" id="sheetBody">${html}</div>`;

    // 닫힘 위치에서 시작 → 다음 프레임에 목표 단계로 애니메이션
    sheet.classList.remove('full');
    applyY(snapPoints().closed);
    backdrop.classList.add('open');
    requestAnimationFrame(() => setSnap(opts.snap || 'half', true));
    wireSheetDrag();
}
function closeSheet() {
    setSnap('closed', true);
    clearTimeout(sheetCloseTimer);
    sheetCloseTimer = setTimeout(() => { if (sheetSnap === 'closed') sheet.innerHTML = ''; }, 380);
}
backdrop.onclick = closeSheet;
window.addEventListener('resize', () => { if (sheetSnap !== 'closed') setSnap(sheetSnap, false); });

// 드래그 배선 — openSheet 로 내용이 바뀔 때마다 다시 건다
function wireSheetDrag() {
    const dragArea = document.getElementById('sheetDrag');
    const body = document.getElementById('sheetBody');
    if (dragArea) dragArea.addEventListener('pointerdown', e => startDrag(e, false));
    if (body) body.addEventListener('pointerdown', e => startDrag(e, true));
}

function startDrag(e, fromBody) {
    if (e.button != null && e.button > 0) return;
    // 슬라이더/입력/버튼 위에서 시작한 제스처는 시트 드래그로 가로채지 않는다
    if (e.target.closest('input, select, textarea, button, .drag-handle')) return;

    const body = document.getElementById('sheetBody');
    const startY = e.clientY;
    const baseY = sheetY;
    let dragging = !fromBody;      // 헤더에서 시작하면 즉시 드래그
    let lastY = startY, lastT = performance.now(), vel = 0;

    if (dragging) sheet.classList.add('dragging');

    function onMove(ev) {
        const dy = ev.clientY - startY;

        if (!dragging) {
            // 본문에서 시작한 경우: 최상단에서 아래로 당길 때만 시트 드래그로 전환
            if (dy > 8 && body && body.scrollTop <= 0) {
                dragging = true;
                sheet.classList.add('dragging');
                body.classList.add('no-scroll');
            } else if (Math.abs(dy) > 8) {
                cleanup();   // 일반 스크롤 → 시트 드래그 포기
                return;
            } else {
                return;
            }
        }

        const now = performance.now();
        const dt = now - lastT;
        if (dt > 0) vel = (ev.clientY - lastY) / dt;
        lastY = ev.clientY; lastT = now;

        const p = snapPoints();
        let y = baseY + dy;
        if (y < p.full) y = p.full + (y - p.full) * 0.25;   // 최상단 저항(고무줄)
        if (y > p.closed) y = p.closed;
        applyY(y);
        ev.preventDefault();
    }

    function onUp() {
        if (!dragging) { cleanup(); return; }
        sheet.classList.remove('dragging');
        if (body) body.classList.remove('no-scroll');

        let target;
        if (Math.abs(vel) >= FLING_V) {
            // 플링: 속도 방향으로 한 단계 이동
            const cur = SNAP_ORDER.indexOf(nearestSnap(sheetY));
            const next = vel > 0 ? Math.min(cur + 1, SNAP_ORDER.length - 1) : Math.max(cur - 1, 0);
            target = SNAP_ORDER[next];
        } else {
            target = nearestSnap(sheetY);
        }
        if (target === 'closed') closeSheet(); else setSnap(target, true);
        cleanup();
    }

    function cleanup() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        if (body) body.classList.remove('no-scroll');
    }

    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
}
// [E] edit by smsong

// ============================================================
//  [B] edit by smsong — 운동 기록(세션) 에디터
//    · 신규 생성과 상세 보기/수정을 하나의 시트로 통합
//    · 시트 안에서 운동을 여러 개 먼저 만들어 두고(초안) '저장'에 한 번에 반영
//    · 저장 시 서버가 workouts 배열을 id 기준으로 동기화(추가/수정/삭제)
// ============================================================
function openSessionEditor(sessionId, date) {
    const existing = sessionId ? state.sessions.find(s => String(s.id) === String(sessionId)) : null;

    // 초안(draft): 저장 전까지 화면에서만 존재. 기존 기록은 깊은 복사로 원본 보호.
    const draft = existing ? JSON.parse(JSON.stringify(existing)) : {
        id: null, date: date || todayStr(),
        startTime: '', endTime: '', durationMin: null,
        condition: DEFAULT_CONDITION, title: '', memo: '', workouts: []
    };
    // 로컬 키(_k): 아직 서버 id 가 없는 운동도 목록에서 식별/정렬하기 위함
    draft.workouts = (draft.workouts || []).map(w => Object.assign({}, w, { _k: localKey(w) }));

    let editKey = null;             // 수정 중인 운동의 _k (null = 추가 모드)
    const selectedParts = new Set();

    openSheet(editorBodyHtml(), {
        title: existing ? '운동 기록 상세' : '운동 기록 추가',
        desc: existing ? '시간·컨디션과 운동 목록을 관리해요.' : '먼저 시간·컨디션을 정하고, 운동을 여러 개 담아 저장하세요.',
        snap: 'half'
    });

    bindEditor();
    paintList();

    // ---------- HTML ----------
    function editorBodyHtml() {
        return `
        <div class="field"><label>날짜</label><input class="input" id="seDate" type="date" value="${draft.date}"></div>

        <div class="field-row">
            <div class="field"><label>시작 시간</label><input class="input" id="seStart" type="time" value="${draft.startTime}"></div>
            <div class="field"><label>종료 시간</label><input class="input" id="seEnd" type="time" value="${draft.endTime}"></div>
            <div class="field"><label>총 시간(분)</label><input class="input" id="seDur" type="number" inputmode="numeric" placeholder="자동" value="${draft.durationMin == null ? '' : draft.durationMin}"></div>
        </div>
        <div class="hint" id="seDurHint"></div>

        <div class="field cond-field">
            <label>컨디션 <span class="cond-chip" id="seCondLbl">${condLabel(draft.condition)}</span></label>
            <div class="cond-wrap">
                <input type="range" class="cond-range" id="seCond" min="0" max="100" step="1" value="${draft.condition == null ? DEFAULT_CONDITION : draft.condition}">
                <div class="cond-big tabnum" id="seCondVal">${draft.condition == null ? DEFAULT_CONDITION : draft.condition}</div>
            </div>
            <div class="cond-scale"><span>0 · 최악</span><span>50 · 보통</span><span>100 · 최상</span></div>
        </div>

        <div class="field"><label>기록 이름 (선택)</label><input class="input" id="seTitle" value="${esc(draft.title)}" placeholder="예: 오전 운동, 저녁 하체"></div>
        <div class="field"><label>메모 (선택)</label><input class="input" id="seMemo" value="${esc(draft.memo)}" placeholder="그립, 통증, 특이사항 등"></div>

        <div class="se-head">
            <h4>운동 <span class="cnt tabnum" id="seCount">0</span></h4>
            <button class="btn sm ex-btn toggle" id="seAddToggle" type="button">＋ 운동</button>
        </div>

        <div class="se-form-wrap" id="seFormWrap">
            <div class="se-form">
                <div class="field">
                    <label>운동 종목</label>
                    <div class="exercise-picker">
                        <select class="select" id="wExercise">${exOptionsHtml('')}</select>
                        <button class="btn sm ex-btn toggle" id="wAddEx" type="button">＋ 종목</button>
                    </div>
                    <div class="ex-new-wrap" id="wNewExWrap">
                        <div class="exercise-picker">
                            <input class="input" id="wNewEx" placeholder="새 종목 이름 (예: 인클라인 벤치)">
                            <button class="btn sm grad ex-btn" id="wNewExSave" type="button">추가</button>
                        </div>
                    </div>
                </div>

                <div class="field">
                    <label>운동 부위 (여러 개 선택 가능)</label>
                    <div class="chip-row" id="wParts">${BODY_PARTS.map(p => `<button class="chip sm" data-bp="${esc(p)}" type="button">${esc(p)}</button>`).join('')}</div>
                </div>

                <label class="check-row">
                    <input type="checkbox" id="wBodyweight">
                    <span class="box">${icon('check')}</span>
                    <span>맨몸 운동 (무게 0kg 고정)</span>
                </label>

                <div class="field-row">
                    <div class="field"><label>무게 (kg)</label><input class="input" id="wWeight" type="number" inputmode="decimal" placeholder="100"></div>
                    <div class="field"><label>횟수 (회)</label><input class="input" id="wReps" type="number" inputmode="numeric" placeholder="5"></div>
                    <div class="field"><label>세트</label><input class="input" id="wSets" type="number" inputmode="numeric" placeholder="1" value="1"></div>
                </div>
                <div class="field"><label>운동 메모 (선택)</label><input class="input" id="wMemo" placeholder="그립, 템포 등"></div>
                <div class="field-row">
                    <button class="btn grad" id="wApply" style="flex:1" type="button">목록에 추가</button>
                    <button class="btn" id="wCancel" style="flex:0 0 92px" type="button">취소</button>
                </div>
            </div>
        </div>

        <div class="reorder-list se-list" id="seList"></div>

        <div class="se-actions">
            <button class="btn grad block" id="seSave">${existing ? '변경사항 저장' : '운동 기록 저장'}</button>
            ${existing ? `<button class="btn danger block" id="seDel" style="margin-top:8px">이 운동 기록 삭제</button>` : ''}
        </div>`;
    }

    function exOptionsHtml(selectedName) {
        if (!state.exercises.length) return `<option value="" disabled selected>종목을 추가하세요</option>`;
        return state.exercises.map(e => `<option value="${esc(e)}" ${e === selectedName ? 'selected' : ''}>${esc(e)}</option>`).join('');
    }

    function localKey(w) {
        return w.id != null ? 'i' + w.id : 'n' + uid();
    }

    // ---------- 목록 그리기 ----------
    function paintList() {
        const el = document.getElementById('seList');
        if (!el) return;
        el.innerHTML = draft.workouts.length
            ? draft.workouts.map(w => workoutRowHtml(w, draft.id, w._k)).join('')
            : `<div class="se-empty">아직 담은 운동이 없어요. ‘＋ 운동’으로 추가하세요.</div>`;
        document.getElementById('seCount').textContent = draft.workouts.length;

        // 목록 내 드래그 정렬(로컬 배열만 재정렬 → 저장 시 서버 반영)
        enableDragReorder(el, keys => {
            const map = {};
            draft.workouts.forEach(w => { map[w._k] = w; });
            draft.workouts = keys.map(k => map[k]).filter(Boolean);
        });

        el.querySelectorAll('[data-rm-w]').forEach(b => b.onclick = ev => {
            ev.stopPropagation();
            const k = b.dataset.rmW;
            draft.workouts = draft.workouts.filter(w => w._k !== k);
            if (editKey === k) { editKey = null; resetForm(); }
            paintList();
        });
        el.querySelectorAll('[data-edit-w]').forEach(b => b.onclick = ev => {
            ev.stopPropagation();
            loadIntoForm(b.dataset.editW);
        });
    }

    // ---------- 폼 제어 ----------
    function openForm(open) {
        const wrap = document.getElementById('seFormWrap');
        const btn = document.getElementById('seAddToggle');
        wrap.classList.toggle('open', open);
        btn.classList.toggle('open', open);
        btn.textContent = open ? '－ 닫기' : '＋ 운동';
        if (open) wrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    function resetForm() {
        editKey = null;
        selectedParts.clear();
        document.querySelectorAll('#wParts .chip').forEach(c => c.classList.remove('active'));
        const bw = document.getElementById('wBodyweight');
        bw.checked = false;
        const ww = document.getElementById('wWeight');
        ww.disabled = false; ww.value = '';
        document.getElementById('wReps').value = '';
        document.getElementById('wSets').value = '1';
        document.getElementById('wMemo').value = '';
        document.getElementById('wApply').textContent = '목록에 추가';
    }
    function loadIntoForm(k) {
        const w = draft.workouts.find(x => x._k === k);
        if (!w) return;
        editKey = k;
        const sel = document.getElementById('wExercise');
        sel.innerHTML = exOptionsHtml(w.exercise);
        selectedParts.clear();
        (w.bodyParts || []).forEach(p => selectedParts.add(p));
        document.querySelectorAll('#wParts .chip').forEach(c => c.classList.toggle('active', selectedParts.has(c.dataset.bp)));
        const bw = document.getElementById('wBodyweight');
        bw.checked = !!w.bodyweight;
        const ww = document.getElementById('wWeight');
        ww.value = w.bodyweight ? '0' : w.weight;
        ww.disabled = !!w.bodyweight;
        document.getElementById('wReps').value = w.reps;
        document.getElementById('wSets').value = w.sets;
        document.getElementById('wMemo').value = w.memo || '';
        document.getElementById('wApply').textContent = '수정 반영';
        openForm(true);
    }

    // 총 시간 힌트 + 자동 계산 (사용자가 직접 입력하면 그 값을 우선)
    function refreshDuration(auto) {
        const st = document.getElementById('seStart').value;
        const en = document.getElementById('seEnd').value;
        const durEl = document.getElementById('seDur');
        const span = spanMinutes(st, en);
        if (auto && span != null) durEl.value = span;
        const hint = document.getElementById('seDurHint');
        if (span != null) {
            hint.textContent = `시작~종료 기준 ${fmtDur(span)}${span !== Number(durEl.value) && durEl.value !== '' ? ' (직접 입력한 값이 우선 저장돼요)' : ''}`;
        } else {
            hint.textContent = '시작·종료를 넣으면 총 시간이 자동 계산돼요. 총 시간만 적어도 괜찮아요.';
        }
    }

    // ---------- 배선 ----------
    function bindEditor() {
        // 컨디션 드래그 슬라이더
        const cond = document.getElementById('seCond');
        const condVal = document.getElementById('seCondVal');
        const condLbl = document.getElementById('seCondLbl');
        const paintCond = () => {
            const v = Number(cond.value);
            condVal.textContent = v;
            condVal.style.color = condColor(v);
            condLbl.textContent = condLabel(v);
            condLbl.style.color = condColor(v);
            cond.style.setProperty('--cond-pct', v + '%');
            cond.style.setProperty('--cond-color', condColor(v));
        };
        cond.addEventListener('input', paintCond);
        paintCond();

        // 시간
        document.getElementById('seStart').addEventListener('change', () => refreshDuration(true));
        document.getElementById('seEnd').addEventListener('change', () => refreshDuration(true));
        document.getElementById('seDur').addEventListener('input', () => refreshDuration(false));
        // 시작 시간이 비어 있으면 현재 시각을 제안(신규만)
        if (!existing && !draft.startTime) document.getElementById('seStart').value = nowTimeStr();
        refreshDuration(false);

        // 운동 폼 토글
        document.getElementById('seAddToggle').onclick = () => {
            const wrap = document.getElementById('seFormWrap');
            const opening = !wrap.classList.contains('open');
            if (opening) resetForm();
            openForm(opening);
        };
        document.getElementById('wCancel').onclick = () => { resetForm(); openForm(false); };

        // 종목 추가 토글
        const newWrap = document.getElementById('wNewExWrap');
        const addExBtn = document.getElementById('wAddEx');
        addExBtn.onclick = () => {
            const opening = !newWrap.classList.contains('open');
            newWrap.classList.toggle('open', opening);
            addExBtn.classList.toggle('open', opening);
            addExBtn.textContent = opening ? '－ 종목' : '＋ 종목';
            if (opening) document.getElementById('wNewEx').focus();
        };
        document.getElementById('wNewExSave').onclick = async () => {
            const name = document.getElementById('wNewEx').value.trim();
            if (!name) return toast('종목 이름을 입력하세요');
            if (state.exercises.includes(name)) { toast('이미 있는 종목이에요'); return; }
            const btn = document.getElementById('wNewExSave'); btn.disabled = true;
            try {
                await addExerciseType(name);
                document.getElementById('wExercise').innerHTML = exOptionsHtml(name);
                document.getElementById('wNewEx').value = '';
                newWrap.classList.remove('open');
                addExBtn.classList.remove('open');
                addExBtn.textContent = '＋ 종목';
                toast(`'${name}' 종목을 추가했어요`);
            } catch (err) { toast(errMsg(err, '종목 추가에 실패했어요')); }
            finally { btn.disabled = false; }
        };

        // 부위 다중 선택
        document.querySelectorAll('#wParts .chip').forEach(c => c.onclick = () => {
            const p = c.dataset.bp;
            if (selectedParts.has(p)) { selectedParts.delete(p); c.classList.remove('active'); }
            else { selectedParts.add(p); c.classList.add('active'); }
        });

        // 맨몸 → 무게 0 고정 + 입력 잠금
        const bwChk = document.getElementById('wBodyweight');
        const wWeight = document.getElementById('wWeight');
        let prevWeight = '';
        bwChk.onchange = () => {
            if (bwChk.checked) { prevWeight = wWeight.value; wWeight.value = '0'; wWeight.disabled = true; }
            else { wWeight.disabled = false; wWeight.value = prevWeight; }
        };

        // 운동 목록에 추가/수정 반영 (아직 서버 저장 아님)
        document.getElementById('wApply').onclick = () => {
            const exercise = document.getElementById('wExercise').value;
            const bodyweight = bwChk.checked;
            const weight = bodyweight ? 0 : parseFloat(wWeight.value);
            const reps = parseInt(document.getElementById('wReps').value, 10);
            const sets = parseInt(document.getElementById('wSets').value, 10);
            if (!exercise) return toast('종목을 선택하세요');
            if (!reps || !sets) return toast('횟수·세트를 입력하세요');
            if (!bodyweight && !weight) return toast('무게를 입력하세요 (맨몸이면 체크)');

            const item = {
                exercise, weight, reps, sets,
                memo: document.getElementById('wMemo').value.trim(),
                bodyParts: BODY_PARTS.filter(p => selectedParts.has(p)),
                bodyweight
            };
            if (editKey) {
                const i = draft.workouts.findIndex(w => w._k === editKey);
                if (i >= 0) draft.workouts[i] = Object.assign({}, draft.workouts[i], item);
                toast('운동을 수정했어요');
            } else {
                draft.workouts.push(Object.assign({ id: null, _k: 'n' + uid() }, item));
                toast('운동을 목록에 담았어요');
            }
            resetForm();
            openForm(false);
            paintList();
        };

        // 저장
        document.getElementById('seSave').onclick = async () => {
            syncMeta();
            if (!draft.date) return toast('날짜를 선택하세요');
            if (!draft.workouts.length) return toast('운동을 1개 이상 담아주세요');
            const btn = document.getElementById('seSave'); btn.disabled = true;
            try {
                const rec = await saveSessionRec(draft);
                ui.workoutSel = rec.date;
                closeSheet(); render();
                toast(existing ? '운동 기록을 수정했어요' : '운동 기록을 저장했어요');
            } catch (err) { btn.disabled = false; toast(errMsg(err, '저장에 실패했어요')); }
        };

        // 삭제
        const delBtn = document.getElementById('seDel');
        if (delBtn) delBtn.onclick = async () => {
            if (!confirm('이 운동 기록을 삭제할까요?\n안에 담긴 운동도 함께 삭제됩니다.')) return;
            delBtn.disabled = true;
            try {
                await delSessionRec(draft.id);
                closeSheet(); render(); toast('운동 기록을 삭제했어요');
            } catch (err) { delBtn.disabled = false; toast(errMsg(err, '삭제에 실패했어요')); }
        };
    }

    // 화면의 메타 입력값을 draft 로 회수
    function syncMeta() {
        draft.date = document.getElementById('seDate').value;
        draft.startTime = document.getElementById('seStart').value || '';
        draft.endTime = document.getElementById('seEnd').value || '';
        const d = document.getElementById('seDur').value;
        draft.durationMin = d === '' ? null : Math.max(0, parseInt(d, 10) || 0);
        draft.condition = Number(document.getElementById('seCond').value);
        draft.title = document.getElementById('seTitle').value.trim();
        draft.memo = document.getElementById('seMemo').value.trim();
    }
}
// [E] edit by smsong

// 식단 입력
function openMealSheet(date) {
    openSheet(`
        <div class="field">
            <label>끼니</label>
            <div class="chip-row" id="mealChips">
                ${MEAL_TYPES.map((t, i) => `<button class="chip ${i === 0 ? 'active' : ''}" data-meal="${t.key}" type="button">${t.label}</button>`).join('')}
            </div>
        </div>
        <div class="field"><label>음식명</label><input class="input" id="mName" placeholder="예: 닭가슴살 도시락"></div>
        <div class="field"><label>칼로리 (kcal)</label><input class="input" id="mKcal" type="number" inputmode="numeric" placeholder="540"></div>
        <div class="field-row">
            <div class="field"><label>탄수 (g)</label><input class="input" id="mCarb" type="number" inputmode="numeric" placeholder="0"></div>
            <div class="field"><label>단백 (g)</label><input class="input" id="mProtein" type="number" inputmode="numeric" placeholder="0"></div>
            <div class="field"><label>지방 (g)</label><input class="input" id="mFat" type="number" inputmode="numeric" placeholder="0"></div>
        </div>
        <div class="field"><label>날짜</label><input class="input" id="mDate" type="date" value="${date}"></div>
        <button class="btn grad block" id="mSave" style="margin-top:6px">기록 저장</button>
    `, { title: '식단 기록', desc: '끼니와 음식, 칼로리를 입력하세요.', snap: 'half' });

    let mealType = 'breakfast';
    document.querySelectorAll('#mealChips .chip').forEach(c => c.onclick = () => {
        document.querySelectorAll('#mealChips .chip').forEach(x => x.classList.remove('active'));
        c.classList.add('active'); mealType = c.dataset.meal;
    });
    document.getElementById('mSave').onclick = async () => {
        const name = document.getElementById('mName').value.trim();
        const kcal = parseInt(document.getElementById('mKcal').value, 10) || 0;
        if (!name) return toast('음식명을 입력하세요');
        const btn = document.getElementById('mSave'); btn.disabled = true;
        try {
            await addMealRec({
                date: document.getElementById('mDate').value, mealType, name, kcal,
                carb: parseInt(document.getElementById('mCarb').value, 10) || 0,
                protein: parseInt(document.getElementById('mProtein').value, 10) || 0,
                fat: parseInt(document.getElementById('mFat').value, 10) || 0
            });
            closeSheet(); render(); toast('식단 기록을 저장했어요');
        } catch (err) { btn.disabled = false; toast(errMsg(err, '저장에 실패했어요')); }
    };
}

// 체중 입력
function openBodySheet() {
    openSheet(`
        <div class="field"><label>체중 (kg)</label><input class="input" id="bWeight" type="number" inputmode="decimal" placeholder="77.6"></div>
        <div class="field"><label>날짜</label><input class="input" id="bDate" type="date" value="${todayStr()}"></div>
        <button class="btn grad block" id="bSave" style="margin-top:6px">저장</button>
    `, { title: '체중 기록', desc: '오늘 체중을 남기면 변화 그래프에 반영돼요.', snap: 'half' });
    document.getElementById('bSave').onclick = () => {
        const weight = parseFloat(document.getElementById('bWeight').value);
        const dt = document.getElementById('bDate').value;
        if (!weight) return toast('체중을 입력하세요');
        const exist = state.bodyLogs.find(b => b.date === dt);
        if (exist) exist.weight = weight; else state.bodyLogs.push({ id: uid(), date: dt, weight });
        persistExtras(); closeSheet(); render(); toast('체중을 기록했어요');
    };
}

// 프로필 설정 (표시 이름 + 신체 정보)
function openProfileSheet() {
    const p = state.profile;
    openSheet(`
        <div class="field"><label>이름</label><input class="input" id="pName" value="${esc(p.name || '')}" placeholder="이름"></div>
        <div class="field-row">
            <div class="field"><label>키 (cm)</label><input class="input" id="pHeight" type="number" inputmode="numeric" value="${p.height || ''}" placeholder="178"></div>
            <div class="field"><label>목표 체중 (kg)</label><input class="input" id="pTarget" type="number" inputmode="decimal" value="${p.targetWeight || ''}" placeholder="74"></div>
        </div>
        <button class="btn grad block" id="pSave" style="margin-top:6px">저장</button>
    `, { title: '프로필 설정', desc: '표시 이름과 신체 정보를 설정하세요.', snap: 'half' });
    document.getElementById('pSave').onclick = () => {
        state.profile.name = document.getElementById('pName').value.trim();
        state.profile.height = parseInt(document.getElementById('pHeight').value, 10) || null;
        state.profile.targetWeight = parseFloat(document.getElementById('pTarget').value) || null;
        // 표시 이름은 로그인 사용자 정보에도 반영(새로고침 후에도 유지)
        try {
            const cu = Auth.getUser() || {};
            cu.name = state.profile.name; localStorage.setItem('currentUser', JSON.stringify(cu));
        } catch (_) {}
        persistExtras(); closeSheet(); render(); toast('프로필을 저장했어요');
    };
}

// 설정 (다크/라이트 테마)
function openSettingsSheet() {
    // [B] edit by smsong : 테마 상태/저장은 theme.js 로 일원화 (선택값은 기기에 계속 남음)
    const cur = window.UpFitTheme ? window.UpFitTheme.current() : 'light';
    openSheet(`
        <div class="field">
            <label>테마</label>
            <div class="seg theme-seg" id="themeSeg">
                <button data-theme="light" class="${cur === 'light' ? 'active' : ''}">라이트</button>
                <button data-theme="dark" class="${cur === 'dark' ? 'active' : ''}">다크</button>
            </div>
        </div>
        <button class="btn block" id="setDone" style="margin-top:6px">완료</button>
    `, { title: '설정', desc: '화면 테마를 선택하세요. 선택한 테마는 이 기기에 계속 유지돼요.', snap: 'half' });
    document.querySelectorAll('#themeSeg button').forEach(b => b.onclick = () => {
        window.UpFitTheme.apply(b.dataset.theme, true);   // persist = true
        document.querySelectorAll('#themeSeg button').forEach(x => x.classList.toggle('active', x === b));
    });
    document.getElementById('setDone').onclick = closeSheet;
    // [E] edit by smsong
}

// ============================================================
//  클릭 위임 (운동 기록 상세 열기 / 식단 삭제)
// ============================================================
document.getElementById('appMain').addEventListener('click', async e => {
    // [B] edit by smsong : 세션 카드 탭 → 상세 시트. 드래그 핸들에서는 열지 않는다.
    const os = e.target.closest('[data-open-session]');
    if (os && !e.target.closest('.drag-handle')) {
        openSessionEditor(os.dataset.openSession, null);
        return;
    }
    // [E] edit by smsong
    const dm = e.target.closest('[data-del-meal]');
    if (dm) {
        if (confirm('이 식단 기록을 삭제할까요?')) {
            try { await delMealRec(dm.dataset.delMeal); render(); toast('삭제했어요'); }
            catch (err) { toast(errMsg(err, '삭제에 실패했어요')); }
        }
    }
});

// ============================================================
//  탭 전환 (현재 탭을 sessionStorage에 저장 → 새로고침해도 유지)
// ============================================================
const TAB_KEY = 'UF_TAB';
function activateTab(tab, remember) {
    const valid = ['home', 'workout', 'diet', 'change', 'profile'];
    if (!valid.includes(tab)) tab = 'home';
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + tab));
    const m = document.getElementById('appMain'); if (m) m.scrollTop = 0;
    if (remember) { try { sessionStorage.setItem(TAB_KEY, tab); } catch (_) {} }
}
document.querySelectorAll('.nav-item').forEach(btn => btn.onclick = () => activateTab(btn.dataset.tab, true));

// ============================================================
//  아이콘 + 유틸
// ============================================================
function icon(name) {
    const s = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
    const map = {
        // [B] edit by smsong : 고정색(#06121f) → currentColor (버튼 글자색 = --on-grad 를 따라감)
        plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
        // [E] edit by smsong
        dumbbell: `<svg viewBox="0 0 24 24" ${s}><path d="M6.5 6.5 17.5 17.5"/><path d="M4 8l-1 1a1.4 1.4 0 0 0 0 2l1 1"/><path d="M8 4 7 5a1.4 1.4 0 0 0 0 2l1 1"/><path d="M20 16l1-1a1.4 1.4 0 0 0 0-2l-1-1"/><path d="M16 20l1-1a1.4 1.4 0 0 0 0-2l-1-1"/></svg>`,
        layers: `<svg viewBox="0 0 24 24" ${s}><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/></svg>`,
        flame: `<svg viewBox="0 0 24 24" ${s}><path d="M12 3c1 3 4 4 4 8a4 4 0 0 1-8 0c0-1 .5-2 1-2.5C9 10 12 9 12 3Z"/></svg>`,
        utensils: `<svg viewBox="0 0 24 24" ${s}><path d="M11 3v18M8 3v6a3 3 0 0 0 3 3"/><path d="M17 3c-1.5 0-2.5 2-2.5 5s1 4 2.5 4 2.5-1 2.5-4-1-5-2.5-5Z"/><path d="M17 12v9"/></svg>`,
        chart: `<svg viewBox="0 0 24 24" ${s}><path d="M3 3v18h18"/><path d="m7 14 3-4 3 3 5-7"/></svg>`,
        trash: `<svg viewBox="0 0 24 24" ${s}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg>`,
        chevL: `<svg viewBox="0 0 24 24" ${s}><path d="m15 18-6-6 6-6"/></svg>`,
        chevR: `<svg viewBox="0 0 24 24" ${s}><path d="m9 18 6-6-6-6"/></svg>`,
        user: `<svg viewBox="0 0 24 24" ${s}><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>`,
        gear: `<svg viewBox="0 0 24 24" ${s}><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/></svg>`,
        dot: `<svg viewBox="0 0 24 24" ${s}><circle cx="12" cy="12" r="3.5"/></svg>`,
        // [B] edit by smsong : 드래그 핸들(점 6개) + 체크 + 시계 + 연필
        grip: `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>`,
        check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 6.5"/></svg>`,
        clock: `<svg viewBox="0 0 24 24" ${s}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>`,
        pencil: `<svg viewBox="0 0 24 24" ${s}><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`
        // [E] edit by smsong
    };
    return map[name] || '';
}

function emptyBlock(ico, title, sub) {
    return `<div class="empty">
        <div class="e-ico">${icon(ico)}</div>
        <div class="e-title">${title}</div>
        ${sub ? `<div class="e-sub">${sub}</div>` : ''}
    </div>`;
}

let toastTimer;
function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ============================================================
//  시작
// ============================================================
// [B] edit by smsong : 테마 변경 시 차트/로고 색을 다시 그림
if (window.UpFitTheme) {
    window.UpFitTheme.onChange(function () { if (state) render(); });
}
// [E] edit by smsong

(async function init() {
    try {
        await load();
    } catch (err) {
        if (err && err.auth) return;    // invalidSession() 이 이미 login.html 로 보냄
        console.error('초기 로드 실패:', err);
        // [B] edit by smsong : 샘플 시드/데모 폴백 없음 — 빈 상태로 표시하고 사유만 안내
        state = blankState();
        applyCurrentUser();
        loadLocalExtras();
        render();
        toast('데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요');
        return;
        // [E] edit by smsong
    }
    render();
    // 새로고침(당겨서 새로고침 포함) 후에도 마지막 탭 유지
    try { activateTab(sessionStorage.getItem(TAB_KEY) || 'home', false); } catch (_) {}
})();

})();
