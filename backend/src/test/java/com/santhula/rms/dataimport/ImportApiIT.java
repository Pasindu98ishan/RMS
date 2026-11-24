package com.santhula.rms.dataimport;

import static com.santhula.rms.support.ProblemMatchers.fieldError;
import static com.santhula.rms.support.ProblemMatchers.forbidden;
import static com.santhula.rms.support.ProblemMatchers.malformed;
import static com.santhula.rms.support.ProblemMatchers.problem;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.santhula.rms.auth.domain.SystemRole;
import com.santhula.rms.support.IntegrationTestBase;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.dhatim.fastexcel.Workbook;
import org.dhatim.fastexcel.Worksheet;
import org.dhatim.fastexcel.reader.ReadableWorkbook;
import org.dhatim.fastexcel.reader.Row;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.ResultActions;

/**
 * Spreadsheet import (P1-IMP-01): templates, CSV and XLSX, dry run, all-or-nothing validation with a report
 * of row, column and reason, matching and updating by key, audit. 403 cases use a Manager (no DATA_IMPORT).
 */
class ImportApiIT extends IntegrationTestBase {

    private Session owner;
    private Session manager;

    @BeforeEach
    void start() throws Exception {
        resetDatabase();
        owner = asOwner();
        manager = asRole(SystemRole.MANAGER);
    }

    // ------------------------------------------------------------------ helpers

    private static byte[] csv(String... lines) {
        return String.join("\n", lines).getBytes(StandardCharsets.UTF_8);
    }

    private ResultActions upload(Session s, String type, String filename, byte[] bytes, boolean dryRun) throws Exception {
        var req = multipart(API + "/import/" + type).file(new MockMultipartFile("file", filename, "text/csv", bytes)).param("dryRun", String.valueOf(dryRun));
        if (s != null) {
            req.header("Authorization", "Bearer " + s.accessToken()).header("X-Terminal-Id", s.terminalId().toString());
        }
        return mvc.perform(req);
    }

    private JsonNode importOk(String type, byte[] bytes) throws Exception {
        JsonNode report = body(upload(owner, type, type.toLowerCase() + ".csv", bytes, false).andExpect(status().isOk()));
        assertThat(report.get("ok").asBoolean()).as(report.toString()).isTrue();
        return report;
    }

    private JsonNode errorsOf(String type, byte[] bytes) throws Exception {
        JsonNode report = body(upload(owner, type, type.toLowerCase() + ".csv", bytes, false).andExpect(status().isOk()));
        assertThat(report.get("ok").asBoolean()).as(report.toString()).isFalse();
        assertThat(report.get("counts").get("created").asInt() + report.get("counts").get("updated").asInt()).isZero();
        return report.get("errors");
    }

    private static boolean hasError(JsonNode errors, int row, String column, String messagePart) {
        for (JsonNode e : errors) {
            if (e.path("row").asInt(-1) == row && column.equals(e.path("column").asText(null)) && e.get("message").asText().contains(messagePart)) {
                return true;
            }
        }
        return false;
    }

    private long count(String path, String field) throws Exception {
        JsonNode body = body(doGet(owner, path));
        return field == null ? body.size() : body.get(field).asLong();
    }

    private void loadCategoriesAndGroups() throws Exception {
        importOk("CATEGORIES", csv("name,sort_order", "Rice & Curry,10", "Short Eats,20", "Beverages,30"));
        importOk("MODIFIER_GROUPS", csv("group,required,min_select,max_select,option,price_delta",
                "Spice level,Y,1,1,Mild,0.00", "Spice level,Y,1,1,Hot,0.00", "Extras,N,0,2,Extra egg,80.00", "Extras,N,0,2,Papadam,40.00"));
    }

    // ------------------------------------------------------------------ templates

