package com.example.UpFit.DTO;

import com.example.UpFit.Entity.UserEntity;
import lombok.*;

@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class UserDTO {
        private Long id;
        private String uid;
        private String password;
        private String name;
        private String age;
        private String gender;
        private String nickname;
        private String address;
        private String email;
        private String phone;
        private String profileURL;
        private String provider;

        // [B] edit by smsong - UpFit 신체 정보(키/현재 체중/목표 체중)
        private Double height;
        private Double weight;
        private Double targetWeight;
        // [E] edit by smsong

        public static UserDTO entityToDto(UserEntity userEntity) {
                return new UserDTO(
                        userEntity.getId(),
                        userEntity.getUid(),
                        userEntity.getPassword(),
                        userEntity.getName(),
                        userEntity.getAge(),
                        userEntity.getGender(),
                        userEntity.getNickname(),
                        userEntity.getAddress(),
                        userEntity.getEmail(),
                        userEntity.getPhone(),
                        userEntity.getProfileURL(),
                        userEntity.getProvider(),
                        // 신체 정보(키/현재 체중/목표 체중) 매핑
                        userEntity.getHeight(),
                        userEntity.getWeight(),
                        userEntity.getTargetWeight());
                        // [E] edit by smsong
        }

        public UserEntity dtoToEntity() {
                // [B] edit by smsong - 신체 정보(키/현재 체중/목표 체중) 필드 포함
                return new UserEntity(id, uid, password, name, age, gender, nickname, address, email, phone, profileURL, provider, height, weight, targetWeight);
                // [E] edit by smsong
        }
}