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
        private int likeCount;

        // [B] edit by smsong - 공인중개사사무소 정보(이름/전화번호/주소)
        private String agencyName;
        private String agencyPhone;
        private String agencyAddress;
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
                        userEntity.getLikeCount(),
                        // [B] edit by smsong - 공인중개사사무소 필드 매핑
                        userEntity.getAgencyName(),
                        userEntity.getAgencyPhone(),
                        userEntity.getAgencyAddress());
                        // [E] edit by smsong
        }

        public UserEntity dtoToEntity() {
                // [B] edit by smsong - 공인중개사사무소 필드(agencyName/agencyPhone/agencyAddress) 추가
                return new UserEntity(id, uid, password, name, age, gender, nickname, address, email, phone, profileURL, provider, likeCount, agencyName, agencyPhone, agencyAddress);
                // [E] edit by smsong
        }
}