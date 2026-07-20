package com.example.UpFit.Service;

import com.example.UpFit.DTO.WorkoutDTO;
import com.example.UpFit.DTO.WorkoutSessionDTO;
import com.example.UpFit.Entity.WorkoutEntity;
import com.example.UpFit.Entity.WorkoutSessionEntity;
import com.example.UpFit.Repository.UserRepository;
import com.example.UpFit.Repository.WorkoutRepository;
import com.example.UpFit.Repository.WorkoutSessionRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

// [B] edit by smsong - 운동 기록(세션) 서비스.
//   기존 WorkoutService(날짜별 개별 운동 CRUD)를 대체한다.
//   구조: 날짜 → 운동 기록(세션: 시작/종료/총시간/컨디션) → 운동 여러 개
//   JWT(uid) → users.id 로 소유자 확인 후 CRUD.
@Service
@RequiredArgsConstructor
public class WorkoutSessionService {

    private static final Logger logger = LoggerFactory.getLogger(WorkoutSessionService.class);
    private static final Pattern DATE_RE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");

    private final WorkoutSessionRepository sessionRepository;
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

    // ------------------------------------------------------------
    //  조회
    // ------------------------------------------------------------

    // 내 운동 기록 전체 조회 (세션 + 세션 내 운동 목록). 날짜 오름차순.
    public List<WorkoutSessionDTO> getMySessions(String uid, UserDetails userDetails) {
        Long userId = ownerId(uid, userDetails);
        List<WorkoutSessionEntity> sessions = sessionRepository.findAllForUserOrdered(userId);
        Map<Long, List<WorkoutEntity>> bySession = groupBySession(workoutRepository.findAllForUserOrdered(userId));
        List<WorkoutSessionDTO> list = sessions.stream()
                .map(s -> WorkoutSessionDTO.entityToDto(s, bySession.get(s.getId())))
                .collect(Collectors.toList());
        logger.info("{} 운동 기록(세션) {}건 조회", uid, list.size());
        return list;
    }

    // 특정 날짜의 운동 기록(세션) 조회 — 달력에서 날짜 클릭 시 사용
    public List<WorkoutSessionDTO> getSessionsByDate(String uid, String date, UserDetails userDetails) {
        Long userId = ownerId(uid, userDetails);
        requireDate(date);
        List<WorkoutSessionEntity> sessions = sessionRepository.findByUserIdAndDateOrdered(userId, date);
        if (sessions.isEmpty()) return new ArrayList<>();
        List<Long> ids = sessions.stream().map(WorkoutSessionEntity::getId).collect(Collectors.toList());
        Map<Long, List<WorkoutEntity>> bySession = groupBySession(workoutRepository.findBySessionIdsOrdered(ids));
        return sessions.stream()
                .map(s -> WorkoutSessionDTO.entityToDto(s, bySession.get(s.getId())))
                .collect(Collectors.toList());
    }

    // 단건 조회
    public WorkoutSessionDTO getSession(String uid, Long id, UserDetails userDetails) {
        Long userId = ownerId(uid, userDetails);
        WorkoutSessionEntity s = mustFind(id, userId);
        return WorkoutSessionDTO.entityToDto(s, workoutRepository.findBySessionIdOrdered(s.getId()));
    }

    // ------------------------------------------------------------
    //  생성 / 수정 / 삭제
    // ------------------------------------------------------------

    // 운동 기록(세션) 생성. workouts 를 함께 보내면 세션 생성과 동시에 여러 운동을 한 번에 저장한다.
    @Transactional
    public WorkoutSessionDTO createSession(String uid, WorkoutSessionDTO dto, UserDetails userDetails) {
        Long userId = ownerId(uid, userDetails);
        requireDate(dto.getSessionDate());

        // 같은 날짜의 마지막 순번 다음으로 배치
        int nextOrder = sessionRepository.findByUserIdAndDateOrdered(userId, dto.getSessionDate()).size();

        WorkoutSessionEntity entity = WorkoutSessionEntity.builder()
                .userId(userId)
                .sessionDate(dto.getSessionDate())
                .startTime(normTime(dto.getStartTime()))
                .endTime(normTime(dto.getEndTime()))
                .durationMin(resolveDuration(dto))
                .conditionScore(clampCondition(dto.getConditionScore()))
                .bodyParts(trimOrNull(dto.getBodyParts(), 120))
                .title(trimOrNull(dto.getTitle(), 60))
                .memo(trimOrNull(dto.getMemo(), 300))
                .sortOrder(nextOrder)
                .build();

        WorkoutSessionEntity saved = sessionRepository.save(entity);
        List<WorkoutEntity> items = syncWorkouts(userId, saved.getId(), dto.getWorkouts());
        logger.info("{} 운동 기록 생성 (id={}, date={}, 운동 {}개)", uid, saved.getId(), saved.getSessionDate(), items.size());
        return WorkoutSessionDTO.entityToDto(saved, items);
    }

