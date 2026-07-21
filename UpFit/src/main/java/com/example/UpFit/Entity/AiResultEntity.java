package com.example.UpFit.Entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

// [B] edit by smsong - AI 분석 결과 저장(캐시).
//   3종 분석을 (uid + type + refKey) 로 구분해 1건씩 보관한다.
//     · type = "trend"   → refKey = 종목명
//     · type = "compare" → refKey = 종목명|이전날짜|최근날짜
//     · type = "session" → refKey = 세션ID
//   재생성 시 같은 키의 기존 행을 덮어쓴다(payloadJson=결과 JSON).
@Entity(name = "ai_results")
@Table(uniqueConstraints = @UniqueConstraint(columnNames = {"uid", "type", "refKey"}))
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class AiResultEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String uid;
    private String type;      // trend | compare | session

    @Column(length = 512)
    private String refKey;    // 분석 대상 식별자

    @Lob
    @Column(columnDefinition = "TEXT")
    private String resultJson;   // AiAnalysisResponseDTO 를 직렬화한 JSON

    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
// [E] edit by smsong
