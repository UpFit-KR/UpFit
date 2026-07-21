package com.example.UpFit.DTO;

import lombok.*;

import java.time.LocalDateTime;
import java.util.List;

// [B] edit by smsong - "다른 기기에 이미 로그인됨" 응답.
//   로그인 시 force=false 인데 다른 기기 세션이 있으면 HTTP 409 로 이 본문을 내려준다.
//   프론트는 devices 목록을 보여주고 "로그아웃하고 이 기기로 로그인" 확인을 받는다.
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class DeviceConflictDTO {
    private boolean requiresConfirmation;   // 항상 true (프론트 분기용 표식)
    private List<DeviceInfo> devices;       // 현재 로그인된 다른 기기들

    @NoArgsConstructor @AllArgsConstructor @Getter @Setter @Builder
    public static class DeviceInfo {
        private String deviceName;
        private String userAgent;
        private LocalDateTime lastSeenAt;
    }
}
// [E] edit by smsong
