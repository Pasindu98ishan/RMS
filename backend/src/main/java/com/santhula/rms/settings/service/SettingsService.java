package com.santhula.rms.settings.service;

import com.santhula.rms.audit.service.AuditAction;
import com.santhula.rms.audit.service.AuditRecord;
import com.santhula.rms.audit.service.AuditService;
import com.santhula.rms.common.config.RmsProperties;
import com.santhula.rms.common.domain.TerminalType;
import com.santhula.rms.common.error.ApiException;
import com.santhula.rms.common.error.ApiException.FieldViolation;
import com.santhula.rms.common.security.CurrentActor;
import com.santhula.rms.settings.domain.ServiceChargeOrderType;
import com.santhula.rms.settings.domain.ServiceChargeRule;
import com.santhula.rms.settings.domain.SettingEntry;
import com.santhula.rms.settings.repo.ServiceChargeRuleRepository;
import com.santhula.rms.settings.repo.SettingRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Restaurant details, service charge, tax, business day and idle timeouts (P1-SET-01..04,
 * P1-AUTH-03). Every change writes SETTINGS_CHANGED with before/after values.
 */
@Service
public class SettingsService {

    private static final BigDecimal HUNDRED = new BigDecimal("100");
    private static final Set<TerminalType> IDLE_CONFIGURABLE =
            EnumSet.of(TerminalType.CASHIER_POS, TerminalType.RECEPTION_POS, TerminalType.ADMIN);
    private static final Map<TerminalType, Integer> IDLE_DEFAULTS =
            Map.of(TerminalType.CASHIER_POS, 10, TerminalType.RECEPTION_POS, 10, TerminalType.ADMIN, 30);
    /** Key of the personal-session idle timeout inside the idle_timeouts setting (ADR-008). */
    static final String PERSONAL = "PERSONAL";
    static final int PERSONAL_DEFAULT = 30;

    private final SettingRepository settings;
    private final ServiceChargeRuleRepository serviceCharges;
    private final AuditService audit;
    private final RmsProperties properties;
    private final Clock clock;

    public SettingsService(SettingRepository settings, ServiceChargeRuleRepository serviceCharges, AuditService audit,
                           RmsProperties properties, Clock clock) {
        this.settings = settings;
        this.serviceCharges = serviceCharges;
        this.audit = audit;
        this.properties = properties;
        this.clock = clock;
    }

    // ------------------------------------------------------------------ views

    public record Versioned<T>(T value, int version, Instant updatedAt) {
    }

    public record RestaurantDetails(String name, String address, String phone, String receiptFooter) {
    }

    public record TaxSettings(boolean enabled, BigDecimal rate, String label) {
    }

    public record BusinessDay(String dayStartTime, ZoneId timeZone) {
    }

    public record IdleTimeout(TerminalType terminalType, Integer minutes) {
        public boolean exempt() {
            return terminalType.isIdleExempt();
        }
    }

    public record ServiceCharge(ServiceChargeOrderType orderType, BigDecimal rate) {
    }

    public record MenuBehaviour(boolean resetAvailabilityDaily) {
    }

    // ------------------------------------------------------------------ restaurant

    @Transactional(readOnly = true)
    public Versioned<RestaurantDetails> restaurant() {
        SettingEntry e = entry(SettingEntry.RESTAURANT);
        return versioned(e, toRestaurant(e.getValue()));
    }

    @Transactional
    public void updateRestaurant(RestaurantDetails details, int expectedVersion) {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("name", details.name().trim());
        value.put("address", details.address().trim());
        value.put("phone", details.phone().trim());
        if (details.receiptFooter() != null) {
            value.put("receiptFooter", details.receiptFooter());
        }
        replace(SettingEntry.RESTAURANT, value, expectedVersion, "restaurant details");
    }

    // ------------------------------------------------------------------ tax

    @Transactional(readOnly = true)
    public Versioned<TaxSettings> tax() {
        SettingEntry e = entry(SettingEntry.TAX);
        Map<String, Object> v = e.getValue();
        return versioned(e, new TaxSettings(Boolean.TRUE.equals(v.get("enabled")),
                rate(v.get("rate")), (String) v.get("label")));
    }

