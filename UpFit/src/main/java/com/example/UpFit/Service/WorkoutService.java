package com.example.UpFit.Service;

import com.example.UpFit.DTO.WorkoutDTO;
import com.example.UpFit.Entity.WorkoutEntity;
import com.example.UpFit.Repository.UserRepository;
import com.example.UpFit.Repository.WorkoutRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

// [B] edit by smsong - 운동 기록 서비스. JWT(uid) → users.id 로 소유자 확인 후 CRUD
@Service
@RequiredArgsConstructor
public class WorkoutService {

    private static final Logger logger = LoggerFactory.getLogger(WorkoutService.class);
    private final WorkoutRepository workoutRepository;
    private final UserRepository userRepository;

    // uid(로그인 사용자)와 요청 uid 일치 확인 후 users.id(외래키) 반환
    private Long ownerId(String uid, UserDetails userDetails) {
        if (userDetails == null || !userDetails.getUsername().equals(uid)) {
            throw new RuntimeException("권한이 없습니다");
        }
        return userRepository.findByUid(uid)
                .orElseThrow(() -> new IllegalArgumentException("사용자를 찾을 수 없습니다"))
                .getId();
    }

    // 내 운동 기록 전체 조회 (날짜 오름차순)
    public List<WorkoutDTO> getMyWorkouts(String uid, UserDetails userDetails) {
        Long userId = ownerId(uid, userDetails);
        List<WorkoutDTO> list = workoutRepository.findAllForUserOrdered(userId).stream()
                .map(WorkoutDTO::entityToDto)
                .collect(Collectors.toList());
        logger.info("{} 운동 기록 {}건 조회", uid, list.size());
        return list;
    }

    // 운동 기록 생성
    public WorkoutDTO createWorkout(String uid, WorkoutDTO dto, UserDetails userDetails) {
        Long userId = ownerId(uid, userDetails);
        WorkoutEntity entity = dto.dtoToEntity();
        entity.setId(null);         // 서버에서 채번
        entity.setUserId(userId);   // 소유자 강제 지정(위조 방지)
        WorkoutEntity saved = workoutRepository.save(entity);
        logger.info("{} 운동 기록 생성 (id={})", uid, saved.getId());
        return WorkoutDTO.entityToDto(saved);
    }

    // 운동 기록 순서 변경 (특정 날짜의 기록을 클라이언트가 보낸 id 순서대로 재번호)
    // orderedIds 에 없는(신규/누락) 기록은 id 순으로 뒤에 붙인다. 본인·해당 날짜의 것만 반영.
    @Transactional
    public List<WorkoutDTO> reorderWorkouts(String uid, String workoutDate,
                                            List<Long> orderedIds, UserDetails userDetails) {
        Long userId = ownerId(uid, userDetails);
        List<WorkoutEntity> dayRecords = workoutRepository.findByUserIdAndWorkoutDate(userId, workoutDate);
        Map<Long, WorkoutEntity> byId = dayRecords.stream()
                .collect(Collectors.toMap(WorkoutEntity::getId, e -> e));

        int order = 0;
        if (orderedIds != null) {
            for (Long id : orderedIds) {
                WorkoutEntity e = byId.remove(id);   // 소유·해당 날짜의 것만 처리(위조/타 날짜 무시)
                if (e != null) e.setSortOrder(order++);
            }
        }
        // 목록에 없던 나머지는 id 순으로 뒤에 배치
        List<WorkoutEntity> remaining = byId.values().stream()
                .sorted(Comparator.comparing(WorkoutEntity::getId))
                .collect(Collectors.toList());
        for (WorkoutEntity e : remaining) e.setSortOrder(order++);

        workoutRepository.saveAll(dayRecords);
        logger.info("{} {} 운동 순서 변경 ({}건)", uid, workoutDate, dayRecords.size());

        return dayRecords.stream()
                .sorted(Comparator.comparing(WorkoutEntity::getSortOrder))
                .map(WorkoutDTO::entityToDto)
                .collect(Collectors.toList());
    }

    // 운동 기록 삭제 (본인 것만)
    public WorkoutDTO deleteWorkout(String uid, Long id, UserDetails userDetails) {
        Long userId = ownerId(uid, userDetails);
        WorkoutEntity entity = workoutRepository.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new IllegalArgumentException("기록을 찾을 수 없습니다"));
        workoutRepository.delete(entity);
        logger.info("{} 운동 기록 삭제 (id={})", uid, id);
        return WorkoutDTO.entityToDto(entity);
    }
}
// [E] edit by smsong
