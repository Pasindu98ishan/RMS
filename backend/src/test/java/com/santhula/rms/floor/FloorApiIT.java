package com.santhula.rms.floor;

import static com.santhula.rms.support.ProblemMatchers.fieldError;
import static com.santhula.rms.support.ProblemMatchers.forbidden;
import static com.santhula.rms.support.ProblemMatchers.malformed;
import static com.santhula.rms.support.ProblemMatchers.problem;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.santhula.rms.auth.domain.SystemRole;
import com.santhula.rms.support.IntegrationTestBase;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** Floor API (P1-FLOOR-01, P1-FLOOR-02): ordering points, tables, floor-plan positions and the POS layout. */
class FloorApiIT extends IntegrationTestBase {

    private Session owner;
    private Session manager;   // holds FLOOR_MANAGE and ORDER_VIEW
    private Session cashier;   // holds ORDER_VIEW, not FLOOR_MANAGE or TERMINAL_MANAGE

    @BeforeEach
    void start() throws Exception {
        resetDatabase();
        owner = asOwner();
        manager = asRole(SystemRole.MANAGER);
        cashier = asRole(SystemRole.CASHIER);
    }

    private JsonNode table(String number, String section, int seats) throws Exception {
        return body(doPost(owner, "/tables", Map.of("number", number, "section", section, "seats", seats)).andExpect(status().isCreated()));
    }

    // ------------------------------------------------------------------ ordering points (P1-FLOOR-02)

