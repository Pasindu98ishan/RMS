package com.santhula.rms.auth.domain;

import java.util.UUID;

/** The 8 seeded roles (V2 migration). Fixed ids so tests and seed data can refer to them. */
public enum SystemRole {
    OWNER("00000000-0000-0000-0001-000000000001"),
    MANAGER("00000000-0000-0000-0001-000000000002"),
    CASHIER("00000000-0000-0000-0001-000000000003"),
    RECEPTIONIST("00000000-0000-0000-0001-000000000004"),
    KITCHEN("00000000-0000-0000-0001-000000000005"),
    RIDER("00000000-0000-0000-0001-000000000006"),
    INVENTORY("00000000-0000-0000-0001-000000000007"),
    HR("00000000-0000-0000-0001-000000000008");

    private final UUID id;

    SystemRole(String id) {
        this.id = UUID.fromString(id);
    }

    public UUID id() {
        return id;
    }
}
