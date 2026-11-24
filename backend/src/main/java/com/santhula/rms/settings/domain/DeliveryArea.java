package com.santhula.rms.settings.domain;

import com.santhula.rms.common.domain.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.util.UUID;

/** A delivery area with its fee (P1-SET-07). Never deleted, only deactivated. */
@Entity
@Table(name = "delivery_area")
public class DeliveryArea extends BaseEntity {

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;
    @Column(nullable = false)
    private String name;
    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal fee;
    @Column(nullable = false)
    private boolean active = true;

    protected DeliveryArea() {
    }

    public DeliveryArea(UUID branchId, String name, BigDecimal fee, boolean active) {
        this.branchId = branchId;
        this.name = name;
        this.fee = fee;
        this.active = active;
    }

    public String getName() {
        return name;
    }

    public BigDecimal getFee() {
        return fee;
    }

    public boolean isActive() {
        return active;
    }

    public void update(String name, BigDecimal fee, boolean active) {
        this.name = name;
        this.fee = fee;
        this.active = active;
    }
}
