package com.example.UpFit.Entity;

import jakarta.persistence.*;
import lombok.*;

// [B] edit by smsong - 사용자 추가 운동 종목(콤보박스 값) 엔티티
@Entity(name = "exercise_types")
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class ExerciseTypeEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long userId;

    private String name;   // 종목명 (사용자별 유니크)
}
// [E] edit by smsong
