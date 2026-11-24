package com.santhula.rms.auth.domain;

import com.santhula.rms.common.domain.BaseEntity;
import com.santhula.rms.common.domain.TerminalType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import org.hibernate.annotations.DynamicUpdate;
import java.time.Instant;
import java.util.UUID;

@Entity
@DynamicUpdate
@Table(name = "terminal")
public class Terminal extends BaseEntity {

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;
    @Column(nullable = false)
    private String name;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private TerminalType type;
    @Column(name = "kitchen_station_id")
    private UUID kitchenStationId;
    @Column(name = "ordering_point_id")
    private UUID orderingPointId;
    @Column(name = "device_token_hash", nullable = false)
    private String deviceTokenHash;
    @Column(nullable = false)
    private boolean active = true;
    @Column(name = "last_login_at")
    private Instant lastLoginAt;

    protected Terminal() {
    }

    public Terminal(UUID branchId, String name, TerminalType type, UUID kitchenStationId, UUID orderingPointId, String deviceTokenHash) {
        this.branchId = branchId;
        this.name = name;
        this.type = type;
        this.kitchenStationId = kitchenStationId;
        this.orderingPointId = orderingPointId;
        this.deviceTokenHash = deviceTokenHash;
    }

    public String getName() {
        return name;
    }

    public TerminalType getType() {
        return type;
    }

    public UUID getKitchenStationId() {
        return kitchenStationId;
    }

    public UUID getOrderingPointId() {
        return orderingPointId;
    }

    public String getDeviceTokenHash() {
        return deviceTokenHash;
    }

    public boolean isActive() {
        return active;
    }

    public Instant getLastLoginAt() {
        return lastLoginAt;
    }

    public void update(String name, TerminalType type, UUID kitchenStationId, UUID orderingPointId) {
        this.name = name;
        this.type = type;
        this.kitchenStationId = kitchenStationId;
        this.orderingPointId = orderingPointId;
    }

    public void deactivate() {
        this.active = false;
    }
}
