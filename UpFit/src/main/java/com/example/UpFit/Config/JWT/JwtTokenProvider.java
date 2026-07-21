package com.example.UpFit.Config.JWT;

import io.jsonwebtoken.*;
import io.jsonwebtoken.security.Keys;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.security.Key;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class JwtTokenProvider {

    private static final Logger logger = LoggerFactory.getLogger(JwtTokenProvider.class);

    @Value("${jwt.secret}")
    private String secret;

    @Value("${jwt.expiration}")
    private Long expiration;

    private Key key;

    // 활성화된 토큰을 저장하는 맵
    private Map<String, String> activeTokens = new ConcurrentHashMap<>();
    // 무효화된 토큰을 저장하는 집합
    private Set<String> invalidTokens = ConcurrentHashMap.newKeySet();

    @PostConstruct
    public void init() {
        byte[] keyBytes = secret.getBytes();
        if (keyBytes.length < 64) {
            throw new IllegalArgumentException("경고 : 비밀 키의 길이는 64자 이상으로 설정할 것");
        }
        this.key = Keys.hmacShaKeyFor(keyBytes);
    }

    // 새로운 JWT 토큰을 생성
    public String generateToken(String uid) {
        invalidateToken(uid); // 이전 토큰 무효화
        Map<String, Object> claims = new HashMap<>();
        String token = doGenerateToken(claims, uid);
        activeTokens.put(uid, token); // 새로운 토큰 저장
        return token;
    }

    // JWT 토큰을 생성
    private String doGenerateToken(Map<String, Object> claims, String subject) {
        return Jwts.builder()
                .setClaims(claims)
                .setSubject(subject)
                .setIssuedAt(new Date(System.currentTimeMillis()))
                .setExpiration(new Date(System.currentTimeMillis() + expiration))
                .signWith(key, SignatureAlgorithm.HS512)
                .compact();
    }

    // JWT 토큰을 생성
    public String getUidFromToken(String token) {
        Claims claims = getAllClaimsFromToken(token);
        return claims != null ? claims.getSubject() : null;
    }

    // JWT 토큰에서 모든 클레임을 추출
    private Claims getAllClaimsFromToken(String token) {
        try {
            return Jwts.parserBuilder()
                    .setSigningKey(key)
                    .build()
                    .parseClaimsJws(token)
                    .getBody();
        } catch (ExpiredJwtException e) {
            logger.error("토큰의 유효기간이 지나 만료되었습니다. 다시 로그인 해주세요");
            throw e;
        } catch (JwtException | IllegalArgumentException e) {
            logger.error("토큰이 유효하지 않습니다");
            throw e;
        }
    }

    // JWT 토큰의 유효성과 만료 여부를 체크
    public Boolean validateToken(String token, String uid) {
        try {
            logger.info("토큰 유효성 및 만료여부를 체크합니다"); // 유효성 및 만료여부 체크 로그 추가
            final String userUid = getUidFromToken(token);
            if (invalidTokens.contains(token)) {
                logger.error("토큰이 무효화되었습니다.");
                return false;
            }
            return (userUid.equals(uid) && !isTokenExpired(token) && token.equals(activeTokens.get(uid)));
        } catch (ExpiredJwtException e) {
            logger.error("토큰의 유효기간이 지나 만료되었습니다. 다시 로그인 해주세요");
            return false;
        } catch (JwtException | IllegalArgumentException e) {
            logger.error("토큰이 유효하지 않습니다");
            return false;
        }
    }

    // JWT 토큰이 만료되었는지 확인
    private Boolean isTokenExpired(String token) {
        final Date expiration = getExpirationDateFromToken(token);
        return expiration.before(new Date());
    }

    // JWT 토큰에서 만료 날짜를 추출
    private Date getExpirationDateFromToken(String token) {
        Claims claims = getAllClaimsFromToken(token);
        return claims != null ? claims.getExpiration() : null;
    }

    // 주어진 사용자 ID의 기존 JWT 토큰을 무효화
    public void invalidateToken(String uid) {
        String token = activeTokens.remove(uid);
        if (token != null) {
            invalidTokens.add(token); // 이전 토큰을 무효화 목록에 추가
        }
    }

    // [B] edit by smsong : 토큰 갱신(슬라이딩 만료) — 현재 토큰이 유효하면 같은 uid 로 새 토큰을 발급.
    //   기존 refreshToken 은 claims 를 그대로 재서명해 setSubject/exp 가 꼬여 오류가 났다.
    //   generateToken(uid) 를 재사용하면 이전 토큰 무효화 + 새 만료시간이 일관되게 처리된다.
    //   반환값: 새 토큰(문자열). 유효하지 않으면 예외.
    public String refreshToken(String token) {
        if (token == null || token.isBlank()) {
            throw new IllegalArgumentException("토큰이 없습니다");
        }
        // 만료/무효 검사 (만료된 토큰으로는 갱신 불가 → 재로그인 필요)
        String uid;
        try {
            uid = getUidFromToken(token);
        } catch (ExpiredJwtException e) {
            logger.error("만료된 토큰으로는 갱신할 수 없습니다");
            throw new IllegalArgumentException("만료된 토큰");
        }
        if (uid == null) throw new IllegalArgumentException("유효하지 않은 토큰");
        if (invalidTokens.contains(token)) {
            logger.error("무효화된 토큰으로는 갱신할 수 없습니다");
            throw new IllegalArgumentException("무효화된 토큰");
        }
        // 현재 활성 토큰과 일치해야 갱신 허용(탈취된 옛 토큰으로 갱신 방지)
        if (!token.equals(activeTokens.get(uid))) {
            logger.error("활성 토큰과 일치하지 않아 갱신을 거부합니다");
            throw new IllegalArgumentException("활성 토큰 불일치");
        }
        // 새 토큰 발급(이전 토큰 자동 무효화)
        String refreshed = generateToken(uid);
        logger.info("토큰이 갱신되었습니다(슬라이딩 만료)");
        return refreshed;
    }

    // JWT 토큰의 남은 유효 기간을 체크
    public Long getTokenRemainingTime(String token) {
        Claims claims = getAllClaimsFromToken(token);
        if (claims == null) {
            logger.error("존재하지 않은 토큰입니다");
            throw new IllegalArgumentException("잘못된 토큰입니다");
        }
        if (isTokenExpired(token) || invalidTokens.contains(token)) {
            logger.error("토큰의 유효기간이 지나 만료되었습니다. 재로그인 후 다시 재발급 해주세요");
            throw new IllegalArgumentException("유효기간이 만료된 토큰입니다");
        }
        Date expirationDate = claims.getExpiration();
        if (expirationDate != null) {
            return (expirationDate.getTime() - System.currentTimeMillis()) / 1000; // 초 단위로 남은 시간 반환
        }
        return null;
    }

    // 활성화된 토큰을 가져오는 메서드
    public String getActiveToken(String uid) {
        return activeTokens.get(uid);
    }

    // 무효화된 토큰을 확인하는 메서드
    public boolean isTokenInvalid(String token) {
        return invalidTokens.contains(token);
    }
}
