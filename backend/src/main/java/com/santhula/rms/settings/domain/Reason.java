package com.santhula.rms.settings.domain;

import com.santhula.rms.common.domain.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.util.UUID;

/** One entry of an editable reason list (P1-SET-08). Never deleted (past records refer to it), only deactivated. */
@Entity
@Table(name = "reason")
public class Reason extends BaseEntity {

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ReasonCategory category;
    @Column(nullable = false)
    private String text;
    @Column(nullable = false)
    private boolean active = true;

    protected Reason() {
    }

    public Reason(UUID branchId, ReasonCategory category, String text, boolean active) {
        this.branchId = branchId;
        this.category = category;
        this.text = text;
        this.active = active;
    }

    public ReasonCategory getCategory() {
        return category;
    }

    public String getText() {
        return text;
    }

    public boolean isActive() {
        return active;
    }

    public void update(String text, boolean active) {
        this.text = text;
        this.active = active;
    }
}