    @Test
    void templates_areDownloadableAsCsvAndXlsx_forEveryType() throws Exception {
        Map<String, String> headers = Map.of(
                "CATEGORIES", "name,sort_order",
                "MENU_ITEMS", "code,name,category,station,local_price,foreign_price,modifier_groups,active",
                "MODIFIER_GROUPS", "group,required,min_select,max_select,option,price_delta",
                "TABLES", "number,section,seats");
        for (var entry : headers.entrySet()) {
            byte[] csv = mvc.perform(get(API + "/import/" + entry.getKey() + "/template").header("Authorization", "Bearer " + owner.accessToken())
                            .header("X-Terminal-Id", owner.terminalId().toString()))
                    .andExpect(status().isOk())
                    .andExpect(header().string("Content-Type", Matchers.startsWith("text/csv")))
                    .andExpect(header().string("Content-Disposition", Matchers.containsString(entry.getKey().toLowerCase() + "-template.csv")))
                    .andReturn().getResponse().getContentAsByteArray();
            assertThat(csv[0]).isEqualTo((byte) 0xEF);                                   // UTF-8 BOM, so Excel shows accents
            assertThat(new String(csv, 3, csv.length - 3, StandardCharsets.UTF_8)).startsWith(entry.getValue() + "\r\n");

            byte[] xlsx = mvc.perform(get(API + "/import/" + entry.getKey() + "/template").param("format", "XLSX")
                            .header("Authorization", "Bearer " + owner.accessToken()).header("X-Terminal-Id", owner.terminalId().toString()))
                    .andExpect(status().isOk())
                    .andExpect(header().string("Content-Disposition", Matchers.containsString(".xlsx")))
                    .andReturn().getResponse().getContentAsByteArray();
            try (ReadableWorkbook wb = new ReadableWorkbook(new ByteArrayInputStream(xlsx))) {
                List<Row> rows = wb.getFirstSheet().read();
                assertThat(rows.size()).isGreaterThanOrEqualTo(2);
                List<String> header = new ArrayList<>();
                for (int c = 0; c < rows.get(0).getCellCount(); c++) {
                    header.add(rows.get(0).getCellText(c));
                }
                assertThat(String.join(",", header)).isEqualTo(entry.getValue());
            }
        }
    }

    @Test
    void templates_needDataImport_andAKnownType() throws Exception {
        doGet(manager, "/import/CATEGORIES/template").andExpect(forbidden());
        doGet(owner, "/import/WIDGETS/template").andExpect(malformed());
        doGet(owner, "/import/CATEGORIES/template?format=PDF").andExpect(malformed());
        doGet(null, "/import/CATEGORIES/template").andExpect(problem(401, "UNAUTHENTICATED"));
    }

    @Test
    void theDownloadedTemplates_importCleanly_inOrder() throws Exception {
        for (String type : List.of("CATEGORIES", "MODIFIER_GROUPS", "MENU_ITEMS", "TABLES")) {
            byte[] template = mvc.perform(get(API + "/import/" + type + "/template").header("Authorization", "Bearer " + owner.accessToken())
                            .header("X-Terminal-Id", owner.terminalId().toString())).andReturn().getResponse().getContentAsByteArray();
            JsonNode report = body(upload(owner, type, "template.csv", template, false).andExpect(status().isOk()));
            assertThat(report.get("ok").asBoolean()).as(type + " " + report.get("errors")).isTrue();
            assertThat(report.get("counts").get("created").asInt()).as(type).isGreaterThan(0);
        }
        assertThat(count("/menu-items", "totalItems")).isEqualTo(2);
    }

    // ------------------------------------------------------------------ categories

    @Test
    void categories_importCreates_thenMatchesByName_andOnlyUpdatesWhatChanged() throws Exception {
        JsonNode first = importOk("CATEGORIES", csv("name,sort_order", "Rice & Curry,10", "Short Eats,20"));
        assertThat(first.get("counts").toString()).contains("\"created\":2").contains("\"updated\":0").contains("\"unchanged\":0");
        assertThat(first.get("rowsRead").asInt()).isEqualTo(2);
        assertThat(first.get("dryRun").asBoolean()).isFalse();

        JsonNode again = importOk("CATEGORIES", csv("name,sort_order", "Rice & Curry,10", "Short Eats,20"));
        assertThat(again.get("counts").toString()).contains("\"created\":0").contains("\"unchanged\":2");

        JsonNode changed = importOk("CATEGORIES", csv("name,sort_order", "short eats,5", "Rice & Curry,"));
        assertThat(changed.get("counts").toString()).contains("\"updated\":1").contains("\"unchanged\":1");   // a blank sort_order keeps the old one
        doGet(owner, "/categories").andExpect(jsonPath("$[0].name").value("Short Eats")).andExpect(jsonPath("$.length()").value(2));
    }

