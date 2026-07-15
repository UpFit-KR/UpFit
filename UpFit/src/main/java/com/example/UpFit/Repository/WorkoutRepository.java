package com.example.UpFit.Repository;

import com.example.UpFit.Entity.WorkoutEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

// [B] edit by smsong - 운동 리포지토리.
//   구조 변경: workoutDate 기준 조회 제거 → sessionId(운동 기록) 기준 조회로 전환.
public interface WorkoutRepository extends JpaRepository<WorkoutEntity, Long> {

    // 사용자의 전체 운동 (세션별 그룹핑 후 전달용). 세션 → 세션 내 순서 → id 순.
    @Query("SELECT w FROM workouts w WHERE w.userId = :userId " +
           "ORDER BY w.sessionId ASC, COALESCE(w.sortOrder, 1000000) ASC, w.id ASC")
    List<WorkoutEntity> findAllForUserOrdered(@Param("userId") Long userId);

    // 특정 세션 안의 운동 (표시 순서대로)
    @Query("SELECT w FROM workouts w WHERE w.sessionId = :sessionId " +
           "ORDER BY COALESCE(w.sortOrder, 1000000) ASC, w.id ASC")
    List<WorkoutEntity> findBySessionIdOrdered(@Param("sessionId") Long sessionId);

    // 여러 세션의 운동을 한 번에 (N+1 방지)
    @Query("SELECT w FROM workouts w WHERE w.sessionId IN :sessionIds " +
           "ORDER BY w.sessionId ASC, COALESCE(w.sortOrder, 1000000) ASC, w.id ASC")
    List<WorkoutEntity> findBySessionIdsOrdered(@Param("sessionIds") List<Long> sessionIds);

    Optional<WorkoutEntity> findByIdAndUserIdAndSessionId(Long id, Long userId, Long sessionId);

    void deleteBySessionId(Long sessionId);
}
// [E] edit by smsong
