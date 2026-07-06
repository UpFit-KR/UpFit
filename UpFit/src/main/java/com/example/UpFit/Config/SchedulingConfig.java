package com.example.UpFit.Config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

// 휴지통 30일 자동 정리(@Scheduled) 활성화. 메인 클래스에 이미 @EnableScheduling 이 있다면 이 파일은 불필요.
@Configuration
@EnableScheduling
public class SchedulingConfig {
}
