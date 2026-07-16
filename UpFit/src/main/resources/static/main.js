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
     - 흐름: 날짜(세션)를 먼저 생성 → 생성된 세션 안에서 운동을 하나씩 추가/수정/삭제.
       세션 폼(1차 시트)과 운동 폼(2차 시트)은 완전히 분리되어 있다.
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
//   표시 순서 = 가슴/등중앙/광배/어깨(한 줄), 하체/이두/삼두/복근(한 줄). 4열 그리드로 4+4 배치.
//   [B] edit by smsong : '어깨' 종목 추가 (상체 밀기 계열 → 광배 다음, 하체 앞에 배치)
const BODY_PARTS = ['가슴', '등중앙', '광배', '어깨', '하체', '이두', '삼두', '복근'];
//   [E] edit by smsong
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
    // 세션 내부 운동 — 세션이 이미 생성된 뒤에만 사용 (sid = 세션 id)
    addWorkout:      (sid, d)      => apiReq('POST',   `/session/${UID}/${sid}/workout`, d),
    updWorkout:      (sid, wid, d) => apiReq('PUT',    `/session/${UID}/${sid}/workout/${wid}`, d),
    delWorkout:      (sid, wid)    => apiReq('DELETE', `/session/${UID}/${sid}/workout/${wid}`),
    reorderWorkouts: (sid, ids)    => apiReq('PUT',    `/session/${UID}/${sid}/workout/reorder`, ids),
    listMeals:     ()   => apiReq('GET',    `/meal/${UID}`),
    addMeal:       (d)  => apiReq('POST',   `/meal/${UID}`, d),
    delMeal:       (id) => apiReq('DELETE', `/meal/${UID}/${id}`),
    listExercises: ()   => apiReq('GET',    `/exercise/${UID}`),
    addExercise:   (nm) => apiReq('POST',   `/exercise/${UID}`, { name: nm }),
    delExercise:   (id) => apiReq('DELETE', `/exercise/${UID}/${id}`),
    // [B] edit by smsong : 내 정보(신체 정보 포함) 조회/수정 — 키/현재 체중/목표 체중을 DB에 영속화
    getMe:      ()      => apiReq('GET', `/user/uid/${UID}`),
    updateMe:   (dto)   => apiUserUpdate(dto)
    // [E] edit by smsong
};

// [B] edit by smsong : 회원 수정은 multipart(PUT /user) — userData 파트에 JSON 을 실어 보낸다.
//   신체 정보(키/현재 체중/목표 체중)만 바꿔도 다른 필드가 지워지지 않도록,
//   호출부에서 기존 사용자 전체(state.userRaw)에 변경값을 병합해 넘긴다.
async function apiUserUpdate(userDto) {
    const token = Auth.getToken();
    if (!token || Auth.isExpired(token)) { Auth.invalidSession(); const e = new Error('AUTH'); e.auth = true; throw e; }
    const fd = new FormData();
    fd.append('userData', JSON.stringify(userDto));   // @RequestPart("userData") String
    const res = await fetch(BACKEND_BASE + '/user', {
        method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + token },   // Content-Type 은 브라우저가 boundary 와 함께 자동 설정
        body: fd
    });
    if (res.status === 401 || res.status === 403) { Auth.invalidSession(); const e = new Error('AUTH'); e.auth = true; throw e; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
}
// [E] edit by smsong

// ---------- DTO ↔ 화면 레코드 매핑 ----------
function partsToArr(s) { return (s ? String(s).split(',') : []).map(x => x.trim()).filter(Boolean); }