    @Test
    void dryRun_reportsExactCounts_butSavesNothing_andWritesNoAuditRow() throws Exception {
        JsonNode report = body(upload(owner, "CATEGORIES", "c.csv", csv("name,sort_order", "A,1", "B,2", "C,3"), true).andExpect(status().isOk()));
        assertThat(report.get("ok").asBoolean()).isTrue();
        assertThat(report.get("dryRun").asBoolean()).isTrue();
        assertThat(report.get("counts").get("created").asInt()).isEqualTo(3);
        assertThat(count("/categories", null)).isZero();
        doGet(owner, "/audit-log?action=DATA_IMPORTED").andExpect(jsonPath("$.totalItems").value(0));
        doGet(owner, "/audit-log?entityType=CATEGORY").andExpect(jsonPath("$.totalItems").value(0));

        importOk("CATEGORIES", csv("name,sort_order", "A,1", "B,2", "C,3"));
        assertThat(count("/categories", null)).isEqualTo(3);
        doGet(owner, "/audit-log?action=DATA_IMPORTED&entityType=IMPORT&entityId=CATEGORIES").andExpect(jsonPath("$.totalItems").value(1))
                .andExpect(jsonPath("$.items[0].after.created").value(3)).andExpect(jsonPath("$.items[0].after.fileName").value("categories.csv"))
                .andExpect(jsonPath("$.items[0].user.username").value(OWNER));
    }

    @Test
    void categories_errors_areAllReported_andNothingIsImported() throws Exception {
        JsonNode errors = errorsOf("CATEGORIES", csv("name,sort_order", "Good,1", ",2", "Dup,x", "Neg,-5", "good,3"));
        assertThat(hasError(errors, 3, "name", "required")).isTrue();
        assertThat(hasError(errors, 4, "sort_order", "'x' is not a whole number")).isTrue();
        assertThat(hasError(errors, 5, "sort_order", "cannot be negative")).isTrue();
        assertThat(hasError(errors, 6, "name", "duplicate")).isTrue();
        assertThat(count("/categories", null)).isZero();         // "Good" was valid but nothing is imported
    }

    // ------------------------------------------------------------------ menu items

    @Test
    void menuItems_import_createsItemsWithPricesStationAndGroups() throws Exception {
        loadCategoriesAndGroups();
        JsonNode report = importOk("MENU_ITEMS", csv(
                "code,name,category,station,local_price,foreign_price,modifier_groups,active",
                "rc-chk,Chicken rice and curry,Rice & Curry,1,850.00,1200.00,Spice level|Extras,Y",
                "SE-ROL,\"Egg roll, spicy\",Short Eats,1,150,,,",
                "BV-OLD,Old drink,Beverages,3,300.5,400.00,,N"));
        assertThat(report.get("counts").get("created").asInt()).isEqualTo(3);

        JsonNode list = body(doGet(owner, "/menu-items?sort=code,asc").andExpect(jsonPath("$.totalItems").value(3)));
        JsonNode chicken = list.get("items").get(1);
        assertThat(chicken.get("code").asText()).isEqualTo("RC-CHK");                              // lower case typed, stored upper case
        assertThat(chicken.get("localPrice").asText()).isEqualTo("850.00");
        assertThat(chicken.get("foreignPrice").asText()).isEqualTo("1200.00");
        assertThat(chicken.get("modifierGroupCount").asInt()).isEqualTo(2);
        JsonNode roll = list.get("items").get(2);
        assertThat(roll.get("name").asText()).isEqualTo("Egg roll, spicy");                        // a quoted comma
        assertThat(roll.get("localPrice").asText()).isEqualTo("150.00");
        assertThat(roll.has("foreignPrice")).isFalse();
        JsonNode old = list.get("items").get(0);
        assertThat(old.get("active").asBoolean()).isFalse();
        assertThat(old.get("localPrice").asText()).isEqualTo("300.50");
        doGet(owner, "/menu-items/" + chicken.get("id").asText()).andExpect(jsonPath("$.modifierGroups[0].name").value("Spice level"))
                .andExpect(jsonPath("$.modifierGroups[1].name").value("Extras")).andExpect(jsonPath("$.stationName").value("Kitchen 1"));
    }

