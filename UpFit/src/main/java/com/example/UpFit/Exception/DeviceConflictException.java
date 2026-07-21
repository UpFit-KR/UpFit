package com.example.UpFit.Exception;

import com.example.UpFit.DTO.DeviceConflictDTO;
import lombok.Getter;

// [B] edit by smsong - 다른 기기에 이미 로그인되어 있어 확인이 필요할 때 던지는 예외.
//   컨트롤러가 잡아서 HTTP 409 + DeviceConflictDTO 로 응답한다.
@Getter
public class DeviceConflictException extends RuntimeException {
    private final DeviceConflictDTO detail;

    public DeviceConflictException(DeviceConflictDTO detail) {
        super("이미 다른 기기에 로그인되어 있습니다");
        this.detail = detail;
    }
}
// [E] edit by smsong
