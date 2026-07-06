package com.example.UpFit.Config.Handler;

import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.authentication.SimpleUrlAuthenticationSuccessHandler;
import org.springframework.stereotype.Component;

import java.io.IOException;

@Component
public class CustomOAuth2AuthenticationSuccessHandler extends SimpleUrlAuthenticationSuccessHandler {

    @Override
    public void onAuthenticationSuccess(HttpServletRequest request, HttpServletResponse response,
            Authentication authentication)
            throws IOException, ServletException {

        // 로그인 성공 기본 리다이렉트 URL
        String redirectUrl = "/user/oauth2/code/kakao";

        // OAuth2 공급자를 통해 리디렉션 URL을 동적으로 설정 -> 공급자 = OAuth2 인증 제공자 (카카오, 네이버, 구글, 페이스북,
        // 깃허브)
        if (authentication.getPrincipal().toString().contains("naver")) {
            redirectUrl = "/user/oauth2/code/naver";
        }

        if (authentication.getPrincipal().toString().contains("google")) {
            redirectUrl = "/user/oauth2/code/google";
        }

        if (authentication.getPrincipal().toString().contains("facebook")) {
            redirectUrl = "/user/oauth2/code/facebook";
        }

        if (authentication.getPrincipal().toString().contains("github")) {
            redirectUrl = "/user/oauth2/code/github";
        }

        getRedirectStrategy().sendRedirect(request, response, redirectUrl);
    }
}
