package com.santhula.rms.auth.domain;

import com.santhula.rms.common.domain.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.JoinTable;
import jakarta.persistence.ManyToMany;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.hibernate.annotations.BatchSize;
import org.hibernate.annotations.DynamicUpdate;

@Entity
@DynamicUpdate // only changed columns are written, so a stale counter is never written back
@Table(name = "app_user")
public class AppUser extends BaseEntity {

    @Column(name = "branch_id", nullable = false)
    private UUID branchId;
    @Column(nullable = false)
    private String username;
    @Column(name = "password_hash", nullable = false)
    private String passwordHash;
    @Column(name = "pin_hash")
    private String pinHash;
    @Column(name = "full_name", nullable = false)
    private String fullName;
    private String phone;
    @Column(nullable = false)
    private boolean active = true;
    @Column(name = "failed_attempts", nullable = false)
    private int failedAttempts;
    @Column(name = "locked_until")
    private Instant lockedUntil;
    @Column(name = "pin_failed_attempts", nullable = false)
    private int pinFailedAttempts;
    @Column(name = "pin_locked_until")
    private Instant pinLockedUntil;
    @Column(name = "last_login_at")
    private Instant lastLoginAt;

    @ManyToMany(fetch = FetchType.EAGER)
    @JoinTable(name = "user_role",
            joinColumns = @JoinColumn(name = "user_id"),
            inverseJoinColumns = @JoinColumn(name = "role_id"))
    @BatchSize(size = 50)
    private Set<Role> roles = new HashSet<>();

    protected AppUser() {
    }

    public AppUser(UUID branchId, String username, String passwordHash, String fullName, String phone) {
        this.branchId = branchId;
        this.username = username;
        this.passwordHash = passwordHash;
        this.fullName = fullName;
        this.phone = phone;
    }

    public String getUsername() {
        return username;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public String getPinHash() {
        return pinHash;
    }

    public boolean hasPin() {
        return pinHash != null;
    }

    public String getFullName() {
        return fullName;
    }

    public String getPhone() {
        return phone;
    }

    public boolean isActive() {
        return active;
    }

    public int getFailedAttempts() {
        return failedAttempts;
    }

    public Instant getLockedUntil() {
        return lockedUntil;
    }

    public boolean isLocked(Instant now) {
        return lockedUntil != null && lockedUntil.isAfter(now);
    }

    public int getPinFailedAttempts() {
        return pinFailedAttempts;
    }

    public Instant getPinLockedUntil() {
        return pinLockedUntil;
    }

    public boolean isPinLocked(Instant now) {
        return pinLockedUntil != null && pinLockedUntil.isAfter(now);
    }

    public Instant getLastLoginAt() {
        return lastLoginAt;
    }

    public Set<Role> getRoles() {
        return roles;
    }

    public List<Role> sortedRoles() {
        return roles.stream().sorted(Comparator.comparing(Role::getName, String.CASE_INSENSITIVE_ORDER)).toList();
    }

    public boolean isOwner() {
        return roles.stream().anyMatch(Role::isOwnerRole);
    }

    // ------------------------------------------------------------------ changes

    public void updateDetails(String fullName, String phone) {
        this.fullName = fullName;
        this.phone = phone;
    }

    public void changePasswordHash(String hash) {
        this.passwordHash = hash;
    }

    public void changePinHash(String hash) {
        this.pinHash = hash;
        this.pinFailedAttempts = 0;
        this.pinLockedUntil = null;
    }

    public void setActive(boolean active) {
        this.active = active;
    }

    /**
     * Sets the PIN counter and lock directly on the entity. FOR TESTS ONLY: production code counts
     * wrong passwords and PINs with AuthAttemptsRepository (atomic SQL), never through the entity,
     * because read-modify-write loses increments under concurrency (BUG-1-002).
     */
    public void recordPinFailure(int attempts, Instant lockedUntil) {
        this.pinFailedAttempts = attempts;
        this.pinLockedUntil = lockedUntil;
    }

    /** Clears the counters on the entity. Used by the admin "unlock" and password reset (real edits, versioned). */
    public void clearPasswordFailures() {
        if (failedAttempts != 0 || lockedUntil != null) {
            failedAttempts = 0;
            lockedUntil = null;
        }
    }

    public void clearPinFailures() {
        if (pinFailedAttempts != 0 || pinLockedUntil != null) {
            pinFailedAttempts = 0;
            pinLockedUntil = null;
        }
    }

    public void unlock() {
        clearPasswordFailures();
        clearPinFailures();
    }

    public void replaceRoles(Set<Role> newRoles) {
        roles.clear();
        roles.addAll(newRoles);
    }
}