// [B] edit by smsong : 운동 부위(bodyParts)는 운동이 아니라 운동 기록(세션)이 보유한다.
function fromWorkoutDTO(d) {
    return {
        id: d.id, sessionId: d.sessionId,
        exercise: d.exercise, weight: d.weight, reps: d.reps, sets: d.sets,
        memo: d.memo || '', bodyweight: !!d.bodyweight,
        sortOrder: d.sortOrder == null ? null : d.sortOrder
    };
}
function toWorkoutDTO(w) {
    return {
        id: (w.id == null ? null : w.id),     // id 유지 → 서버가 수정/신규를 구분
        exercise: w.exercise, weight: w.weight, reps: w.reps, sets: w.sets,
        memo: w.memo || '', bodyweight: !!w.bodyweight
    };
}
// [E] edit by smsong
// 세션(운동 기록) — 화면 레코드는 sessionDate → date, conditionScore → condition 으로 축약
function fromSessionDTO(d) {
    return {
        id: d.id,
        date: d.sessionDate,
        startTime: d.startTime || '',
        endTime: d.endTime || '',
        durationMin: d.durationMin == null ? null : d.durationMin,
        condition: d.conditionScore == null ? null : d.conditionScore,
        bodyParts: partsToArr(d.bodyParts),   // [B][E] edit by smsong : 부위는 세션 단위
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
        bodyParts: (s.bodyParts || []).join(','),   // [B][E] edit by smsong : 부위는 세션 단위
        title: s.title || null,
        memo: s.memo || ''
        // NOTE: workouts 는 보내지 않는다(null).
        //   세션을 먼저 만들고 → 그 안에서 운동을 개별 API 로 추가/수정/삭제하는 흐름이라
        //   세션 저장은 "메타(날짜/시간/컨디션/부위/메모)"만 다룬다.
        //   서버는 workouts == null 이면 기존 운동 목록을 건드리지 않는다.
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
function blankState() { return { exercises: [], sessions: [], meals: [], bodyLogs: [], profile: {}, userRaw: null }; }
// [E] edit by smsong

// [B] edit by smsong : 로그인 사용자 정보 반영 — 기본값 대체 없음(없으면 빈 값으로 둠)
function applyCurrentUser() {
    const cu = Auth.getUser();
    if (!cu) return;
    state.profile.name = cu.name || cu.nickname || cu.username || '';
    state.profile.email = cu.email || '';
}
// [E] edit by smsong

// [B] edit by smsong : 체중 변화 그래프용 일별 기록(bodyLogs)만 로컬 보관.
//   키/현재 체중/목표 체중은 이제 DB(users)에서 관리하므로 로컬에는 "예전 값 폴백"으로만 남긴다.
//   (DB 값이 아직 비어 있는 기존 사용자를 위해, DB 가 null 일 때만 로컬 값을 채운다.)
function loadLocalExtras() {
    try {
        const o = JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}');
        state.bodyLogs = o.bodyLogs || [];
        if (o.name && !state.profile.name) state.profile.name = o.name;
        if (state.profile.height == null && o.height != null) state.profile.height = o.height;
        if (state.profile.weight == null && o.weight != null) state.profile.weight = o.weight;
        if (state.profile.targetWeight == null && o.targetWeight != null) state.profile.targetWeight = o.targetWeight;
    } catch (_) { state.bodyLogs = []; }
}
// bodyLogs 는 로컬, 신체 정보 값은 폴백용으로만 유지(정본은 DB).
function saveLocalExtras() {
    try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify({
            bodyLogs: state.bodyLogs,
            name: state.profile.name,
            height: state.profile.height,
            weight: state.profile.weight,
            targetWeight: state.profile.targetWeight
        }));
    } catch (_) {}
}
// [E] edit by smsong

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

    // [B] edit by smsong : 내 정보(키/현재 체중/목표 체중)를 DB 에서 로드.
    //   실패해도 앱 전체가 죽지 않도록 개별 try/catch (auth 오류는 apiReq 가 이미 처리).
    try {
        const me = await api.getMe();
        if (me) {
            state.userRaw = me;
            state.profile.name = me.name || me.nickname || state.profile.name || '';
            state.profile.email = me.email || state.profile.email || '';
            if (me.height != null) state.profile.height = me.height;
            if (me.weight != null) state.profile.weight = me.weight;
            if (me.targetWeight != null) state.profile.targetWeight = me.targetWeight;
        }
    } catch (err) { if (err && err.auth) throw err; }
    // [E] edit by smsong

    loadLocalExtras();   // 체중 변화 그래프용 bodyLogs(로컬) + DB 가 비었을 때의 폴백
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
// 세션 내부 운동 — 세션이 이미 존재할 때만 호출된다. 서버 저장 후 로컬 state 동기화.
function sessionById(id) { return state.sessions.find(s => String(s.id) === String(id)); }
async function addWorkoutToSession(sid, item) {
    const dto = await api.addWorkout(sid, toWorkoutDTO(item));
    const s = sessionById(sid);
    if (s) (s.workouts = s.workouts || []).push(fromWorkoutDTO(dto));
}
async function updWorkoutInSession(sid, wid, item) {
    const dto = await api.updWorkout(sid, wid, toWorkoutDTO(item));
    const s = sessionById(sid);
    if (!s) return;
    const i = s.workouts.findIndex(w => String(w.id) === String(wid));
    if (i >= 0) s.workouts[i] = fromWorkoutDTO(dto);
}
async function delWorkoutInSession(sid, wid) {
    await api.delWorkout(sid, wid);
    const s = sessionById(sid);
    if (s) s.workouts = s.workouts.filter(w => String(w.id) !== String(wid));
}
// 세션 내부 운동 순서 저장
async function commitWorkoutOrder(sid, ids) {
    const updated = await api.reorderWorkouts(sid, ids.map(Number));
    const s = sessionById(sid);
    if (!s) return;
    s.workouts = (updated || []).map(fromWorkoutDTO);
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
// 체중 변화 그래프(bodyLogs) 등 로컬 항목 저장
function persistExtras() { saveLocalExtras(); }

// [B] edit by smsong : 신체 정보(키/현재 체중/목표 체중)를 DB 에 저장.
//   기존 사용자 전체(userRaw)에 변경값만 병합해 PUT → 다른 필드(나이/공인중개사 정보 등) 보존.
async function saveBodyInfo(patch) {
    Object.assign(state.profile, patch);   // 화면 즉시 반영
    saveLocalExtras();                     // 로컬 폴백도 갱신
    let base = state.userRaw;
    if (!base) { try { base = await api.getMe(); } catch (_) { base = null; } }
    const dto = Object.assign({}, base || { uid: UID }, {
        uid: UID,
        name: state.profile.name || (base && base.name) || null,
        height: state.profile.height,
        weight: state.profile.weight,
        targetWeight: state.profile.targetWeight
    });
    const saved = await api.updateMe(dto);
    if (saved) state.userRaw = saved;
}

// 현재 체중: DB 값이 우선, 없으면 가장 최근 체중 기록(bodyLog)으로 폴백
function currentWeight() {
    if (state.profile.weight != null) return state.profile.weight;
    if (state.bodyLogs.length) {
        return state.bodyLogs.slice().sort((a, b) => a.date < b.date ? 1 : -1)[0].weight;
    }
    return null;
}
// [E] edit by smsong

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
// 세션이 직접 보유한 부위 (BODY_PARTS 순서 유지)
function sessionBodyParts(s) {
    const set = new Set(s.bodyParts || []);
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
// 하루 부위 요약 = 그날 세션들의 부위 합집합
function dayBodyParts(date) {
    const set = new Set();
    sessionsByDate(date).forEach(s => (s.bodyParts || []).forEach(p => set.add(p)));
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
// [B] edit by smsong : kg <-> lbs 변환 (저장은 항상 kg 기준).
//   소수점은 쓰지 않는다 → 양쪽 모두 정수로 반올림.
//   예) 190lbs → 86kg, 85kg → 187lbs
const LB_PER_KG = 2.2046226218;
function lbsToKg(lbs) { return Math.round(lbs / LB_PER_KG); }
function kgToLbs(kg) { return Math.round(kg * LB_PER_KG); }
// 맨몸 종목 판정: 해당 종목의 모든 운동이 맨몸이면 true → 횟수 그래프로 전환
function exerciseIsBodyweight(exercise) {
    const ws = [];
    orderedSessions().forEach(s => (s.workouts || []).forEach(w => { if (w.exercise === exercise) ws.push(w); }));
    return ws.length > 0 && ws.every(w => w.bodyweight);
}
// [E] edit by smsong

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
    <div class="section-head">
        <div class="seg" id="workoutSeg">
            <button data-v="calendar" class="${ui.workoutView === 'calendar' ? 'active' : ''}">달력</button>
            <button data-v="list" class="${ui.workoutView === 'list' ? 'active' : ''}">목록</button>
        </div>
        <!-- [B] edit by smsong : 선택한 날짜로 붙여넣기/파일 가져오기 -->
        <div class="head-btns">
            <button class="ibtn" id="importBtn" type="button" title="기록 가져오기" aria-label="기록 가져오기">${icon('paste')}</button>
            <button class="ibtn grad" id="addSessionBtn" type="button" title="운동 기록 추가" aria-label="운동 기록 추가">${icon('plus')}</button>
        </div>
        <!-- [E] edit by smsong -->
    </div>`;

    html += ui.workoutView === 'calendar' ? workoutCalendarHtml() : workoutListHtml();
    document.getElementById('view-workout').innerHTML = html;

    // 이벤트
    document.getElementById('addSessionBtn').onclick =
        () => openSessionEditor(null, ui.workoutView === 'calendar' ? ui.workoutSel : todayStr());
    // [B] edit by smsong : 달력에서 고른 날짜가 기본 날짜로 들어간다
    document.getElementById('importBtn').onclick =
        () => openImportSheet(ui.workoutView === 'calendar' ? ui.workoutSel : todayStr());
    // [E] edit by smsong
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

// [B] edit by smsong
// position:fixed 의 기준점 계산.
//   CSS 사양상 transform 이 걸린 조상이 있으면 fixed 요소의 기준(포함 블록)이
//   뷰포트가 아니라 그 조상이 된다. 바텀시트(.sheet)는 translateY 로 단계를 표현하므로
//   시트 안 목록을 드래그할 때 뷰포트 좌표를 그대로 쓰면 위치가 어긋난다.
//   → 가장 가까운 transform 조상의 rect 를 원점으로 되돌려 준다.
function fixedOrigin(el) {
    let n = el.parentElement;
    while (n && n !== document.body && n !== document.documentElement) {
        const cs = getComputedStyle(n);
        if (cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none') {
            const r = n.getBoundingClientRect();
            return { x: r.left, y: r.top };
        }
        n = n.parentElement;
    }
    return { x: 0, y: 0 };
}
// [E] edit by smsong

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
        const org = fixedOrigin(row);   // [B][E] edit by smsong : 시트(transform) 안에서도 좌표가 맞도록

        // 슬롯 유지용 자리표시자
        const ph = document.createElement('div');
        ph.className = 'rec-placeholder';
        ph.style.height = rect.height + 'px';
        row.parentNode.insertBefore(ph, row.nextSibling);

        // 대상 행을 화면에 고정
        row.classList.add('dragging');
        row.style.position = 'fixed';
        row.style.left = (rect.left - org.x) + 'px';
        row.style.top = (rect.top - org.y) + 'px';
        row.style.width = rect.width + 'px';
        row.style.margin = '0';

        try { handle.setPointerCapture(pointerId); } catch (_) {}

        function onMove(ev) {
            row.style.top = (ev.clientY - grabOffset - org.y) + 'px';
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
    // [B] edit by smsong : 운동한 날은 점 대신 셀 테두리로만 표시(cellExtra=null, hasFn 은 유지)
    const cal = calendarGrid(ui.workoutCal, ui.workoutSel, null,
        date => sessionsByDate(date).length > 0);
    // [E] edit by smsong

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
        : emptyBlock('dumbbell', '이 날은 기록이 없어요', '오른쪽 위 ＋ 버튼으로 운동 기록을 만드세요');
    detail += `</div>`;

    return `<div class="card">${cal}</div>${detail}`;
}

function workoutListHtml() {
    const dates = [...new Set(state.sessions.map(s => s.date))].sort((a, b) => a < b ? 1 : -1);
    if (!dates.length) return emptyBlock('dumbbell', '아직 운동 기록이 없어요', '오른쪽 위 ＋ 버튼으로 시작하세요');
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

// 운동 기록(세션) 카드. 탭하면 상세가 정중앙 모달로 열린다 (전체보기 아이콘으로 확대 가능).
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

// 세션 안의 운동 한 줄 (상세 시트 내부에서 사용).
// 운동은 항상 서버에 저장된 상태이므로 식별자로 w.id 를 그대로 쓴다.
function workoutRowHtml(w, sessionId) {
    const vol = volumeOf(w);
    const prev = prevExerciseVolume(w.exercise, sessionId);
    const weightTxt = w.bodyweight ? '맨몸' : `${w.weight}kg`;
    // 부위 태그는 세션 카드/세션 폼에만 표시 → 운동 행에는 맨몸 표시만 남긴다
    const tags = w.bodyweight ? [`<span class="bw">맨몸</span>`] : [];
    return `
    <div class="rec" data-reorder-id="${w.id}">
        <div class="drag-handle" title="드래그하여 순서 변경">${icon('grip')}</div>
        <div class="rec-main">
            <div class="rec-title">${esc(w.exercise)} ${deltaChip(vol, prev, 'kg')}</div>
            <div class="rec-detail tabnum">${weightTxt} × ${w.reps}회 × ${w.sets}세트${w.memo ? ' · ' + esc(w.memo) : ''}</div>
            ${tags.length ? `<div class="rec-tags">${tags.join('')}</div>` : ''}
        </div>
        <div class="rec-right">
            <div class="rec-vol tabnum">${vol}<span class="u"> kg</span></div>
            <div class="rec-acts">
                <button class="rec-del" data-edit-w="${w.id}" title="수정">${icon('pencil')}</button>
                <button class="rec-del" data-rm-w="${w.id}" title="삭제">${icon('trash')}</button>
            </div>
        </div>
    </div>`;
}
// [E] edit by smsong

// ---------- 식단 ----------
function renderDiet() {
    let html = `
    <div class="section-head">
        <div class="seg" id="dietSeg">
            <button data-v="calendar" class="${ui.dietView === 'calendar' ? 'active' : ''}">달력</button>
            <button data-v="list" class="${ui.dietView === 'list' ? 'active' : ''}">목록</button>
        </div>
        <button class="ibtn grad" id="addMealBtn" type="button" title="식단 기록 추가" aria-label="식단 기록 추가">${icon('plus')}</button>
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
        emptyBlock('utensils', '이 날은 기록이 없어요', '오른쪽 위 ＋ 버튼으로 추가하세요');
    detail += `</div>`;
    return `<div class="card">${cal}</div>${detail}`;
}

function dietListHtml() {
    const dates = [...new Set(state.meals.map(m => m.date))].sort((a, b) => a < b ? 1 : -1);
    if (!dates.length) return emptyBlock('utensils', '아직 식단 기록이 없어요', '오른쪽 위 ＋ 버튼으로 시작하세요');
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

    let html = '';

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
        const isBw = exerciseIsBodyweight(ui.changeExercise);   // [B][E] edit by smsong : 맨몸이면 횟수 중심

        html += `<div class="cmp-meta">최근 ${fmtKorean(last.date)}${last.startTime ? ' ' + last.startTime : ''}${prev ? ` · 직전(${fmtKorean(prev.date)}${prev.startTime ? ' ' + prev.startTime : ''}) 대비` : ' · 첫 기록'}${isBw ? ' · 맨몸' : ''}</div>`;
        // [B] edit by smsong : 맨몸 종목은 무게/볼륨이 항상 0 → 횟수·세트만 비교/추이로 보여준다
        if (isBw) {
            html += `<div class="cmp-list">
                <div class="cmp-row"><span class="cmp-k">총 횟수</span><div class="cmp-right"><span class="cmp-v tabnum">${last.totalReps}회</span>${deltaChip(last.totalReps, prev ? prev.totalReps : null, '회')}</div></div>
                <div class="cmp-row"><span class="cmp-k">총 세트</span><div class="cmp-right"><span class="cmp-v tabnum">${last.totalSets}세트</span>${deltaChip(last.totalSets, prev ? prev.totalSets : null, '세트')}</div></div>
            </div>`;
            html += `<div class="chart-sub-title" style="margin-top:18px">총 횟수 추이</div>`;
            html += lineChart(stats.map(s => ({ label: labelMd(s.date), value: s.totalReps })), { color: C_WEIGHT, unit: '회' });
            html += `<div class="chart-sub-title" style="margin-top:18px">총 세트 추이</div>`;
            html += lineChart(stats.map(s => ({ label: labelMd(s.date), value: s.totalSets })), { color: C_VOL, unit: '세트' });
            html += chartLegend([[C_WEIGHT, '총 횟수 (회)'], [C_VOL, '총 세트']]);
        } else {
            html += `<div class="cmp-list">
                <div class="cmp-row"><span class="cmp-k">최고 무게</span><div class="cmp-right"><span class="cmp-v tabnum">${last.topWeight}kg</span>${deltaChip(last.topWeight, prev ? prev.topWeight : null, 'kg')}</div></div>
                <div class="cmp-row"><span class="cmp-k">총 횟수</span><div class="cmp-right"><span class="cmp-v tabnum">${last.totalReps}회</span>${deltaChip(last.totalReps, prev ? prev.totalReps : null, '회')}</div></div>
                <div class="cmp-row"><span class="cmp-k">총 세트</span><div class="cmp-right"><span class="cmp-v tabnum">${last.totalSets}세트</span>${deltaChip(last.totalSets, prev ? prev.totalSets : null, '세트')}</div></div>
                <div class="cmp-row"><span class="cmp-k">총 볼륨</span><div class="cmp-right"><span class="cmp-v tabnum">${last.volume}kg</span>${deltaChip(last.volume, prev ? prev.volume : null, 'kg')}</div></div>
            </div>`;
            html += `<div class="chart-sub-title" style="margin-top:18px">최고 무게 추이</div>`;
            html += lineChart(stats.map(s => ({ label: labelMd(s.date), value: s.topWeight })), { color: C_WEIGHT, unit: 'kg' });
            html += `<div class="chart-sub-title" style="margin-top:18px">볼륨 추이</div>`;
            html += lineChart(stats.map(s => ({ label: labelMd(s.date), value: s.volume })), { color: C_VOL, unit: 'kg' });
            html += chartLegend([[C_WEIGHT, '최고 무게 (kg)'], [C_VOL, '볼륨 (kg)']]);
        }
        // [E] edit by smsong
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
    wireCharts(document.getElementById('view-change'));   // [B][E] edit by smsong : 그래프 점 탭 활성화

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
    const lastWeight = currentWeight();   // [B][E] edit by smsong : 현재 체중 = DB 값 우선

    // [B] edit by smsong : 이름/이메일 기본 문구 제거 — 값이 없으면 표시하지 않음
    const nm = p.name || '';
    const em = p.email || '';
    // [B] edit by smsong : 탭 상단 제목/설명 제거
    document.getElementById('view-profile').innerHTML = `
    ${(nm || em) ? `<div class="profile-top">
        <div class="pt-txt">
            ${nm ? `<div class="pt-name">${esc(nm)}</div>` : ''}
            ${em ? `<div class="pt-email">${esc(em)}</div>` : ''}
        </div>
    </div>` : ''}

    <div class="section">
        <div class="section-head"><h2>신체 정보</h2><button class="ibtn sm" id="editBodyBtn" type="button" title="수정" aria-label="수정">${icon('pencil')}</button></div>
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
    // [B] edit by smsong : 그래프 잘림 개선
    //   · padT 14 → 34 : 최고점의 값 라벨/툴팁 말풍선이 위로 잘리던 문제
    //   · padL/padR 8 → 24 : 첫/마지막 x축 라벨이 좌우로 잘리던 문제
    //   · H 170 → 196 : 세로를 키워 추이가 더 잘 보이게
    const W = 320, H = 196, padL = 24, padR = 24, padT = 34, padB = 30;
    // [E] edit by smsong
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

    // 점 + 값  [B] edit by smsong : 각 점에 큰 투명 히트영역(.cpt) + 데이터 → 탭하면 수치 표시
    let dots = '';
    // [B] edit by smsong : 히트영역을 "점 주변 원(r=13)" → "그 점이 속한 세로 컬럼 전체"로 확장.
    //   점을 정확히 누르지 않고 그래프의 위/아래 아무 곳이나 눌러도 해당 값이 뜬다.
    let hits = '';
    points.forEach((p, i) => {
        const cx = x(i);
        const left  = i === 0 ? 0 : (x(i - 1) + cx) / 2;
        const right = i === points.length - 1 ? W : (cx + x(i + 1)) / 2;
        hits += `<rect class="cpt" x="${left.toFixed(1)}" y="0" width="${(right - left).toFixed(1)}" height="${H}" fill="transparent" style="cursor:pointer" data-cx="${cx.toFixed(1)}" data-cy="${y(p.value).toFixed(1)}" data-v="${p.value}" data-lab="${esc(String(p.label))}"/>`;
    });
    // [E] edit by smsong
    points.forEach((p, i) => {
        dots += `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.2" fill="${color}"/>`;
    });
    // 마지막 값 라벨
    const li = points.length - 1;
    dots += `<text x="${x(li).toFixed(1)}" y="${(y(points[li].value) - 8).toFixed(1)}" text-anchor="end" fill="${color}" font-size="11" font-weight="700">${points[li].value}${opts.unit || ''}</text>`;
    // 탭 시 채워지는 툴팁 레이어
    dots += `<g class="chart-tip" style="display:none"></g>`;
    // [E] edit by smsong

    // x축 라벨 — [B] edit by smsong : 테마 변수 사용(style 로 지정해야 var() 가 안전하게 적용됨)
    const every = opts.everyLabel || Math.ceil(points.length / 6);
    let labels = '';
    points.forEach((p, i) => {
        if (i % every === 0 || i === points.length - 1) {
            // [B][E] edit by smsong : 양 끝 라벨은 anchor 를 안쪽으로 → 좌우 잘림 방지
            const anchor = i === 0 ? 'start' : (i === points.length - 1 ? 'end' : 'middle');
            const lx = i === 0 ? Math.max(x(i) - 10, 2) : (i === points.length - 1 ? Math.min(x(i) + 10, W - 2) : x(i));
            labels += `<text x="${lx.toFixed(1)}" y="${H - 9}" text-anchor="${anchor}" style="fill:var(--text-mute)" font-size="9.5">${p.label}</text>`;
        }
    });
    // [E] edit by smsong

    return `<div class="chart-wrap"><svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" data-unit="${opts.unit || ''}" data-color="${color}" data-h="${H}">
        <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity="0.28"/>
            <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient></defs>
        ${targetLine}
        <path d="${area}" fill="url(#${gid})"/>
        <path d="${path}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        ${dots}${labels}${hits}
    </svg></div>`;
}