    @Test
    void P1_IMP_01_anyInvalidRow_meansNothingIsImported_andEveryErrorNamesRowColumnAndReason() throws Exception {
        loadCategoriesAndGroups();
        JsonNode errors = errorsOf("MENU_ITEMS", csv(
                "code,name,category,station,local_price,foreign_price,modifier_groups,active",
                "OK-1,Fine item,Rice & Curry,1,100.00,,,Y",                  // row 2: valid
                "OK-2,Wrong category,Desserts,1,100.00,,,Y",                 // row 3
                "OK-3,Wrong station,Rice & Curry,9,100.00,,,Y",              // row 4
                "OK-4,Bad price,Rice & Curry,1,abc,,,Y",                     // row 5
                "OK-1,Same code again,Rice & Curry,1,100.00,,,Y",            // row 6
                "OK-6,Negative,Rice & Curry,1,-5.00,,,Y",                    // row 7
                "OK-7,Bad group,Rice & Curry,1,100.00,,Nope,Y",              // row 8
                "OK-8,Too many decimals,Rice & Curry,1,10.555,,,Y",          // row 9
                "OK-9,,Rice & Curry,1,100.00,,,Y",                           // row 10: name missing
                "OK-10,Bad flag,Rice & Curry,1,100.00,,,maybe",              // row 11
                "bad code!,Bad code,Rice & Curry,1,100.00,,,Y",              // row 12
                "OK-11,Three problems,Nope,9,abc,,,Y"));                     // row 13: unknown category, unknown station, bad price

        assertThat(hasError(errors, 3, "category", "unknown category 'Desserts'")).isTrue();
        assertThat(hasError(errors, 4, "station", "unknown kitchen station 9")).isTrue();
        assertThat(hasError(errors, 5, "local_price", "'abc' is not a number")).isTrue();
        assertThat(hasError(errors, 6, "code", "duplicate code (first on row 2)")).isTrue();
        assertThat(hasError(errors, 7, "local_price", "cannot be negative")).isTrue();
        assertThat(hasError(errors, 8, "modifier_groups", "unknown modifier group 'Nope'")).isTrue();
        assertThat(hasError(errors, 9, "local_price", "at most 2 decimals")).isTrue();
        assertThat(hasError(errors, 10, "name", "required")).isTrue();
        assertThat(hasError(errors, 11, "active", "must be Y or N")).isTrue();
        assertThat(hasError(errors, 12, "code", "capital letters")).isTrue();
        // A row with several problems gets every one of them reported, not only the first.
        assertThat(hasError(errors, 13, "category", "unknown category 'Nope'")).isTrue();
        assertThat(hasError(errors, 13, "station", "unknown kitchen station 9")).isTrue();
        assertThat(hasError(errors, 13, "local_price", "'abc' is not a number")).isTrue();
        assertThat(errors.get(0).get("value")).isNotNull();
        assertThat(count("/menu-items", "totalItems")).isZero();          // even row 2 was not imported
    }

    @Test
    void menuItems_reimport_updatesByCode_neverDuplicates_andAuditsPriceChanges() throws Exception {
        loadCategoriesAndGroups();
        String head = "code,name,category,station,local_price,foreign_price,modifier_groups,active";
        importOk("MENU_ITEMS", csv(head, "RC-1,Chicken,Rice & Curry,1,850.00,1200.00,Spice level,Y", "RC-2,Fish,Rice & Curry,1,900.00,,,Y"));

        JsonNode report = importOk("MENU_ITEMS", csv(head, "RC-1,Chicken curry,Rice & Curry,2,900.00,1200.00,Spice level,Y",   // name, station, price
                "RC-2,Fish,Rice & Curry,1,900.00,,,Y",                                                                          // identical
                "RC-3,New one,Rice & Curry,1,500.00,,,Y"));
        assertThat(report.get("counts").toString()).contains("\"created\":1").contains("\"updated\":1").contains("\"unchanged\":1");
        assertThat(count("/menu-items", "totalItems")).isEqualTo(3);

        JsonNode rc1 = body(doGet(owner, "/menu-items?search=RC-1")).get("items").get(0);
        assertThat(rc1.get("name").asText()).isEqualTo("Chicken curry");
        assertThat(rc1.get("localPrice").asText()).isEqualTo("900.00");
        assertThat(rc1.get("stationName").asText()).isEqualTo("Kitchen 2");
        doGet(owner, "/audit-log?entityType=MENU_ITEM&entityId=" + rc1.get("id").asText() + "&action=PRICE_CHANGED")
                .andExpect(jsonPath("$.totalItems").value(1)).andExpect(jsonPath("$.items[0].before.localPrice").value("850.00"))
                .andExpect(jsonPath("$.items[0].after.localPrice").value("900.00"));

        // A blank foreign_price on a re-import removes the foreign price; an absent `active` column keeps the flag.
        importOk("MENU_ITEMS", csv("code,name,category,station,local_price,foreign_price", "RC-1,Chicken curry,Rice & Curry,2,900.00,"));
        assertThat(body(doGet(owner, "/menu-items/" + rc1.get("id").asText())).has("foreignPrice")).isFalse();
    }

