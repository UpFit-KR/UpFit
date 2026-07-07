package com.example.UpFit.Controller;

import com.example.UpFit.DTO.MealDTO;
import com.example.UpFit.Service.MealService;
import io.swagger.v3.oas.annotations.Operation;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;

import java.util.List;

// [B] edit by smsong - 식단 기록 API. 경로의 uid 로 소유자 지정, JWT 로 본인 확인
@RestController
@RequestMapping("/meal")
@RequiredArgsConstructor
@CrossOrigin(origins = "http://127.0.0.1:5500")
public class MealController {

    private final MealService mealService;

    @Operation(summary = "식단 기록 전체 조회 (uid)")
    @GetMapping("/{uid}")
    public ResponseEntity<List<MealDTO>> getMyMeals(
            @PathVariable("uid") String uid,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(mealService.getMyMeals(uid, userDetails));
    }

    @Operation(summary = "식단 기록 생성 (uid)")
    @PostMapping("/{uid}")
    public ResponseEntity<MealDTO> createMeal(
            @PathVariable("uid") String uid,
            @RequestBody MealDTO mealDTO,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(mealService.createMeal(uid, mealDTO, userDetails));
    }

    @Operation(summary = "식단 기록 삭제 (uid, id)")
    @DeleteMapping("/{uid}/{id}")
    public ResponseEntity<MealDTO> deleteMeal(
            @PathVariable("uid") String uid,
            @PathVariable("id") Long id,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(mealService.deleteMeal(uid, id, userDetails));
    }
}
// [E] edit by smsong
