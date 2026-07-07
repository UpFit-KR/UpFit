package com.example.UpFit.Controller;

import com.example.UpFit.DTO.WorkoutDTO;
import com.example.UpFit.Service.WorkoutService;
import io.swagger.v3.oas.annotations.Operation;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;

import java.util.List;

// [B] edit by smsong - 운동 기록 API. 경로의 uid 로 소유자 지정, JWT 로 본인 확인
@RestController
@RequestMapping("/workout")
@RequiredArgsConstructor
@CrossOrigin(origins = "http://127.0.0.1:5500")
public class WorkoutController {

    private final WorkoutService workoutService;

    // 내 운동 기록 전체 조회
    @Operation(summary = "운동 기록 전체 조회 (uid)")
    @GetMapping("/{uid}")
    public ResponseEntity<List<WorkoutDTO>> getMyWorkouts(
            @PathVariable("uid") String uid,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(workoutService.getMyWorkouts(uid, userDetails));
    }

    // 운동 기록 생성
    @Operation(summary = "운동 기록 생성 (uid)")
    @PostMapping("/{uid}")
    public ResponseEntity<WorkoutDTO> createWorkout(
            @PathVariable("uid") String uid,
            @RequestBody WorkoutDTO workoutDTO,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(workoutService.createWorkout(uid, workoutDTO, userDetails));
    }

    // 운동 기록 삭제
    @Operation(summary = "운동 기록 삭제 (uid, id)")
    @DeleteMapping("/{uid}/{id}")
    public ResponseEntity<WorkoutDTO> deleteWorkout(
            @PathVariable("uid") String uid,
            @PathVariable("id") Long id,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(workoutService.deleteWorkout(uid, id, userDetails));
    }
}
// [E] edit by smsong
