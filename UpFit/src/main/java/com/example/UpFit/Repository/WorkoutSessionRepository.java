package com.example.UpFit.Repository;

import com.example.UpFit.Entity.WorkoutSessionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

// [B] edit by smsong - 운동 기록(세션) 리포지토리 (userId 기준 조회)
public interface WorkoutSessionRepository extends JpaRepository<WorkoutSessionEntity, Long> {

    // 날짜 오름차순 → 같은 날짜는 sortOrder 오름차순 → 미지정(null)은 맨 뒤 + id 순.
    // COALESCE 로 null 을 큰 값으로 치환해 DB 별 NULL 정렬 차이를 없앤다.
    @Query("SELECT s FROM workout_sessions s WHERE s.userId = :userId " +
           "ORDER BY s.sessionDate ASC, COALESCE(s.sortOrder, 1000000) ASC, s.id ASC")
    List<WorkoutSessionEntity> findAllForUserOrdered(@Param("userId") Long userId);

    // 특정 날짜의 세션(재정렬/순번 채번 대상)
    @Query("SELECT s FROM workout_sessions s WHERE s.userId = :userId AND s.sessionDate = :sessionDate " +
           "ORDER BY COALESCE(s.sortOrder, 1000000) ASC, s.id ASC")
    List<WorkoutSessionEntity> findByUserIdAndDateOrdered(@Param("userId") Long userId,
                                                          @Param("sessionDate") String sessionDate);

    Optional<WorkoutSessionEntity> findByIdAndUserId(Long id, Long userId);
}
// [E] edit by smsong
