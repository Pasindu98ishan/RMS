package com.santhula.rms.floor.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.UUID;
import org.hibernate.annotations.Immutable;

/** Cashier counter or Reception (P1-FLOOR-02). Seeded by V6; not editable. */
@Entity
@Immutable
@Table(name = "ordering_point")
public class OrderingPoint {

    @Id
    private UUID id;
    @Column(name = "branch_id", nullable = false)
    private UUID branchId;
    @Column(nullable = false)
    private String name;
    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    protected OrderingPoint() {
    }

    public UUID getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public int getSortOrder() {
        return sortOrder;
    }
}
