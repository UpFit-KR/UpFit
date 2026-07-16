package com.example.UpFit.DTO;

import com.example.UpFit.Entity.WorkoutEntity;
import lombok.*;

// [B] edit by smsong - 운동 DTO.
//   구조 변경: workoutDate / bodyParts 제거(세션이 보유) → sessionId 추가.
//   id 가 있으면 기존 운동 수정, 없으면 신규 추가로 취급(세션 저장 시 동기화).
//   [B] edit by smsong : 보조(assisted) 추가 — bodyweight 바로 뒤에 선언한다.
//     @AllArgsConstructor 의 인자 순서 = 필드 선언 순서이므로, 엔티티/DTO 양쪽의
//     선언 위치를 동일하게 맞춰야 생성자 호출부가 어긋나지 않는다.
//   [E] edit by smsong
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
    private Boolean bodyweight;  // 맨몸 여부  (bodyParts 는 세션(WorkoutSessionDTO)으로 이동)
    private Boolean assisted;    // [B][E] edit by smsong : 보조(파트너 스팟) 여부. null = 보조 아님
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
                e.getBodyweight(),
                e.getAssisted(),      // [B][E] edit by smsong
                e.getSortOrder());
    }

    public WorkoutEntity dtoToEntity() {
        return new WorkoutEntity(id, userId, sessionId, exercise, weight, reps, sets, memo, bodyweight, assisted, sortOrder);
    }
}
// [E] edit by smsong
