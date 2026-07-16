package com.example.UpFit.Entity;

import jakarta.persistence.*;
import lombok.*;

// [B] edit by smsong - 운동 엔티티.
//   구조 변경: 더 이상 날짜를 직접 갖지 않고, 운동 기록(세션)에 소속된다.
//   날짜/시간/컨디션은 workout_sessions 가 보유 → workoutDate 컬럼 제거, sessionId 추가.
@Entity(name = "workouts")
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class WorkoutEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // users 테이블 PK(id). 세션을 거치지 않고도 소유자 필터링이 가능하도록 비정규화 보관.
    @Column(nullable = false)
    private Long userId;

    // workout_sessions.id 를 가리키는 외래키. 이 운동이 속한 운동 기록(세션).
    @Column(nullable = false)
    private Long sessionId;

    private String exercise;     // 종목명 (exercise_types 의 name 과 매칭)
    private double weight;       // kg
    private int reps;            // 회
    private int sets;            // 세트
    private String memo;

    // NOTE: 운동 부위(bodyParts)는 workout_sessions 로 이동했다.
    //       부위는 개별 운동이 아니라 그날의 운동 기록(세션) 단위로 관리한다.

    // 맨몸 운동 여부. 체크 시 weight = 0.
    private Boolean bodyweight;

    // [B] edit by smsong - 보조 여부.
    //   파트너가 밀어주는(스팟) 상태로 수행한 세트인지 표시한다.
    //   보조를 받은 세트는 "혼자 든 기록"이 아니므로, 성장 분석 그래프에서 기본적으로 제외된다
    //   (변화 탭의 "보조 보기" 체크박스로 포함/제외를 전환).
    //   기존 데이터(null)는 보조 아님으로 취급한다 → Boolean.TRUE.equals() 로만 판정할 것.
    private Boolean assisted;
    // [E] edit by smsong

    // 같은 세션 안에서의 표시 순서(오름차순).
    private Integer sortOrder;
}
// [E] edit by smsong