// [B] edit by smsong : 그래프 점 탭 → 해당 날짜 수치 툴팁 표시
function wireCharts(root) {
    (root || document).querySelectorAll('.chart-svg').forEach(svg => {
        if (svg.dataset.wired) return;
        svg.dataset.wired = '1';
        const tip = svg.querySelector('.chart-tip');
        if (!tip) return;
        const unit = svg.dataset.unit || '';
        const color = svg.dataset.color || 'currentColor';
        const H = parseFloat(svg.dataset.h) || 170;
        svg.addEventListener('click', e => {
            const t = e.target.closest('.cpt');
            if (!t) { tip.style.display = 'none'; tip.innerHTML = ''; return; }
            const cx = parseFloat(t.dataset.cx), cy = parseFloat(t.dataset.cy);
            const v = t.dataset.v, lab = t.dataset.lab;
            // [B][E] edit by smsong : 넓어진 패딩에 맞춰 말풍선이 화면 밖으로 나가지 않게 보정
            const tx = Math.min(Math.max(cx, 30), 290);
            const bubbleY = Math.max(cy - 12, 20);
            tip.innerHTML =
                `<line x1="${cx}" y1="18" x2="${cx}" y2="${H - 24}" stroke="${color}" stroke-width="1" stroke-dasharray="3 3" opacity="0.45"/>` +
                `<circle cx="${cx}" cy="${cy}" r="5" fill="${color}" stroke="var(--ink-900)" stroke-width="2"/>` +
                `<g transform="translate(${tx}, ${bubbleY})">` +
                `<rect x="-28" y="-15" width="56" height="19" rx="6" fill="${color}"/>` +
                `<text x="0" y="-1.5" text-anchor="middle" fill="#fff" font-size="10.5" font-weight="800">${v}${unit}</text></g>` +
                `<text x="${tx}" y="${H - 22}" text-anchor="middle" fill="${color}" font-size="9.5" font-weight="800">${lab}</text>`;
            tip.style.display = '';
        });
    });
}
// [E] edit by smsong

function chartLegend(items) {
    return `<div class="chart-legend">${items.map(([c, l]) => `<span class="lg"><i style="background:${c}"></i>${l}</span>`).join('')}</div>`;
}

// ============================================================
//  [B] edit by smsong — 중앙 모달 폼 (아래→위 슬라이드 시트에서 교체)
//    · 화면 중앙에 뜨는 모달. 폼이 길면 모달 본문만 내부 스크롤.
//    · 모달이 열린 동안 뒤 페이지(문서/앱 메인) 스크롤은 잠근다.
//    · 모달을 2개 운용: 1차 = 운동 기록(세션)/식단/체중/프로필/설정,
//      2차 = 운동 입력 전용(1차 위에 겹침) → 날짜(세션) 폼과 운동 폼 완전 분리.
// ============================================================

// [B] edit by smsong : 시트를 아래→위 슬라이드가 아니라 화면 중앙 모달 폼으로 변경.
//   · 모달이 열리면 뒤 페이지(문서/앱 메인) 스크롤을 잠가서, 폼이 꽉 차도 뒤가 스크롤되지 않는다.
//   · 모달 본문(.sheet-body)만 내부 스크롤된다.
//   · 여러 모달(1차 상세 + 2차 운동입력)이 겹쳐도 잠금이 유지되도록 카운터로 관리.
let modalLockCount = 0;
function lockBgScroll() {
    modalLockCount++;
    document.documentElement.classList.add('modal-open');
    document.body.classList.add('modal-open');
    const m = document.getElementById('appMain'); if (m) m.classList.add('modal-lock');
}
function unlockBgScroll() {
    modalLockCount = Math.max(0, modalLockCount - 1);
    if (modalLockCount === 0) {
        document.documentElement.classList.remove('modal-open');
        document.body.classList.remove('modal-open');
        const m = document.getElementById('appMain'); if (m) m.classList.remove('modal-lock');
    }
}

function createSheet(sheetId, backdropId) {
    const sheet = document.getElementById(sheetId);
    const backdrop = document.getElementById(backdropId);
    const lv2 = sheet.classList.contains('lv2');
    let isOpen = false;
    let present = 'center';
    let closeTimer = null;
    // [B] edit by smsong : 전체보기(화면 꽉 채움) 상태. 정중앙 모달에서만 의미가 있다.
    let full = false;
    // [B] edit by smsong : 작성 중 이탈 방지.
    //   opts.isDirty 가 없으면 본문의 입력요소/칩 상태를 열 때 스냅샷 떠두고 비교해 자동 판정한다.
    let dirtyFn = null;
    let baseSnap = '';
    // [E] edit by smsong

    function body() { return sheet.querySelector('.sheet-body'); }

    // 본문 입력 상태 스냅샷 (input/textarea/select + 칩 선택)
    function snapshotBody() {
        const b = body();
        if (!b) return '';
        const fields = Array.prototype.map.call(b.querySelectorAll('input, textarea, select'), el =>
            (el.type === 'checkbox' || el.type === 'radio') ? (el.checked ? '1' : '0') : el.value);
        const chips = Array.prototype.map.call(b.querySelectorAll('.chip'), c =>
            c.classList.contains('active') ? '1' : '0');
        return fields.join('\u0001') + '\u0002' + chips.join('\u0001');
    }
    function isDirty() {
        if (!isOpen) return false;
        if (dirtyFn) { try { return !!dirtyFn(); } catch (_) { return false; } }
        return snapshotBody() !== baseSnap;
    }
    // 작성한 내용이 있으면 확인 후 닫기. 아무것도 안 썼으면 그냥 닫힌다.
    function requestClose() {
        if (!isOpen) return;
        if (isDirty() && !confirm('작성 중인 내용이 있어요.\n닫으면 지금까지 입력한 내용은 저장되지 않고 사라집니다.\n\n정말 닫을까요?')) return;
        close();
    }
    // [E] edit by smsong

    function open(html, opts) {
        opts = opts || {};
        present = 'center';                                       // 모든 폼 = 정중앙 모달
        // [B] edit by smsong : 재렌더(조회↔수정) 시에도 전체보기 상태를 유지하도록 opts.full 로 전달받는다.
        full = !!opts.full;
        // [E] edit by smsong
        clearTimeout(closeTimer);
        sheet.className = 'sheet' + (lv2 ? ' lv2' : '') + ' as-center' + (full ? ' as-full' : '');
        // [B] edit by smsong : 모든 폼 헤더 = 제목 + [크게 보기][닫기]. 설명(desc)은 두지 않는다.
        sheet.innerHTML = `
            ${opts.title ? `<div class="sheet-head">
                <h3>${esc(opts.title)}</h3>
                <div class="sheet-head-acts">
                    <button class="ibtn sm" data-sheet-full type="button" title="${full ? '작게 보기' : '크게 보기'}" aria-label="크게 보기">${icon(full ? 'collapse' : 'expand')}</button>
                    <button class="ibtn sm" data-sheet-x type="button" title="닫기" aria-label="닫기">${icon('x')}</button>
                </div>
            </div>` : ''}
            <div class="sheet-body">${html}</div>`;
        // [E] edit by smsong
        const bd = body(); if (bd) bd.scrollTop = 0;
        if (!isOpen) { lockBgScroll(); isOpen = true; }
        // [B] edit by smsong : 이탈 방지 기준 스냅샷은 본문을 그린 직후에 뜬다
        dirtyFn = opts.isDirty || null;
        baseSnap = snapshotBody();
        const fb = sheet.querySelector('[data-sheet-full]');
        if (fb) fb.onclick = () => {
            setFull(!full);
            fb.innerHTML = icon(full ? 'collapse' : 'expand');
            fb.title = fb.ariaLabel = full ? '작게 보기' : '크게 보기';
            if (opts.onFull) opts.onFull(full);
        };
        const xb = sheet.querySelector('[data-sheet-x]');
        if (xb) xb.onclick = requestClose;
        // [E] edit by smsong
        backdrop.classList.add('open');
        requestAnimationFrame(() => sheet.classList.add('open'));
    }
    function close() {
        if (!isOpen) return;
        isOpen = false;
        sheet.classList.remove('open');
        backdrop.classList.remove('open');
        sheet.style.transform = '';
        unlockBgScroll();
        clearTimeout(closeTimer);
        closeTimer = setTimeout(() => { if (!isOpen) sheet.innerHTML = ''; }, 300);
    }

    // [B] edit by smsong : 전체보기 토글 — 정중앙 모달을 화면 꽉 차게 확대/복귀
    function setFull(v) {
        full = !!v;
        sheet.classList.toggle('as-full', full);
    }
    function isFull() { return full; }
    // [E] edit by smsong

    // [B][E] edit by smsong : 배경 탭 / ESC 도 "작성 중" 확인을 거친다
    backdrop.onclick = requestClose;
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen) requestClose(); });

    return { open, close, requestClose, isOpen: () => isOpen, setFull, isFull, isDirty };
}
// [E] edit by smsong