    @Test
    void menuItems_dryRun_checksReferencesWithoutSaving() throws Exception {
        loadCategoriesAndGroups();
        JsonNode report = body(upload(owner, "MENU_ITEMS", "i.csv", csv("code,name,category,station,local_price",
                "A-1,One,Rice & Curry,1,10.00", "A-2,Two,Rice & Curry,1,20.00"), true).andExpect(status().isOk()));
        assertThat(report.get("ok").asBoolean()).isTrue();
        assertThat(report.get("counts").get("created").asInt()).isEqualTo(2);
        assertThat(count("/menu-items", "totalItems")).isZero();
    }

    // ------------------------------------------------------------------ modifier groups

    @Test
    void modifierGroups_import_createsGroupsWithOptions_andUpdatesByName() throws Exception {
        JsonNode report = importOk("MODIFIER_GROUPS", csv("group,required,min_select,max_select,option,price_delta",
                "Spice level,Y,1,1,Mild,0.00", "Spice level,Y,1,1,Hot,", "Extras,N,0,3,Egg,80.00", "Extras,N,0,3,Cheese,120.00", "Extras,N,0,3,Gravy,60.00"));
        assertThat(report.get("counts").get("created").asInt()).isEqualTo(2);
        JsonNode groups = body(doGet(owner, "/modifier-groups"));
        assertThat(groups.get(0).get("name").asText()).isEqualTo("Extras");
        assertThat(groups.get(1).get("name").asText()).isEqualTo("Spice level");
        assertThat(groups).hasSize(2);
        assertThat(groups.get(0).get("options")).hasSize(3);
        assertThat(groups.get(1).get("options").get(1).get("priceDelta").asText()).isEqualTo("0.00");   // blank price_delta = 0.00
        String eggId = groups.get(0).get("options").get(0).get("id").asText();

        // Re-import: Extras loses Gravy and Egg gets dearer (the option keeps its id); Spice level is unchanged.
        JsonNode again = importOk("MODIFIER_GROUPS", csv("group,required,min_select,max_select,option,price_delta",
                "Extras,N,0,2,Egg,90.00", "Extras,N,0,2,Cheese,120.00", "Spice level,Y,1,1,Mild,0.00", "Spice level,Y,1,1,Hot,0.00"));
        assertThat(again.get("counts").toString()).contains("\"updated\":1").contains("\"unchanged\":1");
        JsonNode extras = body(doGet(owner, "/modifier-groups")).get(0);
        assertThat(extras.get("options")).hasSize(2);
        assertThat(extras.get("options").get(0).get("id").asText()).isEqualTo(eggId);
        assertThat(extras.get("options").get(0).get("priceDelta").asText()).isEqualTo("90.00");
    }

    @Test
    void modifierGroups_errors_followTheSameRulesAsTheEditor() throws Exception {
        JsonNode errors = errorsOf("MODIFIER_GROUPS", csv("group,required,min_select,max_select,option,price_delta",
                "Bad,Y,0,1,A,0.00",                    // row 2: required with min 0
                "Mixed,Y,1,1,A,0.00",                  // row 3
                "Mixed,N,0,1,B,0.00",                  // row 4: differs from row 3
                "Big,N,0,5,A,0.00",                    // row 5: max more than options
                "Neg,N,0,1,A,-1.00",                   // row 6
                "Twice,N,0,2,A,0.00", "Twice,N,0,2,a,0.00"));   // rows 7-8: same option twice
        assertThat(hasError(errors, 2, "min_select", "at least 1")).isTrue();
        assertThat(errors.toString()).contains("must be the same on every row");
        assertThat(hasError(errors, 5, "max_select", "more than the number of options")).isTrue();
        assertThat(hasError(errors, 6, "price_delta", "negative")).isTrue();
        assertThat(hasError(errors, 8, "option", "used twice")).isTrue();
        assertThat(count("/modifier-groups", null)).isZero();
    }

