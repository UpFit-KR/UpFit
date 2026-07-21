package com.example.UpFit.Repository;

import com.example.UpFit.Entity.AiResultEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

// [B] edit by smsong - AI 분석 결과 캐시 조회/저장
public interface AiResultRepository extends JpaRepository<AiResultEntity, Long> {
    Optional<AiResultEntity> findByUidAndTypeAndRefKey(String uid, String type, String refKey);
    void deleteByUidAndTypeAndRefKey(String uid, String type, String refKey);
}
// [E] edit by smsong
