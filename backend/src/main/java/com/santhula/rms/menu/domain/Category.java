package com.santhula.rms.menu.domain;

import com.santhula.rms.common.domain.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;

@Entity
@Table(name = "category")
public class Category extends BaseEntity {

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;
    @Column(nullable = false)
    private String name;
    @Column(name = "sort_order", nullable = false)
    private int sortOrder;
    @Column(nullable = false)
    private boolean active = true;

    protected Category() {
    }

    public Category(UUID branchId, String name, int sortOrder, boolean active) {
        this.branchId = branchId;
        this.name = name;
        this.sortOrder = sortOrder;
        this.active = active;
    }

    public String getName() {
        return name;
    }

    public int getSortOrder() {
        return sortOrder;
    }

    public boolean isActive() {
        return active;
    }

    public void update(String name, int sortOrder, boolean active) {
        this.name = name;
        this.sortOrder = sortOrder;
        this.active = active;
    }
}
