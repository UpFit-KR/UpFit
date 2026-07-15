package com.example.UpFit.Entity;

import jakarta.persistence.*;
import lombok.*;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.Collection;
import java.util.HashSet;

@Entity(name = "users")
@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class UserEntity implements UserDetails {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    private String uid;
    private String password;
    private String name;
    private String age;
    private String gender; 
    private String nickname;
    private String address;
    private String email;
    private String phone;
    private String profileURL;
    private String provider;
    private int likeCount = 0;

    // [B] edit by smsong - 공인중개사사무소 정보(이름/전화번호/주소)
    private String agencyName;     // 공인중개사사무소 이름
    private String agencyPhone;    // 공인중개사사무소 전화번호
    private String agencyAddress;  // 공인중개사사무소 주소
    // [E] edit by smsong

    // [B] edit by smsong - UpFit 신체 정보(키/현재 체중/목표 체중) DB 영속화
    //   프론트 localStorage 에만 있던 값을 사용자 레코드로 옮겨 기기/재설치와 무관하게 유지.
    private Double height;        // 키 (cm)
    private Double weight;        // 현재 체중 (kg)
    private Double targetWeight;  // 목표 체중 (kg)
    // [E] edit by smsong

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        // 사용자 권한 설정, 필요에 따라 변경할 것
        return new HashSet<>();
    }

    @Override
    public String getUsername() {
        return uid;
    }

    @Override
    public boolean isAccountNonExpired() {
        return true;
    }

    @Override
    public boolean isAccountNonLocked() {
        return true;
    }

    @Override
    public boolean isCredentialsNonExpired() {
        return true;
    }

    @Override
    public boolean isEnabled() {
        return true;
    }
}
