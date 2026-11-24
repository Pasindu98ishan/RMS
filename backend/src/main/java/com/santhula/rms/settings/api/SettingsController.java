package com.santhula.rms.settings.api;

import com.santhula.rms.api.generated.api.SettingsApi;
import com.santhula.rms.api.generated.model.BusinessDaySettings;
import com.santhula.rms.api.generated.model.CreateDeliveryAreaRequest;
import com.santhula.rms.api.generated.model.CreateReasonRequest;
import com.santhula.rms.api.generated.model.DeliveryArea;
import com.santhula.rms.api.generated.model.DeliveryAreaOption;
import com.santhula.rms.api.generated.model.MenuSettings;
import com.santhula.rms.api.generated.model.Reason;
import com.santhula.rms.api.generated.model.ReasonCategory;
import com.santhula.rms.api.generated.model.ReasonOption;
import com.santhula.rms.api.generated.model.UpdateDeliveryAreaRequest;
import com.santhula.rms.api.generated.model.UpdateMenuSettingsRequest;
import com.santhula.rms.api.generated.model.UpdateReasonRequest;
import com.santhula.rms.api.generated.model.IdleTimeoutRule;
import com.santhula.rms.api.generated.model.IdleTimeoutSettings;
import com.santhula.rms.api.generated.model.RestaurantDetails;
import com.santhula.rms.api.generated.model.ServiceChargeOrderType;
import com.santhula.rms.api.generated.model.ServiceChargeRule;
import com.santhula.rms.api.generated.model.ServiceChargeSettings;
import com.santhula.rms.api.generated.model.TaxSettings;
import com.santhula.rms.api.generated.model.TerminalType;
import com.santhula.rms.api.generated.model.UpdateBusinessDaySettingsRequest;
import com.santhula.rms.api.generated.model.UpdateIdleTimeoutSettingsRequest;
import com.santhula.rms.api.generated.model.UpdateRestaurantDetailsRequest;
import com.santhula.rms.api.generated.model.UpdateServiceChargeSettingsRequest;
import com.santhula.rms.api.generated.model.UpdateTaxSettingsRequest;
import com.santhula.rms.settings.service.DeliveryAreaService;
import com.santhula.rms.settings.service.ReasonService;
import com.santhula.rms.settings.service.SettingsService;
import com.santhula.rms.settings.service.SettingsService.Versioned;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class SettingsController implements SettingsApi {

    private final SettingsService service;
    private final DeliveryAreaService deliveryAreas;
    private final ReasonService reasons;

    public SettingsController(SettingsService service, DeliveryAreaService deliveryAreas, ReasonService reasons) {
        this.service = service;
        this.deliveryAreas = deliveryAreas;
        this.reasons = reasons;
    }

    @Override
    @PreAuthorize("hasAuthority('SETTINGS_MANAGE')")
    public ResponseEntity<RestaurantDetails> getRestaurantDetails() {
        return ResponseEntity.ok(restaurant());
    }

    @Override
    @PreAuthorize("hasAuthority('SETTINGS_MANAGE')")
    public ResponseEntity<RestaurantDetails> updateRestaurantDetails(UpdateRestaurantDetailsRequest req) {
        service.updateRestaurant(new SettingsService.RestaurantDetails(req.getName(), req.getAddress(), req.getPhone(),
                req.getReceiptFooter()), req.getVersion());
        return ResponseEntity.ok(restaurant());
    }

    @Override
    @PreAuthorize("hasAuthority('SETTINGS_MANAGE')")
    public ResponseEntity<ServiceChargeSettings> getServiceChargeSettings() {
        return ResponseEntity.ok(serviceCharges());
    }

    @Override
    @PreAuthorize("hasAuthority('SETTINGS_MANAGE')")
    public ResponseEntity<ServiceChargeSettings> updateServiceChargeSettings(UpdateServiceChargeSettingsRequest req) {
        service.updateServiceCharges(req.getRules().stream()
                .map(r -> new SettingsService.ServiceCharge(
                        com.santhula.rms.settings.domain.ServiceChargeOrderType.valueOf(r.getOrderType().getValue()), r.getRate()))
                .toList(), req.getVersion());
        return ResponseEntity.ok(serviceCharges());
    }

    @Override
    @PreAuthorize("hasAuthority('SETTINGS_MANAGE')")
    public ResponseEntity<TaxSettings> getTaxSettings() {
        return ResponseEntity.ok(tax());
    }

    @Override
    @PreAuthorize("hasAuthority('SETTINGS_MANAGE')")
    public ResponseEntity<TaxSettings> updateTaxSettings(UpdateTaxSettingsRequest req) {
        service.updateTax(new SettingsService.TaxSettings(Boolean.TRUE.equals(req.getEnabled()), req.getRate(), req.getLabel()),
                req.getVersion());
        return ResponseEntity.ok(tax());
    }

    @Override
    @PreAuthorize("hasAuthority('SETTINGS_MANAGE')")
    public ResponseEntity<BusinessDaySettings> getBusinessDaySettings() {
        return ResponseEntity.ok(businessDay());
    }

    @Override
    @PreAuthorize("hasAuthority('SETTINGS_MANAGE')")
    public ResponseEntity<BusinessDaySettings> updateBusinessDaySettings(UpdateBusinessDaySettingsRequest req) {
        service.updateBusinessDay(req.getDayStartTime(), req.getVersion());
        return ResponseEntity.ok(businessDay());
    }

    @Override
    @PreAuthorize("hasAuthority('SETTINGS_MANAGE')")
    public ResponseEntity<IdleTimeoutSettings> getIdleTimeoutSettings() {
        return ResponseEntity.ok(idleTimeouts());
    }

    @Override
    @PreAuthorize("hasAuthority('SETTINGS_MANAGE')")
    public ResponseEntity<IdleTimeoutSettings> updateIdleTimeoutSettings(UpdateIdleTimeoutSettingsRequest req) {
        service.updateIdleTimeouts(req.getRules().stream()
                .map(r -> new SettingsService.IdleTimeout(
                        com.santhula.rms.common.domain.TerminalType.valueOf(r.getTerminalType().getValue()), r.getIdleTimeoutMinutes()))
                .toList(), req.getIdleTimeoutPersonalMinutes(), req.getVersion());
        return ResponseEntity.ok(idleTimeouts());
    }

    // ------------------------------------------------------------------ mapping

    private RestaurantDetails restaurant() {
        Versioned<SettingsService.RestaurantDetails> v = service.restaurant();
        return new RestaurantDetails(v.value().name(), v.value().address(), v.value().phone(), v.version(), utc(v.updatedAt()))
                .receiptFooter(v.value().receiptFooter());
    }

    private ServiceChargeSettings serviceCharges() {
        Versioned<List<SettingsService.ServiceCharge>> v = service.serviceCharges();
        return new ServiceChargeSettings(
                v.value().stream().map(c -> new ServiceChargeRule(ServiceChargeOrderType.fromValue(c.orderType().name()), c.rate())).toList(),
                v.version(), utc(v.updatedAt()));
    }

    private TaxSettings tax() {
        Versioned<SettingsService.TaxSettings> v = service.tax();
        return new TaxSettings(v.value().enabled(), v.value().rate(), v.version(), utc(v.updatedAt())).label(v.value().label());
    }

    private BusinessDaySettings businessDay() {
        Versioned<SettingsService.BusinessDay> v = service.businessDay();
        return new BusinessDaySettings(v.value().dayStartTime(), v.value().timeZone().getId(), v.version(), utc(v.updatedAt()));
    }

    private IdleTimeoutSettings idleTimeouts() {
        Versioned<List<SettingsService.IdleTimeout>> v = service.idleTimeouts();
        return new IdleTimeoutSettings(v.value().stream()
                .map(t -> new IdleTimeoutRule(TerminalType.fromValue(t.terminalType().name()), t.exempt()).idleTimeoutMinutes(t.minutes()))
                .toList(), service.personalIdleTimeoutMinutes(), v.version(), utc(v.updatedAt()));
    }

    private static OffsetDateTime utc(Instant i) {
        return i.atOffset(ZoneOffset.UTC);
    }

    // ------------------------------------------------------------------ M1.1: delivery areas

    @Override
    @PreAuthorize("hasAuthority('SETTINGS_MANAGE')")
    public ResponseEntity<List<DeliveryArea>> listDeliveryAreas() {
        return ResponseEntity.ok(deliveryAreas.list().stream().map(SettingsController::area).toList());
    }

    @Override
    @PreAuthorize("hasAuthority('SETTINGS_MANAGE')")
    public ResponseEntity<DeliveryArea> createDeliveryArea(CreateDeliveryAreaRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(area(deliveryAreas.create(req.getName(), req.getFee(), req.getActive())));
    }

    @Override
    @PreAuthorize("hasAuthority('ORDER_CREATE')")
    public ResponseEntity<List<DeliveryAreaOption>> listDeliveryAreaOptions() {
        return ResponseEntity.ok(deliveryAreas.activeAreas().stream().map(a -> new DeliveryAreaOption(a.getId(), a.getName(), a.getFee())).toList());
    }

    @Override
    @PreAuthorize("hasAuthority('SETTINGS_MANAGE')")
    public ResponseEntity<DeliveryArea> getDeliveryArea(UUID areaId) {
        return ResponseEntity.ok(area(deliveryAreas.get(areaId)));
    }

    @Override
    @PreAuthorize("hasAuthority('SETTINGS_MANAGE')")
    public ResponseEntity<DeliveryArea> updateDeliveryArea(UUID areaId, UpdateDeliveryAreaRequest req) {
        return ResponseEntity.ok(area(deliveryAreas.update(areaId, req.getName(), req.getFee(), req.getActive(), req.getVersion())));
    }

    // ------------------------------------------------------------------ M1.1: reasons

    @Override
    @PreAuthorize("hasAuthority('SETTINGS_MANAGE')")
    public ResponseEntity<List<Reason>> listReasons(ReasonCategory category) {
        return ResponseEntity.ok(reasons.list(domainCategory(category)).stream().map(SettingsController::reason).toList());
    }

    @Override
    @PreAuthorize("hasAuthority('SETTINGS_MANAGE')")
    public ResponseEntity<Reason> createReason(CreateReasonRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(reason(reasons.create(domainCategory(req.getCategory()), req.getText(), req.getActive())));
    }

    @Override
    @PreAuthorize("hasAuthority('ORDER_VIEW')")
    public ResponseEntity<List<ReasonOption>> listReasonOptions(ReasonCategory category) {
        return ResponseEntity.ok(reasons.activeReasons(domainCategory(category)).stream().map(r -> new ReasonOption(r.getId(), r.getText())).toList());
    }

    @Override
    @PreAuthorize("hasAuthority('SETTINGS_MANAGE')")
    public ResponseEntity<Reason> updateReason(UUID reasonId, UpdateReasonRequest req) {
        return ResponseEntity.ok(reason(reasons.update(reasonId, req.getText(), req.getActive(), req.getVersion())));
    }

    // ------------------------------------------------------------------ M1.1: menu setting

    @Override
    @PreAuthorize("hasAuthority('SETTINGS_MANAGE')")
    public ResponseEntity<MenuSettings> getMenuSettings() {
        return ResponseEntity.ok(menuSettings());
    }

    @Override
    @PreAuthorize("hasAuthority('SETTINGS_MANAGE')")
    public ResponseEntity<MenuSettings> updateMenuSettings(UpdateMenuSettingsRequest req) {
        service.updateMenuSettings(req.getResetAvailabilityDaily(), req.getVersion());
        return ResponseEntity.ok(menuSettings());
    }

    private MenuSettings menuSettings() {
        Versioned<SettingsService.MenuBehaviour> v = service.menuSettings();
        return new MenuSettings(v.value().resetAvailabilityDaily(), v.version(), utc(v.updatedAt()));
    }

    private static DeliveryArea area(com.santhula.rms.settings.domain.DeliveryArea a) {
        return new DeliveryArea(a.getId(), a.getName(), a.getFee(), a.isActive(), a.getVersion(),
                utc(a.getCreatedAt()), utc(a.getUpdatedAt()));
    }

    private static Reason reason(com.santhula.rms.settings.domain.Reason r) {
        return new Reason(r.getId(), ReasonCategory.fromValue(r.getCategory().name()), r.getText(), r.isActive(), r.getVersion(),
                utc(r.getCreatedAt()), utc(r.getUpdatedAt()));
    }

    private static com.santhula.rms.settings.domain.ReasonCategory domainCategory(ReasonCategory c) {
        return c == null ? null : com.santhula.rms.settings.domain.ReasonCategory.valueOf(c.getValue());
    }
}
