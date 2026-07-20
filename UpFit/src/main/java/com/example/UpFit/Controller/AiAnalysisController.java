package com.example.UpFit.Controller;

import com.example.UpFit.DTO.AiAnalysisRequestDTO;
import com.example.UpFit.DTO.AiAnalysisResponseDTO;
import com.example.UpFit.Service.AiAnalysisService;
import io.swagger.v3.oas.annotations.Operation;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;

// [B] edit by smsong - AI 운동 분석 API.
//   프런트가 구성한 분석 페이로드를 받아 Gemini 로 분석 → 구조화 결과 반환.
//   경로의 uid 로 소유자 지정, JWT 로 본인 확인(다른 프로젝트 패턴과 동일).
@RestController
@RequestMapping("/ai")
@RequiredArgsConstructor
@CrossOrigin(origins = "http://127.0.0.1:5500")
public class AiAnalysisController {

    private final AiAnalysisService aiAnalysisService;

    @Operation(summary = "종목 성장 AI 분석 (uid)")
    @PostMapping("/analyze/{uid}")
    public ResponseEntity<AiAnalysisResponseDTO> analyze(
            @PathVariable("uid") String uid,
            @RequestBody AiAnalysisRequestDTO req,
            @AuthenticationPrincipal UserDetails userDetails) {
        // 본인 확인 (다른 사용자 uid 로 호출 차단)
        if (userDetails == null || !userDetails.getUsername().equals(uid)) {
            return ResponseEntity.status(403).build();
        }
        return ResponseEntity.ok(aiAnalysisService.analyze(req));
    }
}
// [E] edit by smsong
