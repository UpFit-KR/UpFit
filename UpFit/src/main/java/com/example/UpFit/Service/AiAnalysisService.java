package com.example.UpFit.Service;

import com.example.UpFit.Config.GeminiProperties;
import com.example.UpFit.DTO.AiAnalysisRequestDTO;
import com.example.UpFit.DTO.AiAnalysisResponseDTO;
import com.example.UpFit.DTO.AiSessionRequestDTO;
import com.example.UpFit.Entity.AiResultEntity;
import com.example.UpFit.Repository.AiResultRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestClient;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

// [B] edit by smsong - AI 운동 분석 서비스 (Gemini).
//   역할:
//     1) "웨이트 트레이닝 전문 지식"을 시스템 프롬프트로 모델에 주입(=학습 대신 지식 주입).
//     2) 사용자 데이터(해당 종목 전체 이력 + 현재 비교 두 시점 + 체중)를 사용자 프롬프트로 전달.
//     3) 정해진 JSON 스키마로만 답하도록 강제 → 파싱해 구조화 응답 반환.
//   보안: API 키는 서버(yml)에만 두고, 프런트는 이 엔드포인트만 호출한다(키 노출 방지).
@Service
@RequiredArgsConstructor
public class AiAnalysisService {

    private static final Logger log = LoggerFactory.getLogger(AiAnalysisService.class);

    private final GeminiProperties props;
    private final AiResultRepository aiResultRepository;   // [B][E] edit by smsong : AI 결과 저장/조회
    private final ObjectMapper om = new ObjectMapper();
    private final RestClient http = RestClient.create();

    // ─────────────────────────────────────────────────────────────
    //  웨이트 트레이닝 도메인 지식 (시스템 프롬프트)
    //  모델이 근비대/근력/회복/과부하 원리에 근거해 "근성장 vs 근손실"을 판별하도록 지식을 고정한다.
    // ─────────────────────────────────────────────────────────────
    private static final String SYSTEM_KNOWLEDGE = String.join("\n",
        "당신은 웨이트 트레이닝(근력·근비대) 전문 코치이자 데이터 분석가입니다.",
        "다음 원리에 근거해 사용자의 특정 종목 수행 이력을 분석합니다.",
        "",
        "[핵심 원리]",
        "1) 점진적 과부하(progressive overload): 근성장의 근본 동력. 무게·횟수·세트·볼륨(무게×횟수×세트)이",
        "   장기적으로 우상향하면 성장 신호. 볼륨은 근비대의 1차 지표, 최고 무게(1RM 근사)는 근력의 지표.",
        "2) 변동성은 정상: 하루하루의 수치는 컨디션·수면·영양·스트레스로 출렁인다. 한두 세션의 하락은",
        "   근손실이 아니라 '노이즈'일 가능성이 높다. 추세는 3~5회 이상의 흐름으로 판단한다.",
        "3) 디로드/회복: 수치가 꺾여도 직전 세션의 볼륨이 매우 높았거나 컨디션이 낮았다면, 이는 피로 누적에",
        "   따른 일시적 저하(회복 부족)일 수 있다. 이 경우 '근손실'로 단정하지 않는다.",
        "4) 컨디션 해석: 성장했는데 컨디션이 유독 높았다면 '실력 향상'인지 '그날 컨디션 효과'인지 구분한다.",
        "   반대로 컨디션이 낮은 날의 하락은 실제 능력 저하가 아닐 수 있다.",
        "5) 보조(스팟) 세트: 파트너 보조를 받은 세트의 고중량은 '혼자 든 능력'을 과대평가하게 만든다.",
        "   보조 포함/제외 여부(includeAssisted)를 반드시 감안한다.",
        "6) 근손실 판단 기준: 충분한 휴식(정상 빈도)에도 볼륨·최고무게가 여러 세션에 걸쳐 지속 하락할 때만",
        "   근손실 가능성을 언급한다. 훈련 공백이 길었다면 '디트레이닝 후 복귀'로 해석한다.",
        "7) 맨몸 종목: 무게가 없으므로 총 횟수·총 세트의 추세로 판단한다.",
        "8) 미래 예측: 최근 추세와 회복 상태를 근거로, 다음 세션에서 무엇을(무게/횟수/세트/휴식) 어떻게",
        "   조정하면 어떤 결과가 기대되는지 구체적으로 제시한다(예: '이번 주는 볼륨 10% 낮춰 회복 후 재도전').",
        "",
        "[분석 지침]",
        "- 분석 관점(사용자 프롬프트 첫 줄의 [분석 관점])을 최우선으로 따른다:",
        "  · trend(전체 추세)  → history 전체 흐름으로 장기 추세를 판단한다.",
        "  · compare(두 시점)  → 제시된 두 시점의 변화를 핵심으로 분석하고, history 는 맥락으로만 쓴다.",
        "- 무게/볼륨은 사용자 데이터에 명시된 단위(kg 또는 lbs)를 그대로 사용한다. lbs 로 기록된 종목은",
        "  분석 서술·수치·권장 무게를 모두 lbs 로 제시하고, 임의로 kg 으로 환산하지 않는다.",
        "- 데이터가 2~3개로 적으면 confidence 를 낮추고 cautions 에 한계를 명시한다.",
        "- 과장·단정 금지. 의학적 조언이 아니라 트레이닝 관점의 해석임을 유지한다.",
        "- 한국어로, 간결하고 실용적으로 작성한다.",
        "",
        "[출력 형식] — 정해진 JSON 스키마로만 응답한다(서버가 구조를 강제함). 마크다운/코드펜스 금지.",
        "  · headline : 한 줄 요약(40자 이내)",
        "  · trend    : up | down | flat | mixed 중 하나",
        "  · verdict  : growth | loss | maintain | unclear 중 하나",
        "  · confidence : 0~100 정수(데이터가 적으면 낮게)",
        "  · analysis : 핵심 분석 2~4개(각 항목 2~3문장). 장황하게 늘리지 말 것.",
        "  · recommendations : 실천 권장 2~3개(각 1~2문장)",
        "  · cautions : 주의/한계 0~2개",
        "전체 응답은 간결하게 유지한다(불필요하게 길게 쓰지 말 것)."
    );

