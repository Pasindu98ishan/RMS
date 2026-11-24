package com.santhula.rms.dataimport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.santhula.rms.support.IntegrationTestBase;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

/**
 * BUG-1-008 regression (P1-IMP-01): import time must grow in proportion to the number of rows. Before the fix
 * 500 rows took 7 s and 5000 rows about 190 s. The bound here is deliberately generous (a slow CI machine must
 * not fail it) but a return to per-row queries and flushes misses it by an order of magnitude.
 */
class ImportPerformanceIT extends IntegrationTestBase {

    private static final int ROWS = 5000;
    private static final Duration LIMIT = Duration.ofSeconds(20);

    private Session owner;

    @BeforeEach
    void start() throws Exception {
        resetDatabase();
        owner = asOwner();
    }

    private record Timed(JsonNode report, Duration took) {
    }

    private Timed upload(String type, String csv, boolean dryRun) throws Exception {
        long start = System.nanoTime();
        var req = multipart(API + "/import/" + type)
                .file(new MockMultipartFile("file", type.toLowerCase() + ".csv", "text/csv", csv.getBytes(StandardCharsets.UTF_8)))
                .param("dryRun", String.valueOf(dryRun))
                .header("Authorization", "Bearer " + owner.accessToken())
                .header("X-Terminal-Id", owner.terminalId().toString());
        JsonNode report = body(mvc.perform(req).andExpect(status().isOk()));
        Duration took = Duration.ofNanos(System.nanoTime() - start);
        System.out.printf("IMPORT-PERF %s dryRun=%s rows=%d took=%d ms%n", type, dryRun, ROWS, took.toMillis());
        return new Timed(report, took);
    }

    private static String itemsCsv(int priceBase) {
        List<String> lines = new ArrayList<>();
        lines.add("code,name,category,station,local_price,foreign_price,modifier_groups,active");
        for (int i = 0; i < ROWS; i++) {
            lines.add("ITM-" + i + ",Item number " + i + ",Cat " + (i % 20) + "," + (i % 3 + 1) + "," + (priceBase + i % 500) + ".00,"
                    + (priceBase + i % 500) + ".50," + (i % 4 == 0 ? "Spice level|Extras" : "Extras") + ",Y");
        }
        return String.join("\n", lines);
    }

    private void assertFast(Timed t, int created, int updated, int unchanged) {
        assertThat(t.report().get("ok").asBoolean()).as(t.report().toString()).isTrue();
        assertThat(t.report().get("rowsRead").asInt()).isEqualTo(ROWS);
        assertThat(t.report().get("counts").get("created").asInt()).isEqualTo(created);
        assertThat(t.report().get("counts").get("updated").asInt()).isEqualTo(updated);
        assertThat(t.report().get("counts").get("unchanged").asInt()).isEqualTo(unchanged);
        assertThat(t.took()).as("5000-row import took %s", t.took()).isLessThan(LIMIT);
    }

    @Test
    void BUG_1_008_menuItems_5000rows_dryRunAndRealImport_areLinear() throws Exception {
        StringBuilder cats = new StringBuilder("name,sort_order");
        for (int c = 0; c < 20; c++) {
            cats.append("\nCat ").append(c).append(',').append(c * 10);
        }
        upload("CATEGORIES", cats.toString(), false);
        upload("MODIFIER_GROUPS", "group,required,min_select,max_select,option,price_delta\n"
                + "Spice level,Y,1,1,Mild,0.00\nSpice level,Y,1,1,Hot,0.00\nExtras,N,0,2,Extra egg,80.00\nExtras,N,0,2,Papadam,40.00", false);

        // Dry run: exact counts, nothing written.
        assertFast(upload("MENU_ITEMS", itemsCsv(1000), true), ROWS, 0, 0);
        assertThat(body(doGet(owner, "/menu-items?size=1")).get("totalItems").asInt()).isZero();

        // Real import.
        assertFast(upload("MENU_ITEMS", itemsCsv(1000), false), ROWS, 0, 0);
        assertThat(body(doGet(owner, "/menu-items?size=1")).get("totalItems").asInt()).isEqualTo(ROWS);

        // Same file again: all unchanged. Changed prices: all updated (and price changes audited).
        assertFast(upload("MENU_ITEMS", itemsCsv(1000), false), 0, 0, ROWS);
        assertFast(upload("MENU_ITEMS", itemsCsv(2000), true), 0, ROWS, 0);
        assertFast(upload("MENU_ITEMS", itemsCsv(2000), false), 0, ROWS, 0);
    }

    @Test
    void BUG_1_008_validationOfBadRows_5000rows_isLinearToo() throws Exception {
        // Every row names an unknown category: 5000 errors are found (200 are reported) quickly.
        Timed t = upload("MENU_ITEMS", itemsCsv(1000), false);
        assertThat(t.report().get("ok").asBoolean()).isFalse();
        assertThat(t.report().get("errorsTruncated").asBoolean()).isTrue();
        assertThat(t.took()).isLessThan(LIMIT);
    }

    @Test
    void BUG_1_008_tablesAndCategories_5000rows_areLinear() throws Exception {
        List<String> lines = new ArrayList<>();
        lines.add("number,section,seats");
        for (int i = 0; i < ROWS; i++) {
            lines.add("T" + i + ",Section " + (i % 7) + "," + (i % 8 + 2));
        }
        String tables = String.join("\n", lines);
        assertFast(upload("TABLES", tables, true), ROWS, 0, 0);
        assertFast(upload("TABLES", tables, false), ROWS, 0, 0);
        assertFast(upload("TABLES", tables, false), 0, 0, ROWS);

        List<String> cats = new ArrayList<>();
        cats.add("name,sort_order");
        for (int i = 0; i < ROWS; i++) {
            cats.add("Category " + i + "," + i);
        }
        String categories = String.join("\n", cats);
        assertFast(upload("CATEGORIES", categories, true), ROWS, 0, 0);
        assertFast(upload("CATEGORIES", categories, false), ROWS, 0, 0);
        assertFast(upload("CATEGORIES", categories, false), 0, 0, ROWS);
    }
}
