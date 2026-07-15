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
    private String bodyParts;    // 운동 부위(콤마 구분)
    private Boolean bodyweight;  // 맨몸 여부

    public static WorkoutDTO entityToDto(WorkoutEntity e) {
        return new WorkoutDTO(
                e.getId(),
                e.getUserId(),
                e.getWorkoutDate(),
                e.getExercise(),
                e.getWeight(),
                e.getReps(),
                e.getSets(),
                e.getMemo(),
                e.getBodyParts(),
                e.getBodyweight());
    }

    public WorkoutEntity dtoToEntity() {
        return new WorkoutEntity(id, userId, workoutDate, exercise, weight, reps, sets, memo, bodyParts, bodyweight);
    }
}
// [E] edit by smsong
