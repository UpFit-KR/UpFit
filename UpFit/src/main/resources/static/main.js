/* ============================================================
   UpFit — main.js
   ------------------------------------------------------------
   · 5탭(홈/운동/식단/변화/내정보) 단일 페이지
   · 운동: 종목 콤보박스(사용자 추가) + 무게/횟수/세트, 달력·목록 보기
   · 비교: 같은 종목의 직전 세션 대비 볼륨 등락을 증권형으로 표시
             (증가=빨강 ▲ / 감소=파랑 ▼)
   · 데이터: 로그인(토큰+uid) 시 스프링부트 API(/workout, /meal, /exercise)로
     조회·생성·삭제. 토큰이 없으면 로컬 데모(샘플 시드)로 자동 폴백.
     체중·신체정보는 아직 로컬 보관(UF_LOCAL_V1).
   · 테마: 다크(기본)/라이트 — 설정에서 전환, 로고도 라이트 버전으로 교체.
   ============================================================ */

(function () {
'use strict';

// ---------- 상수 ----------
const STORE_KEY = 'UF_STATE_V1';   // (게스트/데모) 로컬 전체 상태
const LOCAL_KEY = 'UF_LOCAL_V1';   // 체중·신체정보 등 백엔드 미연동 항목 (로그인 모드에서도 로컬 보관)
const SEED_FLAG = 'UF_SEEDED_V1';
const THEME_KEY = 'UF_THEME';
const LOGIN_PAGE = 'login.html';
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const MEAL_TYPES = [
    { key: 'breakfast', label: '아침' },
    { key: 'lunch',     label: '점심' },
    { key: 'dinner',    label: '저녁' },
    { key: 'snack',     label: '간식' }
];

// ============================================================
//  백엔드 연동 (운동/식단/종목 — users.id 를 외래키로 사용)
//   · 토큰(accessToken) + uid 가 있으면 실서버 모드,
//     없으면 로컬 데모 모드(샘플 시드)로 자동 폴백.
// ============================================================
const CFG = window.APP_CONFIG || {};
const BACKEND_BASE = CFG.BACKEND_BASE || '';
function getToken() { return localStorage.getItem('accessToken'); }
function getUid() { try { return (JSON.parse(localStorage.getItem('currentUser') || '{}').uid) || ''; } catch (_) { return ''; } }
let API_MODE = !!getToken() && !!getUid();

async function apiReq(method, path, body) {
    const res = await fetch(BACKEND_BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
        body: body != null ? JSON.stringify(body) : undefined
    });
    if (res.status === 401 || res.status === 403) { const e = new Error('AUTH'); e.auth = true; throw e; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
}
const api = {
    listWorkouts:  ()   => apiReq('GET',    `/workout/${getUid()}`),
    addWorkout:    (d)  => apiReq('POST',   `/workout/${getUid()}`, d),
    delWorkout:    (id) => apiReq('DELETE', `/workout/${getUid()}/${id}`),
    listMeals:     ()   => apiReq('GET',    `/meal/${getUid()}`),
    addMeal:       (d)  => apiReq('POST',   `/meal/${getUid()}`, d),
    delMeal:       (id) => apiReq('DELETE', `/meal/${getUid()}/${id}`),
    listExercises: ()   => apiReq('GET',    `/exercise/${getUid()}`),
    addExercise:   (nm) => apiReq('POST',   `/exercise/${getUid()}`, { name: nm }),
    delExercise:   (id) => apiReq('DELETE', `/exercise/${getUid()}/${id}`)
};

// DTO ↔ 화면 레코드 매핑 (서버의 workoutDate/mealDate ↔ 화면의 date)
function fromWorkoutDTO(d) { return { id: d.id, date: d.workoutDate, exercise: d.exercise, weight: d.weight, reps: d.reps, sets: d.sets, memo: d.memo || '' }; }
function toWorkoutDTO(r)   { return { workoutDate: r.date, exercise: r.exercise, weight: r.weight, reps: r.reps, sets: r.sets, memo: r.memo || '' }; }
function fromMealDTO(d)    { return { id: d.id, date: d.mealDate, mealType: d.mealType, name: d.name, kcal: d.kcal, carb: d.carb, protein: d.protein, fat: d.fat }; }
function toMealDTO(r)      { return { mealDate: r.date, mealType: r.mealType, name: r.name, kcal: r.kcal, carb: r.carb, protein: r.protein, fat: r.fat }; }
let exIdByName = {};   // 종목명 → 서버 id (삭제용)

// ---------- 날짜 유틸 ----------
function pad(n) { return String(n).padStart(2, '0'); }
function toDateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayStr() { return toDateStr(new Date()); }
function shiftDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return toDateStr(d); }
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function fmtKorean(s) { const d = parseDate(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`; }
function fmtHeaderDate() { const d = new Date(); return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEKDAYS[d.getDay()]}요일`; }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

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

function blankState() { return { exercises: [], workouts: [], meals: [], bodyLogs: [], profile: {} }; }

// 로그인 사용자 정보(이름/이메일) 반영
function applyCurrentUser() {
    try {
        const cu = JSON.parse(localStorage.getItem('currentUser') || 'null');
        if (cu) {
            state.profile.name = state.profile.name || cu.name || cu.nickname || cu.username;
            state.profile.email = state.profile.email || cu.email;
        }
    } catch (_) {}
    if (!state.profile.name) state.profile.name = '회원';
}

// 체중·신체정보(백엔드 미연동) 로컬 로드/저장
function loadLocalExtras() {
    try {
        const o = JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}');
        state.bodyLogs = o.bodyLogs || [];
        if (o.height != null) state.profile.height = o.height;
        if (o.targetWeight != null) state.profile.targetWeight = o.targetWeight;
    } catch (_) { state.bodyLogs = []; }
}
function saveLocalExtras() {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({
        bodyLogs: state.bodyLogs,
        height: state.profile.height,
        targetWeight: state.profile.targetWeight
    }));
}

