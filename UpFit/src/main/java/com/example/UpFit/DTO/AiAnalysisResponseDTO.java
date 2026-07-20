package com.example.UpFit.DTO;

import lombok.*;

import java.util.List;

// [B] edit by smsong - AI 운동 분석 응답.
//   Gemini 가 아래 구조의 JSON 만 반환하도록 프롬프트로 강제한다(파싱 안정성).
//   프런트는 이 구조를 카드/섹션으로 렌더한다.
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class AiAnalysisResponseDTO {

    // 한 줄 요약(예: "전반적 상승 추세 · 근성장 신호")
    private String headline;

    // 추세 판정: "up" | "down" | "flat" | "mixed"
    private String trend;

    // 근성장/근손실 판정: "growth" | "loss" | "maintain" | "unclear"
    private String verdict;

    // 확신도 0~100 (데이터가 적으면 낮게)
    private Integer confidence;

    // 본문 분석(문단들). 추세·회복·컨디션 맥락 등 서술.
    private List<String> analysis;

    // 앞으로의 권장 액션(미래 분석 기반)
    private List<String> recommendations;

    // 주의/한계(데이터 부족, 보조 세트 영향 등)
    private List<String> cautions;
}
// [E] edit by smsong