    // [B] edit by smsong - 운동 상세(하루 세션) 분석 전용 도메인 지식.
    //   "그날 한 운동"을 사용자 신체·최근 부하 맥락에서 평가/예측하는 데 특화.
    private static final String SESSION_KNOWLEDGE = String.join("\n",
        "당신은 웨이트 트레이닝 코치이자 스포츠 과학 분석가다.",
        "사용자가 '특정 하루'에 수행한 운동 전체를, 그 사람의 신체 정보와 최근 운동량 맥락 위에서",
        "평가하고, 그 결과 피로도·회복·다음날 컨디션을 '예측'하는 것이 임무다.",
        "",
        "[분석·예측 기준]",
        "1) 운동량 적정성: 총 볼륨/세트/종목수를 사용자의 체격(키·체중·체지방·성별)과 recentLoads(최근 세션들)",
        "   대비로 평가한다. '이 사람 기준'으로 많은지 적은지를 말한다. 절대량이 아니라 상대적 부하가 핵심.",
        "2) volumePercentile: 이 사람의 최근 이력 대비 이날 운동량이 상위 몇 %인지(0~100).",
        "   값이 작을수록(예: 5) 평소보다 훨씬 고강도. recentLoads 가 부족하면 신중히 추정하고 confidence 를 낮춘다.",
        "3) intensityLevel: low|moderate|high|extreme 중 하나.",
        "4) fatigueScore(0~100): 이 세션으로 쌓일 예상 피로도. 볼륨·세트·부위 수·컨디션·시간 종합.",
        "5) nextDayCondition(0~100): 오늘 컨디션과 이 부하를 근거로 예측한 '다음날 예상 컨디션'.",
        "   고강도일수록 낮게. 컨디션 정보가 있으면 반영한다.",
        "6) overtraining: 최근 연속 고볼륨/누적 피로/컨디션 하락 신호가 겹치면 true. 근거를 analysis 에 적는다.",
        "7) overallGrade: 이날 운동의 종합 평가. S(매우 우수)~D. 볼륨·균형·강도·적정성 종합.",
        "8) 부위 균형·세트 분배·과부하 여부 등 구체적 코칭 포인트를 짚는다.",
        "",
        "[주의]",
        "- 신체정보(체지방 등)가 없으면 그 부분은 추정/일반론으로 처리하고 cautions 에 '체지방 미입력' 등 한계를 밝힌다.",
        "- 의학적 조언이 아니라 트레이닝 관점의 해석/예측임을 유지한다. 과장·단정 금지.",
        "- 무게 단위는 제공된 단위를 그대로 쓴다(lbs 로 온 값은 lbs 로 서술).",
        "- 한국어로, 구체적이고 실용적으로. 숫자는 근거와 함께 제시한다.",
        "",
        "[출력 형식] — 정해진 JSON 스키마로만 응답(서버가 구조 강제). 마크다운/코드펜스 금지.",
        "  · headline : 이날 운동 한 줄 총평(예: '평소보다 고강도 · 가슴 집중 · 피로 누적 주의')",
        "  · trend : 이날 강도 판정을 up(고강도)|flat(보통)|down(가벼움)|mixed 로.",
        "  · verdict : growth|maintain|loss|unclear 중, 이 운동이 성장 자극으로 충분했는지 관점으로.",
        "  · confidence : 0~100 (신체정보·최근이력이 적으면 낮게)",
        "  · analysis : 핵심 분석 3~5개(각 2~3문장). 운동량 적정성/부위균형/강도/피로 근거를 구체적으로.",
        "  · recommendations : 다음 훈련·회복 권장 2~4개",
        "  · cautions : 주의/한계 0~3개(오버트레이닝 경고, 신체정보 부족 등)",
        "  · volumePercentile, intensityLevel, fatigueScore, nextDayCondition, overtraining, overallGrade 를 반드시 채운다.",
        "전체 응답은 간결하게(불필요하게 길게 쓰지 말 것)."
    );
    // [E] edit by smsong

