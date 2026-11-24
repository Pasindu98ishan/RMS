package com.santhula.rms.floor.domain;

import com.santhula.rms.common.domain.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;

/** A table. x / y (pos_x / pos_y) are its centre on the 1000 x 700 floor-plan grid. */
@Entity
@Table(name = "dining_table")
public class DiningTable extends BaseEntity {

    public static final int GRID_WIDTH = 1000;
    public static final int GRID_HEIGHT = 700;

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;
    @Column(nullable = false)
    private String number;
    @Column(nullable = false)
    private String section;
    @Column(nullable = false)
    private int seats;
    @Column(name = "pos_x", nullable = false)
    private int x;
    @Column(name = "pos_y", nullable = false)
    private int y;
    @Column(nullable = false)
    private boolean active = true;

    protected DiningTable() {
    }

    public DiningTable(UUID branchId, String number, String section, int seats, int x, int y, boolean active) {
        this.branchId = branchId;
        this.number = number;
        this.section = section;
        this.seats = seats;
        this.x = x;
        this.y = y;
        this.active = active;
    }

    public String getNumber() {
        return number;
    }

    public String getSection() {
        return section;
    }

    public int getSeats() {
        return seats;
    }

    public int getX() {
        return x;
    }

    public int getY() {
        return y;
    }

    public boolean isActive() {
        return active;
    }

    public void update(String number, String section, int seats, boolean active) {
        this.number = number;
        this.section = section;
        this.seats = seats;
        this.active = active;
    }

    public void moveTo(int x, int y) {
        this.x = x;
        this.y = y;
    }
}
