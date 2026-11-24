/**
 * Project-wide `test` with RMS fixtures. Specs import { test, expect } from here, not from
 * @playwright/test directly.
 */
import { existsSync, readFileSync } from 'node:fs';
import { type Page, test as base, expect } from '@playwright/test';
import { ApiClient, type TerminalIdentity } from '../utils/api-client';
import { type CreateUserOpts, type TestUser, createUser, registerTerminalAs, uniqueName } from '../utils/admin-api';
import { env } from '../utils/env';
import type { RoleKey } from '../utils/role-grants';
import { type SeedState, type SeedUser, type TerminalKey, type TerminalRecord, SEED, passwordFor, userFor } from './seed';
import { seedBrowserStorage } from './ui';

export interface RmsFixtures {
  /** Unauthenticated API client on the seeded CASHIER_POS terminal (if seeded). */
  api: ApiClient;
  /** Identity of a seeded terminal; fails the test if the seed did not create it. */
  terminal: (key: TerminalKey) => TerminalIdentity;
  /** Logs in as the seeded user of a role on its usual (or the given) terminal. */
  apiAs: (role: RoleKey, opts?: { terminal?: TerminalKey; user?: SeedUser }) => Promise<ApiClient>;
  /**
   * Personal session (ADR-008): the role's seeded user (or `user`) logs in with no terminal header and no device token.
   * Only roles holding LOGIN_ANY_DEVICE succeed; fails the test otherwise. The client sends no X-Terminal-Id.
   */
  apiPersonal: (role: RoleKey, opts?: { user?: { username: string; password: string } }) => Promise<ApiClient>;
  /** The seeded owner, logged in on the ADMIN terminal. */
  owner: ApiClient;
  /** Creates a throwaway user through the owner (never mutate seeded users in tests that lock / deactivate). */
  makeUser: (opts?: CreateUserOpts) => Promise<TestUser>;
  /** A throwaway user's API client on a terminal (default CASHIER_POS). */
  apiAsUser: (u: TestUser, terminal?: TerminalKey) => Promise<ApiClient>;
  /** Device registered as `terminal`, nobody logged in. */
  registeredDevice: (terminal?: TerminalKey) => Promise<Page>;
  /** A brand-new terminal (own device token) registered in the browser, nobody logged in: no contention with other tests (BUG-1-001). */
  freshDevice: (type?: 'CASHIER_POS' | 'RECEPTION_POS' | 'ADMIN') => Promise<Page>;
  /** Device registered and `role`'s seeded user logged in (tokens injected, no login screen). Default terminal ADMIN. */
  uiAs: (role: RoleKey, opts?: { terminal?: TerminalKey; user?: TestUser }) => Promise<Page>;
}

export interface RmsWorkerFixtures {
  seedState: SeedState | null;
}

export const test = base.extend<RmsFixtures, RmsWorkerFixtures>({
  seedState: [
    async ({}, use) => {
      const state = existsSync(env.seedStateFile)
        ? (JSON.parse(readFileSync(env.seedStateFile, 'utf8')) as SeedState)
        : null;
      await use(state);
    },
    { scope: 'worker' },
  ],

  terminal: async ({ seedState }, use) => {
    await use((key) => {
      const id = seedState?.terminals[key];
      if (!id) throw new Error(`Terminal ${key} not seeded: run with RMS_SEED=1 (KITCHEN terminals need M1.1 stations)`);
      return id;
    });
  },

  api: async ({ seedState }, use) => {
    const client = await ApiClient.create(seedState?.terminals.CASHIER_POS);
    await use(client);
    await client.ctx.dispose();
  },

  apiAs: async ({ api, terminal, seedState }, use) => {
    await use(async (role, opts = {}) => {
      const user = opts.user ?? userFor(role);
      // Until M1.1 there are no KITCHEN terminals: kitchen users log in on the cashier POS (test-plan Q12).
      const key = opts.terminal ?? (seedState?.terminals[user.terminal] ? user.terminal : 'CASHIER_POS');
      const { client } = await api.withTerminal(terminal(key)).loginAs(user.username, passwordFor(user));
      return client;
    });
  },

  apiPersonal: async ({ api }, use) => {
    await use(async (role, opts = {}) => {
      const u = opts.user ?? { username: userFor(role).username, password: passwordFor(userFor(role)) };
      const { client } = await api.withTerminal(undefined).loginAs(u.username, u.password);
      return client;
    });
  },

  owner: async ({ apiAs }, use) => {
    await use(await apiAs('owner', { terminal: 'ADMIN' }));
  },

  makeUser: async ({ owner }, use) => {
    await use((opts) => createUser(owner, opts));
  },

  apiAsUser: async ({ api, terminal }, use) => {
    await use(async (u, key = 'CASHIER_POS') => (await api.withTerminal(terminal(key)).loginAs(u.username, u.password)).client);
  },

  registeredDevice: async ({ context, page, seedState }, use) => {
    await use(async (key = 'CASHIER_POS') => {
      const t = seedState?.terminals[key] as TerminalRecord | undefined;
      if (!t) throw new Error(`Terminal ${key} not seeded`);
      await seedBrowserStorage(context, { terminal: t });
      return page;
    });
  },

  freshDevice: async ({ context, page, api }, use) => {
    await use(async (type = 'CASHIER_POS') => {
      const o = userFor('owner');
      const { identity, terminal } = await registerTerminalAs(api, { username: o.username, password: passwordFor(o) }, uniqueName(`QA dev ${type}`), type);
      await seedBrowserStorage(context, { terminal: { ...identity, name: terminal.name, type } });
      return page;
    });
  },

  uiAs: async ({ context, page, seedState, api, terminal }, use) => {
    await use(async (role, opts = {}) => {
      const key = opts.terminal ?? 'ADMIN';
      const t = seedState?.terminals[key] as TerminalRecord | undefined;
      if (!t) throw new Error(`Terminal ${key} not seeded`);
      terminal(key);
      const user = opts.user ?? userFor(role);
      const username = user.username;
      const password = 'password' in user ? user.password : passwordFor(user as SeedUser);
      const { session } = await api.withTerminal(t).loginAs(username, password);
      await seedBrowserStorage(context, { terminal: t, session });
      return page;
    });
  },
});

export { expect, SEED };