    public AiAnalysisResponseDTO analyze(AiAnalysisRequestDTO req) {
        String userPrompt = buildUserPrompt(req);
        // 종목 분석(추세/비교)은 성장 스키마로 호출
        return callGemini(SYSTEM_KNOWLEDGE, userPrompt, buildResponseSchema());
    }

    // [B] edit by smsong - AI 결과 저장/조회/삭제 (uid + type + refKey 로 1건).
    //   type: trend|compare|session
    @Transactional(readOnly = true)
    public AiAnalysisResponseDTO getSaved(String uid, String type, String refKey) {
        Optional<AiResultEntity> found = aiResultRepository.findByUidAndTypeAndRefKey(uid, type, refKey);
        if (found.isEmpty()) return null;
        try {
            return om.readValue(found.get().getResultJson(), AiAnalysisResponseDTO.class);
        } catch (Exception e) {
            log.warn("저장된 AI 결과 파싱 실패 (uid={}, type={}, refKey={})", uid, type, refKey, e);
            return null;
        }
    }

    @Transactional
    public void saveResult(String uid, String type, String refKey, AiAnalysisResponseDTO result) {
        if (refKey == null || refKey.isBlank()) return;   // 키 없으면 저장 생략
        try {
            String json = om.writeValueAsString(result);
            AiResultEntity e = aiResultRepository.findByUidAndTypeAndRefKey(uid, type, refKey)
                    .orElseGet(() -> AiResultEntity.builder()
                            .uid(uid).type(type).refKey(refKey)
                            .createdAt(LocalDateTime.now()).build());
            e.setResultJson(json);
            e.setUpdatedAt(LocalDateTime.now());
            if (e.getCreatedAt() == null) e.setCreatedAt(LocalDateTime.now());
            aiResultRepository.save(e);
        } catch (Exception ex) {
            log.warn("AI 결과 저장 실패 (uid={}, type={}, refKey={})", uid, type, refKey, ex);
        }
    }

    @Transactional
    public void deleteResult(String uid, String type, String refKey) {
        aiResultRepository.deleteByUidAndTypeAndRefKey(uid, type, refKey);
    }
    // [E] edit by smsong

