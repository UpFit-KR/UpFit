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

    // 운동 부위(콤마 구분, 예: "가슴,삼두").
    @Column(length = 120)
    private String bodyParts;

    // 맨몸 운동 여부. 체크 시 weight = 0.
    private Boolean bodyweight;

    // 같은 세션 안에서의 표시 순서(오름차순).
    private Integer sortOrder;
}
// [E] edit by smsong
