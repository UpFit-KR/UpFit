package com.example.UpFit.Repository;

import com.example.UpFit.Entity.WorkoutEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

// [B] edit by smsong - 운동 기록 리포지토리 (userId 기준 조회)
public interface WorkoutRepository extends JpaRepository<WorkoutEntity, Long> {
    List<WorkoutEntity> findByUserIdOrderByWorkoutDateAscIdAsc(Long userId);

    Optional<WorkoutEntity> findByIdAndUserId(Long id, Long userId);
}
// [E] edit by smsong