    // [B] edit by smsong - 운동 상세(하루 세션) 분석. 신체정보+그날 운동 전체를 받아
    //   운동량 상위%, 피로도, 다음날 컨디션, 오버트레이닝, 종합 등급을 예측·분석한다.
    public AiAnalysisResponseDTO analyzeSession(AiSessionRequestDTO req) {
        String userPrompt = buildSessionPrompt(req);
        return callGemini(SESSION_KNOWLEDGE, userPrompt, buildSessionSchema());
    }
    // [E] edit by smsong

    // [B] edit by smsong - Gemini 호출 코어(공통). systemText/userPrompt/스키마만 갈아끼워 재사용.
    private AiAnalysisResponseDTO callGemini(String systemText, String userPrompt, ObjectNode schema) {
        if (props.getApiKey() == null || props.getApiKey().isBlank()) {
            throw new IllegalStateException("AI 기능이 설정되지 않았습니다(API 키 없음)");
        }
        // Gemini generateContent 요청 본문
        ObjectNode body = om.createObjectNode();

        // system_instruction 에 도메인 지식을 싣는다
        ObjectNode sys = body.putObject("system_instruction");
        sys.putArray("parts").addObject().put("text", systemText);

        ArrayNode contents = body.putArray("contents");
        ObjectNode userTurn = contents.addObject();
        userTurn.put("role", "user");
        userTurn.putArray("parts").addObject().put("text", userPrompt);

        // JSON 강제 + 창의성 낮춤(분석의 일관성)
        ObjectNode genCfg = body.putObject("generationConfig");
        genCfg.put("responseMimeType", "application/json");
        genCfg.put("temperature", 0.4);
        // thinking 모델은 maxOutputTokens 안에서 "사고 + 출력"을 함께 쓴다. 넉넉히 잡아 JSON 잘림 방지.
        genCfg.put("maxOutputTokens", 8192);
        ObjectNode thinking = genCfg.putObject("thinkingConfig");
        thinking.put("thinkingBudget", 1024);
        genCfg.set("responseSchema", schema);

        String url = "https://generativelanguage.googleapis.com/v1beta/models/"
                + props.getModel() + ":generateContent";

        String raw;
        try {
            raw = http.post()
                    .uri(url)
                    .header("x-goog-api-key", props.getApiKey())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(om.writeValueAsString(body))
                    .retrieve()
                    .body(String.class);
        } catch (Exception e) {
            log.error("Gemini 호출 실패", e);
            throw new RuntimeException("AI 분석 서버 호출에 실패했어요. 잠시 후 다시 시도해 주세요.");
        }

        try {
            return parse(raw);
        } catch (Exception e) {
            String head = raw == null ? "null" : raw.substring(0, Math.min(raw.length(), 1500));
            log.error("Gemini 응답 처리 실패. 원문(일부): {}", head, e);
            String msg = (e.getMessage() != null && !e.getMessage().isBlank())
                    ? e.getMessage()
                    : "AI 분석 결과를 해석하지 못했어요. 잠시 후 다시 시도해 주세요.";
            throw new RuntimeException(msg);
        }
    }
    // [E] edit by smsong

