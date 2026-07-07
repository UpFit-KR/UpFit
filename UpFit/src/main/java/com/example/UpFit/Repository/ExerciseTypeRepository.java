package com.example.UpFit.Repository;

import com.example.UpFit.Entity.ExerciseTypeEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

// [B] edit by smsong - 운동 종목 리포지토리 (userId 기준 조회)
public interface ExerciseTypeRepository extends JpaRepository<ExerciseTypeEntity, Long> {
    List<ExerciseTypeEntity> findByUserIdOrderByIdAsc(Long userId);

    Optional<ExerciseTypeEntity> findByIdAndUserId(Long id, Long userId);

    boolean existsByUserIdAndName(Long userId, String name);
}
// [E] edit by smsong
