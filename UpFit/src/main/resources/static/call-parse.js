/* =====================================================================
 * call-parse.js — 통화 녹음 파싱 (STT + LLM) → 확인 → 건물/호실/계약자 생성
 * ---------------------------------------------------------------------
 * main.js 의 기존 전역(showModal/closeModal/showToast/showLoading/hideLoading,
 * escapeHtml/icon/Api/getUid/authHeaders/loadData/renderMarkers/updateStats/
 * switchTab/selectBuilding/myPerms/isBroker/state/map)을 그대로 사용한다.
 *
 * index/main.html 에서 main.js 뒤에 로드:
 *   <script src="main.js?v=1.0.0"></script>
 *   <script src="call-parse.js?v=1.0.0"></script>
 *
 * 트리거: 아무 버튼에서 openCallParseModal() 호출.
 * ===================================================================== */
(function () {
    'use strict';

    // ---- 모듈 상태 -------------------------------------------------
    let _callDraft = null;      // 파싱된 초안 (사용자가 편집)
    let _pickedFile = null;     // 선택된 오디오 파일

    // ---- Api 확장: 통화 파싱 엔드포인트 ----------------------------
    // POST /ai/parse-call (multipart: uid + audio) → CallDraftDTO
    Api.parseCall = (file) => {
        const fd = new FormData();
        fd.append('uid', getUid());
        fd.append('audio', file);
        // FormData 전송 → Content-Type 자동(boundary). authHeaders()만 사용.
        return fetch(`${API_BASE_URL}/ai/parse-call`, {
            method: 'POST', headers: authHeaders(), body: fd
        }).then(handleResponse);
    };

    // ---- 전화 버튼 표시 제어: 중개인(broker) 권한 계정에만 노출 ----
    // 건물 생성(+) 버튼과 동일하게 applyPermUI 타이밍에 맞춰 표시/숨김한다.
    function applyCallBtnVisibility() {
        const btn = document.getElementById('call-parse-float');
        if (!btn) return;
        const broker = (typeof isBroker === 'function') ? isBroker() : false;
        btn.style.display = broker ? '' : 'none';   // '' → CSS 기본값(flex)로 복귀
    }
    // main.js의 applyPermUI 를 감싸 권한 로드 후에도 함께 갱신되게 함
    if (typeof window.applyPermUI === 'function') {
        const _origApplyPermUI = window.applyPermUI;
        window.applyPermUI = function () {
            _origApplyPermUI.apply(this, arguments);
            applyCallBtnVisibility();
        };
    }
    // 로드 시 즉시 1회 적용 (비중개인 계정에서 버튼이 잠깐 보이는 깜빡임 방지)
    applyCallBtnVisibility();

    // ---- 최소 스타일 주입 (main.css 수정 없이) ---------------------
    function injectStyles() {
        if (document.getElementById('cp-styles')) return;
        const css = `
      .cp-note{font-size:13px;color:var(--gray-500);line-height:1.6;margin-bottom:12px;}
      .cp-drop{border:1.5px dashed var(--gray-300);border-radius:var(--radius-md);
        padding:22px 14px;text-align:center;cursor:pointer;color:var(--gray-600);
        background:var(--gray-50);transition:border-color .15s,background .15s;}
      .cp-drop:hover{border-color:var(--blue);background:var(--blue-light);color:var(--blue);}
      .cp-drop .cp-fname{margin-top:8px;font-size:13px;font-weight:600;color:var(--gray-800);word-break:break-all;}
      .cp-transcript{background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius-sm);
        padding:10px 12px;font-size:12.5px;line-height:1.7;color:var(--gray-700);
        max-height:180px;overflow-y:auto;white-space:pre-wrap;}
      .cp-unit-card{border:1px solid var(--gray-200);border-radius:var(--radius-md);
        padding:12px;margin-bottom:10px;background:var(--white);position:relative;}
      .cp-unit-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
      .cp-unit-title{font-size:13px;font-weight:700;color:var(--gray-800);}
      .cp-unit-del{border:none;background:var(--red-light);color:var(--red);border-radius:8px;
        width:26px;height:26px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
      .cp-lowconf{border-left:3px solid var(--amber);padding-left:10px;}
      .cp-badge{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;
        background:var(--amber-light);color:var(--amber);margin-left:6px;vertical-align:middle;}
      .cp-add-unit{width:100%;padding:10px;border:1.5px dashed var(--gray-300);border-radius:var(--radius-md);
        background:var(--white);color:var(--gray-600);font-weight:600;font-size:13px;cursor:pointer;font-family:var(--font);}
      .cp-add-unit:hover{border-color:var(--blue);color:var(--blue);}
      .cp-check{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--gray-700);margin-bottom:10px;}
    `;
        const el = document.createElement('style');
        el.id = 'cp-styles';
        el.textContent = css;
        document.head.appendChild(el);
    }

    // ---- 1) 업로드 모달 -------------------------------------------
    window.openCallParseModal = function () {
        // 생성 권한자(중개인/관리자)만 사용
        if (!myPerms().canCreate) { showToast('생성 권한이 있는 중개인만 사용할 수 있습니다'); return; }
        injectStyles();
        _pickedFile = null;
        _callDraft = null;

        document.getElementById('modal-title').textContent = '통화 녹음으로 등록';
        document.getElementById('modal-body').innerHTML = `
      <div class="cp-note">
        통화 녹음 파일(m4a·mp3·wav 등)을 올리면 음성을 텍스트로 바꾸고
        AI가 건물·호실·계약자 정보를 정리합니다. 확인·수정 후 등록하세요.
      </div>
      <div class="cp-drop" id="cp-drop" onclick="document.getElementById('cp-file').click()">
        ${icon('phone', 26)}
        <div>여기를 눌러 녹음 파일 선택</div>
        <div class="cp-fname" id="cp-fname"></div>
      </div>
      <input id="cp-file" type="file" accept="audio/*,.m4a,.mp3,.wav,.amr,.aac,.ogg" style="display:none">
    `;
        document.getElementById('modal-footer').innerHTML = `
      <button class="btn-secondary" onclick="closeModal()">취소</button>
      <button class="btn-primary" id="cp-start-btn" onclick="startCallParse()">분석 시작</button>
    `;

        document.getElementById('cp-file').addEventListener('change', (e) => {
            _pickedFile = e.target.files && e.target.files[0] ? e.target.files[0] : null;
            const fn = document.getElementById('cp-fname');
            if (fn) fn.textContent = _pickedFile ? _pickedFile.name : '';
        });

        showModal();
    };

    // ---- 2) 분석 시작 → STT+LLM ----------------------------------
    window.startCallParse = async function () {
        if (_isSubmitting) return;
        if (!_pickedFile) { showToast('녹음 파일을 선택하세요'); return; }

        showLoading('음성 인식 후 내용을 정리하는 중…');
        try {
            const draft = await Api.parseCall(_pickedFile);
            _callDraft = normalizeDraft(draft);
            renderCallDraft();
        } catch (e) {
            showToast('분석 실패: ' + (e.message || e));
        } finally {
            hideLoading();
        }
    };

    // 서버 초안의 누락 필드 방어적 보정
    function normalizeDraft(d) {
        d = d || {};
        d.building = d.building || {};
        d.units = Array.isArray(d.units) ? d.units : [];
        d.tenant = d.tenant || null;
        d.confidence = d.confidence || {};
        return d;
    }

    // ---- 3) 초안 편집 화면 ---------------------------------------
    function renderCallDraft() {
        const b = _callDraft.building;
        const conf = _callDraft.confidence || {};
        const lowB = (conf.building != null && conf.building < 0.6);

        const brokerTenant = isBroker() ? tenantSectionHtml() : '';

        document.getElementById('modal-title').textContent = '내용 확인 후 등록';
        document.getElementById('modal-body').innerHTML = `
      <details style="margin-bottom:14px;">
        <summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--gray-600);">전사 내용 보기</summary>
        <div class="cp-transcript" style="margin-top:8px;">${escapeHtml(_callDraft.transcript || '(없음)')}</div>
      </details>

      <div class="form-section-title">건물 ${lowB ? '<span class="cp-badge">확인 필요</span>' : ''}</div>
      <div class="${lowB ? 'cp-lowconf' : ''}">
        <div class="form-group">
          <label class="form-label">건물명 *</label>
          <input id="cp-b-name" class="form-input" type="text" value="${escapeHtml(b.name)}" placeholder="예: 강남 상가빌딩">
        </div>
        <div class="form-group">
          <label class="form-label">주소 <span style="font-weight:400;color:var(--gray-400);">(등록 시 이 주소로 지도 위치 자동 설정)</span></label>
          <input id="cp-b-addr" class="form-input" type="text" value="${escapeHtml(b.address)}" placeholder="주소">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">건물 유형</label>
            ${selectHtml('cp-b-type', b.type, [
            ['house', '단독&다중'], ['multiplex', '다세대'], ['officetel', '오피스텔'],
            ['apartment', '아파트'], ['neighborhood', '근린생활시설'], ['commercial', '상가']
        ])}
          </div>
          <div class="form-group">
            <label class="form-label">거래유형</label>
            ${dealSelectHtml('cp-b-deal', b.dealType)}
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">보증금/매매가 (만원)</label>
            <input id="cp-b-deposit" class="form-input" type="number" min="0" value="${numv(b.deposit)}"></div>
          <div class="form-group"><label class="form-label">월세 (만원)</label>
            <input id="cp-b-rent" class="form-input" type="number" min="0" value="${numv(b.rent)}"></div>
        </div>
        <div class="form-group"><label class="form-label">관리비 (만원)</label>
          <input id="cp-b-manage" class="form-input" type="number" min="0" value="${numv(b.manage)}"></div>
      </div>

      <div class="form-section-title">호실 (${_callDraft.units.length})</div>
      <div id="cp-units"></div>
      <button class="cp-add-unit" onclick="cpAddUnit()">${icon('plus', 14)} 호실 추가</button>

      ${brokerTenant}
    `;
        document.getElementById('modal-footer').innerHTML = `
      <button class="btn-secondary" onclick="closeModal()">취소</button>
      <button class="btn-primary" onclick="confirmCallDraft()">확인 후 등록</button>
    `;

        renderUnits();
    }

    function tenantSectionHtml() {
        const t = _callDraft.tenant || {};
        const has = !!(t.phone || t.buildingName || t.unitName);
        return `
      <div class="form-section-title">계약자 (중개사)</div>
      <label class="cp-check">
        <input type="checkbox" id="cp-t-include" ${has ? 'checked' : ''}> 계약자 목록에도 함께 등록
      </label>
      <div class="form-group"><label class="form-label">전화번호</label>
        <input id="cp-t-phone" class="form-input" type="text" value="${escapeHtml(t.phone)}" placeholder="010-0000-0000"></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">건물명</label>
          <input id="cp-t-bname" class="form-input" type="text" value="${escapeHtml(t.buildingName)}"></div>
        <div class="form-group"><label class="form-label">호실</label>
          <input id="cp-t-uname" class="form-input" type="text" value="${escapeHtml(t.unitName)}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">보증금 (만원)</label>
          <input id="cp-t-deposit" class="form-input" type="number" min="0" value="${numv(t.deposit)}"></div>
        <div class="form-group"><label class="form-label">월세 (만원)</label>
          <input id="cp-t-rent" class="form-input" type="number" min="0" value="${numv(t.rent)}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">계약 시작</label>
          <input id="cp-t-cstart" class="form-input" type="date" value="${escapeHtml(t.contractStart)}"></div>
        <div class="form-group"><label class="form-label">계약 만료</label>
          <input id="cp-t-cend" class="form-input" type="date" value="${escapeHtml(t.contractEnd)}"></div>
      </div>`;
    }

    // ---- 호실 목록 렌더 / 추가 / 삭제 -----------------------------
    function renderUnits() {
        const wrap = document.getElementById('cp-units');
        if (!wrap) return;
        wrap.innerHTML = _callDraft.units.map((u, i) => unitCardHtml(u, i)).join('');
    }

    function unitCardHtml(u, i) {
        u = u || {};
        return `
      <div class="cp-unit-card" data-idx="${i}">
        <div class="cp-unit-head">
          <span class="cp-unit-title">호실 ${i + 1}</span>
          <button class="cp-unit-del" onclick="cpRemoveUnit(${i})" title="삭제">${icon('close', 13)}</button>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">층</label>
            <input id="cpu-floor-${i}" class="form-input" type="number" value="${numv(u.floor)}"></div>
          <div class="form-group"><label class="form-label">호실명</label>
            <input id="cpu-name-${i}" class="form-input" type="text" value="${escapeHtml(u.name)}" placeholder="예: 101호"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">현황</label>
            ${selectHtml('cpu-status-' + i, u.status || 'empty', [['empty', '공실'], ['occupied', '임차중'], ['expiring', '만료임박']])}</div>
          <div class="form-group"><label class="form-label">거래유형</label>
            ${dealSelectHtml('cpu-deal-' + i, u.dealType)}</div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">보증금 (만원)</label>
            <input id="cpu-deposit-${i}" class="form-input" type="number" min="0" value="${numv(u.deposit)}"></div>
          <div class="form-group"><label class="form-label">월세 (만원)</label>
            <input id="cpu-rent-${i}" class="form-input" type="number" min="0" value="${numv(u.rent)}"></div>
        </div>
        <div class="form-group"><label class="form-label">임차인</label>
          <input id="cpu-tenant-${i}" class="form-input" type="text" value="${escapeHtml(u.tenant)}"></div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">계약 시작</label>
            <input id="cpu-cstart-${i}" class="form-input" type="date" value="${escapeHtml(u.contractStart)}"></div>
          <div class="form-group"><label class="form-label">계약 만료</label>
            <input id="cpu-cend-${i}" class="form-input" type="date" value="${escapeHtml(u.contractEnd)}"></div>
        </div>
      </div>`;
    }

    // 편집 중인 값을 먼저 저장하고 다시 그려야 입력이 날아가지 않는다.
    window.cpAddUnit = function () {
        syncUnitsFromDom();
        _callDraft.units.push({ floor: 0, name: '', status: 'empty', dealType: null, deposit: 0, rent: 0, manage: 0, tenant: '' });
        renderUnits();
    };
    window.cpRemoveUnit = function (i) {
        syncUnitsFromDom();
        _callDraft.units.splice(i, 1);
        renderUnits();
    };

    function syncUnitsFromDom() {
        const cards = document.querySelectorAll('.cp-unit-card');
        const arr = [];
        cards.forEach((card) => {
            const i = card.getAttribute('data-idx');
            arr.push({
                floor: intv(`cpu-floor-${i}`),
                name: sval(`cpu-name-${i}`),
                status: sval(`cpu-status-${i}`) || 'empty',
                dealType: sval(`cpu-deal-${i}`) || null,
                deposit: intv(`cpu-deposit-${i}`),
                rent: intv(`cpu-rent-${i}`),
                manage: 0,
                tenant: sval(`cpu-tenant-${i}`),
                contractStart: sval(`cpu-cstart-${i}`) || null,
                contractEnd: sval(`cpu-cend-${i}`) || null
            });
        });
        _callDraft.units = arr;
    }

    // ---- 4) 확정 → 기존 생성 API 로 저장 --------------------------
    window.confirmCallDraft = async function () {
        if (_isSubmitting) return;

        const name = sval('cp-b-name');
        if (!name) { showToast('건물명을 입력하세요'); return; }
        syncUnitsFromDom();

        const building = {
            name: name,
            address: sval('cp-b-addr'),
            type: sval('cp-b-type'),
            dealType: sval('cp-b-deal') || null,
            deposit: intv('cp-b-deposit'),
            rent: intv('cp-b-rent'),
            manage: intv('cp-b-manage'),
            units: []
        };
        const units = _callDraft.units.slice();

        showLoading('건물·호실을 등록하는 중…');
        try {
            // 주소 → 좌표 (네이버 지오코더). 실패하면 현재 지도 중심 사용.
            let coords = await geocodeAddress(building.address);
            if (!coords && typeof map !== 'undefined' && map && map.getCenter) {
                const c = map.getCenter(); coords = { lat: c.lat(), lng: c.lng() };
            }
            if (!coords) coords = { lat: 37.5665, lng: 126.9780 }; // 서울시청 폴백
            building.lat = coords.lat; building.lng = coords.lng;

            // 1) 건물 생성 → id 확보 (importNaverJson 과 동일한 순서)
            const created = await Api.createBuilding(building);
            const buildingId = String(created.id);

            // 2) 호실 순차 생성
            for (const u of units) {
                await Api.createUnit(buildingId, {
                    floor: u.floor, name: u.name, status: u.status || 'empty',
                    dealType: u.dealType || null, deposit: u.deposit || 0, rent: u.rent || 0,
                    manage: u.manage || 0, tenant: u.tenant || null,
                    contractStart: u.contractStart || null, contractEnd: u.contractEnd || null
                });
            }

            // 3) 계약자 (중개사 + 체크 시). 실패해도 건물 등록은 유지.
            if (isBroker()) {
                const inc = document.getElementById('cp-t-include');
                if (inc && inc.checked) {
                    const t = {
                        phone: sval('cp-t-phone'), buildingName: sval('cp-t-bname') || name,
                        unitName: sval('cp-t-uname'), deposit: intv('cp-t-deposit'),
                        rent: intv('cp-t-rent'), manage: 0,
                        contractStart: sval('cp-t-cstart') || null, contractEnd: sval('cp-t-cend') || null
                    };
                    try { await Api.createTenant(t); } catch (e) { console.warn('계약자 등록 실패:', e); }
                }
            }

            await loadData();
            closeModal();
            if (typeof renderMarkers === 'function') renderMarkers();
            if (typeof updateStats === 'function') updateStats();
            showToast(`'${name}' 등록 완료 (호실 ${units.length}개)`);

            if (typeof map !== 'undefined' && map) switchTab('map');
            selectBuilding(buildingId);
        } catch (e) {
            showToast('등록 실패: ' + (e.message || e));
        } finally {
            hideLoading();
        }
    };

    // ---- 유틸 -----------------------------------------------------
    function geocodeAddress(addr) {
        return new Promise((resolve) => {
            if (!addr || typeof naver === 'undefined' || !naver.maps || !naver.maps.Service) return resolve(null);
            try {
                naver.maps.Service.geocode({ query: addr }, (status, res) => {
                    if (status !== naver.maps.Service.Status.OK) return resolve(null);
                    const item = res && res.v2 && res.v2.addresses && res.v2.addresses[0];
                    if (!item) return resolve(null);
                    resolve({ lat: parseFloat(item.y), lng: parseFloat(item.x) });
                });
            } catch (_) { resolve(null); }
        });
    }

    function selectHtml(id, val, opts) {
        return `<select id="${id}" class="form-select">` +
            opts.map(([v, label]) =>
                `<option value="${v}" ${val === v ? 'selected' : ''}>${label}</option>`).join('') +
            `</select>`;
    }
    function dealSelectHtml(id, val) {
        return `<select id="${id}" class="form-select">` +
            `<option value="" ${!val ? 'selected' : ''}>미지정</option>` +
            `<option value="sale" ${val === 'sale' ? 'selected' : ''}>매매</option>` +
            `<option value="jeonse" ${val === 'jeonse' ? 'selected' : ''}>전세</option>` +
            `<option value="monthly" ${val === 'monthly' ? 'selected' : ''}>월세</option></select>`;
    }
    function sval(id) { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
    function intv(id) { const n = parseInt(sval(id), 10); return isNaN(n) ? 0 : n; }
    function numv(v) { return (v == null || v === 0) ? '' : v; }   // 0/null 은 빈칸으로 표시

})();