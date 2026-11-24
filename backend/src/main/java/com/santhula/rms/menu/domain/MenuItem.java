package com.santhula.rms.menu.domain;

import com.santhula.rms.common.domain.BaseEntity;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.MapKeyColumn;
import jakarta.persistence.MapKeyEnumerated;
import jakarta.persistence.OrderColumn;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.hibernate.annotations.Fetch;
import org.hibernate.annotations.FetchMode;

/**
 * A menu item: exactly one kitchen station, a LOCAL price and an optional FOREIGN price, and an optional
 * ordered list of attached modifier groups. Never deleted, only deactivated. `available` = false means
 * sold out today.
 */
@Entity
@Table(name = "menu_item")
public class MenuItem extends BaseEntity {

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;
    @Column(nullable = false)
    private String code;
    @Column(nullable = false)
    private String name;
    @Column(name = "category_id", nullable = false)
    private UUID categoryId;
    @Column(name = "kitchen_station_id", nullable = false)
    private UUID stationId;
    @Column(nullable = false)
    private boolean active = true;
    /**
     * Sold out today. Changed only with a plain UPDATE (MenuItemRepository.setAvailable), so a cashier's toggle never
     * bumps the version; {@code updatable = false} keeps an admin's form save from writing a stale value back
     * (and, unlike @DynamicUpdate, lets Hibernate batch the item updates of an import).
     */
    @Column(nullable = false, updatable = false)
    private boolean available = true;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "menu_item_price", joinColumns = @JoinColumn(name = "menu_item_id"))
    @MapKeyColumn(name = "price_list")
    @MapKeyEnumerated(EnumType.STRING)
    @Column(name = "price", nullable = false, precision = 12, scale = 2)
    @Fetch(FetchMode.SUBSELECT)
    private Map<PriceList, BigDecimal> prices = new EnumMap<>(PriceList.class);

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "menu_item_modifier_group", joinColumns = @JoinColumn(name = "menu_item_id"))
    @OrderColumn(name = "sort_order")
    @Column(name = "modifier_group_id", nullable = false)
    @Fetch(FetchMode.SUBSELECT)
    private List<UUID> modifierGroupIds = new ArrayList<>();

    protected MenuItem() {
    }

    public MenuItem(UUID branchId, String code, String name, UUID categoryId, UUID stationId, boolean active) {
        this.branchId = branchId;
        this.code = code;
        this.name = name;
        this.categoryId = categoryId;
        this.stationId = stationId;
        this.active = active;
    }

    public String getCode() {
        return code;
    }

    public String getName() {
        return name;
    }

    public UUID getCategoryId() {
        return categoryId;
    }

    public UUID getStationId() {
        return stationId;
    }

    public boolean isActive() {
        return active;
    }

    public boolean isAvailable() {
        return available;
    }

    public BigDecimal localPrice() {
        return prices.get(PriceList.LOCAL);
    }

    public BigDecimal foreignPrice() {
        return prices.get(PriceList.FOREIGN);
    }

    public List<UUID> getModifierGroupIds() {
        return modifierGroupIds;
    }

    public void update(String code, String name, UUID categoryId, UUID stationId, boolean active) {
        this.code = code;
        this.name = name;
        this.categoryId = categoryId;
        this.stationId = stationId;
        this.active = active;
    }

    /** Sets the local price and the foreign price; a null foreign price removes it. */
    public void setPrices(BigDecimal local, BigDecimal foreign) {
        prices.put(PriceList.LOCAL, local);
        if (foreign == null) {
            prices.remove(PriceList.FOREIGN);
        } else {
            prices.put(PriceList.FOREIGN, foreign);
        }
    }

    public void replaceModifierGroups(List<UUID> ids) {
        modifierGroupIds.clear();
        modifierGroupIds.addAll(ids);
    }
}
