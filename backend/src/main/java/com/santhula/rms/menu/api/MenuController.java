package com.santhula.rms.menu.api;

import com.santhula.rms.api.generated.api.MenuApi;
import com.santhula.rms.api.generated.model.AvailabilityItem;
import com.santhula.rms.api.generated.model.Category;
import com.santhula.rms.api.generated.model.CreateCategoryRequest;
import com.santhula.rms.api.generated.model.CreateMenuItemRequest;
import com.santhula.rms.api.generated.model.CreateModifierGroupRequest;
import com.santhula.rms.api.generated.model.ItemAvailability;
import com.santhula.rms.api.generated.model.KitchenStation;
import com.santhula.rms.api.generated.model.KitchenStationOption;
import com.santhula.rms.api.generated.model.MenuItem;
import com.santhula.rms.api.generated.model.MenuItemPage;
import com.santhula.rms.api.generated.model.MenuItemSummary;
import com.santhula.rms.api.generated.model.ModifierGroup;
import com.santhula.rms.api.generated.model.ModifierGroupRef;
import com.santhula.rms.api.generated.model.ModifierOption;
import com.santhula.rms.api.generated.model.ModifierOptionInput;
import com.santhula.rms.api.generated.model.PosCategory;
import com.santhula.rms.api.generated.model.PosMenu;
import com.santhula.rms.api.generated.model.PosMenuItem;
import com.santhula.rms.api.generated.model.PosModifierGroup;
import com.santhula.rms.api.generated.model.PosModifierOption;
import com.santhula.rms.api.generated.model.SetItemAvailabilityRequest;
import com.santhula.rms.api.generated.model.UpdateCategoryRequest;
import com.santhula.rms.api.generated.model.UpdateKitchenStationRequest;
import com.santhula.rms.api.generated.model.UpdateMenuItemRequest;
import com.santhula.rms.api.generated.model.UpdateModifierGroupRequest;
import com.santhula.rms.menu.service.CategoryService;
import com.santhula.rms.menu.service.KitchenStationService;
import com.santhula.rms.menu.service.MenuItemService;
import com.santhula.rms.menu.service.ModifierGroupService;
import com.santhula.rms.menu.service.PosMenuService;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class MenuController implements MenuApi {

    private final KitchenStationService stations;
    private final CategoryService categories;
    private final MenuItemService items;
    private final ModifierGroupService groups;
    private final PosMenuService posMenu;

    public MenuController(KitchenStationService stations, CategoryService categories, MenuItemService items,
                          ModifierGroupService groups, PosMenuService posMenu) {
        this.stations = stations;
        this.categories = categories;
        this.items = items;
        this.groups = groups;
        this.posMenu = posMenu;
    }

    // ------------------------------------------------------------------ kitchen stations

    @Override
    @PreAuthorize("hasAuthority('MENU_MANAGE')")
    public ResponseEntity<List<KitchenStation>> listKitchenStations() {
        return ResponseEntity.ok(stations.list().stream().map(MenuController::station).toList());
    }

    @Override
    @PreAuthorize("hasAuthority('TERMINAL_MANAGE')")
    public ResponseEntity<List<KitchenStationOption>> listKitchenStationOptions() {
        return ResponseEntity.ok(stations.activeStations().stream().map(MenuController::stationOption).toList());
    }

    @Override
    @PreAuthorize("hasAuthority('MENU_MANAGE')")
    public ResponseEntity<KitchenStation> getKitchenStation(UUID stationId) {
        return ResponseEntity.ok(station(stations.get(stationId)));
    }

    @Override
    @PreAuthorize("hasAuthority('MENU_MANAGE')")
    public ResponseEntity<KitchenStation> updateKitchenStation(UUID stationId, UpdateKitchenStationRequest req) {
        return ResponseEntity.ok(station(stations.update(stationId, req.getName(), req.getTargetPrepMinutes(), req.getActive(), req.getVersion())));
    }

    // ------------------------------------------------------------------ categories

    @Override
    @PreAuthorize("hasAuthority('MENU_MANAGE')")
    public ResponseEntity<List<Category>> listCategories() {
        return ResponseEntity.ok(categories.list().stream().map(MenuController::category).toList());
    }

    @Override
    @PreAuthorize("hasAuthority('MENU_MANAGE')")
    public ResponseEntity<Category> createCategory(CreateCategoryRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(category(categories.create(req.getName(), req.getSortOrder(), req.getActive())));
    }

    @Override
    @PreAuthorize("hasAuthority('MENU_MANAGE')")
    public ResponseEntity<Category> getCategory(UUID categoryId) {
        return ResponseEntity.ok(category(categories.get(categoryId)));
    }

    @Override
    @PreAuthorize("hasAuthority('MENU_MANAGE')")
    public ResponseEntity<Category> updateCategory(UUID categoryId, UpdateCategoryRequest req) {
        return ResponseEntity.ok(category(categories.update(categoryId, req.getName(), req.getSortOrder(), req.getActive(), req.getVersion())));
    }

    // ------------------------------------------------------------------ menu items

    @Override
    @PreAuthorize("hasAuthority('MENU_MANAGE')")
    public ResponseEntity<MenuItemPage> listMenuItems(Integer page, Integer size, String sort, UUID categoryId, UUID stationId,
                                                      Boolean active, Boolean available, String search) {
        var result = items.list(new MenuItemService.ItemFilter(categoryId, stationId, active, available, search),
                page == null ? 0 : page, size == null ? 50 : size, sort);
        return ResponseEntity.ok(new MenuItemPage(result.page(), result.size(), result.total(),
                result.items().stream().map(MenuController::itemSummary).toList()));
    }

    @Override
    @PreAuthorize("hasAuthority('MENU_MANAGE')")
    public ResponseEntity<MenuItem> createMenuItem(CreateMenuItemRequest req) {
        var view = items.create(new MenuItemService.ItemData(req.getCode(), req.getName(), req.getCategoryId(), req.getStationId(),
                req.getLocalPrice(), req.getForeignPrice(), req.getActive(), ids(req.getModifierGroupIds())));
        return ResponseEntity.status(HttpStatus.CREATED).body(item(view));
    }

    @Override
    @PreAuthorize("hasAuthority('MENU_MANAGE')")
    public ResponseEntity<MenuItem> getMenuItem(UUID itemId) {
        return ResponseEntity.ok(item(items.get(itemId)));
    }

    @Override
    @PreAuthorize("hasAuthority('MENU_MANAGE')")
    public ResponseEntity<MenuItem> updateMenuItem(UUID itemId, UpdateMenuItemRequest req) {
        var view = items.update(itemId, new MenuItemService.ItemData(req.getCode(), req.getName(), req.getCategoryId(), req.getStationId(),
                req.getLocalPrice(), req.getForeignPrice(), req.getActive(), ids(req.getModifierGroupIds())), req.getVersion());
        return ResponseEntity.ok(item(view));
    }

    @Override
    @PreAuthorize("hasAuthority('MENU_AVAILABILITY')")
    public ResponseEntity<ItemAvailability> setMenuItemAvailability(UUID itemId, SetItemAvailabilityRequest req) {
        var row = items.setAvailability(itemId, req.getAvailable());
        return ResponseEntity.ok(new ItemAvailability(row.id(), row.code(), row.name(), row.available()));
    }

    @Override
    @PreAuthorize("hasAuthority('MENU_AVAILABILITY')")
    public ResponseEntity<List<AvailabilityItem>> listAvailabilityItems() {
        return ResponseEntity.ok(items.availabilityRows().stream()
                .map(r -> new AvailabilityItem(r.id(), r.code(), r.name(), r.categoryName(), r.available())).toList());
    }

    @Override
    @PreAuthorize("hasAuthority('ORDER_CREATE')")
    public ResponseEntity<PosMenu> getPosMenu() {
        var menu = posMenu.menu();
        return ResponseEntity.ok(new PosMenu(utc(menu.generatedAt()),
                menu.categories().stream().map(c -> new PosCategory(c.id(), c.name(), c.sortOrder(), c.items().stream().map(i ->
                        new PosMenuItem(i.id(), i.code(), i.name(), i.stationId(), i.localPrice(), i.available(), i.modifierGroupIds())
                                .foreignPrice(i.foreignPrice())).toList())).toList(),
                menu.modifierGroups().stream().map(g -> new PosModifierGroup(g.id(), g.name(), g.required(), g.minSelect(), g.maxSelect(),
                        g.options().stream().map(o -> new PosModifierOption(o.id(), o.name(), o.priceDelta())).toList())).toList(),
                menu.kitchenStations().stream().map(s -> new KitchenStationOption(s.id(), s.number(), s.name())).toList()));
    }

    // ------------------------------------------------------------------ modifier groups

    @Override
    @PreAuthorize("hasAuthority('MENU_MANAGE')")
    public ResponseEntity<List<ModifierGroup>> listModifierGroups() {
        return ResponseEntity.ok(groups.list().stream().map(MenuController::group).toList());
    }

    @Override
    @PreAuthorize("hasAuthority('MENU_MANAGE')")
    public ResponseEntity<ModifierGroup> createModifierGroup(CreateModifierGroupRequest req) {
        var view = groups.create(new ModifierGroupService.GroupData(req.getName(), req.getRequired(), req.getMinSelect(), req.getMaxSelect(),
                req.getActive() == null || req.getActive(), options(req.getOptions())));
        return ResponseEntity.status(HttpStatus.CREATED).body(group(view));
    }

    @Override
    @PreAuthorize("hasAuthority('MENU_MANAGE')")
    public ResponseEntity<ModifierGroup> getModifierGroup(UUID groupId) {
        return ResponseEntity.ok(group(groups.get(groupId)));
    }

    @Override
    @PreAuthorize("hasAuthority('MENU_MANAGE')")
    public ResponseEntity<ModifierGroup> updateModifierGroup(UUID groupId, UpdateModifierGroupRequest req) {
        var view = groups.update(groupId, new ModifierGroupService.GroupData(req.getName(), req.getRequired(), req.getMinSelect(),
                req.getMaxSelect(), req.getActive(), options(req.getOptions())), req.getVersion());
        return ResponseEntity.ok(group(view));
    }

    // ------------------------------------------------------------------ mapping

    private static KitchenStation station(KitchenStationService.StationView v) {
        var s = v.station();
        return new KitchenStation(s.getId(), s.getNumber(), s.getName(), s.getTargetPrepMinutes(), s.isActive(), (int) v.activeItemCount(),
                s.getVersion(), utc(s.getUpdatedAt()));
    }

    private static KitchenStationOption stationOption(KitchenStationService.StationInfo s) {
        return new KitchenStationOption(s.id(), s.number(), s.name());
    }

    private static Category category(CategoryService.CategoryView v) {
        var c = v.category();
        return new Category(c.getId(), c.getName(), c.getSortOrder(), c.isActive(), (int) v.itemCount(), c.getVersion(),
                utc(c.getCreatedAt()), utc(c.getUpdatedAt()));
    }

    private static MenuItemSummary itemSummary(MenuItemService.ItemView v) {
        var i = v.item();
        return new MenuItemSummary(i.getId(), i.getCode(), i.getName(), i.getCategoryId(), v.categoryName(), i.getStationId(), v.stationName(),
                i.localPrice(), i.isActive(), i.isAvailable(), v.groups().size(), i.getVersion()).foreignPrice(i.foreignPrice());
    }

    private static MenuItem item(MenuItemService.ItemView v) {
        var i = v.item();
        return new MenuItem(i.getId(), i.getCode(), i.getName(), i.getCategoryId(), v.categoryName(), i.getStationId(), v.stationName(),
                i.localPrice(), i.isActive(), i.isAvailable(), v.groups().stream().map(g -> new ModifierGroupRef(g.id(), g.name())).toList(),
                i.getVersion(), utc(i.getCreatedAt()), utc(i.getUpdatedAt())).foreignPrice(i.foreignPrice());
    }

    private static ModifierGroup group(ModifierGroupService.GroupView v) {
        var g = v.group();
        return new ModifierGroup(g.getId(), g.getName(), g.isRequired(), g.getMinSelect(), g.getMaxSelect(), g.isActive(),
                g.getOptions().stream().map(o -> new ModifierOption(o.getId(), o.getName(), o.getPriceDelta())).toList(),
                (int) v.itemCount(), g.getVersion(), utc(g.getCreatedAt()), utc(g.getUpdatedAt()));
    }

    private static List<ModifierGroupService.OptionData> options(List<ModifierOptionInput> in) {
        return in.stream().map(o -> new ModifierGroupService.OptionData(o.getId(), o.getName(), o.getPriceDelta())).toList();
    }

    private static List<UUID> ids(Collection<UUID> in) {
        return in == null ? List.of() : List.copyOf(in);
    }

    private static OffsetDateTime utc(Instant i) {
        return i.atOffset(ZoneOffset.UTC);
    }
}