const Sheet1 = createSheet('sheet', 'sheetBackdrop');    // 운동 기록(세션)/식단/체중/프로필/설정
const Sheet2 = createSheet('sheet2', 'sheetBackdrop2');  // 운동 입력 전용 (1차 위에 겹침)

function openSheet(html, opts) { Sheet1.open(html, opts); }
function closeSheet() { Sheet1.close(); }
// [B] edit by smsong : 1차 모달 전체보기 토글 헬퍼
function setSheetFull(v) { Sheet1.setFull(v); }
function requestCloseSheet() { Sheet1.requestClose(); }
// [E] edit by smsong
// [E] edit by smsong

// ============================================================
//  [B] edit by smsong — 1차 시트 : 운동 기록(날짜/세션)
//    모드: 'new'(생성) | 'view'(조회) | 'edit'(수정) | 'workouts'(운동 보기)
//      · new      : 메타 입력 폼(부위 4+3 그리드 / 총 시간 자동계산·입력잠금 / 컨디션 맨 아래).
//                   만들면 곧바로 'view' 모드로 전환.
//      · view     : 읽기 전용. 상단 좌측 [수정][삭제], 우측 [운동 보기].
//      · edit     : view 에서 수정 → 메타 편집 폼 → 저장하면 view 로 복귀.
//      · workouts : 이 기록에 담긴 운동 목록(추가/수정/삭제/드래그). 세션과 운동을 분리해 본다.
//    개별 운동 입력 폼은 2차 시트(openWorkoutSheet)로 분리(1차 위에 겹침).
// ============================================================
function openSessionEditor(sessionId, date, mode) {
    const isNew = !sessionId;
    let curMode = isNew ? 'new' : (mode || 'view');
    let sid = sessionId || null;

    // new 모드 임시 초안(생성 전). 생성 후에는 항상 state(서버본)를 읽는다.
    const newDraft = {
        date: date || todayStr(),
        startTime: '', endTime: '', durationMin: null,
        condition: DEFAULT_CONDITION, bodyParts: [], memo: ''
    };

    // [B] edit by smsong : 전체보기 상태. 조회↔수정 전환(재렌더) 사이에도 유지된다.
    let fullView = false;
    // [E] edit by smsong

    renderMode();

    function sess() { return sid ? sessionById(sid) : null; }

    function renderMode() {
        if (curMode === 'new' || curMode === 'edit') renderMetaForm();
        else renderMetaView();
    }

    // ---------- 조회(읽기 전용 상세 + 운동 리스트) ----------
    function renderMetaView() {
        const s = sess();
        if (!s) { closeSheet(); return; }
        const dur = sessionDuration(s);
        const parts = sessionBodyParts(s);
        const c = s.condition;
        const timeStr = fmtTimeRange(s);
        openSheet(`
            <!-- [B][E] edit by smsong : 크게 보기/닫기는 시트 헤더가 담당 → 툴바에는 기록 조작만 남긴다 -->
            <div class="se-toolbar">
                <div class="se-tb-left">
                    <button class="ibtn sm" id="seEdit" type="button" title="수정" aria-label="수정">${icon('pencil')}</button>
                    <button class="ibtn sm danger" id="seDel" type="button" title="삭제" aria-label="삭제">${icon('trash')}</button>
                </div>
                <div class="se-tb-right">
                    <button class="ibtn sm grad" id="seAddW" type="button" title="운동 추가" aria-label="운동 추가">${icon('plus')}</button>
                </div>
            </div>

            <div class="se-meta">
                <span class="se-meta-date">${fmtKorean(s.date)}</span>
                ${timeStr ? `<span class="se-meta-item">${esc(timeStr)}${dur != null ? ' · ' + fmtDur(dur) : ''}</span>` : (dur != null ? `<span class="se-meta-item">${fmtDur(dur)}</span>` : '')}
                <span class="se-meta-item se-meta-cond" style="color:${condColor(c)}">컨디션 ${c == null ? '—' : c}</span>
            </div>
            ${parts.length ? `<div class="se-meta-parts">${parts.map(p => `<span class="chip xs active view-chip">${esc(p)}</span>`).join('')}</div>` : ''}
            ${s.memo ? `<div class="se-meta-memo">${esc(s.memo)}</div>` : ''}

            <div class="se-head">
                <h4>운동 <span class="cnt tabnum" id="seCount">0</span></h4>
                <span class="se-head-sum tabnum" id="seVol"></span>
            </div>
            <div class="reorder-list se-list" id="seList"></div>
        `, {
            // [B][E] edit by smsong : 제목 + 헤더의 크게보기/닫기. 조회는 읽기 전용이라 이탈 확인 없음.
            title: '운동 기록',
            full: fullView,
            onFull: v => { fullView = v; },
            isDirty: () => false
        });

        document.getElementById('seEdit').onclick = () => { curMode = 'edit'; renderMode(); };
        document.getElementById('seDel').onclick = async () => {
            if (!confirm('이 운동 기록을 삭제할까요?\n안에 담긴 운동도 함께 삭제됩니다.')) return;
            const b = document.getElementById('seDel'); b.disabled = true;
            try { await delSessionRec(sid); closeSheet(); render(); toast('운동 기록을 삭제했어요'); }
            catch (err) { b.disabled = false; toast(errMsg(err, '삭제에 실패했어요')); }
        };
        document.getElementById('seAddW').onclick = () => openWorkoutSheet(null, async item => {
            await addWorkoutToSession(sid, item);
            paintList(); render(); toast('운동을 추가했어요');
        });
        paintList();
    }

    // ---------- 생성/수정 폼 ----------
    function renderMetaForm() {
        const src = curMode === 'edit' ? sess() : newDraft;
        if (curMode === 'edit' && !src) { closeSheet(); return; }
        const draft = {
            date: src.date || todayStr(),
            startTime: src.startTime || '',
            endTime: src.endTime || '',
            durationMin: src.durationMin == null ? null : src.durationMin,
            condition: src.condition == null ? DEFAULT_CONDITION : src.condition,
            bodyParts: (src.bodyParts || []).slice(),
            memo: src.memo || ''
        };
        const selectedParts = new Set(draft.bodyParts);
        const cond = draft.condition;

        openSheet(`
            <div class="field"><label>날짜</label><input class="input" id="seDate" type="date" value="${draft.date}"></div>

            <div class="field-row">
                <div class="field"><label>시작 시간</label><input class="input" id="seStart" type="time" value="${draft.startTime || ''}"></div>
                <div class="field"><label>종료 시간</label><input class="input" id="seEnd" type="time" value="${draft.endTime || ''}"></div>
                <div class="field"><label>총 시간(분)</label><input class="input readonly" id="seDur" type="text" inputmode="none" placeholder="자동" value="${draft.durationMin == null ? '' : draft.durationMin}" readonly tabindex="-1"></div>
            </div>
            <div class="hint" id="seDurHint"></div>

            <div class="field">
                <label>운동 부위 (여러 개 선택 가능)</label>
                <div class="chip-grid" id="seParts">${BODY_PARTS.map(p => `<button class="chip sm ${selectedParts.has(p) ? 'active' : ''}" data-bp="${esc(p)}" type="button">${esc(p)}</button>`).join('')}</div>
            </div>

            <div class="field"><label>메모 (선택)</label><input class="input" id="seMemo" value="${esc(draft.memo || '')}" placeholder="그립, 통증, 특이사항 등"></div>

            <div class="field cond-field">
                <div class="cond-head">
                    <label>컨디션</label>
                    <div class="cond-readout">
                        <span class="cond-big tabnum" id="seCondVal">${cond}</span>
                        <span class="cond-chip" id="seCondLbl">${condLabel(cond)}</span>
                    </div>
                </div>
                <input type="range" class="cond-range" id="seCond" min="0" max="100" step="1" value="${cond}">
                <div class="cond-scale"><span>0 · 최악</span><span>50 · 보통</span><span>100 · 최상</span></div>
            </div>

            <div class="se-actions">
                <button class="btn grad block" id="seSave">${curMode === 'new' ? '운동 기록 만들기' : '변경사항 저장'}</button>
                ${curMode === 'edit' ? `<button class="btn block" id="seCancel" style="margin-top:8px">취소</button>` : ''}
            </div>
        `, {
            // [B][E] edit by smsong : + 버튼으로 여는 세션 폼에도 제목을 붙인다. 입력 중 닫으면 확인.
            title: curMode === 'new' ? '운동 기록 만들기' : '운동 기록 수정',
            full: fullView,
            onFull: v => { fullView = v; }
        });

        // 컨디션 슬라이더
        const condEl = document.getElementById('seCond');
        const condVal = document.getElementById('seCondVal');
        const condLbl = document.getElementById('seCondLbl');
        const paintCond = () => {
            const v = Number(condEl.value);
            condVal.textContent = v; condVal.style.color = condColor(v);
            condLbl.textContent = condLabel(v); condLbl.style.color = condColor(v);
            condEl.style.setProperty('--cond-pct', v + '%');
            condEl.style.setProperty('--cond-color', condColor(v));
        };
        condEl.addEventListener('input', paintCond); paintCond();

        // 시작·종료 → 총 시간(분) 자동 계산 (직접 입력 불가)
        const startEl = document.getElementById('seStart');
        const endEl = document.getElementById('seEnd');
        const durEl = document.getElementById('seDur');
        const hintEl = document.getElementById('seDurHint');
        function refreshDuration() {
            const span = spanMinutes(startEl.value, endEl.value);
            durEl.value = span == null ? '' : span;
            hintEl.textContent = span == null
                ? '시작·종료 시간을 넣으면 총 시간이 자동으로 계산돼요.'
                : `시작~종료 기준 ${fmtDur(span)} · 자동 계산돼요`;
        }
        startEl.addEventListener('change', refreshDuration);
        endEl.addEventListener('change', refreshDuration);
        if (curMode === 'new' && !draft.startTime) startEl.value = nowTimeStr();
        refreshDuration();

        // 부위 다중 선택
        document.querySelectorAll('#seParts .chip').forEach(c => c.onclick = () => {
            const p = c.dataset.bp;
            if (selectedParts.has(p)) { selectedParts.delete(p); c.classList.remove('active'); }
            else { selectedParts.add(p); c.classList.add('active'); }
        });

        // 저장 (신규=생성 후 조회 모드로 / 수정=저장 후 조회 모드로)
        document.getElementById('seSave').onclick = async () => {
            const s = curMode === 'edit' ? sess() : null;
            const payload = {
                id: curMode === 'edit' ? sid : null,
                date: document.getElementById('seDate').value,
                startTime: startEl.value || '',
                endTime: endEl.value || '',
                durationMin: durEl.value === '' ? null : Math.max(0, parseInt(durEl.value, 10) || 0),
                condition: Number(condEl.value),
                bodyParts: BODY_PARTS.filter(p => selectedParts.has(p)),
                title: s ? (s.title || '') : '',
                memo: document.getElementById('seMemo').value.trim()
            };
            if (!payload.date) return toast('날짜를 선택하세요');
            const btn = document.getElementById('seSave'); btn.disabled = true;
            try {
                const rec = await saveSessionRec(payload);
                sid = rec.id;
                ui.workoutSel = rec.date;
                render();
                curMode = 'view';
                renderMode();
                toast(payload.id ? '운동 기록을 저장했어요' : '기록을 만들었어요. 아래 “운동 추가”로 운동을 담으세요');
            } catch (err) { btn.disabled = false; toast(errMsg(err, '저장에 실패했어요')); }
        };

        const cancel = document.getElementById('seCancel');
        if (cancel) cancel.onclick = () => { curMode = 'view'; renderMode(); };
    }

    // ---------- 세션 안 운동 리스트 렌더 ----------
    function paintList() {
        const el = document.getElementById('seList');
        if (!el) return;
        const s = sess();
        const list = (s && s.workouts) || [];
        el.innerHTML = list.length
            ? list.map(w => workoutRowHtml(w, sid)).join('')
            : `<div class="se-empty">아직 운동이 없어요. 위 ＋ 버튼으로 추가하세요.</div>`;
        const cntEl = document.getElementById('seCount'); if (cntEl) cntEl.textContent = list.length;
        const volEl = document.getElementById('seVol'); if (volEl) volEl.textContent = list.length ? `볼륨 ${sessionVolume(s)} kg` : '';

        enableDragReorder(el, async ids => {
            try { await commitWorkoutOrder(sid, ids); render(); }
            catch (err) { toast(errMsg(err, '순서 저장에 실패했어요')); paintList(); }
        });
        el.querySelectorAll('[data-rm-w]').forEach(b => b.onclick = async ev => {
            ev.stopPropagation();
            if (!confirm('이 운동을 삭제할까요?')) return;
            b.disabled = true;
            try { await delWorkoutInSession(sid, b.dataset.rmW); paintList(); render(); toast('삭제했어요'); }
            catch (err) { b.disabled = false; toast(errMsg(err, '삭제에 실패했어요')); }
        });
        el.querySelectorAll('[data-edit-w]').forEach(b => b.onclick = ev => {
            ev.stopPropagation();
            const w = list.find(x => String(x.id) === String(b.dataset.editW));
            if (!w) return;
            openWorkoutSheet(w, async item => {
                await updWorkoutInSession(sid, w.id, item);
                paintList(); render(); toast('운동을 수정했어요');
            });
        });
    }
}
// [E] edit by smsong

