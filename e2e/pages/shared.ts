import type { Locator, Page } from '@playwright/test';
import { TID } from './testids';

export abstract class BasePage {
  constructor(readonly page: Page) {}
  protected tid(id: string): Locator {
    return this.page.getByTestId(id);
  }
}

/** /login (P1-AUTH-01). */
export class LoginPage extends BasePage {
  readonly username = this.tid(TID.login.username);
  readonly password = this.tid(TID.login.password);
  readonly submit = this.tid(TID.login.submit);
  readonly error = this.tid(TID.login.error);

  async goto(): Promise<void> {
    await this.page.goto('/login');
  }

  async login(username: string, password: string): Promise<void> {
    await this.username.fill(username);
    await this.password.fill(password);
    await this.submit.click();
  }
}

/** /setup/terminal (P1-AUTH-04). After a successful registration the page shows "Device registered" and "Go to login". */
export class TerminalSetupPage extends BasePage {
  readonly ownerUsername = this.tid(TID.terminalSetup.ownerUsername);
  readonly ownerPassword = this.tid(TID.terminalSetup.ownerPassword);
  readonly name = this.tid(TID.terminalSetup.name);
  readonly type = this.tid(TID.terminalSetup.type);
  readonly station = this.tid(TID.terminalSetup.station);
  readonly submit = this.tid(TID.terminalSetup.submit);
  readonly registered = this.tid(TID.terminalSetup.registered);
  readonly gotoLogin = this.tid(TID.terminalSetup.gotoLogin);
  readonly current = this.tid(TID.terminalSetup.current);
  readonly error = this.tid(TID.terminalSetup.error);

  async goto(): Promise<void> {
    await this.page.goto('/setup/terminal');
  }

  /** `typeLabel` is the label shown in the "Used as" select, e.g. "Cashier POS", "Admin". */
  async register(owner: { username: string; password: string }, name: string, typeLabel: string): Promise<void> {
    await this.ownerUsername.fill(owner.username);
    await this.ownerPassword.fill(owner.password);
    await this.name.fill(name);
    await this.type.click();
    await this.page.getByRole('option', { name: typeLabel, exact: true }).click();
    await this.submit.click();
  }
}

/** Layout chrome shared by POS / Admin / Kitchen layouts. */
export class AppShell extends BasePage {
  readonly nav = this.tid(TID.shell.nav);
  readonly logoutButton = this.tid(TID.shell.logout);
  readonly userMenu = this.tid(TID.shell.userMenu);
  readonly terminalName = this.tid(TID.shell.terminalName);
  readonly forbidden = this.tid(TID.shell.forbidden);
  readonly idleOverlay = this.tid(TID.idle.overlay);

  navItem(route: string): Locator {
    return this.tid(TID.shell.navItem(route));
  }

  async logout(): Promise<void> {
    await this.userMenu.click();
    await this.logoutButton.click();
  }
}

/** Shared PinPrompt dialog (screens.md "Shared dialogs"; P1-AUTH-05). */
export class PinPrompt extends BasePage {
  readonly dialog = this.tid(TID.pinPrompt.dialog);
  readonly approver = this.tid(TID.pinPrompt.approver);
  readonly pin = this.tid(TID.pinPrompt.pin);
  readonly submit = this.tid(TID.pinPrompt.submit);
  readonly error = this.tid(TID.pinPrompt.error);

  async approve(approverUsername: string, pin: string): Promise<void> {
    await this.approver.fill(approverUsername);
    await this.pin.fill(pin);
    await this.submit.click();
  }
}
