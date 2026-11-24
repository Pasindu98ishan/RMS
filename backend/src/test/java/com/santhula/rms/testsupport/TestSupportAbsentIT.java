package com.santhula.rms.testsupport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.santhula.rms.support.TestDatabase;
import java.time.Clock;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/** QA Q26: in the default profile the test helpers do not exist (404) and the clock is the system clock. */
@SpringBootTest(properties = {"rms.bootstrap.owner-username=", "rms.security.bcrypt-strength=4", "rms.menu.reset-scheduler-enabled=false"})
@AutoConfigureMockMvc
class TestSupportAbsentIT {

    @Autowired
    MockMvc mvc;
    @Autowired
    ApplicationContext context;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        TestDatabase.register(registry);
    }

    @Test
    void QA_Q26_testEndpoints_are404_outsideTheTestProfile() throws Exception {
        mvc.perform(post("/api/v1/test/reset")).andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("NOT_FOUND"));
        mvc.perform(post("/api/v1/test/clock/advance").contentType(MediaType.APPLICATION_JSON).content("{\"minutes\":16}"))
                .andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/test/clock/reset")).andExpect(status().isNotFound());
    }

    @Test
    void QA_Q26_noTestBeansOutsideTheTestProfile() {
        assertThat(context.getBeansOfType(TestSupportController.class)).isEmpty();
        assertThat(context.getBeansOfType(DatabaseReset.class)).isEmpty();
        assertThat(context.getBean(Clock.class)).isNotInstanceOf(MutableClock.class);
    }
}
