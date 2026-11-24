package com.santhula.rms.devseed;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.santhula.rms.support.IntegrationTestBase;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Runs the dev seeder's logic against a real database. The class is only a bean in the `dev` profile, so the
 * test builds one by hand with the real services; it never changes the profile of the shared test context.
 */
class DevSampleDataSeederIT extends IntegrationTestBase {

    @Autowired
    ApplicationContext context;
    @Autowired
    TransactionTemplate tx;

    private Session owner;

    @BeforeEach
    void start() throws Exception {
        resetDatabase();
        owner = asOwner();
    }

    private void seed() {
        DevSampleDataSeeder seeder = context.getAutowireCapableBeanFactory().createBean(DevSampleDataSeeder.class);
        tx.executeWithoutResult(s -> seeder.run(null));
    }

    private long total(String path, String field) throws Exception {
        JsonNode body = body(doGet(owner, path));
        return field == null ? body.size() : body.get(field).asLong();
    }

    @Test
    void P1_MENU_sampleRestaurant_isLoaded_andRunningItAgainChangesNothing() throws Exception {
        seed();
        assertThat(total("/categories", null)).isEqualTo(6);
        assertThat(total("/menu-items", "totalItems")).isEqualTo(46);
        assertThat(total("/modifier-groups", null)).isEqualTo(3);
        assertThat(total("/tables", null)).isEqualTo(12);
        assertThat(total("/delivery-areas", null)).isEqualTo(3);
        doGet(owner, "/kitchen-stations").andExpect(jsonPath("$[0].name").value("Kitchen 1 - Rice & Curry"))
                .andExpect(jsonPath("$[0].targetPrepMinutes").value(15)).andExpect(jsonPath("$[1].targetPrepMinutes").value(20))
                .andExpect(jsonPath("$[2].targetPrepMinutes").value(8)).andExpect(jsonPath("$[0].activeItemCount").value(19));
        doGet(owner, "/menu-items?search=RC-CHK").andExpect(jsonPath("$.items[0].localPrice").value("850.00"))
                .andExpect(jsonPath("$.items[0].foreignPrice").value("1200.00")).andExpect(jsonPath("$.items[0].modifierGroupCount").value(2));
        long audit = total("/audit-log?size=1", "totalItems");

        seed();      // idempotent: nothing new, nothing changed, no extra audit rows
        assertThat(total("/menu-items", "totalItems")).isEqualTo(46);
        assertThat(total("/categories", null)).isEqualTo(6);
        assertThat(total("/tables", null)).isEqualTo(12);
        assertThat(total("/delivery-areas", null)).isEqualTo(3);
        assertThat(total("/audit-log?size=1", "totalItems")).isEqualTo(audit);
    }

    @Test
    void theSeederNeverOverwritesADevelopersEdits() throws Exception {
        seed();
        JsonNode chicken = body(doGet(owner, "/menu-items?search=RC-CHK")).get("items").get(0);
        doPut(owner, "/menu-items/" + chicken.get("id").asText(), Map.of("code", "RC-CHK", "name", "My own name", "categoryId",
                chicken.get("categoryId").asText(), "stationId", chicken.get("stationId").asText(), "localPrice", "999.00", "active", true,
                "version", chicken.get("version").asInt())).andExpect(status().isOk());
        JsonNode station = body(doGet(owner, "/kitchen-stations")).get(1);
        doPut(owner, "/kitchen-stations/" + station.get("id").asText(), Map.of("name", "Grill room", "targetPrepMinutes", 25, "active", true,
                "version", station.get("version").asInt())).andExpect(status().isOk());

        seed();
        doGet(owner, "/menu-items?search=RC-CHK").andExpect(jsonPath("$.items[0].name").value("My own name"))
                .andExpect(jsonPath("$.items[0].localPrice").value("999.00"));
        doGet(owner, "/kitchen-stations").andExpect(jsonPath("$[1].name").value("Grill room")).andExpect(jsonPath("$[1].targetPrepMinutes").value(25));
    }

    @Test
    void aMissingItemIsAddedBack_withoutTouchingTheOthers() throws Exception {
        seed();
        // A developer who deactivated an item keeps it deactivated; only genuinely missing records are created.
        JsonNode egg = body(doGet(owner, "/menu-items?search=SE-ROL")).get("items").get(0);
        doPut(owner, "/menu-items/" + egg.get("id").asText(), Map.of("code", "SE-ROL", "name", "Egg roll", "categoryId", egg.get("categoryId").asText(),
                "stationId", egg.get("stationId").asText(), "localPrice", "150.00", "active", false, "version", egg.get("version").asInt()))
                .andExpect(status().isOk());
        seed();
        doGet(owner, "/menu-items?search=SE-ROL").andExpect(jsonPath("$.items[0].active").value(false));
        assertThat(total("/menu-items", "totalItems")).isEqualTo(46);
    }
}
