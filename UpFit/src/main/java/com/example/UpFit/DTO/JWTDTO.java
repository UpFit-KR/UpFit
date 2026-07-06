package com.example.UpFit.DTO;

import lombok.*;

@NoArgsConstructor
@AllArgsConstructor
@Getter
@Setter
@Builder
public class JWTDTO {
    private String token;
    private UserDTO user;
    private Long tokenRemainingTime;

    public JWTDTO(String token, UserDTO user) {
        this.token = token;
        this.user = user;
    }
}
