package com.santhula.rms.settings.domain;

import com.santhula.rms.common.domain.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.util.UUID;

@Entity
@Table(name = "service_charge_rule")
public class ServiceChargeRule extends BaseEntity {

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Enumerated(EnumType.STRING)
    @Column(name = "order_type", nullable = false)
    private ServiceChargeOrderType orderType;

    @Column(nullable = false, precision = 5, scale = 2)
    private BigDecimal rate;

    protected ServiceChargeRule() {
    }

    public ServiceChargeOrderType getOrderType() {
        return orderType;
    }

    public BigDecimal getRate() {
        return rate;
    }

    public void setRate(BigDecimal rate) {
        this.rate = rate;
    }
}
