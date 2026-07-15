package com.example.UpFit.DTO;

import com.example.UpFit.Entity.WorkoutEntity;
import com.example.UpFit.Entity.WorkoutSessionEntity;
import lombok.*;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

// [B] edit by smsong - 운동 기록(세션) DTO. 안에 운동 목록(workouts)을 중첩해 한 번에 주고받는다.
//   · 생성/수정 시 workouts 를 통째로 보내면 서버가 id 기준으로 동기화(추가/수정/삭제)한다.
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class WorkoutSessionDTO {
    private Long id;
    private Long userId;
    private String sessionDate;     // "YYYY-MM-DD"
    private String startTime;       // "HH:mm" (운동 시작 시각)
    private String endTime;         // "HH:mm" (운동 종료 시각)
    private Integer durationMin;    // 총 운동 시간(분)
    private Integer conditionScore; // 컨디션 0~100
    private String title;
    private String memo;
    private Integer sortOrder;      // 같은 날짜 내 세션 순서
    private List<WorkoutDTO> workouts;

    public static WorkoutSessionDTO entityToDto(WorkoutSessionEntity s, List<WorkoutEntity> ws) {
        List<WorkoutDTO> items = (ws == null ? new ArrayList<WorkoutEntity>() : ws).stream()
                .map(WorkoutDTO::entityToDto)
                .collect(Collectors.toList());
        return new WorkoutSessionDTO(
                s.getId(),
                s.getUserId(),
                s.getSessionDate(),
                s.getStartTime(),
                s.getEndTime(),
                s.getDurationMin(),
                s.getConditionScore(),
                s.getTitle(),
                s.getMemo(),
                s.getSortOrder(),
                items);
    }
}
// [E] edit by smsong