    @Transactional
    public void updateTax(TaxSettings tax, int expectedVersion) {
        BigDecimal rate = checkRate(tax.rate(), "rate");
        if (tax.enabled()) {
            throw ApiException.conflict("TAX_NOT_SUPPORTED", "Tax cannot be turned on yet",
                    "Tax is switched off for this restaurant. Turning it on needs a system update first.");
        }
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("enabled", false);
        value.put("rate", rate.toPlainString());
        if (tax.label() != null) {
            value.put("label", tax.label());
        }
        replace(SettingEntry.TAX, value, expectedVersion, "tax setting");
    }

    // ------------------------------------------------------------------ business day

    @Transactional(readOnly = true)
    public Versioned<BusinessDay> businessDay() {
        SettingEntry e = entry(SettingEntry.BUSINESS_DAY);
        return versioned(e, new BusinessDay((String) e.getValue().get("dayStartTime"), properties.timeZone()));
    }

    @Transactional
    public void updateBusinessDay(String dayStartTime, int expectedVersion) {
        replace(SettingEntry.BUSINESS_DAY, Map.of("dayStartTime", dayStartTime), expectedVersion, "business day setting");
    }

    // ------------------------------------------------------------------ idle timeouts

    @Transactional(readOnly = true)
    public Versioned<List<IdleTimeout>> idleTimeouts() {
        SettingEntry e = entry(SettingEntry.IDLE_TIMEOUTS);
        List<IdleTimeout> list = new ArrayList<>();
        for (TerminalType t : TerminalType.values()) {
            list.add(new IdleTimeout(t, t.isIdleExempt() ? null : minutes(e.getValue(), t)));
        }
        return versioned(e, list);
    }

    /** Idle logout for a terminal type; empty for KITCHEN and DISPLAY (never logged out). */
    @Transactional(readOnly = true)
    public Optional<Integer> idleTimeoutMinutes(TerminalType type) {
        if (type.isIdleExempt()) {
            return Optional.empty();
        }
        return Optional.of(minutes(entry(SettingEntry.IDLE_TIMEOUTS).getValue(), type));
    }

    /** Idle logout of a personal session (logged in without a terminal, ADR-008); default 30 min. */
    @Transactional(readOnly = true)
    public int personalIdleTimeoutMinutes() {
        Object m = entry(SettingEntry.IDLE_TIMEOUTS).getValue().get(PERSONAL);
        return m instanceof Number n ? n.intValue() : PERSONAL_DEFAULT;
    }

    @Transactional
    public void updateIdleTimeouts(List<IdleTimeout> rules, int expectedVersion) {
        updateIdleTimeouts(rules, null, expectedVersion);
    }

    /** {@code personalMinutes} null keeps the current personal-session timeout. */
    @Transactional
    public void updateIdleTimeouts(List<IdleTimeout> rules, Integer personalMinutes, int expectedVersion) {
        List<FieldViolation> errors = new ArrayList<>();
        Map<TerminalType, Integer> byType = new EnumMap<>(TerminalType.class);
        for (int i = 0; i < rules.size(); i++) {
            IdleTimeout r = rules.get(i);
            if (r.terminalType().isIdleExempt()) {
                errors.add(new FieldViolation("rules[" + i + "].terminalType",
                        "Kitchen and display terminals are never logged out for idleness"));
            } else if (byType.put(r.terminalType(), r.minutes()) != null) {
                errors.add(new FieldViolation("rules[" + i + "].terminalType", "Each terminal type can appear only once"));
            }
        }
        if (errors.isEmpty() && !byType.keySet().equals(IDLE_CONFIGURABLE)) {
            errors.add(new FieldViolation("rules", "Send one rule each for cashier POS, reception POS and admin"));
        }
        if (!errors.isEmpty()) {
            throw ApiException.validation(errors);
        }
        Map<String, Object> value = new LinkedHashMap<>();
        byType.forEach((k, v) -> value.put(k.name(), v));
        value.put(PERSONAL, personalMinutes != null ? personalMinutes : personalIdleTimeoutMinutes());
        replace(SettingEntry.IDLE_TIMEOUTS, value, expectedVersion, "idle timeout setting");
    }

