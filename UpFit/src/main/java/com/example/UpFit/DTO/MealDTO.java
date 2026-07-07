package com.example.UpFit.DTO;

import com.example.UpFit.Entity.MealEntity;
import lombok.*;

// [B] edit by smsong - 식단 기록 DTO
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class MealDTO {
    private Long id;
    private Long userId;
    private String mealDate;
    private String mealType;
    private String name;
    private int kcal;
    private double carb;
    private double protein;
    private double fat;

    public static MealDTO entityToDto(MealEntity e) {
        return new MealDTO(
                e.getId(),
                e.getUserId(),
                e.getMealDate(),
                e.getMealType(),
                e.getName(),
                e.getKcal(),
                e.getCarb(),
                e.getProtein(),
                e.getFat());
    }

    public MealEntity dtoToEntity() {
        return new MealEntity(id, userId, mealDate, mealType, name, kcal, carb, protein, fat);
    }
}
// [E] edit by smsong
