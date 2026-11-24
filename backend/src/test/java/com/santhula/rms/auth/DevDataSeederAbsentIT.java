package com.santhula.rms.auth;

import static org.assertj.core.api.Assertions.assertThat;

import com.santhula.rms.auth.repo.AppUserRepository;
import com.santhula.rms.auth.service.DevDataSeeder;
import com.santhula.rms.support.TestDatabase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** The dev data seeder must not exist outside the `dev` profile (default profile here). */
@SpringBootTest(properties = {"rms.bootstrap.owner-username=", "rms.security.bcrypt-strength=4", "rms.menu.reset-scheduler-enabled=false"})
class DevDataSeederAbsentIT {

    @Autowired
    ApplicationContext context;
    @Autowired
    AppUserRepository users;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        TestDatabase.register(registry);
    }

    @Test
    void devSeeders_areNotBeans_andCreateNothing_outsideTheDevProfile() {
        assertThat(context.getBeansOfType(DevDataSeeder.class)).isEmpty();
        assertThat(context.getBeansOfType(com.santhula.rms.devseed.DevSampleDataSeeder.class)).isEmpty();
        assertThat(users.existsByUsernameIgnoreCase("cashier1")).isFalse();
        assertThat(users.existsByUsernameIgnoreCase("manager1")).isFalse();
    }
}