    // ------------------------------------------------------------------ service charges

    @Transactional(readOnly = true)
    public Versioned<List<ServiceCharge>> serviceCharges() {
        List<ServiceChargeRule> rows = serviceCharges.findByBranchId(properties.branchId()).stream()
                .sorted(Comparator.comparing(ServiceChargeRule::getOrderType))
                .toList();
        int version = rows.stream().mapToInt(ServiceChargeRule::getVersion).max().orElse(0);
        Instant updatedAt = rows.stream().map(ServiceChargeRule::getUpdatedAt).max(Comparator.naturalOrder()).orElse(Instant.EPOCH);
        return new Versioned<>(rows.stream().map(r -> new ServiceCharge(r.getOrderType(), scale(r.getRate()))).toList(),
                version, updatedAt);
    }

    /** Service charge rate copied onto new orders (ADR-002). */
    @Transactional(readOnly = true)
    public BigDecimal serviceChargeRate(ServiceChargeOrderType type) {
        return serviceCharges.findByBranchId(properties.branchId()).stream()
                .filter(r -> r.getOrderType() == type)
                .map(r -> scale(r.getRate()))
                .findFirst()
                .orElse(BigDecimal.ZERO.setScale(2));
    }

    @Transactional
    public void updateServiceCharges(List<ServiceCharge> rules, int expectedVersion) {
        List<FieldViolation> errors = new ArrayList<>();
        Map<ServiceChargeOrderType, BigDecimal> byType = new EnumMap<>(ServiceChargeOrderType.class);
        for (int i = 0; i < rules.size(); i++) {
            ServiceCharge r = rules.get(i);
            try {
                BigDecimal rate = checkRate(r.rate(), "rules[" + i + "].rate");
                if (byType.put(r.orderType(), rate) != null) {
                    errors.add(new FieldViolation("rules[" + i + "].orderType", "Each order type can appear only once"));
                }
            } catch (ApiException e) {
                errors.addAll(e.getFieldErrors());
            }
        }
        if (errors.isEmpty() && byType.size() != ServiceChargeOrderType.values().length) {
            errors.add(new FieldViolation("rules", "Send one rate each for dine-in, takeaway and delivery"));
        }
        if (!errors.isEmpty()) {
            throw ApiException.validation(errors);
        }

        Versioned<List<ServiceCharge>> before = serviceCharges();
        if (before.version() != expectedVersion) {
            throw ApiException.versionConflict("service charge setting");
        }
        Instant now = Instant.now(clock);
        var userId = CurrentActor.current().map(CurrentActor::userId).orElse(null);
        for (ServiceChargeRule row : serviceCharges.findByBranchId(properties.branchId())) {
            int updated = serviceCharges.updateRate(row.getId(), byType.get(row.getOrderType()), expectedVersion, now, userId);
            if (updated != 1) {
                throw ApiException.versionConflict("service charge setting");
            }
        }
        audit.record(AuditRecord.of(AuditAction.SETTINGS_CHANGED, "SERVICE_CHARGE_RULE", null)
                .before(chargeMap(before.value()))
                .after(chargeMap(byType.entrySet().stream().map(e -> new ServiceCharge(e.getKey(), e.getValue())).toList()))
                .build());
    }

    // ------------------------------------------------------------------ menu setting + business date (M1.1)

    @Transactional(readOnly = true)
    public Versioned<MenuBehaviour> menuSettings() {
        SettingEntry e = entry(SettingEntry.MENU);
        return versioned(e, new MenuBehaviour(!Boolean.FALSE.equals(e.getValue().get("resetAvailabilityDaily"))));
    }

    @Transactional
    public void updateMenuSettings(boolean resetAvailabilityDaily, int expectedVersion) {
        replace(SettingEntry.MENU, Map.of("resetAvailabilityDaily", resetAvailabilityDaily), expectedVersion, "menu setting");
    }

