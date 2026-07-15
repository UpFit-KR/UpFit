package com.example.UpFit.Repository;

import com.example.UpFit.Entity.WorkoutEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

// [B] edit by smsong - 운동 기록 리포지토리 (userId 기준 조회)
public interface WorkoutRepository extends JpaRepository<WorkoutEntity, Long> {

    // 날짜 오름차순 → 같은 날짜는 sortOrder 오름차순 → 미지정(null)은 맨 뒤 + id 순.
    // COALESCE 로 null 을 큰 값으로 치환해 DB 별 NULL 정렬 차이를 없앤다(기존 행 호환).
    @Query("SELECT w FROM workouts w WHERE w.userId = :userId " +
           "ORDER BY w.workoutDate ASC, COALESCE(w.sortOrder, 1000000) ASC, w.id ASC")
    List<WorkoutEntity> findAllForUserOrdered(@Param("userId") Long userId);

    // 특정 날짜의 기록(재정렬 대상)
    List<WorkoutEntity> findByUserIdAndWorkoutDate(Long userId, String workoutDate);

    Optional<WorkoutEntity> findByIdAndUserId(Long id, Long userId);
}
// [E] edit by smsong
