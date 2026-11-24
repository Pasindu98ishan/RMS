import type { Locator } from '@playwright/test';
import { BasePage } from '../shared';
import { TID } from '../testids';

/** /admin/users — users incl. PIN reset and unlock (P1-RBAC-02, P1-AUTH-01, P1-AUTH-05). */
export class AdminUsersPage extends BasePage {
  readonly table = this.tid(TID.users.table);
  readonly createButton = this.tid(TID.users.create);

  async goto(): Promise<void> {
    await this.page.goto('/admin/users');
  }
  row(username: string): Locator {
    return this.tid(TID.users.row(username));
  }
  lockedBadge(username: string): Locator {
    return this.tid(TID.users.lockedBadge(username));
  }
  async unlock(username: string): Promise<void> {
    await this.tid(TID.users.unlock(username)).click();
  }
  async resetPin(username: string, newPin: string): Promise<void> {
    await this.tid(TID.users.resetPin(username)).click();
    await this.tid(TID.users.pin).fill(newPin);
    await this.tid(TID.users.save).click();
  }
  async create(u: { username: string; fullName: string; password: string; pin: string; role: string }): Promise<void> {
    await this.createButton.click();
    await this.tid(TID.users.username).fill(u.username);
    await this.tid(TID.users.fullName).fill(u.fullName);
    await this.tid(TID.users.password).fill(u.password);
    await this.tid(TID.users.pin).fill(u.pin);
    await this.tid(TID.users.roles).click();
    await this.page.getByRole('option', { name: u.role }).click();
    await this.tid(TID.users.save).click();
  }
}

/** /admin/roles — role & permission editor (P1-RBAC-01/02). */
export class AdminRolesPage extends BasePage {
  readonly list = this.tid(TID.roles.list);
  readonly createButton = this.tid(TID.roles.create);
  readonly nameInput = this.tid(TID.roles.name);
  readonly saveButton = this.tid(TID.roles.save);
  readonly deleteButton = this.tid(TID.roles.delete);

  async goto(): Promise<void> {
    await this.page.goto('/admin/roles');
  }
  row(name: string): Locator {
    return this.tid(TID.roles.row(name));
  }
  permission(code: string): Locator {
    return this.tid(TID.roles.permission(code));
  }
  async createRole(name: string, codes: string[]): Promise<void> {
    await this.createButton.click();
    await this.nameInput.fill(name);
    for (const c of codes) await this.permission(c).check();
    await this.saveButton.click();
  }
}

/** /admin/terminals (P1-AUTH-04). */
export class AdminTerminalsPage extends BasePage {
  readonly table = this.tid(TID.terminals.table);
  async goto(): Promise<void> {
    await this.page.goto('/admin/terminals');
  }
  row(name: string): Locator {
    return this.tid(TID.terminals.row(name));
  }
  async deactivate(name: string): Promise<void> {
    await this.tid(TID.terminals.deactivate(name)).click();
  }
}

/** /admin/settings (P1-SET-01..04, idle timeouts) and /admin/kitchens target times (P1-SET-05). */
export class AdminSettingsPage extends BasePage {
  readonly restaurantName = this.tid(TID.settings.restaurantName);
  readonly restaurantAddress = this.tid(TID.settings.restaurantAddress);
  readonly restaurantPhone = this.tid(TID.settings.restaurantPhone);
  readonly receiptFooter = this.tid(TID.settings.receiptFooter);
  readonly taxEnabled = this.tid(TID.settings.taxEnabled);
  readonly taxRate = this.tid(TID.settings.taxRate);
  readonly businessDayStart = this.tid(TID.settings.businessDayStart);
  readonly saveButton = this.tid(TID.settings.save);

  async goto(): Promise<void> {
    await this.page.goto('/admin/settings');
  }
  serviceCharge(orderType: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY'): Locator {
    return this.tid(TID.settings.serviceCharge(orderType));
  }
  idleTimeout(terminalType: string): Locator {
    return this.tid(TID.settings.idleTimeout(terminalType));
  }
  stationTarget(station: string): Locator {
    return this.tid(TID.settings.stationTarget(station));
  }
  fieldError(field: string): Locator {
    return this.tid(TID.settings.fieldError(field));
  }
  async save(): Promise<void> {
    await this.saveButton.click();
  }
}

/** /admin/audit — audit log search + export (P1-AUD-03). */
export class AdminAuditPage extends BasePage {
  readonly from = this.tid(TID.audit.from);
  readonly to = this.tid(TID.audit.to);
  readonly user = this.tid(TID.audit.user);
  readonly action = this.tid(TID.audit.action);
  readonly entity = this.tid(TID.audit.entity);
  readonly searchButton = this.tid(TID.audit.search);
  readonly table = this.tid(TID.audit.table);
  readonly rows = this.tid(TID.audit.row);
  readonly times = this.tid(TID.audit.time);
  readonly exportButton = this.tid(TID.audit.export);
  readonly nextPage = this.tid(TID.audit.nextPage);

  async goto(): Promise<void> {
    await this.page.goto('/admin/audit');
  }
  async search(f: { from?: string; to?: string; user?: string; action?: string; entity?: string }): Promise<void> {
    if (f.from) await this.from.fill(f.from);
    if (f.to) await this.to.fill(f.to);
    if (f.user) await this.user.fill(f.user);
    if (f.action) await this.action.fill(f.action);
    if (f.entity) await this.entity.fill(f.entity);
    await this.searchButton.click();
  }
}
