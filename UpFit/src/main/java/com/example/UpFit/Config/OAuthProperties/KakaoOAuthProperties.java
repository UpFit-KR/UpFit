package com.example.UpFit.Config.OAuthProperties;

import lombok.*;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "spring.security.oauth2.client.registration.kakao")
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class KakaoOAuthProperties {
    private String clientId;
    private String clientSecret;
    private String redirectUri;
}
