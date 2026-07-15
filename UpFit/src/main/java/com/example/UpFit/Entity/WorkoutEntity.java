package com.example.UpFit.Entity;

import jakarta.persistence.*;
import lombok.*;

// [B] edit by smsong - 운동 기록 엔티티 (users.id 를 외래키(userId)로 소유자 구분)
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

    // users 테이블 PK(id) 를 가리키는 외래키. 이 값으로 사용자별 기록을 필터링한다.
    @Column(nullable = false)
    private Long userId;

    private String workoutDate;  // "YYYY-MM-DD" (프론트 date input 포맷과 동일)
    private String exercise;     // 종목명 (exercise_types 의 name 과 매칭)
    private double weight;       // kg
    private int reps;            // 회
    private int sets;            // 세트
    private String memo;

    // 운동 부위(콤마 구분, 예: "가슴,삼두"). 하루에 여러 부위 체크 가능.
    @Column(length = 120)
    private String bodyParts;

    // 맨몸 운동 여부. 체크 시 weight = 0. 기존 행 호환을 위해 래퍼(Boolean)로 둠(null 허용).
    private Boolean bodyweight;

    // 같은 날짜 안에서의 사용자 지정 표시 순서(오름차순). 재정렬 API 로 갱신.
    // 기존 행 호환을 위해 래퍼(Integer)로 두어 null 허용(null 은 맨 뒤 + id 순으로 취급).
    private Integer sortOrder;
}
// [E] edit by smsong