    // ------------------------------------------------------------------ tables

    @Test
    void tables_import_createsTables_thenMatchesByNumber() throws Exception {
        JsonNode first = importOk("TABLES", csv("number,section,seats", "1,Indoor,4", "2,Indoor,2", "G1,Garden,6"));
        assertThat(first.get("counts").get("created").asInt()).isEqualTo(3);
        JsonNode second = importOk("TABLES", csv("number,section,seats", "1,Indoor,4", "2,Terrace,2", "g1,Garden,8", "G2,Garden,4"));
        assertThat(second.get("counts").toString()).contains("\"created\":1").contains("\"updated\":2").contains("\"unchanged\":1");
        assertThat(count("/tables", null)).isEqualTo(4);
        doGet(owner, "/tables?section=Garden").andExpect(jsonPath("$[0].number").value("G1")).andExpect(jsonPath("$[0].seats").value(8));
    }

    @Test
    void tables_errors_areReported() throws Exception {
        JsonNode errors = errorsOf("TABLES", csv("number,section,seats", "1,Indoor,4", "1,Indoor,2", "2,,4", "3,Indoor,0", "4,Indoor,x", "bad number,Indoor,2", "5,Indoor,51"));
        assertThat(hasError(errors, 3, "number", "duplicate table number (first used on row 2)")).isTrue();
        assertThat(hasError(errors, 4, "section", "required")).isTrue();
        assertThat(hasError(errors, 5, "seats", "between 1 and 50")).isTrue();
        assertThat(hasError(errors, 6, "seats", "'x' is not a whole number")).isTrue();
        assertThat(hasError(errors, 7, "number", "letters, digits or dashes")).isTrue();
        assertThat(hasError(errors, 8, "seats", "between 1 and 50")).isTrue();
        assertThat(count("/tables", null)).isZero();
    }

    // ------------------------------------------------------------------ XLSX and file formats

