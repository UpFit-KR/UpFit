package com.example.UpFit.Repository;

import com.example.UpFit.Entity.UserEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface UserRepository extends JpaRepository<UserEntity, Long> {
    Optional<UserEntity> findByUid(String uid);

    Optional<UserEntity> findByNickname(String nickname);

    Optional<UserEntity> findByNicknameContainingIgnoreCase(String nickname);

    boolean existsByUid(String uid);

    boolean existsByNickname(String nickname);

    boolean existsByEmail(String email);

    boolean existsByPhone(String phone);
}
