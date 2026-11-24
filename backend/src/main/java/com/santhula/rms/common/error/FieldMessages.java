package com.santhula.rms.common.error;

import java.util.Locale;

/**
 * Plain-English field messages for Bean Validation failures on generated DTOs (the generated
 * annotations carry no custom messages). Shown to the cashier as-is.
 */
final class FieldMessages {

    private FieldMessages() {
    }

    static String message(String field, String constraint, String fallback) {
        String label = label(field);
        if (constraint == null) {
            return capitalize(fallback == null ? label + " is not valid" : label + " " + fallback);
        }
        return switch (constraint) {
            case "NotNull", "NotBlank", "NotEmpty" -> label + " is required";
            case "Size" -> label + " has the wrong length";
            case "Pattern" -> label + " is not in the right format";
            case "Min", "Max", "DecimalMin", "DecimalMax" -> label + (fallback == null ? " is out of range" : " " + fallback);
            case "Email" -> label + " is not a valid email address";
            default -> label + " is not valid";
        };
    }

    /** "roleIds" -> "Role ids", "rules[1].rate" -> "Rate". */
    static String label(String field) {
        if (field == null || field.isBlank()) {
            return "Value";
        }
        String last = field.contains(".") ? field.substring(field.lastIndexOf('.') + 1) : field;
        last = last.replaceAll("\\[\\d+]", "");
        String words = last.replaceAll("([a-z])([A-Z])", "$1 $2").toLowerCase(Locale.ROOT);
        return capitalize(words);
    }

    private static String capitalize(String s) {
        return s.isEmpty() ? s : Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }
}