    private static byte[] xlsx(List<List<Object>> rows) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        Workbook wb = new Workbook(out, "test", "1.0");
        Worksheet ws = wb.newWorksheet("data");
        for (int r = 0; r < rows.size(); r++) {
            for (int c = 0; c < rows.get(r).size(); c++) {
                Object v = rows.get(r).get(c);
                if (v instanceof Number n) {
                    ws.value(r, c, n);
                } else if (v != null) {
                    ws.value(r, c, v.toString());
                }
            }
        }
        wb.finish();
        return out.toByteArray();
    }

    @Test
    void xlsx_files_areImported_withNumericCells() throws Exception {
        byte[] tables = xlsx(List.of(List.of("Number", "Section", "Seats"), List.of("1", "Indoor", 4), List.of("2", "Indoor", 6.0), List.of("G1", "Garden", 2)));
        JsonNode report = body(upload(owner, "TABLES", "tables.xlsx", tables, false).andExpect(status().isOk()));
        assertThat(report.get("ok").asBoolean()).as(report.toString()).isTrue();      // the header "Number" is matched case-insensitively
        assertThat(report.get("counts").get("created").asInt()).isEqualTo(3);
        doGet(owner, "/tables?section=Indoor").andExpect(jsonPath("$[1].seats").value(6));

        importOk("CATEGORIES", csv("name", "Rice & Curry"));
        byte[] items = xlsx(List.of(List.of("code", "name", "category", "station", "local_price", "foreign_price"),
                List.of("X-1", "Sheet item", "Rice & Curry", 1, 850.5, 1200)));
        JsonNode itemReport = body(upload(owner, "MENU_ITEMS", "items.xlsx", items, false).andExpect(status().isOk()));
        assertThat(itemReport.get("ok").asBoolean()).as(itemReport.toString()).isTrue();
        JsonNode item = body(doGet(owner, "/menu-items?search=X-1")).get("items").get(0);
        assertThat(item.get("localPrice").asText()).isEqualTo("850.50");
        assertThat(item.get("foreignPrice").asText()).isEqualTo("1200.00");
    }

    @Test
    void xlsx_errors_reportTheSpreadsheetRowNumber() throws Exception {
        byte[] bad = xlsx(List.of(List.of("number", "section", "seats"), List.of("1", "Indoor", 4), List.of("2", "Indoor", "many")));
        JsonNode errors = body(upload(owner, "TABLES", "t.xlsx", bad, false).andExpect(status().isOk())).get("errors");
        assertThat(hasError(errors, 3, "seats", "'many' is not a whole number")).isTrue();
    }

    @Test
    void csv_withByteOrderMark_semicolons_andBlankLines_isAccepted() throws Exception {
        byte[] body = ("﻿number;section;seats\n1;Indoor;4\n\n;;\n2;Indoor;2\n").getBytes(StandardCharsets.UTF_8);
        JsonNode report = body(upload(owner, "TABLES", "t.csv", body, false).andExpect(status().isOk()));
        assertThat(report.get("ok").asBoolean()).as(report.toString()).isTrue();
        assertThat(report.get("rowsRead").asInt()).isEqualTo(2);
    }

    @Test
    void headerProblems_areReported_asRowOne() throws Exception {
        JsonNode missing = errorsOf("TABLES", csv("number,seats", "1,4"));
        assertThat(hasError(missing, 1, "section", "missing column 'section'")).isTrue();
        JsonNode unknown = errorsOf("CATEGORIES", csv("name,sort_order,colour", "A,1,red"));
        assertThat(hasError(unknown, 1, "colour", "unknown column 'colour'")).isTrue();
        JsonNode twice = errorsOf("CATEGORIES", csv("name,name", "A,B"));
        assertThat(hasError(twice, 1, "name", "appears twice")).isTrue();
    }

    @Test
    void aFileWithOnlyAHeader_isOkAndEmpty() throws Exception {
        JsonNode report = importOk("CATEGORIES", csv("name,sort_order"));
        assertThat(report.get("rowsRead").asInt()).isZero();
        assertThat(report.get("counts").get("created").asInt()).isZero();
    }

    @Test
    void unreadableFiles_are422_ImportFileInvalid() throws Exception {
        upload(owner, "CATEGORIES", "empty.csv", new byte[0], false).andExpect(problem(422, "IMPORT_FILE_INVALID"));
        upload(owner, "CATEGORIES", "broken.xlsx", ("PK\u0003\u0004 this is not really a workbook").getBytes(StandardCharsets.UTF_8), false)
                .andExpect(problem(422, "IMPORT_FILE_INVALID"));
        upload(owner, "CATEGORIES", "quote.csv", csv("name", "\"unterminated"), false).andExpect(problem(422, "IMPORT_FILE_INVALID"));
        StringBuilder many = new StringBuilder("name\n");
        for (int i = 0; i <= 5000; i++) {
            many.append("C").append(i).append('\n');
        }
        upload(owner, "CATEGORIES", "many.csv", many.toString().getBytes(StandardCharsets.UTF_8), false)
                .andExpect(problem(422, "IMPORT_FILE_INVALID")).andExpect(jsonPath("$.detail").value(Matchers.containsString("5000")));
        assertThat(count("/categories", null)).isZero();
    }

    @Test
    void aFileOfRandomText_isAReportOfUnknownColumns_notAServerError() throws Exception {
        JsonNode errors = errorsOf("CATEGORIES", csv("hello world", "this is not a spreadsheet"));
        assertThat(errors.toString()).contains("missing column 'name'");
    }

    // ------------------------------------------------------------------ access and request shape

    @Test
    void importNeedsDataImport_aFile_andAKnownType() throws Exception {
        upload(manager, "CATEGORIES", "c.csv", csv("name", "A"), false).andExpect(forbidden());
        upload(null, "CATEGORIES", "c.csv", csv("name", "A"), false).andExpect(problem(401, "UNAUTHENTICATED"));
        upload(owner, "WIDGETS", "c.csv", csv("name", "A"), false).andExpect(malformed());
        // no file part at all
        mvc.perform(multipart(API + "/import/CATEGORIES").header("Authorization", "Bearer " + owner.accessToken())
                .header("X-Terminal-Id", owner.terminalId().toString())).andExpect(fieldError("file"));
        // a forbidden caller gets 403 even without a valid body
        mvc.perform(multipart(API + "/import/CATEGORIES").header("Authorization", "Bearer " + manager.accessToken())
                .header("X-Terminal-Id", manager.terminalId().toString())).andExpect(forbidden());
        assertThat(count("/categories", null)).isZero();
    }
}
