package com.santhula.rms.settings.domain;

import com.santhula.rms.common.domain.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** One key/value setting group (jsonb), e.g. `restaurant`, `tax`, `business_day`, `idle_timeouts`. */
@Entity
@Table(name = "setting")
public class SettingEntry extends BaseEntity {

    public static final String RESTAURANT = "restaurant";
    public static final String TAX = "tax";
    public static final String BUSINESS_DAY = "business_day";
    public static final String IDLE_TIMEOUTS = "idle_timeouts";
    public static final String MENU = "menu";
    /** Housekeeping: the business date of the last daily sold-out reset. Not edited through the API. */
    public static final String AVAILABILITY_RESET = "availability_reset";

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;

    @Column(nullable = false)
    private String key;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private Map<String, Object> value;

    protected SettingEntry() {
    }

    public SettingEntry(UUID branchId, String key, Map<String, Object> value) {
        this.branchId = branchId;
        this.key = key;
        this.value = new LinkedHashMap<>(value);
    }

    public String getKey() {
        return key;
    }

    public Map<String, Object> getValue() {
        return value;
    }

    /** Replaces the whole value (a new map, so Hibernate always sees the change). */
    public void replaceValue(Map<String, Object> newValue) {
        this.value = new LinkedHashMap<>(newValue);
    }
}
