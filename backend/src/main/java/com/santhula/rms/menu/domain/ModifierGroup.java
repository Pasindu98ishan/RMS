package com.santhula.rms.menu.domain;

import com.santhula.rms.common.domain.BaseEntity;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.hibernate.annotations.Fetch;
import org.hibernate.annotations.FetchMode;

/** A modifier group such as Spice level, with its options (P1-MENU-03). Never deleted, only deactivated. */
@Entity
@Table(name = "modifier_group")
public class ModifierGroup extends BaseEntity {

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;
    @Column(nullable = false)
    private String name;
    @Column(nullable = false)
    private boolean required;
    @Column(name = "min_select", nullable = false)
    private int minSelect;
    @Column(name = "max_select", nullable = false)
    private int maxSelect;
    @Column(nullable = false)
    private boolean active = true;

    @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
    @JoinColumn(name = "group_id", nullable = false)
    @OrderBy("sortOrder ASC")
    @Fetch(FetchMode.SUBSELECT)
    private List<ModifierOption> options = new ArrayList<>();

    protected ModifierGroup() {
    }

    public ModifierGroup(UUID branchId, String name, boolean required, int minSelect, int maxSelect, boolean active) {
        this.branchId = branchId;
        this.name = name;
        this.required = required;
        this.minSelect = minSelect;
        this.maxSelect = maxSelect;
        this.active = active;
    }

    public String getName() {
        return name;
    }

    public boolean isRequired() {
        return required;
    }

    public int getMinSelect() {
        return minSelect;
    }

    public int getMaxSelect() {
        return maxSelect;
    }

    public boolean isActive() {
        return active;
    }

    public List<ModifierOption> getOptions() {
        return options;
    }

    public void update(String name, boolean required, int minSelect, int maxSelect, boolean active) {
        this.name = name;
        this.required = required;
        this.minSelect = minSelect;
        this.maxSelect = maxSelect;
        this.active = active;
    }
}