    /**
     * The current business date: the calendar date in the branch time zone, but before the business-day
     * start time (default 06:00) it is still the previous day (P1-SET-04).
     */
    @Transactional(readOnly = true)
    public LocalDate currentBusinessDate() {
        ZonedDateTime now = Instant.now(clock).atZone(properties.timeZone());
        LocalTime start = LocalTime.parse((String) entry(SettingEntry.BUSINESS_DAY).getValue().get("dayStartTime"));
        return now.toLocalTime().isBefore(start) ? now.toLocalDate().minusDays(1) : now.toLocalDate();
    }

    @Transactional(readOnly = true)
    public Optional<LocalDate> lastAvailabilityReset() {
        return settings.findByBranchIdAndKey(properties.branchId(), SettingEntry.AVAILABILITY_RESET)
                .map(e -> LocalDate.parse((String) e.getValue().get("date")));
    }

    @Transactional
    public void markAvailabilityReset(LocalDate businessDate) {
        Map<String, Object> value = Map.of("date", businessDate.toString());
        SettingEntry e = settings.findByBranchIdAndKey(properties.branchId(), SettingEntry.AVAILABILITY_RESET).orElse(null);
        if (e == null) {
            settings.saveAndFlush(new SettingEntry(properties.branchId(), SettingEntry.AVAILABILITY_RESET, value));
        } else {
            e.replaceValue(value);
            settings.saveAndFlush(e);
        }
    }

    // ------------------------------------------------------------------ helpers

    private SettingEntry entry(String key) {
        return settings.findByBranchIdAndKey(properties.branchId(), key)
                .orElseThrow(() -> new IllegalStateException("Setting '" + key + "' is missing; check the V2 seed migration"));
    }

    private void replace(String key, Map<String, Object> value, int expectedVersion, String what) {
        SettingEntry e = entry(key);
        if (e.getVersion() != expectedVersion) {
            throw ApiException.versionConflict(what);
        }
        Map<String, Object> before = new LinkedHashMap<>(e.getValue());
        e.replaceValue(value);
        settings.saveAndFlush(e);
        audit.record(AuditRecord.of(AuditAction.SETTINGS_CHANGED, "SETTING", key).before(before).after(value).build());
    }

    private static <T> Versioned<T> versioned(SettingEntry e, T value) {
        return new Versioned<>(value, e.getVersion(), e.getUpdatedAt());
    }

    private static RestaurantDetails toRestaurant(Map<String, Object> v) {
        return new RestaurantDetails((String) v.get("name"), (String) v.get("address"),
                (String) v.getOrDefault("phone", ""), (String) v.get("receiptFooter"));
    }

    private static int minutes(Map<String, Object> v, TerminalType t) {
        Object m = v.get(t.name());
        return m instanceof Number n ? n.intValue() : IDLE_DEFAULTS.get(t);
    }

    private static Map<String, Object> chargeMap(List<ServiceCharge> list) {
        Map<String, Object> m = new LinkedHashMap<>();
        list.stream().sorted(Comparator.comparing(ServiceCharge::orderType))
                .forEach(c -> m.put(c.orderType().name(), c.rate().toPlainString()));
        return m;
    }

    private static BigDecimal rate(Object raw) {
        return raw == null ? BigDecimal.ZERO.setScale(2) : scale(new BigDecimal(raw.toString()));
    }

    private static BigDecimal scale(BigDecimal v) {
        return v.setScale(2, RoundingMode.UNNECESSARY);
    }

    /** Rates are percentages 0.00-100.00 with at most 2 decimals. */
    static BigDecimal checkRate(BigDecimal rate, String field) {
        if (rate == null) {
            throw ApiException.validation(field, "Rate is required");
        }
        if (rate.signum() < 0 || rate.compareTo(HUNDRED) > 0) {
            throw ApiException.validation(field, "Rate must be between 0.00 and 100.00");
        }
        if (rate.stripTrailingZeros().scale() > 2) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, "VALIDATION_FAILED", "Please check the highlighted fields",
                    "Some fields are missing or invalid.", List.of(new FieldViolation(field, "Rate can have at most 2 decimals")));
        }
        return rate.setScale(2, RoundingMode.UNNECESSARY);
    }
}
