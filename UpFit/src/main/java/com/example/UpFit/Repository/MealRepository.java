package com.example.UpFit.Repository;

import com.example.UpFit.Entity.MealEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

// [B] edit by smsong - 식단 기록 리포지토리 (userId 기준 조회)
public interface MealRepository extends JpaRepository<MealEntity, Long> {
    List<MealEntity> findByUserIdOrderByMealDateAscIdAsc(Long userId);

    Optional<MealEntity> findByIdAndUserId(Long id, Long userId);
}
// [E] edit by smsong