// 데모(로컬 전체 상태) 저장
function saveDemo() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

// 메인 로드: 실서버 모드면 백엔드 조회, 아니면 데모
async function load() {
    state = blankState();
    applyCurrentUser();

    if (API_MODE) {
        try {
            const [ws, ms, exs] = await Promise.all([api.listWorkouts(), api.listMeals(), api.listExercises()]);
            state.workouts = (ws || []).map(fromWorkoutDTO);
            state.meals = (ms || []).map(fromMealDTO);
            state.exercises = (exs || []).map(e => e.name);
            exIdByName = {};
            (exs || []).forEach(e => { exIdByName[e.name] = e.id; });
            loadLocalExtras();   // 체중/신체정보는 로컬
            return;
        } catch (err) {
            if (err && err.auth) {   // 토큰 만료 → 로그인으로
                localStorage.removeItem('accessToken');
                window.location.replace(LOGIN_PAGE);
                return;
            }
            console.warn('백엔드 조회 실패 → 로컬 데모로 전환:', err.message);
            API_MODE = false;   // 이후 조작도 로컬로
        }
    }
    // 데모 모드
    try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s) state = s; } catch (_) {}
    state.exercises = state.exercises || [];
    state.workouts = state.workouts || [];
    state.meals = state.meals || [];
    state.bodyLogs = state.bodyLogs || [];
    state.profile = state.profile || {};
    applyCurrentUser();
    seedIfEmpty();
}

