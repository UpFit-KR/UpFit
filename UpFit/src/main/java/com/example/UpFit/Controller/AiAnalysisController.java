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
//   경로의 uid 로 소유자 지정, JWT 로 본인 확인(다른 프로젝트 패턴과 동일).
//   결과는 (type + refKey) 로 DB 에 1건씩 저장 → 다음 방문 때 바로 조회, 재생성 시 덮어쓴다.
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
            @RequestParam(value = "type", defaultValue = "trend") String type,
            @RequestParam(value = "refKey", required = false) String refKey,
            @RequestBody AiAnalysisRequestDTO req,
            @AuthenticationPrincipal UserDetails userDetails) {
        if (notOwner(userDetails, uid)) return ResponseEntity.status(403).build();
        AiAnalysisResponseDTO res = aiAnalysisService.analyze(req);
        // [B][E] edit by smsong : 결과 저장(재생성 시 덮어씀)
        aiAnalysisService.saveResult(uid, type, refKey, res);
        return ResponseEntity.ok(res);
    }

    // [B] edit by smsong - 운동 상세(하루 세션) AI 분석. 신체정보+그날 운동 전체 → 운동량/피로/예측.
    @Operation(summary = "운동 상세(하루) AI 분석 (uid)")
    @PostMapping("/session/{uid}")
    public ResponseEntity<AiAnalysisResponseDTO> analyzeSession(
            @PathVariable("uid") String uid,
            @RequestParam(value = "refKey", required = false) String refKey,
            @RequestBody AiSessionRequestDTO req,
            @AuthenticationPrincipal UserDetails userDetails) {
        if (notOwner(userDetails, uid)) return ResponseEntity.status(403).build();
        AiAnalysisResponseDTO res = aiAnalysisService.analyzeSession(req);
        aiAnalysisService.saveResult(uid, "session", refKey, res);
        return ResponseEntity.ok(res);
    }

    // 저장된 결과 조회 (없으면 204 No Content)
    @Operation(summary = "저장된 AI 결과 조회 (uid)")
    @GetMapping("/result/{uid}")
    public ResponseEntity<AiAnalysisResponseDTO> getSaved(
            @PathVariable("uid") String uid,
            @RequestParam("type") String type,
            @RequestParam("refKey") String refKey,
            @AuthenticationPrincipal UserDetails userDetails) {
        if (notOwner(userDetails, uid)) return ResponseEntity.status(403).build();
        AiAnalysisResponseDTO saved = aiAnalysisService.getSaved(uid, type, refKey);
        if (saved == null) return ResponseEntity.noContent().build();
        return ResponseEntity.ok(saved);
    }

    // 저장된 결과 삭제
    @Operation(summary = "저장된 AI 결과 삭제 (uid)")
    @DeleteMapping("/result/{uid}")
    public ResponseEntity<Void> deleteSaved(
            @PathVariable("uid") String uid,
            @RequestParam("type") String type,
            @RequestParam("refKey") String refKey,
            @AuthenticationPrincipal UserDetails userDetails) {
        if (notOwner(userDetails, uid)) return ResponseEntity.status(403).build();
        aiAnalysisService.deleteResult(uid, type, refKey);
        return ResponseEntity.noContent().build();
    }
    // [E] edit by smsong
}

