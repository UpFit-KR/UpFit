package com.example.UpFit.DTO;

import lombok.*;

import java.util.List;

// [B] edit by smsong - 운동 상세(하루 세션) AI 분석 요청.
//   그날 수행한 모든 운동 + 사용자 신체정보 + 최근 운동량 맥락을 받아,
//   운동량 상위%, 피로도, 다음날 컨디션, 오버트레이닝, 종합 평가를 예측·분석한다.
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class AiSessionRequestDTO {

    private String date;          // 분석 대상 날짜 (YYYY-MM-DD)
    private String weekday;       // 요일(한글, 예: "금")

    // 사용자 신체 정보(있는 것만) — 운동량이 이 사람에게 적정한지 판단 근거
    private Double height;        // cm
    private Double weight;        // kg
    private Double targetWeight;  // kg
    private Double bodyFat;       // %
    private String gender;
    private String age;

    // 이 세션 요약
    private List<String> bodyParts;   // 운동 부위(가슴/등 등)
    private Integer condition;        // 그날 컨디션 0~100
    private Integer durationMin;      // 총 운동 시간(분)
    private Integer totalWorkouts;    // 운동(종목별 세트묶음) 개수
    private Integer totalSets;        // 총 세트 수
    private Double totalVolume;       // 총 볼륨(kg) — 맨몸 제외
    private String volumeUnit;        // "kg"

    // 그날 수행한 개별 운동들(종목/무게/횟수/세트/맨몸/보조/단위)
    private List<WorkoutLine> workouts;

    // 최근 운동량 맥락 — 이 세션이 평소 대비 많은지/적은지 판단용.
    //   최근 세션들의 (날짜, 총볼륨, 총세트, 컨디션)
    private List<RecentLoad> recentLoads;

    @NoArgsConstructor @AllArgsConstructor @Getter @Setter @Builder
    public static class WorkoutLine {
        private String exercise;
        private Double weight;      // kg (맨몸이면 0/무시)
        private Double origLbs;     // 사용자가 lbs 로 입력했으면 원본 lbs
        private Integer reps;
        private Integer sets;
        private Boolean bodyweight;
        private Boolean assisted;
    }

    @NoArgsConstructor @AllArgsConstructor @Getter @Setter @Builder
    public static class RecentLoad {
        private String date;
        private Double volume;      // kg
        private Integer totalSets;
        private Integer condition;
    }
}
// [E] edit by smsong