    @Test
    void P1_FLOOR_02_twoOrderingPoints_cashierAndReception() throws Exception {
        doGet(owner, "/ordering-points").andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].name").value("Cashier")).andExpect(jsonPath("$[1].name").value("Reception"))
                .andExpect(jsonPath("$[0].id").isNotEmpty());
        doGet(manager, "/ordering-points").andExpect(forbidden());     // TERMINAL_MANAGE is the owner's
        doGet(null, "/ordering-points").andExpect(problem(401, "UNAUTHENTICATED"));
    }

    // ------------------------------------------------------------------ tables (P1-FLOOR-01)

    @Test
    void P1_FLOOR_01_createListGetUpdateTable() throws Exception {
        JsonNode t = table("1", "Indoor", 4);
        assertThat(t.get("active").asBoolean()).isTrue();
        assertThat(t.get("version").asInt()).isZero();
        assertThat(t.get("x").asInt()).isBetween(0, 1000);
        assertThat(t.get("y").asInt()).isBetween(0, 700);
        String id = t.get("id").asText();

        doGet(owner, "/tables/" + id).andExpect(status().isOk()).andExpect(jsonPath("$.number").value("1"));
        doPut(owner, "/tables/" + id, Map.of("number", "1A", "section", "Terrace", "seats", 6, "active", true, "version", 0))
                .andExpect(status().isOk()).andExpect(jsonPath("$.number").value("1A")).andExpect(jsonPath("$.section").value("Terrace"))
                .andExpect(jsonPath("$.seats").value(6)).andExpect(jsonPath("$.version").value(1));
        doGet(owner, "/audit-log?entityType=DINING_TABLE&entityId=" + id + "&action=UPDATE")
                .andExpect(jsonPath("$.items[0].before.number").value("1")).andExpect(jsonPath("$.items[0].after.number").value("1A"));
    }

    @Test
    void newTables_getDifferentFreeSpots_andAnExplicitPositionIsKept() throws Exception {
        JsonNode a = table("1", "Indoor", 2);
        JsonNode b = table("2", "Indoor", 2);
        assertThat(a.get("x").asInt() == b.get("x").asInt() && a.get("y").asInt() == b.get("y").asInt()).isFalse();

        Map<String, Object> placed = new LinkedHashMap<>();
        placed.put("number", "9");
        placed.put("section", "Garden");
        placed.put("seats", 4);
        placed.put("x", 640);
        placed.put("y", 120);
        doPost(owner, "/tables", placed).andExpect(status().isCreated()).andExpect(jsonPath("$.x").value(640)).andExpect(jsonPath("$.y").value(120));
    }

    @Test
    void tables_listFilteredAndSortedNaturally_bySectionThenNumber() throws Exception {
        for (String n : List.of("10", "2", "1")) {
            table(n, "Indoor", 4);
        }
        table("G2", "Garden", 4);
        JsonNode g1 = table("G1", "Garden", 4);
        doPut(owner, "/tables/" + g1.get("id").asText(), Map.of("number", "G1", "section", "Garden", "seats", 4, "active", false, "version", 0))
                .andExpect(status().isOk());

        JsonNode all = body(doGet(owner, "/tables").andExpect(status().isOk()));
        assertThat(all.findValuesAsText("number")).containsExactly("G1", "G2", "1", "2", "10");   // Garden before Indoor; 2 before 10
        doGet(owner, "/tables?active=false").andExpect(jsonPath("$.length()").value(1)).andExpect(jsonPath("$[0].number").value("G1"));
        doGet(owner, "/tables?section=indoor").andExpect(jsonPath("$.length()").value(3));
        doGet(owner, "/tables?active=maybe").andExpect(malformed());
    }

    @Test
    void tables_validation_duplicateNumber_staleVersion_notFound_403() throws Exception {
        JsonNode t = table("5", "Indoor", 4);
        doPost(owner, "/tables", Map.of("number", "5", "section", "Garden", "seats", 2)).andExpect(problem(409, "TABLE_NUMBER_TAKEN"));
        table("6", "Indoor", 4);
        doPut(owner, "/tables/" + t.get("id").asText(), Map.of("number", "6", "section", "Indoor", "seats", 4, "active", true, "version", 0))
                .andExpect(problem(409, "TABLE_NUMBER_TAKEN"));
        doPut(owner, "/tables/" + t.get("id").asText(), Map.of("number", "5", "section", "Indoor", "seats", 4, "active", true, "version", 7))
                .andExpect(problem(409, "VERSION_CONFLICT"));
        doPost(owner, "/tables", Map.of("number", "bad number!", "section", "Indoor", "seats", 2)).andExpect(fieldError("number"));
        doPost(owner, "/tables", Map.of("number", "7", "section", "", "seats", 2)).andExpect(fieldError("section"));
        doPost(owner, "/tables", Map.of("number", "7", "section", "Indoor", "seats", 0)).andExpect(fieldError("seats"));
        doPost(owner, "/tables", Map.of("number", "7", "section", "Indoor", "seats", 51)).andExpect(fieldError("seats"));
        Map<String, Object> outside = new LinkedHashMap<>(Map.of("number", "7", "section", "Indoor", "seats", 2));
        outside.put("x", 1001);
        doPost(owner, "/tables", outside).andExpect(fieldError("x"));
        doGet(owner, "/tables/" + UUID.randomUUID()).andExpect(problem(404, "NOT_FOUND"));

        doGet(cashier, "/tables").andExpect(forbidden());
        doPost(cashier, "/tables", Map.of("number", "8", "section", "Indoor", "seats", 2)).andExpect(forbidden());
        doGet(manager, "/tables").andExpect(status().isOk());   // the manager holds FLOOR_MANAGE
    }

    // ------------------------------------------------------------------ positions (the floor-plan editor)

    @Test
    void savePositions_movesSeveralTablesAtOnce_returnsNewVersions_andAudits() throws Exception {
        JsonNode a = table("1", "Indoor", 4);
        JsonNode b = table("2", "Indoor", 4);
        JsonNode result = body(doPut(owner, "/tables/positions", Map.of("positions", List.of(
                        Map.of("tableId", a.get("id").asText(), "x", 100, "y", 200, "version", a.get("version").asInt()),
                        Map.of("tableId", b.get("id").asText(), "x", 900, "y", 650, "version", b.get("version").asInt()))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(2)));
        assertThat(result.get(0).get("x").asInt()).isEqualTo(100);
        assertThat(result.get(1).get("y").asInt()).isEqualTo(650);
        assertThat(result.get(0).get("version").asInt()).isEqualTo(1);
        doGet(owner, "/tables/" + a.get("id").asText()).andExpect(jsonPath("$.x").value(100)).andExpect(jsonPath("$.y").value(200));
        doGet(owner, "/audit-log?entityType=DINING_TABLE&entityId=" + a.get("id").asText() + "&action=UPDATE")
                .andExpect(jsonPath("$.items[0].after.x").value(100));
    }

    @Test
    void savePositions_isAllOrNothing_staleVersion_unknownTable_outsideTheGrid_403() throws Exception {
        JsonNode a = table("1", "Indoor", 4);
        JsonNode b = table("2", "Indoor", 4);
        int ax = a.get("x").asInt();

        // b's version is stale: nothing moves, not even a
        doPut(owner, "/tables/positions", Map.of("positions", List.of(
                Map.of("tableId", a.get("id").asText(), "x", 50, "y", 50, "version", 0),
                Map.of("tableId", b.get("id").asText(), "x", 60, "y", 60, "version", 9)))).andExpect(problem(409, "VERSION_CONFLICT"));
        doGet(owner, "/tables/" + a.get("id").asText()).andExpect(jsonPath("$.x").value(ax)).andExpect(jsonPath("$.version").value(0));

        doPut(owner, "/tables/positions", Map.of("positions", List.of(
                Map.of("tableId", UUID.randomUUID().toString(), "x", 50, "y", 50, "version", 0)))).andExpect(fieldError("positions[0].tableId"));
        doPut(owner, "/tables/positions", Map.of("positions", List.of(
                Map.of("tableId", a.get("id").asText(), "x", 50, "y", 50, "version", 0),
                Map.of("tableId", a.get("id").asText(), "x", 60, "y", 60, "version", 0)))).andExpect(fieldError("positions[1].tableId"));
        doPut(owner, "/tables/positions", Map.of("positions", List.of(
                Map.of("tableId", a.get("id").asText(), "x", 1001, "y", 50, "version", 0)))).andExpect(fieldError("positions[0].x"));
        doPut(owner, "/tables/positions", Map.of("positions", List.of(
                Map.of("tableId", a.get("id").asText(), "x", 50, "y", 701, "version", 0)))).andExpect(fieldError("positions[0].y"));
        doPut(owner, "/tables/positions", Map.of("positions", List.of())).andExpect(fieldError("positions"));
        doPut(cashier, "/tables/positions", Map.of("positions", List.of(
                Map.of("tableId", a.get("id").asText(), "x", 50, "y", 50, "version", 0)))).andExpect(forbidden());
    }

    // ------------------------------------------------------------------ POS layout

    @Test
    void floorLayout_hasActiveTablesWithPositions_forAnyoneWhoMayViewOrders() throws Exception {
        JsonNode a = table("1", "Indoor", 4);
        JsonNode off = table("2", "Indoor", 4);
        doPut(owner, "/tables/" + off.get("id").asText(), Map.of("number", "2", "section", "Indoor", "seats", 4, "active", false, "version", 0))
                .andExpect(status().isOk());

        doGet(cashier, "/floor/layout").andExpect(status().isOk())
                .andExpect(jsonPath("$.width").value(1000)).andExpect(jsonPath("$.height").value(700))
                .andExpect(jsonPath("$.tables.length()").value(1))
                .andExpect(jsonPath("$.tables[0].id").value(a.get("id").asText()))
                .andExpect(jsonPath("$.tables[0].seats").value(4))
                .andExpect(jsonPath("$.tables[0].x").isNumber());
        doGet(asRole(SystemRole.KITCHEN), "/floor/layout").andExpect(forbidden());
    }
}
