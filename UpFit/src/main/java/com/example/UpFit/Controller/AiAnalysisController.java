package com.example.UpFit.Controller;

import com.example.UpFit.DTO.AiAnalysisRequestDTO;
import com.example.UpFit.DTO.AiAnalysisResponseDTO;
import com.example.UpFit.DTO.AiSessionRequestDTO;
import com.example.UpFit.Service.AiAnalysisService;
import io.swagger.v3.oas.annotations.Operation;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;

// [B] edit by smsong - AI 운동 분석 API.
//   프런트가 구성한 분석 페이로드를 받아 Gemini 로 분석 → 구조화 결과 반환.
//   경로의 uid 로 소유자 지정, JWT 로 본인 확인. (결과는 저장하지 않고 매번 새로 생성)
@RestController
@RequestMapping("/ai")
@RequiredArgsConstructor
@CrossOrigin(origins = "http://127.0.0.1:5500")
public class AiAnalysisController {

    private final AiAnalysisService aiAnalysisService;

    private boolean notOwner(UserDetails u, String uid) {
        return u == null || !u.getUsername().equals(uid);
    }

    @Operation(summary = "종목 성장 AI 분석 (uid)")
    @PostMapping("/analyze/{uid}")
    public ResponseEntity<AiAnalysisResponseDTO> analyze(
            @PathVariable("uid") String uid,
            @RequestBody AiAnalysisRequestDTO req,
            @AuthenticationPrincipal UserDetails userDetails) {
        if (notOwner(userDetails, uid)) return ResponseEntity.status(403).build();
        return ResponseEntity.ok(aiAnalysisService.analyze(req));
    }

    // [B] edit by smsong - 운동 상세(하루 세션) AI 분석. 신체정보+그날 운동 전체 → 운동량/피로/예측.
    @Operation(summary = "운동 상세(하루) AI 분석 (uid)")
    @PostMapping("/session/{uid}")
    public ResponseEntity<AiAnalysisResponseDTO> analyzeSession(
            @PathVariable("uid") String uid,
            @RequestBody AiSessionRequestDTO req,
            @AuthenticationPrincipal UserDetails userDetails) {
        if (notOwner(userDetails, uid)) return ResponseEntity.status(403).build();
        return ResponseEntity.ok(aiAnalysisService.analyzeSession(req));
    }
    // [E] edit by smsong
}