    // 운동 기록(세션) 수정. workouts 가 null 이 아니면 목록 전체를 동기화(추가/수정/삭제)한다.
    @Transactional
    public WorkoutSessionDTO updateSession(String uid, Long id, WorkoutSessionDTO dto, UserDetails userDetails) {
        Long userId = ownerId(uid, userDetails);
        WorkoutSessionEntity entity = mustFind(id, userId);

        if (dto.getSessionDate() != null) {
            requireDate(dto.getSessionDate());
            // 날짜가 바뀌면 새 날짜의 맨 뒤로 재배치
            if (!dto.getSessionDate().equals(entity.getSessionDate())) {
                entity.setSortOrder(sessionRepository.findByUserIdAndDateOrdered(userId, dto.getSessionDate()).size());
                entity.setSessionDate(dto.getSessionDate());
            }
        }
        entity.setStartTime(normTime(dto.getStartTime()));
        entity.setEndTime(normTime(dto.getEndTime()));
        entity.setDurationMin(resolveDuration(dto));
        entity.setConditionScore(clampCondition(dto.getConditionScore()));
        entity.setBodyParts(trimOrNull(dto.getBodyParts(), 120));
        entity.setTitle(trimOrNull(dto.getTitle(), 60));
        entity.setMemo(trimOrNull(dto.getMemo(), 300));

        WorkoutSessionEntity saved = sessionRepository.save(entity);

        List<WorkoutEntity> items = (dto.getWorkouts() != null)
                ? syncWorkouts(userId, saved.getId(), dto.getWorkouts())
                : workoutRepository.findBySessionIdOrdered(saved.getId());

        logger.info("{} 운동 기록 수정 (id={}, 운동 {}개)", uid, saved.getId(), items.size());
        return WorkoutSessionDTO.entityToDto(saved, items);
    }

    // 운동 기록(세션) 삭제 — 안에 있는 운동도 함께 삭제된다.
    @Transactional
    public WorkoutSessionDTO deleteSession(String uid, Long id, UserDetails userDetails) {
        Long userId = ownerId(uid, userDetails);
        WorkoutSessionEntity entity = mustFind(id, userId);
        List<WorkoutEntity> items = workoutRepository.findBySessionIdOrdered(entity.getId());
        workoutRepository.deleteBySessionId(entity.getId());
        sessionRepository.delete(entity);
        logger.info("{} 운동 기록 삭제 (id={}, 운동 {}개 동반 삭제)", uid, id, items.size());
        return WorkoutSessionDTO.entityToDto(entity, items);
    }

    // 같은 날짜 안의 세션 순서 변경 (클라이언트가 보낸 id 순서대로 재번호)
    @Transactional
    public List<WorkoutSessionDTO> reorderSessions(String uid, String date, List<Long> orderedIds, UserDetails userDetails) {
        Long userId = ownerId(uid, userDetails);
        requireDate(date);
        List<WorkoutSessionEntity> dayRecords = sessionRepository.findByUserIdAndDateOrdered(userId, date);
        Map<Long, WorkoutSessionEntity> byId = dayRecords.stream()
                .collect(Collectors.toMap(WorkoutSessionEntity::getId, e -> e));

        int order = 0;
        if (orderedIds != null) {
            for (Long id : orderedIds) {
                WorkoutSessionEntity e = byId.remove(id);   // 소유·해당 날짜의 것만 처리(위조/타 날짜 무시)
                if (e != null) e.setSortOrder(order++);
            }
        }
        List<WorkoutSessionEntity> remaining = byId.values().stream()
                .sorted(Comparator.comparing(WorkoutSessionEntity::getId))
                .collect(Collectors.toList());
        for (WorkoutSessionEntity e : remaining) e.setSortOrder(order++);

        sessionRepository.saveAll(dayRecords);
        logger.info("{} {} 운동 기록 순서 변경 ({}건)", uid, date, dayRecords.size());

        List<Long> ids = dayRecords.stream().map(WorkoutSessionEntity::getId).collect(Collectors.toList());
        Map<Long, List<WorkoutEntity>> bySession = ids.isEmpty()
                ? new LinkedHashMap<>()
                : groupBySession(workoutRepository.findBySessionIdsOrdered(ids));

        return dayRecords.stream()
                .sorted(Comparator.comparing(WorkoutSessionEntity::getSortOrder))
                .map(s -> WorkoutSessionDTO.entityToDto(s, bySession.get(s.getId())))
                .collect(Collectors.toList());
    }

