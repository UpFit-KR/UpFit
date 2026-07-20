package com.example.UpFit.DTO;

import lombok.*;

import java.util.List;

// [B] edit by smsong - AI 운동 분석 요청.
//   프런트가 이미 모든 세션을 들고 있으므로, 분석에 필요한 데이터를 프런트에서 구성해 보낸다.
//   서버는 여기에 "웨이트 트레이닝 전문 지식" 시스템 프롬프트를 얹어 Gemini 에 전달한다.
//   · exercise   : 분석 대상 종목명
//   · includeAssisted : 보조 세트 포함 여부(그래프/비교와 동일한 기준)
//   · compareFrom / compareTo : 사용자가 지금 화면에서 비교 중인 두 시점(요약)
//   · history    : 해당 종목의 "전체" 세션 요약(과거→현재). 추세/미래 분석의 근거.
//   · bodyweightSeries : 기간 내 체중 추이(있으면). 근성장/근손실 판단 보조.
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class AiAnalysisRequestDTO {

    private String exercise;
    private boolean bodyweightExercise;   // 맨몸 종목이면 무게/볼륨 대신 횟수 중심
    private boolean includeAssisted;

    private SessionStat compareFrom;      // 비교 대상(이전). null 가능
    private SessionStat compareTo;        // 비교 대상(최근)

    private List<SessionStat> history;    // 이 종목 전체 세션 요약(과거→현재)
    private List<WeightPoint> bodyweightSeries;  // 체중 추이(선택)

    @NoArgsConstructor @AllArgsConstructor @Getter @Setter @Builder
    public static class SessionStat {
        private String date;          // YYYY-MM-DD
        private String time;          // HH:mm (선택)
        private Double topWeight;     // 최고 무게(kg)
        private Integer totalReps;    // 총 횟수(회 = reps×sets 합)
        private Integer totalSets;    // 총 세트
        private Double volume;        // 총 볼륨(kg)
        private Integer condition;    // 컨디션 0~100 (선택)
        private Integer durationMin;  // 그 세션 총 운동 시간(분, 선택)
        private Integer assistedSets; // 보조 세트 수(선택)
    }

    @NoArgsConstructor @AllArgsConstructor @Getter @Setter @Builder
    public static class WeightPoint {
        private String date;
        private Double weight;
    }
}
// [E] edit by smsong
