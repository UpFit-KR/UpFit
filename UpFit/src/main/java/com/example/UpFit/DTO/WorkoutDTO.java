package com.example.UpFit.DTO;

import com.example.UpFit.Entity.WorkoutEntity;
import lombok.*;

// [B] edit by smsong - 운동 기록 DTO
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class WorkoutDTO {
    private Long id;
    private Long userId;
    private String workoutDate;
    private String exercise;
    private double weight;
    private int reps;
    private int sets;
    private String memo;

    public static WorkoutDTO entityToDto(WorkoutEntity e) {
        return new WorkoutDTO(
                e.getId(),
                e.getUserId(),
                e.getWorkoutDate(),
                e.getExercise(),
                e.getWeight(),
                e.getReps(),
                e.getSets(),
                e.getMemo());
    }

    public WorkoutEntity dtoToEntity() {
        return new WorkoutEntity(id, userId, workoutDate, exercise, weight, reps, sets, memo);
    }
}
// [E] edit by smsong