    // ------------------------------------------------------------
    //  세션 내부 운동 단건 조작 (세션 통째 저장 대신 부분 수정이 필요할 때)
    // ------------------------------------------------------------

    @Transactional
    public WorkoutDTO addWorkout(String uid, Long sessionId, WorkoutDTO dto, UserDetails userDetails) {
        Long userId = ownerId(uid, userDetails);
        WorkoutSessionEntity session = mustFind(sessionId, userId);
        int nextOrder = workoutRepository.findBySessionIdOrdered(session.getId()).size();
        WorkoutEntity e = new WorkoutEntity();
        applyWorkout(e, dto, userId, session.getId(), nextOrder);
        WorkoutEntity saved = workoutRepository.save(e);
        logger.info("{} 운동 추가 (sessionId={}, id={})", uid, session.getId(), saved.getId());
        return WorkoutDTO.entityToDto(saved);
    }

    @Transactional
    public WorkoutDTO updateWorkout(String uid, Long sessionId, Long workoutId, WorkoutDTO dto, UserDetails userDetails) {
        Long userId = ownerId(uid, userDetails);
        WorkoutSessionEntity session = mustFind(sessionId, userId);
        WorkoutEntity e = workoutRepository.findByIdAndUserIdAndSessionId(workoutId, userId, session.getId())
                .orElseThrow(() -> new IllegalArgumentException("운동을 찾을 수 없습니다"));
        applyWorkout(e, dto, userId, session.getId(), e.getSortOrder() == null ? 0 : e.getSortOrder());
        return WorkoutDTO.entityToDto(workoutRepository.save(e));
    }

    @Transactional
    public WorkoutDTO deleteWorkout(String uid, Long sessionId, Long workoutId, UserDetails userDetails) {
        Long userId = ownerId(uid, userDetails);
        WorkoutSessionEntity session = mustFind(sessionId, userId);
        WorkoutEntity e = workoutRepository.findByIdAndUserIdAndSessionId(workoutId, userId, session.getId())
                .orElseThrow(() -> new IllegalArgumentException("운동을 찾을 수 없습니다"));
        workoutRepository.delete(e);
        logger.info("{} 운동 삭제 (sessionId={}, id={})", uid, session.getId(), workoutId);
        return WorkoutDTO.entityToDto(e);
    }

    // 세션 내부 운동 순서 변경
    @Transactional
    public List<WorkoutDTO> reorderWorkouts(String uid, Long sessionId, List<Long> orderedIds, UserDetails userDetails) {
        Long userId = ownerId(uid, userDetails);
        WorkoutSessionEntity session = mustFind(sessionId, userId);
        List<WorkoutEntity> items = workoutRepository.findBySessionIdOrdered(session.getId());
        Map<Long, WorkoutEntity> byId = items.stream().collect(Collectors.toMap(WorkoutEntity::getId, e -> e));

        int order = 0;
        if (orderedIds != null) {
            for (Long id : orderedIds) {
                WorkoutEntity e = byId.remove(id);
                if (e != null) e.setSortOrder(order++);
            }
        }
        List<WorkoutEntity> remaining = byId.values().stream()
                .sorted(Comparator.comparing(WorkoutEntity::getId))
                .collect(Collectors.toList());
        for (WorkoutEntity e : remaining) e.setSortOrder(order++);

        workoutRepository.saveAll(items);
        return items.stream()
                .sorted(Comparator.comparing(WorkoutEntity::getSortOrder))
                .map(WorkoutDTO::entityToDto)
                .collect(Collectors.toList());
    }

    // ------------------------------------------------------------
    //  내부 유틸
    // ------------------------------------------------------------

    private WorkoutSessionEntity mustFind(Long id, Long userId) {
        return sessionRepository.findByIdAndUserId(id, userId)
                .orElseThrow(() -> new IllegalArgumentException("운동 기록을 찾을 수 없습니다"));
    }

    private Map<Long, List<WorkoutEntity>> groupBySession(List<WorkoutEntity> all) {
        return all.stream().collect(Collectors.groupingBy(
                WorkoutEntity::getSessionId, LinkedHashMap::new, Collectors.toList()));
    }

