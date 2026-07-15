package com.example.UpFit.Controller;

import com.example.UpFit.DTO.WorkoutDTO;
import com.example.UpFit.DTO.WorkoutSessionDTO;
import com.example.UpFit.Service.WorkoutSessionService;
import io.swagger.v3.oas.annotations.Operation;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;

import java.util.List;

// [B] edit by smsong - 운동 기록(세션) API. 기존 WorkoutController 를 대체한다.
//   구조: 날짜 → 운동 기록(세션) → 운동 여러 개
//   경로의 uid 로 소유자 지정, JWT 로 본인 확인.
@RestController
@RequestMapping("/session")
@RequiredArgsConstructor
@CrossOrigin(origins = "http://127.0.0.1:5500")
public class WorkoutSessionController {

    private final WorkoutSessionService workoutSessionService;

    // 내 운동 기록 전체 조회 (세션 + 세션 내 운동)
    @Operation(summary = "운동 기록(세션) 전체 조회 (uid)")
    @GetMapping("/{uid}")
    public ResponseEntity<List<WorkoutSessionDTO>> getMySessions(
            @PathVariable("uid") String uid,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(workoutSessionService.getMySessions(uid, userDetails));
    }

    // 달력에서 날짜 클릭 → 해당 날짜의 운동 기록 목록
    @Operation(summary = "날짜별 운동 기록 조회 (uid, date)")
    @GetMapping("/{uid}/date/{date}")
    public ResponseEntity<List<WorkoutSessionDTO>> getSessionsByDate(
            @PathVariable("uid") String uid,
            @PathVariable("date") String date,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(workoutSessionService.getSessionsByDate(uid, date, userDetails));
    }

    // 운동 기록 단건 조회 (상세)
    @Operation(summary = "운동 기록 단건 조회 (uid, id)")
    @GetMapping("/{uid}/detail/{id}")
    public ResponseEntity<WorkoutSessionDTO> getSession(
            @PathVariable("uid") String uid,
            @PathVariable("id") Long id,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(workoutSessionService.getSession(uid, id, userDetails));
    }

    // 운동 기록 생성 (body.workouts 로 운동 여러 개 동시 생성)
    @Operation(summary = "운동 기록 생성 (uid)")
    @PostMapping("/{uid}")
    public ResponseEntity<WorkoutSessionDTO> createSession(
            @PathVariable("uid") String uid,
            @RequestBody WorkoutSessionDTO dto,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(workoutSessionService.createSession(uid, dto, userDetails));
    }

    // 운동 기록 수정 (body.workouts 를 보내면 목록 전체 동기화)
    @Operation(summary = "운동 기록 수정 (uid, id)")
    @PutMapping("/{uid}/{id}")
    public ResponseEntity<WorkoutSessionDTO> updateSession(
            @PathVariable("uid") String uid,
            @PathVariable("id") Long id,
            @RequestBody WorkoutSessionDTO dto,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(workoutSessionService.updateSession(uid, id, dto, userDetails));
    }

    // 운동 기록 삭제 (내부 운동 동반 삭제)
    @Operation(summary = "운동 기록 삭제 (uid, id)")
    @DeleteMapping("/{uid}/{id}")
    public ResponseEntity<WorkoutSessionDTO> deleteSession(
            @PathVariable("uid") String uid,
            @PathVariable("id") Long id,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(workoutSessionService.deleteSession(uid, id, userDetails));
    }

    // 같은 날짜 안의 운동 기록 순서 변경. body = 정렬된 id 배열, ?date=YYYY-MM-DD
    @Operation(summary = "운동 기록 순서 변경 (uid, 날짜별)")
    @PutMapping("/{uid}/reorder")
    public ResponseEntity<List<WorkoutSessionDTO>> reorderSessions(
            @PathVariable("uid") String uid,
            @RequestParam("date") String date,
            @RequestBody List<Long> orderedIds,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(workoutSessionService.reorderSessions(uid, date, orderedIds, userDetails));
    }

    // ---------- 세션 내부 운동 단건 조작 ----------

    @Operation(summary = "운동 기록 안에 운동 추가 (uid, sessionId)")
    @PostMapping("/{uid}/{sessionId}/workout")
    public ResponseEntity<WorkoutDTO> addWorkout(
            @PathVariable("uid") String uid,
            @PathVariable("sessionId") Long sessionId,
            @RequestBody WorkoutDTO dto,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(workoutSessionService.addWorkout(uid, sessionId, dto, userDetails));
    }

    @Operation(summary = "운동 기록 안의 운동 수정 (uid, sessionId, workoutId)")
    @PutMapping("/{uid}/{sessionId}/workout/{workoutId}")
    public ResponseEntity<WorkoutDTO> updateWorkout(
            @PathVariable("uid") String uid,
            @PathVariable("sessionId") Long sessionId,
            @PathVariable("workoutId") Long workoutId,
            @RequestBody WorkoutDTO dto,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(workoutSessionService.updateWorkout(uid, sessionId, workoutId, dto, userDetails));
    }

    @Operation(summary = "운동 기록 안의 운동 삭제 (uid, sessionId, workoutId)")
    @DeleteMapping("/{uid}/{sessionId}/workout/{workoutId}")
    public ResponseEntity<WorkoutDTO> deleteWorkout(
            @PathVariable("uid") String uid,
            @PathVariable("sessionId") Long sessionId,
            @PathVariable("workoutId") Long workoutId,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(workoutSessionService.deleteWorkout(uid, sessionId, workoutId, userDetails));
    }

    @Operation(summary = "운동 기록 안의 운동 순서 변경 (uid, sessionId)")
    @PutMapping("/{uid}/{sessionId}/workout/reorder")
    public ResponseEntity<List<WorkoutDTO>> reorderWorkouts(
            @PathVariable("uid") String uid,
            @PathVariable("sessionId") Long sessionId,
            @RequestBody List<Long> orderedIds,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(workoutSessionService.reorderWorkouts(uid, sessionId, orderedIds, userDetails));
    }
}
// [E] edit by smsong
