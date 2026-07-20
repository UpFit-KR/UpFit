package com.example.UpFit.Service;

import com.example.UpFit.Config.GeminiProperties;
import com.example.UpFit.DTO.AiAnalysisRequestDTO;
import com.example.UpFit.DTO.AiAnalysisResponseDTO;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.ArrayList;
import java.util.List;

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
        "- 반드시 제공된 history(과거→현재 전체)를 근거로 추세를 판단한다. compareFrom/compareTo 두 점만 보고",
        "  단정하지 말 것.",
        "- 데이터가 2~3개로 적으면 confidence 를 낮추고 cautions 에 한계를 명시한다.",
        "- 과장·단정 금지. 의학적 조언이 아니라 트레이닝 관점의 해석임을 유지한다.",
        "- 한국어로, 간결하고 실용적으로 작성한다.",
        "",
        "[출력 형식] — 오직 아래 JSON 만 출력한다. 마크다운/설명/코드펜스 금지.",
        "{",
        "  \"headline\": \"한 줄 요약\",",
        "  \"trend\": \"up|down|flat|mixed\",",
        "  \"verdict\": \"growth|loss|maintain|unclear\",",
        "  \"confidence\": 0-100,",
        "  \"analysis\": [\"문단1\", \"문단2\", ...],",
        "  \"recommendations\": [\"권장1\", \"권장2\", ...],",
        "  \"cautions\": [\"주의1\", ...]",
        "}"
    );

    public AiAnalysisResponseDTO analyze(AiAnalysisRequestDTO req) {
        if (props.getApiKey() == null || props.getApiKey().isBlank()) {
            throw new IllegalStateException("AI 기능이 설정되지 않았습니다(API 키 없음)");
        }
        String userPrompt = buildUserPrompt(req);

        // Gemini generateContent 요청 본문
        ObjectNode body = om.createObjectNode();

        // system_instruction 에 도메인 지식을 싣는다
        ObjectNode sys = body.putObject("system_instruction");
        sys.putArray("parts").addObject().put("text", SYSTEM_KNOWLEDGE);

        ArrayNode contents = body.putArray("contents");
        ObjectNode userTurn = contents.addObject();
        userTurn.put("role", "user");
        userTurn.putArray("parts").addObject().put("text", userPrompt);

        // JSON 강제 + 창의성 낮춤(분석의 일관성)
        ObjectNode genCfg = body.putObject("generationConfig");
        genCfg.put("responseMimeType", "application/json");
        genCfg.put("temperature", 0.4);
        genCfg.put("maxOutputTokens", 1400);

        String url = "https://generativelanguage.googleapis.com/v1beta/models/"
                + props.getModel() + ":generateContent";

        try {
            String raw = http.post()
                    .uri(url)
                    .header("x-goog-api-key", props.getApiKey())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(om.writeValueAsString(body))
                    .retrieve()
                    .body(String.class);

            return parse(raw);
        } catch (Exception e) {
            log.error("Gemini 분석 실패", e);
            throw new RuntimeException("AI 분석에 실패했어요. 잠시 후 다시 시도해 주세요.");
        }
    }

    // 응답에서 model 텍스트(JSON)를 꺼내 DTO 로 파싱
    private AiAnalysisResponseDTO parse(String raw) throws Exception {
        JsonNode root = om.readTree(raw);
        JsonNode textNode = root.path("candidates").path(0)
                .path("content").path("parts").path(0).path("text");
        if (textNode.isMissingNode()) {
            throw new RuntimeException("AI 응답이 비었습니다");
        }
        String jsonText = textNode.asText().trim();
        // 혹시 코드펜스가 섞이면 제거
        if (jsonText.startsWith("```")) {
            jsonText = jsonText.replaceAll("^```[a-zA-Z]*", "").replaceAll("```$", "").trim();
        }
        JsonNode a = om.readTree(jsonText);

        return AiAnalysisResponseDTO.builder()
                .headline(txt(a, "headline"))
                .trend(txt(a, "trend"))
                .verdict(txt(a, "verdict"))
                .confidence(a.path("confidence").isNumber() ? a.path("confidence").asInt() : null)
                .analysis(arr(a, "analysis"))
                .recommendations(arr(a, "recommendations"))
                .cautions(arr(a, "cautions"))
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
        StringBuilder sb = new StringBuilder();
        sb.append("분석 대상 종목: ").append(nz(r.getExercise())).append("\n");
        sb.append("종목 유형: ").append(r.isBodyweightExercise() ? "맨몸(무게 없음, 횟수/세트 중심)" : "웨이트(무게 있음)").append("\n");
        sb.append("보조 세트 ").append(r.isIncludeAssisted() ? "포함" : "제외").append(" 기준으로 집계됨\n\n");

        if (r.getCompareFrom() != null || r.getCompareTo() != null) {
            sb.append("[사용자가 지금 화면에서 비교 중인 두 시점]\n");
            sb.append("이전: ").append(statLine(r.getCompareFrom())).append("\n");
            sb.append("최근: ").append(statLine(r.getCompareTo())).append("\n\n");
        }

        sb.append("[이 종목의 전체 세션 이력 — 과거→현재]\n");
        List<AiAnalysisRequestDTO.SessionStat> hist = r.getHistory();
        if (hist == null || hist.isEmpty()) {
            sb.append("(이력 없음)\n");
        } else {
            int i = 1;
            for (AiAnalysisRequestDTO.SessionStat s : hist) {
                sb.append(i++).append(") ").append(statLine(s)).append("\n");
            }
        }

        if (r.getBodyweightSeries() != null && !r.getBodyweightSeries().isEmpty()) {
            sb.append("\n[같은 기간 체중(kg) 추이 — 근성장/근손실 판단 보조]\n");
            for (AiAnalysisRequestDTO.WeightPoint w : r.getBodyweightSeries()) {
                sb.append(nz(w.getDate())).append(": ").append(w.getWeight()).append("kg\n");
            }
        }

        sb.append("\n위 데이터를 근거로 시스템 지침의 JSON 스키마에 맞춰 분석 결과만 출력하세요.");
        return sb.toString();
    }

    private String statLine(AiAnalysisRequestDTO.SessionStat s) {
        if (s == null) return "(없음)";
        StringBuilder b = new StringBuilder();
        b.append(nz(s.getDate()));
        if (s.getTime() != null && !s.getTime().isBlank()) b.append(" ").append(s.getTime());
        b.append(" — ");
        if (s.getTopWeight() != null) b.append("최고 ").append(fmt(s.getTopWeight())).append("kg, ");
        if (s.getTotalReps() != null) b.append("총 ").append(s.getTotalReps()).append("회, ");
        if (s.getTotalSets() != null) b.append(s.getTotalSets()).append("세트, ");
        if (s.getVolume() != null) b.append("볼륨 ").append(fmt(s.getVolume())).append("kg");
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