    // 클라이언트가 보낸 운동 목록을 세션에 동기화한다.
    //   · id 가 있고 이 세션 소속 → 수정
    //   · id 가 없음 → 신규 추가
    //   · 목록에서 빠진 기존 운동 → 삭제
    //   · 보낸 배열의 순서가 곧 sortOrder
    private List<WorkoutEntity> syncWorkouts(Long userId, Long sessionId, List<WorkoutDTO> dtos) {
        List<WorkoutEntity> current = workoutRepository.findBySessionIdOrdered(sessionId);
        Map<Long, WorkoutEntity> byId = current.stream().collect(Collectors.toMap(WorkoutEntity::getId, e -> e));

        List<WorkoutEntity> result = new ArrayList<>();
        int order = 0;
        if (dtos != null) {
            for (WorkoutDTO d : dtos) {
                if (d == null) continue;
                WorkoutEntity e = (d.getId() != null) ? byId.remove(d.getId()) : null;
                if (e == null) e = new WorkoutEntity();      // 위조된 id 가 오면 신규로 취급(타 세션 침범 방지)
                applyWorkout(e, d, userId, sessionId, order++);
                result.add(e);
            }
        }
        if (!byId.isEmpty()) workoutRepository.deleteAll(byId.values());   // 목록에서 빠진 것 = 삭제
        if (result.isEmpty()) return Collections.emptyList();
        return workoutRepository.saveAll(result);
    }

    private void applyWorkout(WorkoutEntity e, WorkoutDTO d, Long userId, Long sessionId, int order) {
        String exercise = d.getExercise() == null ? "" : d.getExercise().trim();
        if (exercise.isEmpty()) throw new IllegalArgumentException("운동 종목을 선택하세요");
        if (d.getReps() <= 0 || d.getSets() <= 0) throw new IllegalArgumentException("횟수·세트를 입력하세요");

        boolean bw = Boolean.TRUE.equals(d.getBodyweight());
        e.setUserId(userId);            // 소유자 강제 지정(위조 방지)
        e.setSessionId(sessionId);      // 소속 세션 강제 지정
        e.setExercise(exercise);
        e.setBodyweight(bw);
        // [B][E] edit by smsong : 보조 여부. null 이 오면 false 로 굳혀 저장한다(조회 시 분기 불필요)
        e.setAssisted(Boolean.TRUE.equals(d.getAssisted()));
        // [B][E] edit by smsong : lbs 원본. 맨몸이거나 값이 없으면 보관하지 않는다(kg 환산 표기로 대체).
        e.setOrigLbs((bw || d.getOrigLbs() == null || d.getOrigLbs() <= 0) ? null : d.getOrigLbs());
        e.setWeight(bw ? 0 : Math.max(0, d.getWeight()));
        e.setReps(d.getReps());
        e.setSets(d.getSets());
        e.setMemo(trimOrNull(d.getMemo(), 255));
        e.setSortOrder(order);   // 부위(bodyParts)는 세션이 보유 → 여기서 다루지 않음
    }

    private void requireDate(String date) {
        if (date == null || !DATE_RE.matcher(date.trim()).matches()) {
            throw new IllegalArgumentException("날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)");
        }
    }

    // 총 운동 시간: 클라이언트가 명시하면 그 값, 아니면 시작~종료로 계산
    private Integer resolveDuration(WorkoutSessionDTO dto) {
        if (dto.getDurationMin() != null && dto.getDurationMin() >= 0) return dto.getDurationMin();
        return spanMinutes(dto.getStartTime(), dto.getEndTime());
    }

    private Integer spanMinutes(String start, String end) {
        Integer s = toMinutes(start);
        Integer e = toMinutes(end);
        if (s == null || e == null) return null;
        int d = e - s;
        if (d < 0) d += 24 * 60;   // 자정을 넘긴 운동 보정
        return d;
    }

    private Integer toMinutes(String t) {
        String v = normTime(t);
        if (v == null) return null;
        LocalTime lt = LocalTime.parse(v);
        return lt.getHour() * 60 + lt.getMinute();
    }

    // "HH:mm" / "HH:mm:ss" → "HH:mm". 형식이 아니면 null.
    private String normTime(String t) {
        if (t == null) return null;
        String v = t.trim();
        if (v.isEmpty()) return null;
        try {
            LocalTime lt = LocalTime.parse(v.length() > 5 ? v.substring(0, 5) : v);
            return String.format("%02d:%02d", lt.getHour(), lt.getMinute());
        } catch (Exception ex) {
            return null;
        }
    }

    private Integer clampCondition(Integer c) {
        if (c == null) return null;
        return Math.max(0, Math.min(100, c));
    }

    private String trimOrNull(String s, int max) {
        if (s == null) return null;
        String v = s.trim();
        if (v.isEmpty()) return null;
        return v.length() > max ? v.substring(0, max) : v;
    }
}
// [E] edit by smsong
