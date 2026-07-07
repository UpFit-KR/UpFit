package com.example.UpFit.DTO;

import com.example.UpFit.Entity.ExerciseTypeEntity;
import lombok.*;

// [B] edit by smsong - 운동 종목 DTO
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class ExerciseTypeDTO {
    private Long id;
    private Long userId;
    private String name;

    public static ExerciseTypeDTO entityToDto(ExerciseTypeEntity e) {
        return new ExerciseTypeDTO(e.getId(), e.getUserId(), e.getName());
    }

    public ExerciseTypeEntity dtoToEntity() {
        return new ExerciseTypeEntity(id, userId, name);
    }
}
// [E] edit by smsong
