package com.example.UpFit.Controller;

import com.example.UpFit.DTO.ExerciseTypeDTO;
import com.example.UpFit.Service.ExerciseTypeService;
import io.swagger.v3.oas.annotations.Operation;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;

import java.util.List;

// [B] edit by smsong - 운동 종목(콤보박스 값) API
@RestController
@RequestMapping("/exercise")
@RequiredArgsConstructor
@CrossOrigin(origins = "http://127.0.0.1:5500")
public class ExerciseTypeController {

    private final ExerciseTypeService exerciseTypeService;

    @Operation(summary = "운동 종목 목록 조회 (uid)")
    @GetMapping("/{uid}")
    public ResponseEntity<List<ExerciseTypeDTO>> getMyExercises(
            @PathVariable("uid") String uid,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(exerciseTypeService.getMyExercises(uid, userDetails));
    }

    @Operation(summary = "운동 종목 추가 (uid)")
    @PostMapping("/{uid}")
    public ResponseEntity<ExerciseTypeDTO> createExercise(
            @PathVariable("uid") String uid,
            @RequestBody ExerciseTypeDTO dto,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(exerciseTypeService.createExercise(uid, dto, userDetails));
    }

    @Operation(summary = "운동 종목 삭제 (uid, id)")
    @DeleteMapping("/{uid}/{id}")
    public ResponseEntity<ExerciseTypeDTO> deleteExercise(
            @PathVariable("uid") String uid,
            @PathVariable("id") Long id,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(exerciseTypeService.deleteExercise(uid, id, userDetails));
    }
}
// [E] edit by smsong
