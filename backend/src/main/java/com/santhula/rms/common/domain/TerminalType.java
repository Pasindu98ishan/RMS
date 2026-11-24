package com.santhula.rms.common.domain;

/** Terminal types (data-model.md). Shared because settings keys idle timeouts by it. */
public enum TerminalType {
    CASHIER_POS,
    RECEPTION_POS,
    KITCHEN,
    ADMIN,
    DISPLAY;

    /** KITCHEN and DISPLAY screens are never logged out for idleness (P1-AUTH-03). */
    public boolean isIdleExempt() {
        return this == KITCHEN || this == DISPLAY;
    }
}