    // [B] edit by smsong - 운동 상세(하루 세션) 분석 프롬프트
    private String buildSessionPrompt(AiSessionRequestDTO r) {
        String unit = (r.getVolumeUnit() == null || r.getVolumeUnit().isBlank()) ? "kg" : r.getVolumeUnit();
        StringBuilder sb = new StringBuilder();
        sb.append("[분석 대상] ").append(nz(r.getDate()));
        if (r.getWeekday() != null && !r.getWeekday().isBlank()) sb.append(" (").append(r.getWeekday()).append(")");
        sb.append(" 하루 운동\n\n");

        sb.append("[사용자 신체 정보]\n");
        sb.append("- 성별: ").append(r.getGender() == null || r.getGender().isBlank() ? "미입력" : r.getGender()).append("\n");
        sb.append("- 나이: ").append(r.getAge() == null || r.getAge().isBlank() ? "미입력" : r.getAge()).append("\n");
        sb.append("- 키: ").append(r.getHeight() != null ? fmt(r.getHeight()) + "cm" : "미입력").append("\n");
        sb.append("- 체중: ").append(r.getWeight() != null ? fmt(r.getWeight()) + "kg" : "미입력").append("\n");
        sb.append("- 목표 체중: ").append(r.getTargetWeight() != null ? fmt(r.getTargetWeight()) + "kg" : "미입력").append("\n");
        sb.append("- 체지방률: ").append(r.getBodyFat() != null ? fmt(r.getBodyFat()) + "%" : "미입력(추정 처리)").append("\n\n");

        sb.append("[이날 세션 요약]\n");
        if (r.getBodyParts() != null && !r.getBodyParts().isEmpty())
            sb.append("- 부위: ").append(String.join(", ", r.getBodyParts())).append("\n");
        if (r.getCondition() != null) sb.append("- 컨디션(0~100): ").append(r.getCondition()).append("\n");
        if (r.getDurationMin() != null) sb.append("- 운동 시간: ").append(r.getDurationMin()).append("분\n");
        if (r.getTotalWorkouts() != null) sb.append("- 종목(운동) 수: ").append(r.getTotalWorkouts()).append("\n");
        if (r.getTotalSets() != null) sb.append("- 총 세트: ").append(r.getTotalSets()).append("\n");
        if (r.getTotalVolume() != null) sb.append("- 총 볼륨: ").append(fmt(r.getTotalVolume())).append(unit).append("\n");
        sb.append("\n");

        sb.append("[이날 수행한 운동 상세]\n");
        List<AiSessionRequestDTO.WorkoutLine> ws = r.getWorkouts();
        if (ws == null || ws.isEmpty()) sb.append("(없음)\n");
        else {
            int i = 1;
            for (AiSessionRequestDTO.WorkoutLine w : ws) {
                sb.append(i++).append(") ").append(nz(w.getExercise())).append(" — ");
                if (Boolean.TRUE.equals(w.getBodyweight())) {
                    sb.append("맨몸");
                } else if (w.getOrigLbs() != null) {
                    sb.append(fmt(w.getOrigLbs())).append("lbs");
                } else if (w.getWeight() != null) {
                    sb.append(fmt(w.getWeight())).append("kg");
                }
                if (w.getReps() != null) sb.append(" × ").append(w.getReps()).append("회");
                if (w.getSets() != null) sb.append(" × ").append(w.getSets()).append("세트");
                if (Boolean.TRUE.equals(w.getAssisted())) sb.append(" (보조)");
                sb.append("\n");
            }
        }
        sb.append("\n");

        if (r.getRecentLoads() != null && !r.getRecentLoads().isEmpty()) {
            sb.append("[최근 운동량 맥락 — 이 세션이 평소 대비 많은지/적은지 판단용]\n");
            for (AiSessionRequestDTO.RecentLoad rl : r.getRecentLoads()) {
                sb.append("- ").append(nz(rl.getDate())).append(": ");
                if (rl.getVolume() != null) sb.append("볼륨 ").append(fmt(rl.getVolume())).append("kg");
                if (rl.getTotalSets() != null) sb.append(", ").append(rl.getTotalSets()).append("세트");
                if (rl.getCondition() != null) sb.append(", 컨디션 ").append(rl.getCondition());
                sb.append("\n");
            }
            sb.append("\n");
        } else {
            sb.append("[최근 운동량 맥락] (데이터 부족 — 상대 평가 시 신중히, confidence 낮게)\n\n");
        }

        sb.append("위 데이터를 근거로, 이날 운동에 대해 운동량 적정성(상위 %)·강도·피로도·다음날 예상 컨디션·");
        sb.append("오버트레이닝 여부·종합 등급을 예측/판단하고, 시스템 지침의 JSON 스키마로만 응답하세요.");
        return sb.toString();
    }

