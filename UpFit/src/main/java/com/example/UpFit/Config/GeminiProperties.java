package com.example.UpFit.Config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

// [B] edit by smsong - Gemini 설정 바인딩.
//   application.yml:
//     gemini:
//       api-key: ${GEMINI_API_KEY}
//       model: gemini-2.5-flash
@Configuration
@ConfigurationProperties(prefix = "gemini")
@Getter
@Setter
public class GeminiProperties {
    private String apiKey;
    private String model = "gemini-2.5-flash";
}
// [E] edit by smsong
