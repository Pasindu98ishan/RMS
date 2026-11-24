package com.santhula.rms.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.santhula.rms.audit.service.AuditService;
import com.santhula.rms.auth.domain.AppUser;
import com.santhula.rms.auth.domain.Role;
import com.santhula.rms.auth.domain.SystemRole;
import com.santhula.rms.auth.repo.AppUserRepository;
import com.santhula.rms.auth.repo.RoleRepository;
import com.santhula.rms.common.config.RmsProperties;
import java.time.Duration;
import java.time.ZoneId;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.annotation.Profile;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

class DevDataSeederTest {

    private final AppUserRepository users = mock(AppUserRepository.class);
    private final RoleRepository roles = mock(RoleRepository.class);
    private final AuditService audit = mock(AuditService.class);
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(4);
    private final RmsProperties props = new RmsProperties(UUID.randomUUID(), ZoneId.of("Asia/Colombo"),
            new RmsProperties.Security("", Duration.ofMinutes(15), Duration.ofHours(12), 4, 5, Duration.ofMinutes(15), 3,
                    Duration.ofMinutes(5)), null, null, null, null);

    private DevDataSeeder seeder() {
        for (SystemRole r : SystemRole.values()) {
            when(roles.findById(r.id())).thenReturn(Optional.of(new Role(props.branchId(), r.name(), null)));
        }
        return new DevDataSeeder(users, roles, encoder, audit, props);
    }

    @Test
    void isOnlyActiveInTheDevProfile() {
        assertThat(DevDataSeeder.class.getAnnotation(Profile.class).value()).containsExactly("dev");
    }

    @Test
    void createsOneUserPerSeededRole_withPasswordAndPin() {
        seeder().run(null);

        ArgumentCaptor<AppUser> saved = ArgumentCaptor.forClass(AppUser.class);
        verify(users, times(7)).saveAndFlush(saved.capture());
        assertThat(saved.getAllValues()).extracting(AppUser::getUsername)
                .containsExactlyInAnyOrder("manager1", "cashier1", "reception1", "kitchen1", "rider1", "inventory1", "hr1");
        for (AppUser u : saved.getAllValues()) {
            assertThat(encoder.matches("dev-pass-1234", u.getPasswordHash())).isTrue();
            assertThat(encoder.matches("1234", u.getPinHash())).isTrue();
            assertThat(u.getRoles()).hasSize(1);
        }
        verify(audit, times(7)).record(any());
    }

    @Test
    void isIdempotent_existingUsersAreLeftAlone() {
        when(users.existsByUsernameIgnoreCase(anyString())).thenReturn(true);
        seeder().run(null);
        verify(users, never()).saveAndFlush(any());
        verify(audit, never()).record(any());
    }
}
