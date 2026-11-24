package com.santhula.rms.menu.domain;

import com.santhula.rms.common.domain.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;

/** One of the three kitchen stations (P1-MENU-07). Seeded by V6; name, target time and active flag are editable. */
@Entity
@Table(name = "kitchen_station")
public class KitchenStation extends BaseEntity {

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;
    @Column(nullable = false)
    private int number;
    @Column(nullable = false)
    private String name;
    @Column(name = "target_prep_minutes", nullable = false)
    private int targetPrepMinutes;
    @Column(nullable = false)
    private boolean active = true;

    protected KitchenStation() {
    }

    public int getNumber() {
        return number;
    }

    public String getName() {
        return name;
    }

    public int getTargetPrepMinutes() {
        return targetPrepMinutes;
    }

    public boolean isActive() {
        return active;
    }

    public void update(String name, int targetPrepMinutes, boolean active) {
        this.name = name;
        this.targetPrepMinutes = targetPrepMinutes;
        this.active = active;
    }
}
