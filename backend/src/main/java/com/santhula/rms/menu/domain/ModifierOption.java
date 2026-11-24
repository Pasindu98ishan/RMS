package com.santhula.rms.menu.domain;

import com.santhula.rms.common.domain.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.math.BigDecimal;

/** One option of a modifier group, e.g. "Extra cheese" +120.00. */
@Entity
@Table(name = "modifier_option")
public class ModifierOption extends BaseEntity {

    @Column(nullable = false)
    private String name;
    @Column(name = "price_delta", nullable = false, precision = 12, scale = 2)
    private BigDecimal priceDelta;
    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    protected ModifierOption() {
    }

    public ModifierOption(String name, BigDecimal priceDelta, int sortOrder) {
        this.name = name;
        this.priceDelta = priceDelta;
        this.sortOrder = sortOrder;
    }

    public String getName() {
        return name;
    }

    public BigDecimal getPriceDelta() {
        return priceDelta;
    }

    public int getSortOrder() {
        return sortOrder;
    }

    public void update(String name, BigDecimal priceDelta, int sortOrder) {
        this.name = name;
        this.priceDelta = priceDelta;
        this.sortOrder = sortOrder;
    }
}