    // 운동 상세 분석 응답 스키마(성장 스키마 + 세션 전용 필드)
    private ObjectNode buildSessionSchema() {
        ObjectNode schema = om.createObjectNode();
        schema.put("type", "OBJECT");
        ObjectNode p = schema.putObject("properties");
        p.putObject("headline").put("type", "STRING");
        p.putObject("trend").put("type", "STRING");
        p.putObject("verdict").put("type", "STRING");
        p.putObject("confidence").put("type", "INTEGER");
        ObjectNode analysis = p.putObject("analysis");
        analysis.put("type", "ARRAY"); analysis.putObject("items").put("type", "STRING");
        ObjectNode recos = p.putObject("recommendations");
        recos.put("type", "ARRAY"); recos.putObject("items").put("type", "STRING");
        ObjectNode cautions = p.putObject("cautions");
        cautions.put("type", "ARRAY"); cautions.putObject("items").put("type", "STRING");
        // 세션 전용
        p.putObject("volumePercentile").put("type", "INTEGER");
        p.putObject("intensityLevel").put("type", "STRING");
        p.putObject("fatigueScore").put("type", "INTEGER");
        p.putObject("nextDayCondition").put("type", "INTEGER");
        p.putObject("overtraining").put("type", "BOOLEAN");
        p.putObject("overallGrade").put("type", "STRING");
        ArrayNode req = schema.putArray("required");
        req.add("headline"); req.add("analysis"); req.add("intensityLevel");
        req.add("fatigueScore"); req.add("nextDayCondition"); req.add("overallGrade");
        return schema;
    }
    // [E] edit by smsong

    // [B] edit by smsong : 응답 JSON 스키마 (Gemini structured output)
    private ObjectNode buildResponseSchema() {
        ObjectNode schema = om.createObjectNode();
        schema.put("type", "OBJECT");
        ObjectNode p = schema.putObject("properties");
        p.putObject("headline").put("type", "STRING");
        p.putObject("trend").put("type", "STRING");
        p.putObject("verdict").put("type", "STRING");
        p.putObject("confidence").put("type", "INTEGER");
        ObjectNode analysis = p.putObject("analysis");
        analysis.put("type", "ARRAY");
        analysis.putObject("items").put("type", "STRING");
        ObjectNode recos = p.putObject("recommendations");
        recos.put("type", "ARRAY");
        recos.putObject("items").put("type", "STRING");
        ObjectNode cautions = p.putObject("cautions");
        cautions.put("type", "ARRAY");
        cautions.putObject("items").put("type", "STRING");
        ArrayNode req = schema.putArray("required");
        req.add("headline"); req.add("trend"); req.add("verdict"); req.add("analysis");
        return schema;
    }
    // [E] edit by smsong

    // 응답에서 model 텍스트(JSON)를 꺼내 DTO 로 파싱
    private AiAnalysisResponseDTO parse(String raw) throws Exception {
        JsonNode root = om.readTree(raw);

        // [B] edit by smsong : 프롬프트 차단(안전필터)·쿼터 등 오류를 먼저 걸러 명확히 알린다
        if (root.has("error")) {
            String msg = root.path("error").path("message").asText("알 수 없는 오류");
            throw new RuntimeException("AI 서버 오류: " + msg);
        }
        JsonNode cand = root.path("candidates").path(0);
        if (cand.isMissingNode()) {
            String block = root.path("promptFeedback").path("blockReason").asText("");
            throw new RuntimeException(block.isEmpty() ? "AI 응답이 비었습니다" : "요청이 차단되었습니다(" + block + ")");
        }
        // 응답이 토큰 한도로 잘렸는지 확인 → 잘렸다면 파싱을 시도하지 말고 명확히 안내
        String finish = cand.path("finishReason").asText("");
        JsonNode textNode = cand.path("content").path("parts").path(0).path("text");
        if (textNode.isMissingNode() || textNode.asText().isBlank()) {
            if ("MAX_TOKENS".equals(finish)) {
                throw new RuntimeException("분석 내용이 너무 길어 응답이 잘렸어요. 다시 시도해 주세요.");
            }
            throw new RuntimeException("AI 응답이 비었습니다(" + (finish.isEmpty() ? "원인 불명" : finish) + ")");
        }

        String jsonText = textNode.asText().trim();
        // 혹시 코드펜스가 섞이면 제거
        if (jsonText.startsWith("```")) {
            jsonText = jsonText.replaceAll("^```[a-zA-Z]*", "").replaceAll("```$", "").trim();
        }
        JsonNode a;
        try {
            a = om.readTree(jsonText);
        } catch (Exception parseErr) {
            // [B][E] edit by smsong : 텍스트는 있으나 JSON 이 깨진 경우(대개 MAX_TOKENS 로 중간 잘림)
            if ("MAX_TOKENS".equals(finish)) {
                throw new RuntimeException("분석 내용이 너무 길어 응답이 잘렸어요. 다시 시도해 주세요.");
            }
            throw parseErr;
        }

        return AiAnalysisResponseDTO.builder()
                .headline(txt(a, "headline"))
                .trend(txt(a, "trend"))
                .verdict(txt(a, "verdict"))
                .confidence(a.path("confidence").isNumber() ? a.path("confidence").asInt() : null)
                .analysis(arr(a, "analysis"))
                .recommendations(arr(a, "recommendations"))
                .cautions(arr(a, "cautions"))
                // [B][E] edit by smsong : 세션 분석 전용 필드(없으면 null). 종목 분석 응답엔 없다.
                .volumePercentile(a.path("volumePercentile").isNumber() ? a.path("volumePercentile").asInt() : null)
                .intensityLevel(txt(a, "intensityLevel"))
                .fatigueScore(a.path("fatigueScore").isNumber() ? a.path("fatigueScore").asInt() : null)
                .nextDayCondition(a.path("nextDayCondition").isNumber() ? a.path("nextDayCondition").asInt() : null)
                .overtraining(a.path("overtraining").isBoolean() ? a.path("overtraining").asBoolean() : null)
                .overallGrade(txt(a, "overallGrade"))
                .build();
    }