// ============================================================
//  데이터 조작 (실서버 ↔ 데모 공통 인터페이스)
// ============================================================
async function addWorkoutRec(rec) {
    if (API_MODE) {
        const dto = await api.addWorkout(toWorkoutDTO(rec));
        state.workouts.push(fromWorkoutDTO(dto));
    } else {
        state.workouts.push(Object.assign({ id: uid() }, rec)); saveDemo();
    }
}
async function delWorkoutRec(id) {
    if (API_MODE) await api.delWorkout(id);
    state.workouts = state.workouts.filter(w => String(w.id) !== String(id));
    if (!API_MODE) saveDemo();
}
async function addMealRec(rec) {
    if (API_MODE) {
        const dto = await api.addMeal(toMealDTO(rec));
        state.meals.push(fromMealDTO(dto));
    } else {
        state.meals.push(Object.assign({ id: uid() }, rec)); saveDemo();
    }
}
async function delMealRec(id) {
    if (API_MODE) await api.delMeal(id);
    state.meals = state.meals.filter(m => String(m.id) !== String(id));
    if (!API_MODE) saveDemo();
}
async function addExerciseType(name) {
    if (API_MODE) {
        const dto = await api.addExercise(name);
        state.exercises.push(dto.name); exIdByName[dto.name] = dto.id;
    } else {
        state.exercises.push(name); saveDemo();
    }
}
// 체중/신체정보(로컬 항목) 저장
function persistExtras() { if (API_MODE) saveLocalExtras(); else saveDemo(); }
// 에러 메시지 표준화
function errMsg(err, fallback) {
    if (err && err.auth) return '로그인이 만료되었어요. 다시 로그인해 주세요';
    return fallback || '문제가 발생했어요';
}

// ---------- 최초 1회 샘플 데이터 ----------
function seedIfEmpty() {
    if (API_MODE) return;                          // 실서버 모드에선 시드하지 않음
    if (localStorage.getItem(SEED_FLAG)) return;
    localStorage.setItem(SEED_FLAG, '1');
    if (state.workouts.length || state.meals.length) return;

    state.exercises = ['벤치프레스', '스쿼트', '데드리프트', '오버헤드프레스', '랫풀다운'];
    const W = (date, exercise, weight, reps, sets) => ({ id: uid(), date, exercise, weight, reps, sets, memo: '' });
    state.workouts = [
        W(shiftDays(-6), '벤치프레스', 100, 5, 1),
        W(shiftDays(-6), '스쿼트', 120, 5, 2),
        W(shiftDays(-4), '벤치프레스', 100, 6, 1),
        W(shiftDays(-4), '오버헤드프레스', 40, 8, 1),
        W(shiftDays(-2), '벤치프레스', 102, 5, 1),
        W(shiftDays(-2), '스쿼트', 125, 5, 2),
        W(shiftDays(-2), '데드리프트', 140, 3, 1),
        W(shiftDays(0),  '벤치프레스', 102, 6, 1),
        W(shiftDays(0),  '랫풀다운', 60, 10, 1)
    ];
    const M = (date, mealType, name, kcal) => ({ id: uid(), date, mealType, name, kcal, carb: 0, protein: 0, fat: 0 });
    state.meals = [
        M(shiftDays(-2), 'breakfast', '오트밀 + 바나나', 320),
        M(shiftDays(-2), 'lunch', '닭가슴살 도시락', 540),
        M(shiftDays(0), 'breakfast', '계란 3개 + 토스트', 320),
        M(shiftDays(0), 'lunch', '소고기 덮밥', 620),
        M(shiftDays(0), 'snack', '프로틴 셰이크', 180)
    ];
    const B = (date, weight) => ({ id: uid(), date, weight });
    state.bodyLogs = [B(shiftDays(-6), 78.5), B(shiftDays(-4), 78.2), B(shiftDays(-2), 77.9), B(shiftDays(0), 77.6)];
    state.profile.height = state.profile.height || 178;
    state.profile.targetWeight = state.profile.targetWeight || 74;
    saveDemo();
}

// ---------- 계산 ----------
function volumeOf(w) { return (w.weight || 0) * (w.reps || 0) * (w.sets || 0); }

// 특정 종목의 일자별 세션 집계 (오름차순)
function exerciseSessions(exercise) {
    const byDate = {};
    state.workouts.filter(w => w.exercise === exercise).forEach(w => {
        if (!byDate[w.date]) byDate[w.date] = { date: w.date, volume: 0, items: [] };
        byDate[w.date].volume += volumeOf(w);
        byDate[w.date].items.push(w);
    });
    return Object.values(byDate).sort((a, b) => a.date < b.date ? -1 : 1);
}

// 특정 종목·날짜의 직전 세션 볼륨 (없으면 null)
function prevSessionVolume(exercise, date) {
    const sessions = exerciseSessions(exercise).filter(s => s.date < date);
    return sessions.length ? sessions[sessions.length - 1].volume : null;
}

