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
}
// [E] edit by smsong
