package com.santhula.rms.menu;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.santhula.rms.auth.domain.SystemRole;
import com.santhula.rms.menu.service.AvailabilityResetService;
import com.santhula.rms.support.IntegrationTestBase;
import java.time.Duration;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * Sold-out items become available again at the start of each business day (P1-MENU-06, m1.1-scope.md decision
 * 5). The scheduler is off in tests; they call the service with the test clock moved forward.
 */
class AvailabilityResetIT extends IntegrationTestBase {

    @Autowired
    AvailabilityResetService reset;

    private Session owner;
    private Session cashier;
    private String itemId;

    @BeforeEach
    void start() throws Exception {
        resetDatabase();
        owner = asOwner();
        cashier = asRole(SystemRole.CASHIER);
        String category = body(doPost(owner, "/categories", Map.of("name", "Beverages")).andExpect(status().isCreated())).get("id").asText();
        JsonNode stations = body(doGet(owner, "/kitchen-stations"));
        itemId = body(doPost(owner, "/menu-items", Map.of("code", "BV-1", "name", "Lime juice", "categoryId", category,
                "stationId", stations.get(2).get("id").asText(), "localPrice", "350.00")).andExpect(status().isCreated())).get("id").asText();
        reset.resetIfNewBusinessDay();            // today's reset has happened; from now on only a NEW business day resets
    }

    /** Moves the test clock; access tokens last 15 minutes, so the sessions are created again afterwards. */
    private void advance(Duration by) throws Exception {
        clock.advance(by);
        owner = asOwner();
        cashier = asRole(SystemRole.CASHIER);
    }

    private void soldOut() throws Exception {
        doPut(cashier, "/menu-items/" + itemId + "/availability", Map.of("available", false)).andExpect(status().isOk());
    }

    private boolean available() throws Exception {
        return body(doGet(owner, "/menu-items/" + itemId)).get("available").asBoolean();
    }

    @Test
    void sameBusinessDay_nothingIsReset() throws Exception {
        soldOut();
        assertThat(reset.resetIfNewBusinessDay()).isZero();
        assertThat(available()).isFalse();
    }

    @Test
    void P1_MENU_06_nextBusinessDay_soldOutItemsAreAvailableAgain_andItIsAudited() throws Exception {
        soldOut();
        advance(Duration.ofHours(25));
        assertThat(reset.resetIfNewBusinessDay()).isEqualTo(1);
        assertThat(available()).isTrue();
        // Once per business day: a second call the same day does nothing.
        soldOut();
        assertThat(reset.resetIfNewBusinessDay()).isZero();
        assertThat(available()).isFalse();
        doGet(owner, "/audit-log?entityType=MENU_ITEM&action=UPDATE&userId=" + owner.userId()).andExpect(status().isOk());
        JsonNode log = body(doGet(owner, "/audit-log?entityType=MENU_ITEM&action=UPDATE&size=200"));
        boolean found = false;
        for (JsonNode e : log.get("items")) {
            if ("system".equals(e.path("username").asText()) && e.path("after").path("itemsMadeAvailable").asInt() == 1) {
                found = true;
            }
        }
        assertThat(found).as("the daily reset is audit-logged as the system").isTrue();
    }

    @Test
    void theBusinessDayStartsAtTheConfiguredTime_notAtMidnight() throws Exception {
        // Move the clock to just before the day-start time (06:00 Asia/Colombo), then just after it.
        var now = java.time.ZonedDateTime.now(clock.withZone(java.time.ZoneId.of("Asia/Colombo")));
        var nextSix = now.toLocalDate().atTime(6, 0).atZone(now.getZone());
        if (!nextSix.isAfter(now)) {
            nextSix = nextSix.plusDays(1);
        }
        advance(Duration.between(now, nextSix).minusMinutes(1));          // 05:59 of the day that is still "yesterday"
        reset.resetIfNewBusinessDay();                                          // makes sure the marker is at that business day
        soldOut();
        assertThat(reset.resetIfNewBusinessDay()).as("05:59 is still the old business day").isZero();
        advance(Duration.ofMinutes(2));                                   // 06:01
        assertThat(reset.resetIfNewBusinessDay()).as("06:01 starts the new business day").isEqualTo(1);
        assertThat(available()).isTrue();
    }

    @Test
    void whenSwitchedOff_soldOutItemsStaySoldOut() throws Exception {
        doPut(owner, "/settings/menu", Map.of("resetAvailabilityDaily", false, "version", 0)).andExpect(status().isOk());
        soldOut();
        advance(Duration.ofHours(25));
        assertThat(reset.resetIfNewBusinessDay()).isZero();
        assertThat(available()).isFalse();
        // The new day is remembered, so switching it on later the same day does not wipe today's sold-out marks.
        doPut(owner, "/settings/menu", Map.of("resetAvailabilityDaily", true, "version", 1)).andExpect(status().isOk());
        assertThat(reset.resetIfNewBusinessDay()).isZero();
        assertThat(available()).isFalse();
        doGet(owner, "/settings/menu").andExpect(jsonPath("$.resetAvailabilityDaily").value(true));
    }
}