// ============================================================
//  2차 시트 : 운동 입력 폼 (종목 / 맨몸 / 무게 / 횟수 / 세트 / 메모)
//    · 세션 폼과 분리된 별도 시트로, 1차 시트 위에 겹쳐 열린다.
//    · 부위는 세션이 보유하므로 여기에는 없다.
//    · 이미 만들어진 세션에 대해서만 열리며, onApply 가 서버 저장을 담당한다.
// ============================================================
function openWorkoutSheet(initial, onApply) {
    const editing = !!initial;

    Sheet2.open(`
        <div class="field">
            <label>운동 종목</label>
            <div class="exercise-picker">
                <select class="select" id="wExercise">${exOptions(editing ? initial.exercise : '')}</select>
                <button class="ibtn ex-btn toggle" id="wAddEx" type="button" title="종목 추가" aria-label="종목 추가">${icon('plus')}</button>
            </div>
            <div class="ex-new-wrap" id="wNewExWrap">
                <div class="exercise-picker">
                    <input class="input" id="wNewEx" placeholder="새 종목 이름 (예: 인클라인 벤치)">
                    <button class="ibtn grad ex-btn" id="wNewExSave" type="button" title="종목 저장" aria-label="종목 저장">${icon('check')}</button>
                </div>
            </div>
        </div>

        <label class="check-row">
            <input type="checkbox" id="wBodyweight" ${editing && initial.bodyweight ? 'checked' : ''}>
            <span class="box">${icon('check')}</span>
            <span>맨몸 운동 (무게 0kg 고정)</span>
        </label>

        <div class="field-row">
            <div class="field"><label>무게 (kg)</label><input class="input" id="wWeight" type="number" inputmode="decimal" placeholder="100" value="${editing ? (initial.bodyweight ? 0 : initial.weight) : ''}" ${editing && initial.bodyweight ? 'disabled' : ''}></div>
            <div class="field"><label>무게 (lbs)</label><input class="input" id="wWeightLbs" type="number" inputmode="decimal" placeholder="220" value="${editing && !initial.bodyweight && initial.weight ? kgToLbs(initial.weight) : ''}" ${editing && initial.bodyweight ? 'disabled' : ''}></div>
        </div>
        <div class="hint" id="wLbsHint" style="margin-top:-6px">lbs 를 입력하면 kg 으로 자동 변환돼 등록돼요.</div>
        <div class="field-row">
            <div class="field"><label>횟수 (회)</label><input class="input" id="wReps" type="number" inputmode="numeric" placeholder="5" value="${editing ? initial.reps : ''}"></div>
            <div class="field"><label>세트</label><input class="input" id="wSets" type="number" inputmode="numeric" placeholder="1" value="${editing ? initial.sets : 1}"></div>
        </div>
        <div class="field"><label>운동 메모 (선택)</label><input class="input" id="wMemo" placeholder="그립, 템포 등" value="${editing ? esc(initial.memo || '') : ''}"></div>

        <button class="btn grad block" id="wApply" style="margin-top:6px">${editing ? '수정 저장' : '운동 추가'}</button>
        <button class="btn block" id="wCancel" style="margin-top:8px">취소</button>
    `, {
        title: editing ? '운동 수정' : '운동 추가'   // [B][E] edit by smsong : 설명(desc) 제거 → 제목만
    });

    function exOptions(selectedName) {
        if (!state.exercises.length) return `<option value="" disabled selected>종목을 추가하세요</option>`;
        return state.exercises.map(e => `<option value="${esc(e)}" ${e === selectedName ? 'selected' : ''}>${esc(e)}</option>`).join('');
    }

    // 종목 추가 토글
    const newWrap = document.getElementById('wNewExWrap');
    const addExBtn = document.getElementById('wAddEx');
    addExBtn.onclick = () => {
        const opening = !newWrap.classList.contains('open');
        newWrap.classList.toggle('open', opening);
        addExBtn.classList.toggle('open', opening);
        addExBtn.innerHTML = icon(opening ? 'minus' : 'plus');   // [B][E] edit by smsong : 텍스트 → 아이콘
        addExBtn.title = addExBtn.ariaLabel = opening ? '종목 추가 닫기' : '종목 추가';
        if (opening) document.getElementById('wNewEx').focus();
    };
    document.getElementById('wNewExSave').onclick = async () => {
        const name = document.getElementById('wNewEx').value.trim();
        if (!name) return toast('종목 이름을 입력하세요');
        if (state.exercises.includes(name)) { toast('이미 있는 종목이에요'); return; }
        const btn = document.getElementById('wNewExSave'); btn.disabled = true;
        try {
            await addExerciseType(name);
            document.getElementById('wExercise').innerHTML = exOptions(name);
            document.getElementById('wNewEx').value = '';
            newWrap.classList.remove('open');
            addExBtn.classList.remove('open');
            addExBtn.innerHTML = icon('plus');   // [B][E] edit by smsong : 텍스트 → 아이콘
            toast(`'${name}' 종목을 추가했어요`);
        } catch (err) { toast(errMsg(err, '종목 추가에 실패했어요')); }
        finally { btn.disabled = false; }
    };

    // 맨몸 → 무게 0 고정 + 입력 잠금 (kg/lbs 둘 다)
    const bwChk = document.getElementById('wBodyweight');
    const wWeight = document.getElementById('wWeight');
    const wWeightLbs = document.getElementById('wWeightLbs');
    // [B] edit by smsong : lbs 입력 → kg 자동 변환(양방향 동기화). 저장 값은 항상 kg.
    let syncing = false;
    wWeightLbs.addEventListener('input', () => {
        if (syncing) return; syncing = true;
        const lbs = parseFloat(wWeightLbs.value);
        wWeight.value = isNaN(lbs) ? '' : lbsToKg(lbs);
        syncing = false;
    });
    wWeight.addEventListener('input', () => {
        if (syncing) return; syncing = true;
        const kg = parseFloat(wWeight.value);
        wWeightLbs.value = isNaN(kg) ? '' : kgToLbs(kg);
        syncing = false;
    });
    // [E] edit by smsong
    let prevWeight = editing && !initial.bodyweight ? String(initial.weight) : '';
    bwChk.onchange = () => {
        if (bwChk.checked) {
            prevWeight = wWeight.value;
            wWeight.value = '0'; wWeight.disabled = true;
            wWeightLbs.value = ''; wWeightLbs.disabled = true;
        } else {
            wWeight.disabled = false; wWeight.value = prevWeight;
            wWeightLbs.disabled = false;
            const kg = parseFloat(prevWeight);
            wWeightLbs.value = isNaN(kg) || !kg ? '' : kgToLbs(kg);
        }
    };

    document.getElementById('wCancel').onclick = () => Sheet2.close();

    document.getElementById('wApply').onclick = async () => {
        const exercise = document.getElementById('wExercise').value;
        const bodyweight = bwChk.checked;
        const weight = bodyweight ? 0 : parseFloat(wWeight.value);
        const reps = parseInt(document.getElementById('wReps').value, 10);
        const sets = parseInt(document.getElementById('wSets').value, 10);
        if (!exercise) return toast('종목을 선택하세요');
        if (!reps || !sets) return toast('횟수·세트를 입력하세요');
        if (!bodyweight && !weight) return toast('무게를 입력하세요 (맨몸이면 체크)');

        const btn = document.getElementById('wApply'); btn.disabled = true;
        try {
            await onApply({
                exercise, weight, reps, sets,
                memo: document.getElementById('wMemo').value.trim(),
                bodyweight
            });
            Sheet2.close();
        } catch (err) { btn.disabled = false; toast(errMsg(err, '저장에 실패했어요')); }
    };
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
    `, { title: '식단 기록' });   // [B][E] edit by smsong : 설명(desc) 제거 → 제목만

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
    `, { title: '체중 기록' });   // [B][E] edit by smsong : 설명(desc) 제거 → 제목만
    document.getElementById('bSave').onclick = async () => {
        const weight = parseFloat(document.getElementById('bWeight').value);
        const dt = document.getElementById('bDate').value;
        if (!weight) return toast('체중을 입력하세요');
        const exist = state.bodyLogs.find(b => b.date === dt);
        if (exist) exist.weight = weight; else state.bodyLogs.push({ id: uid(), date: dt, weight });
        persistExtras();
        // [B] edit by smsong : 가장 최근 날짜의 기록이면 '현재 체중'으로도 DB 에 반영
        const latest = state.bodyLogs.slice().sort((a, b) => a.date < b.date ? 1 : -1)[0];
        if (latest && latest.date === dt) {
            try { await saveBodyInfo({ weight }); } catch (_) { /* 그래프 기록은 유지, 동기화만 실패 */ }
        }
        // [E] edit by smsong
        closeSheet(); render(); toast('체중을 기록했어요');
    };
}