    private String txt(JsonNode n, String k) { return n.path(k).isTextual() ? n.path(k).asText() : null; }
    private List<String> arr(JsonNode n, String k) {
        List<String> out = new ArrayList<>();
        JsonNode arr = n.path(k);
        if (arr.isArray()) arr.forEach(x -> { if (x.isTextual()) out.add(x.asText()); });
        return out;
    }

    // 사용자 데이터를 사람이 읽기 쉬운(=모델이 이해하기 쉬운) 텍스트로 직렬화
    private String buildUserPrompt(AiAnalysisRequestDTO r) {
        // [B] edit by smsong : 무게 단위. 값들은 이미 이 단위로 환산돼 들어온다.
        String unit = (r.getWeightUnit() == null || r.getWeightUnit().isBlank()) ? "kg" : r.getWeightUnit();
        boolean lbs = "lbs".equalsIgnoreCase(unit);
        // 분석 관점: compare(두 시점 집중) / trend(전체 추세). 기본은 trend.
        boolean compareMode = "compare".equalsIgnoreCase(nz(r.getAnalysisMode()));
        // [E] edit by smsong
        StringBuilder sb = new StringBuilder();
        // [B] edit by smsong : 분석 관점을 맨 앞에서 명확히 지시
        if (compareMode) {
            sb.append("[분석 관점] 아래 '비교 중인 두 시점'을 직접 비교하는 것이 핵심 과제다.\n");
            sb.append("두 시점 사이에 무게/횟수/세트/볼륨이 어떻게 달라졌는지, 그것이 근성장·정체·근손실 중\n");
            sb.append("무엇을 시사하는지 구체적으로 판단하라. 전체 이력은 '맥락'으로만 참고한다.\n\n");
        } else {
            sb.append("[분석 관점] 이 종목의 '전체 이력'을 바탕으로 장기적인 성장 추세를 판단하는 것이 핵심 과제다.\n");
            sb.append("특정 두 시점 비교가 아니라, 흐름 전반이 상승인지 정체인지 하락인지와 그 이유를 종합하라.\n\n");
        }
        // [E] edit by smsong
        sb.append("분석 대상 종목: ").append(nz(r.getExercise())).append("\n");
        sb.append("종목 유형: ").append(r.isBodyweightExercise() ? "맨몸(무게 없음, 횟수/세트 중심)" : "웨이트(무게 있음)").append("\n");
        // [B] edit by smsong : 이 종목의 무게/볼륨 단위를 명시하고, 그 단위로 분석·조언하도록 지시
        if (!r.isBodyweightExercise()) {
            sb.append("무게/볼륨 단위: ").append(unit);
            if (lbs) sb.append(" (사용자가 lbs 로 기록한 종목이므로, 분석·수치·권장 무게를 모두 lbs 로 제시할 것. kg 로 환산하지 말 것)");
            sb.append("\n");
        }
        // [E] edit by smsong
        sb.append("보조 세트 ").append(r.isIncludeAssisted() ? "포함" : "제외").append(" 기준으로 집계됨\n\n");

        // [B] edit by smsong : compare 모드에서만 두 시점을 '핵심 비교 대상'으로 제시
        if (compareMode && (r.getCompareFrom() != null || r.getCompareTo() != null)) {
            sb.append("[★ 비교 중인 두 시점 — 이 둘의 변화가 분석의 핵심]\n");
            sb.append("이전: ").append(statLine(r.getCompareFrom(), unit)).append("\n");
            sb.append("최근: ").append(statLine(r.getCompareTo(), unit)).append("\n\n");
        }
        // [E] edit by smsong

        sb.append(compareMode ? "[참고용 — 이 종목의 전체 세션 이력(과거→현재)]\n"
                              : "[이 종목의 전체 세션 이력 — 과거→현재]\n");
        List<AiAnalysisRequestDTO.SessionStat> hist = r.getHistory();
        if (hist == null || hist.isEmpty()) {
            sb.append("(이력 없음)\n");
        } else {
            int i = 1;
            for (AiAnalysisRequestDTO.SessionStat s : hist) {
                sb.append(i++).append(") ").append(statLine(s, unit)).append("\n");
            }
        }

        if (r.getBodyweightSeries() != null && !r.getBodyweightSeries().isEmpty()) {
            sb.append("\n[같은 기간 체중(kg) 추이 — 근성장/근손실 판단 보조]\n");
            for (AiAnalysisRequestDTO.WeightPoint w : r.getBodyweightSeries()) {
                sb.append(nz(w.getDate())).append(": ").append(w.getWeight()).append("kg\n");
            }
        }

        sb.append("\n위 데이터를 근거로 시스템 지침의 JSON 스키마에 맞춰 분석 결과만 출력하세요.");
        if (compareMode) sb.append(" (headline 과 analysis 는 두 시점의 '변화'를 중심으로 서술하세요.)");
        else sb.append(" (headline 과 analysis 는 전체 '추세'를 중심으로 서술하세요.)");
        if (lbs) sb.append(" (무게·볼륨은 반드시 lbs 단위로 서술하세요.)");
        return sb.toString();
    }

