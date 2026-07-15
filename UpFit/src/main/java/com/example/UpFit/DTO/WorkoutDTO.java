package com.example.UpFit.DTO;

import com.example.UpFit.Entity.WorkoutEntity;
import lombok.*;

// [B] edit by smsong - 운동 DTO.
//   구조 변경: workoutDate 제거(세션이 보유) → sessionId 추가.
//   id 가 있으면 기존 운동 수정, 없으면 신규 추가로 취급(세션 저장 시 동기화).
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class WorkoutDTO {
    private Long id;
    private Long userId;
    private Long sessionId;
    private String exercise;
    private double weight;
    private int reps;
    private int sets;
    private String memo;
    private String bodyParts;    // 운동 부위(콤마 구분)
    private Boolean bodyweight;  // 맨몸 여부
    private Integer sortOrder;   // 같은 세션 내 표시 순서

    public static WorkoutDTO entityToDto(WorkoutEntity e) {
        return new WorkoutDTO(
                e.getId(),
                e.getUserId(),
                e.getSessionId(),
                e.getExercise(),
                e.getWeight(),
                e.getReps(),
                e.getSets(),
                e.getMemo(),
                e.getBodyParts(),
                e.getBodyweight(),
                e.getSortOrder());
    }

    public WorkoutEntity dtoToEntity() {
        return new WorkoutEntity(id, userId, sessionId, exercise, weight, reps, sets, memo, bodyParts, bodyweight, sortOrder);
    }
}
// [E] edit by smsong