// 프로필 설정 (표시 이름 + 신체 정보)
function openProfileSheet() {
    const p = state.profile;
    openSheet(`
        <div class="field"><label>이름</label><input class="input" id="pName" value="${esc(p.name || '')}" placeholder="이름"></div>
        <div class="field-row">
            <div class="field"><label>키 (cm)</label><input class="input" id="pHeight" type="number" inputmode="decimal" value="${p.height != null ? p.height : ''}" placeholder="178"></div>
            <div class="field"><label>현재 체중 (kg)</label><input class="input" id="pWeight" type="number" inputmode="decimal" value="${currentWeight() != null ? currentWeight() : ''}" placeholder="77.6"></div>
            <div class="field"><label>목표 체중 (kg)</label><input class="input" id="pTarget" type="number" inputmode="decimal" value="${p.targetWeight != null ? p.targetWeight : ''}" placeholder="74"></div>
        </div>
        <button class="btn grad block" id="pSave" style="margin-top:6px">저장</button>
    `, { title: '프로필 설정' });   // [B][E] edit by smsong : 설명(desc) 제거 → 제목만
    document.getElementById('pSave').onclick = async () => {
        const name = document.getElementById('pName').value.trim();
        const height = parseFloat(document.getElementById('pHeight').value);
        const weight = parseFloat(document.getElementById('pWeight').value);
        const target = parseFloat(document.getElementById('pTarget').value);
        state.profile.name = name;
        // 표시 이름은 로그인 사용자 정보에도 반영(새로고침 후에도 유지)
        try {
            const cu = Auth.getUser() || {};
            cu.name = name; localStorage.setItem('currentUser', JSON.stringify(cu));
        } catch (_) {}
        const btn = document.getElementById('pSave'); btn.disabled = true;
        try {
            // [B] edit by smsong : 키/현재 체중/목표 체중을 DB 에 저장
            await saveBodyInfo({
                height: isNaN(height) ? null : height,
                weight: isNaN(weight) ? null : weight,
                targetWeight: isNaN(target) ? null : target
            });
            closeSheet(); render(); toast('프로필을 저장했어요');
            // [E] edit by smsong
        } catch (err) {
            btn.disabled = false;
            toast(errMsg(err, '프로필 저장에 실패했어요'));
        }
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
        <!-- [B] edit by smsong : 예전 텍스트 기록 마이그레이션 진입점 -->
        <div class="field">
            <label>기록 마이그레이션</label>
            <button class="ibtn" id="setImport" type="button" title="운동 기록 가져오기" aria-label="운동 기록 가져오기">${icon('paste')}</button>
            <div class="hint">월 단위로 남겨둔 텍스트 파일을 여러 개 한 번에 올릴 수 있어요.</div>
        </div>
        <!-- [E] edit by smsong -->
        <button class="btn block" id="setDone" style="margin-top:6px">완료</button>
    `, { title: '설정' });   // [B][E] edit by smsong : 설명(desc) 제거 → 제목만
    document.querySelectorAll('#themeSeg button').forEach(b => b.onclick = () => {
        window.UpFitTheme.apply(b.dataset.theme, true);   // persist = true
        document.querySelectorAll('#themeSeg button').forEach(x => x.classList.toggle('active', x === b));
    });
    // [B] edit by smsong : 설정에서 열면 기본 날짜는 오늘(파일에 날짜가 있으면 파일 날짜 우선)
    document.getElementById('setImport').onclick = () => openImportSheet(todayStr());
    // [E] edit by smsong
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
    // [B] edit by smsong : 탭을 옮기면 항상 맨 위에서 시작하도록 스크롤 초기화.
    //   실제 스크롤 컨테이너가 .app-main / 문서(body·html) 중 무엇이든 모두 리셋한다.
    resetScrollTop();
    // [E] edit by smsong
    if (remember) { try { sessionStorage.setItem(TAB_KEY, tab); } catch (_) {} }
}
// [B] edit by smsong : 스크롤 위치 초기화 유틸 (탭 전환 시 이전 탭의 스크롤 잔상 제거)
function resetScrollTop() {
    const m = document.getElementById('appMain'); if (m) m.scrollTop = 0;
    try { window.scrollTo(0, 0); } catch (_) {}
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
}
// [E] edit by smsong
document.querySelectorAll('.nav-item').forEach(btn => btn.onclick = () => activateTab(btn.dataset.tab, true));

// ============================================================
//  [B] edit by smsong — 운동 기록 텍스트 파서
//    기존에 텍스트로 남기던 기록을 그대로 읽어 세션+운동으로 변환한다.
//    · 붙여넣기 가져오기(날짜 선택 후 운동 목록만 붙여넣기)
//    · 파일 마이그레이션(월 단위 .txt 여러 개)
//    두 기능이 같은 파서를 쓴다.
//
//    인식 문법
//      월 헤더 : "2026년 6월 운동"            → 이후 날짜의 연/월 기준
//      월 요약 : "6월 휴식 : 12번"             → 무시
//      날짜 줄 : "6/1 월 (가슴, 이두) (10%)"   → 세션 1개
//                괄호는 순서 무관하게 해석: 부위 / 컨디션(%) / 시간(19:00~20:30) / 그 외=메모
//      운동 줄 : "⁃ 플랫 벤치프레스 3rep 1set (85kg)"
//                무게 생략      → 맨몸 운동(bodyweight)
//                단위 없는 숫자 → 머신 중량. opts.unit('lbs'|'kg') 로 해석
//                "(실패)"       → 횟수 0. 서버가 reps>0 을 요구하므로 운동으로 넣지 않고
//                                 세션 메모에 "실패: 종목 무게" 로 남긴다.
//      휴식 줄 : "휴식"                        → 그 날은 세션을 만들지 않음
// ============================================================

// 종목 문자열에서 쓰는 별칭 → BODY_PARTS 표준 이름
const PART_ALIAS = { '등': '등중앙', '랫': '광배', '다리': '하체', '코어': '복근', '숄더': '어깨', '어께': '어깨' };

const IM_MONTH_RE   = /^(\d{4})\s*년\s*(\d{1,2})\s*월/;                 // 2026년 6월 운동
const IM_SUMMARY_RE = /^\d{1,2}\s*월\s*(휴식|운동|합계|총)/;             // 6월 휴식 : 12번
const IM_BULLET_RE  = /^[\s\u00a0]*[-–—•·∙▪◦*⁃‣]/;
const IM_REST_RE    = /^(휴식|휴무|쉼|오프|off|rest|없음|-)$/i;
const IM_DAY_RE     = /^(?:(\d{4})\s*[년.\-\/]\s*)?(\d{1,2})\s*[월.\-\/]\s*(\d{1,2})\s*일?\s*(?:[월화수목금토일](?:요일)?)?$/;
// 월 없이 일만 적은 줄: "1일 월", "1일" → 기준 연·월을 사용
const IM_DAYONLY_RE = /^(\d{1,2})\s*일\s*(?:[월화수목금토일](?:요일)?)?$/;
const IM_WEEKDAY_RE = /^[월화수목금토일](?:요일)?$/;
const IM_PCT_RE     = /^(\d{1,3})\s*%$/;
const IM_TIME_RE    = /^(\d{1,2}:\d{2})\s*[~\-–—]\s*(\d{1,2}:\d{2})$/;
const IM_WEIGHT_RE  = /^(\d+(?:\.\d+)?)\s*(kg|킬로(?:그램)?|lbs?|파운드)?$/i;
const IM_FAIL_RE    = /(실패|fail(ed)?)/i;
const IM_REPS_RE    = /(\d+)\s*(?:reps?|회|번)/i;
const IM_SETS_RE    = /(\d+)\s*(?:sets?|세트|셋)/i;

// 줄 앞의 불릿/번호/탭 제거
function imStripBullet(line) {
    return String(line).replace(/^[\s\u00a0]*(?:[-–—•·∙▪◦*⁃‣]|\d+[.)])?[\s\u00a0]*/, '').trim();
}

// 괄호를 모두 뽑아내고 나머지 본문을 돌려준다. "벤치 3rep 1set (85kg)" → rest:"벤치 3rep 1set", groups:["85kg"]
function imSplitParens(text) {
    const groups = [];
    const rest = String(text).replace(/[（(]\s*([^（()）]*?)\s*[)）]/g, (m, g) => {
        if (g) groups.push(g.trim());
        return ' ';
    });
    return { groups: groups, rest: rest.replace(/\s+/g, ' ').trim() };
}

// 괄호 하나를 부위 목록으로 해석 (모든 토큰이 부위일 때만 성공)
function imAsParts(group) {
    const tokens = group.split(/[,、·/·|+]/).map(t => t.trim()).filter(Boolean);
    if (!tokens.length) return null;
    const parts = [];
    for (const t of tokens) {
        const name = PART_ALIAS[t] || t;
        if (BODY_PARTS.indexOf(name) < 0) return null;   // 하나라도 부위가 아니면 부위 그룹이 아님(=메모)
        if (parts.indexOf(name) < 0) parts.push(name);
    }
    return parts;
}

// 날짜 줄의 괄호들을 해석해 세션 메타로
function imDayMeta(groups) {
    const meta = { bodyParts: [], condition: null, startTime: '', endTime: '', memo: [] };
    groups.forEach(g => {
        if (IM_WEEKDAY_RE.test(g)) return;                       // (월) 같은 요일 표기는 버림
        const pct = g.match(IM_PCT_RE);
        if (pct) { meta.condition = Math.max(0, Math.min(100, Number(pct[1]))); return; }
        const tm = g.match(IM_TIME_RE);
        if (tm) { meta.startTime = imPadTime(tm[1]); meta.endTime = imPadTime(tm[2]); return; }
        const parts = imAsParts(g);
        if (parts) { parts.forEach(p => { if (meta.bodyParts.indexOf(p) < 0) meta.bodyParts.push(p); }); return; }
        meta.memo.push(g);
    });
    return meta;
}
function imPadTime(t) {
    const [h, m] = String(t).split(':');
    return pad(Number(h)) + ':' + m;
}

// 날짜 줄 판정 → 'YYYY-MM-DD' 또는 null
function imMatchDate(rest, ctx) {
    const m = rest.match(IM_DAY_RE);
    if (m) {
        // 기준 연·월 강제 적용이면 파일에 적힌 연도를 무시한다
        const year = (!ctx.force && m[1]) ? Number(m[1]) : ctx.year;
        if (!year) return null;                               // 연도를 알 수 없으면 날짜 줄로 보지 않는다
        const mm = Number(m[2]), dd = Number(m[3]);
        if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
        return year + '-' + pad(mm) + '-' + pad(dd);
    }
    // "1일" 처럼 일만 적힌 줄 → 기준 연·월로 보완
    const d1 = rest.match(IM_DAYONLY_RE);
    if (d1 && ctx.year && ctx.month) {
        const dd = Number(d1[1]);
        if (dd < 1 || dd > 31) return null;
        return ctx.year + '-' + pad(ctx.month) + '-' + pad(dd);
    }
    return null;
}

// 운동 줄 → { exercise, weight, reps, sets, bodyweight, memo } | { failed:true, ... } | null
function imParseItem(rest, groups, unit) {
    let weight = null, failed = false;
    const memo = [];

    groups.forEach(g => {
        const w = g.match(IM_WEIGHT_RE);
        if (w) {
            const v = Number(w[1]);
            const u = (w[2] || '').toLowerCase();
            if (u.indexOf('kg') === 0 || u.indexOf('킬로') === 0) weight = v;          // 명시 kg
            else if (u) weight = lbsToKg(v);                                           // 명시 lbs/파운드
            else weight = (unit === 'kg') ? v : lbsToKg(v);                            // 단위 없음 → 옵션
            return;
        }
        if (IM_FAIL_RE.test(g)) { failed = true; memo.push(g); return; }
        memo.push(g);
    });

    const repsM = rest.match(IM_REPS_RE);
    const setsM = rest.match(IM_SETS_RE);

    // 종목명 = 본문에서 횟수/세트 토큰을 걷어낸 나머지
    let name = rest;
    if (repsM) name = name.replace(repsM[0], ' ');
    if (setsM) name = name.replace(setsM[0], ' ');
    name = name.replace(/\s+/g, ' ').trim();
    if (!name) return null;

    if (failed || !repsM) {
        // 횟수가 없는 줄(=실패/메모성 기록). 운동으로 저장하지 않고 호출부가 메모로 남긴다.
        return { failed: true, exercise: name, weight: weight, memo: memo.join(' ') };
    }

    const reps = Number(repsM[1]);
    const sets = setsM ? Number(setsM[1]) : 1;
    if (!(reps > 0) || !(sets > 0)) return { failed: true, exercise: name, weight: weight, memo: memo.join(' ') };

    const bodyweight = (weight == null || weight === 0);
    return {
        exercise: name,
        weight: bodyweight ? 0 : weight,
        reps: reps,
        sets: sets,
        bodyweight: bodyweight,
        memo: memo.join(' ')
    };
}

/**
 * 기록 텍스트 → 날짜별 세션 목록
 * @param {string} text
 * @param {{unit?:'lbs'|'kg', defaultDate?:string, year?:number, month?:number, forceYm?:boolean}} opts
 * @returns {{days:Array, warnings:Array<string>, restCount:number}}
 */
function parseWorkoutText(text, opts) {
    opts = opts || {};
    const unit = opts.unit === 'kg' ? 'kg' : 'lbs';
    // 기준 연·월. 파일에 "2026년 6월 운동" 헤더가 있으면 그 값으로 갱신되지만,
    // opts.forceYm 이면 헤더를 무시하고 사용자가 고른 기준 연·월을 끝까지 사용한다.
    const ctx = { year: opts.year || null, month: opts.month || null, force: !!opts.forceYm };
    const days = [];
    const byDate = {};
    const warnings = [];
    let cur = null;

    function openDay(date, groups) {
        if (byDate[date]) { cur = byDate[date]; return cur; }   // 같은 날짜가 또 나오면 이어붙인다
        const meta = imDayMeta(groups || []);
        cur = {
            date: date,
            bodyParts: meta.bodyParts,
            condition: meta.condition,
            startTime: meta.startTime,
            endTime: meta.endTime,
            memo: meta.memo,
            items: [],
            failed: [],
            rest: false
        };
        byDate[date] = cur;
        days.push(cur);
        return cur;
    }

    const lines = String(text || '').replace(/\r/g, '').split('\n');
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const lineNo = i + 1;
        if (!raw.trim()) continue;

        const mh = raw.trim().match(IM_MONTH_RE);
        if (mh) {                                                // 월 헤더 "2026년 6월 운동"
            if (!ctx.force) { ctx.year = Number(mh[1]); ctx.month = Number(mh[2]); }
            continue;
        }
        if (IM_SUMMARY_RE.test(raw.trim())) continue;            // 월 요약

        const hadBullet = IM_BULLET_RE.test(raw);
        const body = imStripBullet(raw);
        if (!body) continue;

        const sp = imSplitParens(body);

        // 날짜 줄 (불릿이 붙은 줄은 항상 운동 줄로 본다)
        if (!hadBullet) {
            const date = imMatchDate(sp.rest, ctx);
            if (date) { openDay(date, sp.groups); continue; }
        }

        if (IM_REST_RE.test(sp.rest)) { if (cur) cur.rest = true; continue; }

        const item = imParseItem(sp.rest, sp.groups, unit);
        if (!item) { warnings.push(lineNo + '행: 해석할 수 없어 건너뜀 — ' + body); continue; }

        if (!cur) {
            if (!opts.defaultDate) { warnings.push(lineNo + '행: 날짜를 알 수 없어 건너뜀 — ' + body); continue; }
            openDay(opts.defaultDate, []);
        }
        if (item.failed) cur.failed.push(item);
        else cur.items.push(item);
    }

    // 운동이 하나도 없는 날 = 휴식일 → 세션을 만들지 않는다
    let restCount = 0;
    const result = days.filter(d => {
        if (d.items.length) return true;
        restCount++;
        return false;
    });

    // 실패 기록은 세션 메모로 흡수 (서버가 reps>0 을 요구하므로 운동 행으로 넣지 않는다)
    result.forEach(d => {
        d.failed.forEach(f => {
            const w = f.weight != null ? ' ' + f.weight + 'kg' : '';
            d.memo.push('실패: ' + f.exercise + w);
        });
        d.memoText = d.memo.join(' · ').slice(0, 300);
        // 부위가 비어 있으면 운동 줄에서 유추하지 않고 그대로 둔다(사용자가 나중에 채움)
    });

    return { days: result, warnings: warnings, restCount: restCount };
}
// [E] edit by smsong

// ============================================================
//  [B] edit by smsong — 운동 기록 가져오기 시트
//    · 붙여넣기 : 날짜 선택 후 운동 목록만 붙여넣으면 그 날짜로 업로드
//    · 파일     : 월 단위 .txt 를 여러 개 골라 한 번에 마이그레이션
//    저장은 날짜 1일 = 요청 1건. 백엔드 createSession 이 workouts 를 함께 받아
//    세션+운동을 한 트랜잭션으로 만든다(중간 실패로 반쪽 기록이 남지 않음).
// ============================================================
const IMPORT_UNIT_KEY = 'UF_IMPORT_UNIT_' + UID;
function imGetUnit() {
    try { return localStorage.getItem(IMPORT_UNIT_KEY) === 'kg' ? 'kg' : 'lbs'; } catch (_) { return 'lbs'; }
}
function imSetUnit(u) { try { localStorage.setItem(IMPORT_UNIT_KEY, u); } catch (_) {} }

// 여러 소스에서 나온 같은 날짜를 하나로 합친다
function imMergeDays(days) {
    const byDate = {};
    const out = [];
    days.forEach(d => {
        const prev = byDate[d.date];
        if (!prev) { byDate[d.date] = d; out.push(d); return; }
        d.items.forEach(i => prev.items.push(i));
        d.bodyParts.forEach(p => { if (prev.bodyParts.indexOf(p) < 0) prev.bodyParts.push(p); });
        if (prev.condition == null) prev.condition = d.condition;
        if (!prev.startTime) { prev.startTime = d.startTime; prev.endTime = d.endTime; }
        prev.memoText = [prev.memoText, d.memoText].filter(Boolean).join(' · ').slice(0, 300);
    });
    return out.sort((a, b) => a.date < b.date ? -1 : 1);
}

// 하루치 = 요청 1건 (세션 + 운동 전체)
async function importOneDay(d) {
    const dto = toSessionDTO({
        date: d.date,
        startTime: d.startTime,
        endTime: d.endTime,
        durationMin: spanMinutes(d.startTime, d.endTime),
        condition: d.condition,
        bodyParts: d.bodyParts,
        memo: d.memoText || ''
    });
    // toSessionDTO 는 평소 workouts 를 보내지 않지만(세션 메타만 다룸),
    // 가져오기에서는 세션 생성과 동시에 운동을 저장해야 하므로 여기서만 함께 싣는다.
    dto.workouts = d.items.map(toWorkoutDTO);
    const res = await api.addSession(dto);
    upsertSessionLocal(fromSessionDTO(res));
}

function openImportSheet(defaultDate) {
    const date0 = defaultDate || todayStr();
    const d0 = parseDate(date0);
    let year = d0.getFullYear();
    let month = d0.getMonth() + 1;
    let forceYm = false;
    let unit = imGetUnit();
    let dup = 'skip';
    let parsed = null;
    let busy = false;

    // 기준 연도 후보: 올해 기준 앞뒤로 넉넉히
    const thisYear = new Date().getFullYear();
    const years = [];
    for (let y = thisYear + 1; y >= thisYear - 12; y--) years.push(y);

    openSheet(`
        <!-- [B] edit by smsong : 기준 연·월을 고르고 파일을 넣으면 한 번에 마이그레이션 -->
        <div class="field">
            <label>기준 연·월</label>
            <div class="ym-row">
                <select class="select" id="imYear">
                    ${years.map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}년</option>`).join('')}
                </select>
                <select class="select" id="imMonth">
                    ${Array.from({ length: 12 }, (_, i) => i + 1).map(m => `<option value="${m}" ${m === month ? 'selected' : ''}>${m}월</option>`).join('')}
                </select>
            </div>
            <label class="check-row im-check">
                <input type="checkbox" id="imForce">
                <span class="box">${icon('check')}</span>
                <span>파일에 적힌 연·월 무시</span>
            </label>
        </div>

        <div class="field">
            <label>단위 없는 숫자 <span class="lbl-sub">예) (190)</span></label>
            <div class="seg im-seg" id="imUnit">
                <button data-u="lbs" class="${unit === 'lbs' ? 'active' : ''}" type="button">lbs · 머신</button>
                <button data-u="kg" class="${unit === 'kg' ? 'active' : ''}" type="button">kg</button>
            </div>
        </div>

        <div class="field">
            <label>파일 <span class="lbl-sub">.txt 여러 개</span></label>
            <input class="input im-file" id="imFiles" type="file" accept=".txt,text/plain" multiple>
        </div>

        <div class="field">
            <label>또는 붙여넣기</label>
            <textarea class="input im-text" id="imText" placeholder="플랫 벤치프레스 3rep 1set (85kg)&#10;체스트 프레스 머신 4rep 2set (190)&#10;풀업 12rep 1set"></textarea>
        </div>

        <div class="field">
            <label>기본 날짜 <span class="lbl-sub">날짜 줄이 없을 때</span></label>
            <input class="input" id="imDate" type="date" value="${date0}">
        </div>

        <div class="field">
            <label>이미 기록이 있는 날짜</label>
            <div class="seg im-seg" id="imDup">
                <button data-d="skip" class="active" type="button">건너뛰기</button>
                <button data-d="add" type="button">새 기록으로 추가</button>
            </div>
        </div>
        <!-- [E] edit by smsong -->

        <div id="imPreview"></div>
        <button class="btn grad block" id="imGo" style="margin-top:6px">분석하기</button>
    `, {
        title: '운동 기록 가져오기',
        // [B][E] edit by smsong : 연·월/단위 같은 설정 변경은 이탈 확인 대상이 아니다.
        //   실제로 "적은 기록"(붙여넣은 텍스트 / 고른 파일)이 있을 때만 확인한다.
        isDirty: () => {
            const t = document.getElementById('imText');
            const f = document.getElementById('imFiles');
            return !!(t && t.value.trim()) || !!(f && f.files && f.files.length);
        }
    });

    const $ = id => document.getElementById(id);
    const taEl = $('imText'), fileEl = $('imFiles'), goEl = $('imGo'), pvEl = $('imPreview');
    const yEl = $('imYear'), mEl = $('imMonth'), fEl = $('imForce');

    function resetParsed() {
        if (busy) return;
        parsed = null; pvEl.innerHTML = ''; goEl.textContent = '분석하기';
    }
    taEl.oninput = resetParsed;
    fileEl.onchange = resetParsed;
    // [B] edit by smsong : 연·월을 바꾸면 기본 날짜의 연·월도 같이 맞춘다(일자는 유지)
    function syncBaseDate() {
        year = Number(yEl.value); month = Number(mEl.value);
        const day = Math.min(Number(($('imDate').value || date0).slice(8, 10)) || 1,
                             new Date(year, month, 0).getDate());
        $('imDate').value = year + '-' + pad(month) + '-' + pad(day);
        resetParsed();
    }
    yEl.onchange = syncBaseDate;
    mEl.onchange = syncBaseDate;
    fEl.onchange = () => { forceYm = fEl.checked; resetParsed(); };
    $('imDate').onchange = resetParsed;
    // [E] edit by smsong
    document.querySelectorAll('#imUnit button').forEach(b => b.onclick = () => {
        unit = b.dataset.u; imSetUnit(unit);
        document.querySelectorAll('#imUnit button').forEach(x => x.classList.toggle('active', x === b));
        resetParsed();
    });
    document.querySelectorAll('#imDup button').forEach(b => b.onclick = () => {
        dup = b.dataset.d;
        document.querySelectorAll('#imDup button').forEach(x => x.classList.toggle('active', x === b));
        if (parsed) preview();
    });

    goEl.onclick = async () => {
        if (busy) return;
        if (!parsed) await analyze(); else await upload();
    };

    // ---------- 분석 ----------
    async function analyze() {
        const sources = [];
        const files = fileEl.files ? Array.prototype.slice.call(fileEl.files) : [];
        try {
            for (const f of files) sources.push({ name: f.name, text: await f.text() });
        } catch (_) { toast('파일을 읽지 못했어요'); return; }
        const ta = taEl.value.trim();
        if (ta) sources.push({ name: '붙여넣기', text: ta });
        if (!sources.length) { toast('기록을 붙여넣거나 파일을 선택하세요'); return; }

        const base = $('imDate').value || todayStr();
        let days = [], warnings = [], restCount = 0;
        sources.forEach(src => {
            // [B][E] edit by smsong : 기준 연·월(+강제 적용)을 파서에 전달
            const r = parseWorkoutText(src.text, {
                unit: unit, defaultDate: base,
                year: year, month: month, forceYm: forceYm
            });
            r.days.forEach(d => days.push(d));
            r.warnings.forEach(w => warnings.push((sources.length > 1 ? src.name + ' · ' : '') + w));
            restCount += r.restCount;
        });
        parsed = { days: imMergeDays(days), warnings: warnings, restCount: restCount };
        preview();
    }

    // ---------- 미리보기 ----------
    function targetDays() {
        return dup === 'skip' ? parsed.days.filter(d => !sessionsByDate(d.date).length) : parsed.days;
    }
    function preview() {
        const all = parsed.days;
        if (!all.length) {
            pvEl.innerHTML = `<div class="im-box im-warn">해석된 운동이 없어요. 형식을 확인해 주세요.
                ${parsed.restCount ? `<br>휴식으로 표시된 ${parsed.restCount}일은 원래 제외됩니다.` : ''}</div>`;
            goEl.textContent = '분석하기'; parsed = null; return;
        }
        const target = targetDays();
        const skipped = all.length - target.length;
        const items = target.reduce((a, d) => a + d.items.length, 0);
        const names = {};
        target.forEach(d => d.items.forEach(i => { names[i.exercise] = 1; }));
        const newNames = Object.keys(names).filter(n => state.exercises.indexOf(n) < 0);

        pvEl.innerHTML = `
            <div class="im-box">
                <div class="im-sum">
                    <span><b class="tabnum">${target.length}</b>일</span>
                    <span><b class="tabnum">${items}</b>개 운동</span>
                    <span>새 종목 <b class="tabnum">${newNames.length}</b>개</span>
                </div>
                ${parsed.restCount ? `<div class="im-note">휴식 ${parsed.restCount}일은 제외했어요.</div>` : ''}
                ${skipped ? `<div class="im-note">이미 기록이 있는 ${skipped}일은 건너뜁니다.</div>` : ''}
                <div class="im-days">
                    ${target.slice(0, 40).map(d => `
                        <div class="im-day">
                            <span class="im-d">${esc(d.date)}</span>
                            <span class="im-p">${d.bodyParts.length ? esc(d.bodyParts.join(' · ')) : '<span class="muted">부위 없음</span>'}</span>
                            <span class="im-c tabnum">${d.items.length}개${d.condition != null ? ' · 컨디션 ' + d.condition : ''}</span>
                        </div>`).join('')}
                    ${target.length > 40 ? `<div class="im-note">외 ${target.length - 40}일…</div>` : ''}
                </div>
                ${parsed.warnings.length ? `<div class="im-warn">
                    해석 못한 줄 ${parsed.warnings.length}개 (건너뜀)
                    <ul>${parsed.warnings.slice(0, 5).map(w => `<li>${esc(w)}</li>`).join('')}</ul>
                </div>` : ''}
            </div>`;
        goEl.textContent = target.length ? `${target.length}일 업로드` : '업로드할 날짜 없음';
    }

    // ---------- 업로드 ----------
    async function upload() {
        const target = targetDays();
        if (!target.length) { toast('업로드할 날짜가 없어요'); return; }

        busy = true; goEl.disabled = true; taEl.disabled = true; fileEl.disabled = true;
        yEl.disabled = mEl.disabled = fEl.disabled = true;
        const names = {};
        target.forEach(d => d.items.forEach(i => { names[i.exercise] = 1; }));
        const newNames = Object.keys(names).filter(n => state.exercises.indexOf(n) < 0);

        const total = target.length + newNames.length;
        let step = 0;
        const bar = (msg) => {
            pvEl.innerHTML = `<div class="im-box">
                <div class="im-note">${esc(msg)}</div>
                <div class="im-bar"><b style="width:${Math.round(step / total * 100)}%"></b></div>
            </div>`;
        };

        try {
            // 1) 새 종목 먼저 등록 (콤보박스에서 바로 고를 수 있도록)
            for (const n of newNames) {
                bar(`종목 등록 중… ${n}`);
                try { await addExerciseType(n); } catch (err) { if (err && err.auth) throw err; }
                step++;
            }
            // 2) 날짜별 업로드
            let ok = 0; const fails = [];
            for (const d of target) {
                bar(`${d.date} 업로드 중… (${ok + fails.length + 1}/${target.length})`);
                try { await importOneDay(d); ok++; }
                catch (err) {
                    if (err && err.auth) throw err;
                    fails.push(d.date + ' — ' + errMsg(err, '실패'));
                }
                step++;
            }
            render();
            if (!fails.length) { closeSheet(); toast(`${ok}일 · 운동 ${target.reduce((a, d) => a + d.items.length, 0)}개를 가져왔어요`); }
            else {
                busy = false; goEl.disabled = false; taEl.disabled = false; fileEl.disabled = false;
                yEl.disabled = mEl.disabled = fEl.disabled = false;
                parsed = null; goEl.textContent = '분석하기';
                pvEl.innerHTML = `<div class="im-box im-warn">${ok}일 성공 · ${fails.length}일 실패
                    <ul>${fails.slice(0, 5).map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>`;
                toast('일부 날짜를 저장하지 못했어요');
            }
        } catch (err) {
            if (err && err.auth) return;   // 세션 만료 → auth.js 가 로그인으로 보냄
            busy = false; goEl.disabled = false; taEl.disabled = false; fileEl.disabled = false;
            yEl.disabled = mEl.disabled = fEl.disabled = false;
            toast(errMsg(err, '가져오기에 실패했어요'));
        }
    }
}
// [E] edit by smsong

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
        pencil: `<svg viewBox="0 0 24 24" ${s}><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
        // [E] edit by smsong
        // [B] edit by smsong : 전체보기(확대) / 작게 보기(축소) / 닫기
        expand: `<svg viewBox="0 0 24 24" ${s}><path d="M9 3H3v6"/><path d="M3 3l7 7"/><path d="M15 21h6v-6"/><path d="M21 21l-7-7"/></svg>`,
        collapse: `<svg viewBox="0 0 24 24" ${s}><path d="M3 10h6V4"/><path d="M10 10 3 3"/><path d="M21 14h-6v6"/><path d="m14 14 7 7"/></svg>`,
        x: `<svg viewBox="0 0 24 24" ${s}><path d="M6 6l12 12M18 6 6 18"/></svg>`,
        minus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M5 12h14"/></svg>`,
        // [B][E] edit by smsong : 기록 가져오기(붙여넣기)
        paste: `<svg viewBox="0 0 24 24" ${s}><path d="M9 4H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/><rect x="9" y="2.5" width="6" height="3.5" rx="1"/><path d="M9 12h6M9 16h4"/></svg>`
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