    private String statLine(AiAnalysisRequestDTO.SessionStat s, String unit) {
        if (s == null) return "(없음)";
        StringBuilder b = new StringBuilder();
        b.append(nz(s.getDate()));
        if (s.getTime() != null && !s.getTime().isBlank()) b.append(" ").append(s.getTime());
        b.append(" — ");
        if (s.getTopWeight() != null) b.append("최고 ").append(fmt(s.getTopWeight())).append(unit).append(", ");
        if (s.getTotalReps() != null) b.append("총 ").append(s.getTotalReps()).append("회, ");
        if (s.getTotalSets() != null) b.append(s.getTotalSets()).append("세트, ");
        if (s.getVolume() != null) b.append("볼륨 ").append(fmt(s.getVolume())).append(unit);
        if (s.getCondition() != null) b.append(", 컨디션 ").append(s.getCondition());
        if (s.getDurationMin() != null) b.append(", ").append(s.getDurationMin()).append("분");
        if (s.getAssistedSets() != null && s.getAssistedSets() > 0) b.append(", 보조 ").append(s.getAssistedSets()).append("세트");
        return b.toString();
    }

    private String fmt(Double d) {
        if (d == null) return "0";
        if (d == Math.floor(d)) return String.valueOf(d.longValue());
        return String.valueOf(Math.round(d * 10) / 10.0);
    }
    private String nz(String s) { return s == null ? "" : s; }
}
// [E] edit by smsong
