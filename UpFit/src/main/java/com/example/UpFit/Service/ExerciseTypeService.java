package com.example.UpFit.Service;

import com.example.UpFit.DTO.ExerciseTypeDTO;
import com.example.UpFit.Entity.ExerciseTypeEntity;
import com.example.UpFit.Repository.ExerciseTypeRepository;
import com.example.UpFit.Repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

// [B] edit by smsong - 운동 종목 서비스. 사용자별 콤보박스 값 CRUD (중복 방지)
@Service
@RequiredArgsConstructor
public class ExerciseTypeService {

    private static final Logger logger = LoggerFactory.getLogger(ExerciseTypeService.class);
    private final ExerciseTypeRepository exerciseTypeRepository;
    private final UserRepository userRepository;

    private Long ownerId(String uid, UserDetails userDetails) {
        if (userDetails == null || !userDetails.getUsername().equals(uid)) {
            throw new RuntimeException("권한이 없습니다");
        }
        return userRepository.findByUid(uid)
                .orElseThrow(() -> new IllegalArgumentException("사용자를 찾을 수 없습니다"))
                .getId();
    }

    // 내 종목 목록 조회
    public List<ExerciseTypeDTO> getMyExercises(String uid, UserDetails userDetails) {
        Long userId = ownerId(uid, userDetails);
        return exerciseTypeRepository.findByUserIdOrderByIdAsc(userId).stream()
                .map(ExerciseTypeDTO::entityToDto)
                .collect(Collectors.toList());
    }

    // 종목 추가 (같은 이름 중복 방지)
    public ExerciseTypeDTO createExercise(String uid, ExerciseTypeDTO dto, UserDetails userDetails) {
        Long userId = ownerId(uid, userDetails);
        String name = dto.getName() == null ? "" : dto.getName().trim();
        if (name.isEmpty()) throw new IllegalArgumentException("종목 이름을 입력하세요");
        if (exerciseTypeRepository.existsByUserIdAndName(userId, name)) {
            throw new IllegalArgumentException("이미 등록된 종목입니다");
        }
        ExerciseTypeEntity saved = exerciseTypeRepository.save(
                ExerciseTypeEntity.builder().userId(userId).name(name).build());
        logger.info("{} 종목 추가: {}", uid, name);
        return ExerciseTypeDTO.entityToDto(saved);
    }

    // 종목 삭제 (본인 것만)
    public ExerciseTypeDTO deleteExercise(String uid, Long id, UserDetails userDetails) {
        Long userId = ownerId(uid, userDetails);
        ExerciseTypeEntity entity = exerciseTypeRepository.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new IllegalArgumentException("종목을 찾을 수 없습니다"));
        exerciseTypeRepository.delete(entity);
        logger.info("{} 종목 삭제 (id={})", uid, id);
        return ExerciseTypeDTO.entityToDto(entity);
    }
}
// [E] edit by smsong
