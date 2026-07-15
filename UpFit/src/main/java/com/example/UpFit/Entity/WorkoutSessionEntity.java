package com.example.UpFit.Entity;

import jakarta.persistence.*;
import lombok.*;

// [B] edit by smsong - 운동 기록(세션) 엔티티.
//   날짜를 큰 틀로 하는 "하나의 운동 기록" = 세션. 하루에 여러 세션(오전/오후/저녁) 가능.
//   개별 운동(WorkoutEntity)은 sessionId 로 이 세션에 속한다.
@Entity(name = "workout_sessions")
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class WorkoutSessionEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // users 테이블 PK(id) 를 가리키는 외래키.
    @Column(nullable = false)
    private Long userId;

    // 날짜 "YYYY-MM-DD" (프론트 date input 포맷과 동일). 달력의 기준 키.
    @Column(length = 10, nullable = false)
    private String sessionDate;

    // 운동 시간 — 시작/종료 시각("HH:mm")과 총 소요 시간(분)을 모두 기록한다.
    // durationMin 이 비어 있으면 서버가 start/end 로 계산(자정 넘김 보정 포함).
    @Column(length = 5)
    private String startTime;

    @Column(length = 5)
    private String endTime;

    private Integer durationMin;

    // 컨디션 0~100 (UI 는 드래그 슬라이더).
    // NOTE: MySQL 예약어 CONDITION 회피 → 컬럼명 condition_score 로 고정.
    @Column(name = "condition_score")
    private Integer conditionScore;

    // 이 날 운동한 부위(콤마 구분, 예: "가슴,삼두").
    // 개별 운동이 아니라 운동 기록(세션) 단위로 관리한다.
    @Column(length = 120)
    private String bodyParts;

    // 세션 이름(선택, 예: "오전 운동")
    @Column(length = 60)
    private String title;

    @Column(length = 300)
    private String memo;

    // 같은 날짜 안에서의 세션 표시 순서(오름차순). 재정렬 API 로 갱신.
    private Integer sortOrder;
}
// [E] edit by smsong
