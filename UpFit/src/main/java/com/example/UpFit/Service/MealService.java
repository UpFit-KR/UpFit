package com.example.UpFit.Service;

import com.example.UpFit.DTO.MealDTO;
import com.example.UpFit.Entity.MealEntity;
import com.example.UpFit.Repository.MealRepository;
import com.example.UpFit.Repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

// [B] edit by smsong - 식단 기록 서비스. JWT(uid) → users.id 로 소유자 확인 후 CRUD
@Service
@RequiredArgsConstructor
public class MealService {

    private static final Logger logger = LoggerFactory.getLogger(MealService.class);
    private final MealRepository mealRepository;
    private final UserRepository userRepository;

    private Long ownerId(String uid, UserDetails userDetails) {
        if (userDetails == null || !userDetails.getUsername().equals(uid)) {
            throw new RuntimeException("권한이 없습니다");
        }
        return userRepository.findByUid(uid)
                .orElseThrow(() -> new IllegalArgumentException("사용자를 찾을 수 없습니다"))
                .getId();
    }

    // 내 식단 기록 전체 조회 (날짜 오름차순)
    public List<MealDTO> getMyMeals(String uid, UserDetails userDetails) {
        Long userId = ownerId(uid, userDetails);
        List<MealDTO> list = mealRepository.findByUserIdOrderByMealDateAscIdAsc(userId).stream()
                .map(MealDTO::entityToDto)
                .collect(Collectors.toList());
        logger.info("{} 식단 기록 {}건 조회", uid, list.size());
        return list;
    }

    // 식단 기록 생성
    public MealDTO createMeal(String uid, MealDTO dto, UserDetails userDetails) {
        Long userId = ownerId(uid, userDetails);
        MealEntity entity = dto.dtoToEntity();
        entity.setId(null);
        entity.setUserId(userId);
        MealEntity saved = mealRepository.save(entity);
        logger.info("{} 식단 기록 생성 (id={})", uid, saved.getId());
        return MealDTO.entityToDto(saved);
    }

    // 식단 기록 삭제 (본인 것만)
    public MealDTO deleteMeal(String uid, Long id, UserDetails userDetails) {
        Long userId = ownerId(uid, userDetails);
        MealEntity entity = mealRepository.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new IllegalArgumentException("기록을 찾을 수 없습니다"));
        mealRepository.delete(entity);
        logger.info("{} 식단 기록 삭제 (id={})", uid, id);
        return MealDTO.entityToDto(entity);
    }
}
// [E] edit by smsong
