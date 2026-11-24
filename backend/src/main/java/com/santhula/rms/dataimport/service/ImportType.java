package com.santhula.rms.dataimport.service;

import java.util.List;

/**
 * What an import file contains, with its columns (P1-IMP-01, docs/requirements/m1.1-scope.md "Import format").
 * Column names are matched case-insensitively with spaces read as underscores.
 */
public enum ImportType {

    CATEGORIES(List.of("name"), List.of("sort_order"),
            List.of(List.of("Rice & Curry", "10"), List.of("Short Eats", "20"))),

    MENU_ITEMS(List.of("code", "name", "category", "station", "local_price"),
            List.of("foreign_price", "modifier_groups", "active"),
            List.of(List.of("RC-CHK", "Chicken rice and curry", "Rice & Curry", "1", "850.00", "1200.00", "Spice level|Extras", "Y"),
                    List.of("SE-ROL", "Egg roll", "Short Eats", "1", "150.00", "", "", "Y"))),

    MODIFIER_GROUPS(List.of("group", "required", "min_select", "max_select", "option", "price_delta"), List.of(),
            List.of(List.of("Spice level", "Y", "1", "1", "Mild", "0.00"),
                    List.of("Spice level", "Y", "1", "1", "Hot", "0.00"),
                    List.of("Extras", "N", "0", "2", "Extra egg", "80.00"),
                    List.of("Extras", "N", "0", "2", "Papadam", "40.00"))),

    TABLES(List.of("number", "section", "seats"), List.of(),
            List.of(List.of("1", "Indoor", "4"), List.of("G1", "Garden", "6")));

    private final List<String> required;
    private final List<String> optional;
    private final List<List<String>> examples;

    ImportType(List<String> required, List<String> optional, List<List<String>> examples) {
        this.required = required;
        this.optional = optional;
        this.examples = examples;
    }

    public List<String> requiredColumns() {
        return required;
    }

    public List<String> optionalColumns() {
        return optional;
    }

    /** All columns in template order: required first, then optional. */
    public List<String> columns() {
        return java.util.stream.Stream.concat(required.stream(), optional.stream()).toList();
    }

    /** Example rows for the template, each with one value per column of {@link #columns()}. */
    public List<List<String>> exampleRows() {
        return examples;
    }

    /** File name of the template, e.g. menu_items-template.csv. */
    public String templateName(String extension) {
        return name().toLowerCase(java.util.Locale.ROOT) + "-template." + extension;
    }
}