// 등락 칩 HTML (증가=빨강 ▲, 감소=파랑 ▼, 유지=–, 최초=NEW)
function deltaChip(cur, prev, unit) {
    unit = unit || '';
    if (prev == null) return `<span class="delta new">NEW</span>`;
    const d = Math.round((cur - prev) * 10) / 10;
    if (d > 0) return `<span class="delta up"><span class="arw">▲</span>${d}${unit}</span>`;
    if (d < 0) return `<span class="delta down"><span class="arw">▼</span>${Math.abs(d)}${unit}</span>`;
    return `<span class="delta flat">– 유지</span>`;
}

function workoutsByDate(date) { return state.workouts.filter(w => w.date === date); }
function mealsByDate(date) { return state.meals.filter(m => m.date === date); }
function kcalOfDate(date) { return mealsByDate(date).reduce((s, m) => s + (m.kcal || 0), 0); }
function volumeOfDate(date) { return workoutsByDate(date).reduce((s, w) => s + volumeOf(w), 0); }
function setsOfDate(date) { return workoutsByDate(date).reduce((s, w) => s + (w.sets || 0), 0); }

// ============================================================
//  렌더링
// ============================================================
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function render() {
    document.getElementById('hdrName').textContent = state.profile.name || '회원';
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

    // 관심종목형 성장 리스트: 종목별 최근 세션 + 직전 대비 등락
    const rows = state.exercises.map(ex => {
        const ss = exerciseSessions(ex);
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
    </div>

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
        <div class="section-head"><h2>오늘 식단</h2><span class="sub">${kcal} kcal</span></div>
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
    <div class="view-desc">종목을 선택하고 무게·횟수·세트를 기록하면 직전 세션과 자동 비교돼요.</div>
    <div class="section-head">
        <div class="seg" id="workoutSeg">
            <button data-v="calendar" class="${ui.workoutView === 'calendar' ? 'active' : ''}">달력</button>
            <button data-v="list" class="${ui.workoutView === 'list' ? 'active' : ''}">목록</button>
        </div>
        <button class="icon-btn" id="addWorkoutBtn">${icon('plus')} 기록</button>
    </div>`;

    html += ui.workoutView === 'calendar' ? workoutCalendarHtml() : workoutListHtml();
    document.getElementById('view-workout').innerHTML = html;

    // 이벤트
    document.getElementById('addWorkoutBtn').onclick = () => openWorkoutSheet(ui.workoutView === 'calendar' ? ui.workoutSel : todayStr());
    document.querySelectorAll('#workoutSeg button').forEach(b => b.onclick = () => { ui.workoutView = b.dataset.v; renderWorkout(); });
    bindCalendar('workout');
}

function workoutCalendarHtml() {
    const cal = calendarGrid(ui.workoutCal, ui.workoutSel, date => {
        const v = volumeOfDate(date);
        return v > 0 ? `<span class="dot"></span>` : '';
    }, date => volumeOfDate(date) > 0);

    let detail = `<div class="cal-day-detail">
        <div class="day-head"><div class="d-date">${fmtKorean(ui.workoutSel)}</div>
        <div class="d-sum tabnum">볼륨 ${volumeOfDate(ui.workoutSel)} kg</div></div>`;
    const recs = workoutsByDate(ui.workoutSel);
    detail += recs.length ? recs.map(w => workoutRecHtml(w)).join('') :
        emptyBlock('dumbbell', '이 날은 기록이 없어요', '＋ 기록 버튼으로 추가하세요');
    detail += `</div>`;

    return `<div class="card">${cal}</div>${detail}`;
}

function workoutListHtml() {
    const dates = [...new Set(state.workouts.map(w => w.date))].sort((a, b) => a < b ? 1 : -1);
    if (!dates.length) return emptyBlock('dumbbell', '아직 운동 기록이 없어요', '오른쪽 위 ＋ 기록으로 시작하세요');
    return dates.map(date => `
        <div class="day-group">
            <div class="day-head">
                <div class="d-date">${fmtKorean(date)}</div>
                <div class="d-sum tabnum">볼륨 ${volumeOfDate(date)} kg</div>
            </div>
            ${workoutsByDate(date).map(w => workoutRecHtml(w)).join('')}
        </div>`).join('');
}

function workoutRecHtml(w) {
    const vol = volumeOf(w);
    const prev = prevSessionVolume(w.exercise, w.date);
    return `
    <div class="rec">
        <div class="rec-main">
            <div class="rec-title">${esc(w.exercise)} ${deltaChip(vol, prev, 'kg')}</div>
            <div class="rec-detail tabnum">${w.weight}kg × ${w.reps}회 × ${w.sets}세트${w.memo ? ' · ' + esc(w.memo) : ''}</div>
        </div>
        <div class="rec-right">
            <div class="rec-vol tabnum">${vol}<span class="u"> kg</span></div>
            <button class="rec-del" data-del-workout="${w.id}">${icon('trash')}</button>
        </div>
    </div>`;
}

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
    // 종목 셀렉트 (볼륨 추이)
    const exsWithData = state.exercises.filter(ex => exerciseSessions(ex).length);
    if (!ui.changeExercise || !exsWithData.includes(ui.changeExercise)) ui.changeExercise = exsWithData[0] || null;

    let html = `
    <div class="view-title">변화</div>
    <div class="view-desc">기록이 쌓일수록 그래프가 선명해져요.</div>`;

    // 1) 종목별 볼륨 추이
    html += `<div class="section">
        <div class="section-head"><h2>종목별 볼륨 추이</h2></div>
        <div class="card">`;
    if (exsWithData.length) {
        html += `<select class="select-pill" id="changeExSelect" style="margin-bottom:14px">
            ${exsWithData.map(ex => `<option value="${esc(ex)}" ${ex === ui.changeExercise ? 'selected' : ''}>${esc(ex)}</option>`).join('')}
        </select>`;
        const ss = exerciseSessions(ui.changeExercise);
        html += lineChart(ss.map(s => ({ label: labelMd(s.date), value: s.volume })), { color: '#38bdf8', unit: 'kg' });
        html += chartLegend([['#38bdf8', '볼륨 (kg)']]);
    } else {
        html += emptyBlock('chart', '표시할 운동 데이터가 없어요', '운동을 2회 이상 기록하면 추이가 그려져요');
    }
    html += `</div></div>`;

    // 2) 체중 변화
    html += `<div class="section">
        <div class="section-head"><h2>체중 변화</h2>${state.profile.targetWeight ? `<span class="sub">목표 ${state.profile.targetWeight}kg</span>` : ''}</div>
        <div class="card">`;
    const bl = state.bodyLogs.slice().sort((a, b) => a.date < b.date ? -1 : 1);
    if (bl.length) {
        html += lineChart(bl.map(b => ({ label: labelMd(b.date), value: b.weight })), { color: '#2dd4a0', unit: 'kg', target: state.profile.targetWeight });
        html += chartLegend([['#2dd4a0', '체중 (kg)']].concat(state.profile.targetWeight ? [['#ff5a6a', '목표']] : []));
        html += `<button class="btn sm block" id="addBodyBtn" style="margin-top:14px">오늘 체중 기록</button>`;
    } else {
        html += emptyBlock('chart', '체중 기록이 없어요', '아래 버튼으로 오늘 체중을 남겨보세요');
        html += `<button class="btn grad block" id="addBodyBtn" style="margin-top:14px">오늘 체중 기록</button>`;
    }
    html += `</div></div>`;

    // 3) 칼로리 추이 (최근 14일)
    html += `<div class="section">
        <div class="section-head"><h2>칼로리 추이</h2><span class="sub">최근 14일</span></div>
        <div class="card">`;
    const days = [];
    for (let i = 13; i >= 0; i--) days.push(shiftDays(-i));
    const kcalPoints = days.map(d => ({ label: labelMd(d), value: kcalOfDate(d) }));
    if (kcalPoints.some(p => p.value > 0)) {
        html += lineChart(kcalPoints, { color: '#fbbf24', unit: 'kcal', everyLabel: 3 });
        html += chartLegend([['#fbbf24', '섭취 칼로리 (kcal)']]);
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
    const totalWorkouts = state.workouts.length;
    const totalMeals = state.meals.length;
    const lastWeight = state.bodyLogs.length ? state.bodyLogs.slice().sort((a, b) => a.date < b.date ? 1 : -1)[0].weight : null;

    document.getElementById('view-profile').innerHTML = `
    <div class="view-title">내 정보</div>
    <div class="profile-top">
        <img id="pfAvatar" src="${logoSrc()}" alt="">
        <div>
            <div class="pt-name">${esc(p.name || '회원')}</div>
            <div class="pt-email">${esc(p.email || '소셜 계정으로 로그인됨')}</div>
        </div>
    </div>

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
            <div class="stat-card"><div class="val tabnum">${totalWorkouts}</div><div class="lbl">운동 기록</div></div>
            <div class="stat-card"><div class="val tabnum">${totalMeals}</div><div class="lbl">식단 기록</div></div>
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
    document.getElementById('logoutBtn').onclick = () => {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('currentUser');
        localStorage.removeItem('auth');
        window.location.replace(LOGIN_PAGE);
    };
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
    if (min === max) { min -= 1; max += 1; }
    const range = max - min || 1;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const x = i => padL + (innerW * i) / (points.length - 1);
    const y = v => padT + innerH - ((v - min) / range) * innerH;

    const color = opts.color || '#38bdf8';
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
        targetLine = `<line x1="${padL}" y1="${ty}" x2="${W - padR}" y2="${ty}" stroke="#ff5a6a" stroke-width="1.2" stroke-dasharray="4 4" opacity="0.7"/>`;
    }

    // 점 + 값
    let dots = '';
    points.forEach((p, i) => {
        dots += `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.2" fill="${color}"/>`;
    });
    // 마지막 값 라벨
    const li = points.length - 1;
    dots += `<text x="${x(li).toFixed(1)}" y="${(y(points[li].value) - 8).toFixed(1)}" text-anchor="end" fill="${color}" font-size="11" font-weight="700">${points[li].value}${opts.unit || ''}</text>`;

    // x축 라벨
    const every = opts.everyLabel || Math.ceil(points.length / 6);
    let labels = '';
    points.forEach((p, i) => {
        if (i % every === 0 || i === points.length - 1) {
            labels += `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="#5f748f" font-size="9.5">${p.label}</text>`;
        }
    });

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
//  바텀시트
// ============================================================
const sheet = document.getElementById('sheet');
const backdrop = document.getElementById('sheetBackdrop');
function openSheet(html) {
    sheet.innerHTML = `<div class="sheet-grip"></div>` + html;
    backdrop.classList.add('open');
    requestAnimationFrame(() => sheet.classList.add('open'));
}
function closeSheet() { sheet.classList.remove('open'); backdrop.classList.remove('open'); }
backdrop.onclick = closeSheet;

// 운동 입력
function openWorkoutSheet(date) {
    const exOptions = state.exercises.length
        ? state.exercises.map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join('')
        : `<option value="" disabled selected>종목을 추가하세요</option>`;

    openSheet(`
        <h3>운동 기록</h3>
        <div class="sheet-desc">종목을 고르고 무게·횟수·세트를 입력하세요.</div>

        <div class="field">
            <label>운동 종목</label>
            <div class="exercise-picker">
                <select class="select" id="wExercise">${exOptions}</select>
                <button class="btn sm" id="wAddEx" type="button">＋ 종목</button>
            </div>
            <div id="wNewExWrap" style="display:none;margin-top:8px">
                <div class="exercise-picker">
                    <input class="input" id="wNewEx" placeholder="새 종목 이름 (예: 인클라인 벤치)">
                    <button class="btn sm grad" id="wNewExSave" type="button">추가</button>
                </div>
            </div>
        </div>

        <div class="field-row">
            <div class="field"><label>무게 (kg)</label><input class="input" id="wWeight" type="number" inputmode="decimal" placeholder="100"></div>
            <div class="field"><label>횟수 (회)</label><input class="input" id="wReps" type="number" inputmode="numeric" placeholder="5"></div>
            <div class="field"><label>세트</label><input class="input" id="wSets" type="number" inputmode="numeric" placeholder="1" value="1"></div>
        </div>
        <div class="field"><label>날짜</label><input class="input" id="wDate" type="date" value="${date}"></div>
        <div class="field"><label>메모 (선택)</label><input class="input" id="wMemo" placeholder="컨디션, 그립 등"></div>

        <button class="btn grad block" id="wSave" style="margin-top:6px">기록 저장</button>
    `);

    const newWrap = document.getElementById('wNewExWrap');
    document.getElementById('wAddEx').onclick = () => {
        newWrap.style.display = newWrap.style.display === 'none' ? 'block' : 'none';
        if (newWrap.style.display === 'block') document.getElementById('wNewEx').focus();
    };
    document.getElementById('wNewExSave').onclick = async () => {
        const name = document.getElementById('wNewEx').value.trim();
        if (!name) return toast('종목 이름을 입력하세요');
        if (state.exercises.includes(name)) { toast('이미 있는 종목이에요'); return; }
        const btn = document.getElementById('wNewExSave'); btn.disabled = true;
        try {
            await addExerciseType(name);
            const sel = document.getElementById('wExercise');
            sel.innerHTML = state.exercises.map(e => `<option value="${esc(e)}" ${e === name ? 'selected' : ''}>${esc(e)}</option>`).join('');
            document.getElementById('wNewEx').value = '';
            newWrap.style.display = 'none';
            toast(`'${name}' 종목을 추가했어요`);
        } catch (err) { toast(errMsg(err, '종목 추가에 실패했어요')); }
        finally { btn.disabled = false; }
    };
    document.getElementById('wSave').onclick = async () => {
        const exercise = document.getElementById('wExercise').value;
        const weight = parseFloat(document.getElementById('wWeight').value);
        const reps = parseInt(document.getElementById('wReps').value, 10);
        const sets = parseInt(document.getElementById('wSets').value, 10);
        const dt = document.getElementById('wDate').value;
        if (!exercise) return toast('종목을 선택하세요');
        if (!weight || !reps || !sets) return toast('무게·횟수·세트를 입력하세요');
        const btn = document.getElementById('wSave'); btn.disabled = true;
        try {
            await addWorkoutRec({ date: dt, exercise, weight, reps, sets, memo: document.getElementById('wMemo').value.trim() });
            closeSheet(); render(); toast('운동 기록을 저장했어요');
        } catch (err) { btn.disabled = false; toast(errMsg(err, '저장에 실패했어요')); }
    };
}

// 식단 입력
function openMealSheet(date) {
    openSheet(`
        <h3>식단 기록</h3>
        <div class="sheet-desc">끼니와 음식, 칼로리를 입력하세요.</div>
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
    `);

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
        <h3>체중 기록</h3>
        <div class="sheet-desc">오늘 체중을 남기면 변화 그래프에 반영돼요.</div>
        <div class="field"><label>체중 (kg)</label><input class="input" id="bWeight" type="number" inputmode="decimal" placeholder="77.6"></div>
        <div class="field"><label>날짜</label><input class="input" id="bDate" type="date" value="${todayStr()}"></div>
        <button class="btn grad block" id="bSave" style="margin-top:6px">저장</button>
    `);
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
        <h3>프로필 설정</h3>
        <div class="sheet-desc">표시 이름과 신체 정보를 설정하세요.</div>
        <div class="field"><label>이름</label><input class="input" id="pName" value="${esc(p.name || '')}" placeholder="이름"></div>
        <div class="field-row">
            <div class="field"><label>키 (cm)</label><input class="input" id="pHeight" type="number" inputmode="numeric" value="${p.height || ''}" placeholder="178"></div>
            <div class="field"><label>목표 체중 (kg)</label><input class="input" id="pTarget" type="number" inputmode="decimal" value="${p.targetWeight || ''}" placeholder="74"></div>
        </div>
        <button class="btn grad block" id="pSave" style="margin-top:6px">저장</button>
    `);
    document.getElementById('pSave').onclick = () => {
        const nm = document.getElementById('pName').value.trim();
        state.profile.name = nm || state.profile.name;
        state.profile.height = parseInt(document.getElementById('pHeight').value, 10) || null;
        state.profile.targetWeight = parseFloat(document.getElementById('pTarget').value) || null;
        // 표시 이름은 로그인 사용자 정보에도 반영(새로고침 후에도 유지)
        try {
            const cu = JSON.parse(localStorage.getItem('currentUser') || '{}');
            cu.name = state.profile.name; localStorage.setItem('currentUser', JSON.stringify(cu));
        } catch (_) {}
        persistExtras(); closeSheet(); render(); toast('프로필을 저장했어요');
    };
}

// 설정 (다크/라이트 테마)
function openSettingsSheet() {
    const cur = currentTheme();
    openSheet(`
        <h3>설정</h3>
        <div class="sheet-desc">화면 테마를 선택하세요.</div>
        <div class="field">
            <label>테마</label>
            <div class="seg theme-seg" id="themeSeg">
                <button data-theme="light" class="${cur === 'light' ? 'active' : ''}">라이트</button>
                <button data-theme="dark" class="${cur === 'dark' ? 'active' : ''}">다크</button>
            </div>
        </div>
        <button class="btn block" id="setDone" style="margin-top:6px">완료</button>
    `);
    document.querySelectorAll('#themeSeg button').forEach(b => b.onclick = () => {
        applyTheme(b.dataset.theme, true);
        document.querySelectorAll('#themeSeg button').forEach(x => x.classList.toggle('active', x === b));
    });
    document.getElementById('setDone').onclick = closeSheet;
}

// ============================================================
//  삭제 위임 (운동/식단)
// ============================================================
document.getElementById('appMain').addEventListener('click', async e => {
    const dw = e.target.closest('[data-del-workout]');
    const dm = e.target.closest('[data-del-meal]');
    if (dw) {
        if (confirm('이 운동 기록을 삭제할까요?')) {
            try { await delWorkoutRec(dw.dataset.delWorkout); render(); toast('삭제했어요'); }
            catch (err) { toast(errMsg(err, '삭제에 실패했어요')); }
        }
    } else if (dm) {
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
        plus: `<svg viewBox="0 0 24 24" fill="none" stroke="#06121f" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
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
        dot: `<svg viewBox="0 0 24 24" ${s}><circle cx="12" cy="12" r="3.5"/></svg>`
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
//  테마 (다크/라이트)
// ============================================================
function currentTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    return (saved === 'light' || saved === 'dark') ? saved : 'dark';   // 기본: 다크(현재 디자인)
}
function logoSrc() { return currentTheme() === 'light' ? 'icons/upfit-light.png' : 'icons/upfit.png'; }
function refreshLogos() {
    const src = logoSrc();
    document.querySelectorAll('.app-header .logo, #pfAvatar').forEach(img => { img.src = src; });
}
function applyTheme(theme, persist) {
    if (theme !== 'light' && theme !== 'dark') theme = 'dark';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#eef2f8' : '#071120');
    if (persist) localStorage.setItem(THEME_KEY, theme);
    refreshLogos();
}

// ============================================================
//  시작
// ============================================================
// 인증 게이트: 토큰이 없으면 게스트(데모)로 둘러보기 허용.
//   ▸ 로그인 강제하려면 아래 주석을 해제하세요.
// if (!getToken()) { window.location.replace(LOGIN_PAGE); }

applyTheme(currentTheme());   // 초기 테마 적용(로고 포함)

(async function init() {
    try {
        await load();
    } catch (err) {
        console.error('초기 로드 실패:', err);
        API_MODE = false;
        state = blankState(); applyCurrentUser(); loadLocalExtras(); seedIfEmpty();
    }
    render();
    // 새로고침(당겨서 새로고침 포함) 후에도 마지막 탭 유지
    try { activateTab(sessionStorage.getItem(TAB_KEY) || 'home', false); } catch (_) {}
})();

})();
