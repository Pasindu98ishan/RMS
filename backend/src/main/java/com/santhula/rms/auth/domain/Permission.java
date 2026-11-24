package com.santhula.rms.auth.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.UUID;
import org.hibernate.annotations.Immutable;

/** Reference data seeded by Flyway (V2); one row per permission code. */
@Entity
@Immutable
@Table(name = "permission")
public class Permission {

    @Id
    private UUID id;
    @Column(nullable = false, unique = true)
    private String code;
    @Column(nullable = false)
    private String description;
    @Column(nullable = false)
    private String module;
    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    protected Permission() {
    }

    public UUID getId() {
        return id;
    }

    public String getCode() {
        return code;
    }

    public String getDescription() {
        return description;
    }

    public String getModule() {
        return module;
    }

    public int getSortOrder() {
        return sortOrder;
    }
}
