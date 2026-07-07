package com.example.UpFit.Entity;

import jakarta.persistence.*;
import lombok.*;

// [B] edit by smsong - 식단 기록 엔티티 (users.id 를 외래키(userId)로 소유자 구분)
@Entity(name = "meals")
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class MealEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long userId;

    private String mealDate;   // "YYYY-MM-DD"
    private String mealType;   // breakfast | lunch | dinner | snack
    private String name;       // 음식명
    private int kcal;
    private double carb;       // 탄수화물(g)
    private double protein;    // 단백질(g)
    private double fat;        // 지방(g)
}
// [E] edit by smsong
