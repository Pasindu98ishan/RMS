/**
 * Annex A §2 "sensitive actions need a manager or owner PIN at the terminal" (P1-AUTH-05).
 *
 * The contract has NO PIN-check endpoint and M1.0 has no x-approval operation (agreed, Q10): the approval,
 * 3-wrong-PIN lock and unlock-PIN rows run against the first approval operation in M1.2 and stay `fixme`.
 * M1.0 covers PIN storage, format, reset, change and the pinSet / pinLocked flags.
 */
import { test, expect } from '../fixtures/test';
import { type Schemas, expectProblem } from '../utils/api-client';
import { auditFor, getUser, json } from '../utils/admin-api';
import { EP } from '../utils/endpoints';

test.describe('P1-AUTH-05 PIN storage and format (M1.0)', { tag: '@api' }, () => {
  for (const pin of ['123', '1234567', '12a4', '12 34', '']) {
    test(`P1-AUTH-05-T08 PIN "${pin}" is rejected with 422 on setOwnPin, createUser and resetUserPin`, async ({ owner, api, terminal, makeUser }) => {
      const u = await makeUser({ role: 'cashier' });
      const { client } = await api.withTerminal(terminal('CASHIER_POS')).loginAs(u.username, u.password);
      const p = await expectProblem(await client.post(EP.myPin, { body: { currentPassword: u.password, newPin: pin } }), 422);
      expect((p.fieldErrors ?? []).map((f) => f.field)).toContain('newPin');
      await expectProblem(await owner.post(EP.resetPin(u.id), { body: { newPin: pin } }), 422);
      const body = { username: `qa-pin-${Math.random().toString(16).slice(2, 8)}`, fullName: 'x', password: u.password, roleIds: u.roleIds, pin };
      await expectProblem(await owner.post(EP.users, { body }), 422);
    });
  }

  for (const pin of ['1234', '12345', '123456']) {
    test(`P1-AUTH-05-T08b a PIN of ${pin.length} digits is accepted (setOwnPin, resetUserPin)`, async ({ owner, api, terminal, makeUser }) => {
      const u = await makeUser({ role: 'cashier', pin: null });
      const { client } = await api.withTerminal(terminal('CASHIER_POS')).loginAs(u.username, u.password);
      await json(await client.post(EP.myPin, { body: { currentPassword: u.password, newPin: pin } }), 204);
      await json(await owner.post(EP.resetPin(u.id), { body: { newPin: pin } }), [200, 204]);
    });
  }

  test('P1-AUTH-05-T12 no API response contains a PIN or a PIN hash', async ({ owner, api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'manager', pin: '48217' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    const login = await dev.login(u.username, u.password);
    const loginText = await login.text();
    const { client } = await dev.loginAs(u.username, u.password);
    await json(await client.post(EP.myPin, { body: { currentPassword: u.password, newPin: '90817' } }), 204);
    await json(await owner.post(EP.resetPin(u.id), { body: { newPin: '73612' } }), [200, 204]);
    const texts = [
      loginText,
      await (await client.get(EP.me)).text(),
      await (await owner.get(EP.user(u.id))).text(),
      await (await owner.get(EP.users, { query: { size: 200 } })).text(),
      await (await owner.get(EP.auditLog, { query: { size: 200 } })).text(),
    ].join('\n');
    expect(texts).not.toMatch(/pinHash|pin_hash|"pin"\s*:|\$2[aby]\$|\$argon2/i);
    for (const pin of ['48217', '90817', '73612']) expect(texts).not.toContain(`"${pin}"`);
  });

  test('P1-AUTH-05-T14 owner resets a PIN: pinSet true, PIN_RESET audited without values', async ({ owner, makeUser }) => {
    const u = await makeUser({ role: 'manager', pin: null });
    expect((await getUser(owner, u.id)).pinSet).toBe(false);
    await json(await owner.post(EP.resetPin(u.id), { body: { newPin: '246802' } }), [200, 204]);
    const after = await getUser(owner, u.id);
    expect(after.pinSet).toBe(true);
    expect(after.pinLocked).toBe(false);
    const entries = (await auditFor(owner, u.id, { action: 'PIN_RESET' }));
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries[0])).not.toContain('246802');
  });

  test('P1-AUTH-05-T17 setOwnPin with the wrong password returns 422 and counts towards the account lock', async ({ api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'manager' });
    const dev = api.withTerminal(terminal('CASHIER_POS'));
    const { client } = await dev.loginAs(u.username, u.password);
    const body = { currentPassword: 'Wrong#Password1', newPin: '2468' };
    for (let i = 0; i < 4; i++) {
      const p = await expectProblem(await client.post(EP.myPin, { body }), 422);
      expect((p.fieldErrors ?? []).map((f) => f.field)).toContain('currentPassword');
    }
    await expectProblem(await client.post(EP.myPin, { body }), 423, 'ACCOUNT_LOCKED');
    await expectProblem(await dev.login(u.username, u.password), 423, 'ACCOUNT_LOCKED');
  });

  test('P1-AUTH-05-T18 setOwnPin succeeds with the right password and audits PIN_CHANGED without the PIN', async ({ owner, api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'manager', pin: null });
    const { client, session } = await api.withTerminal(terminal('CASHIER_POS')).loginAs(u.username, u.password);
    expect(session.user.pinSet).toBe(false);
    await json(await client.post(EP.myPin, { body: { currentPassword: u.password, newPin: '551177' } }), 204);
    expect((await getUser(owner, u.id)).pinSet).toBe(true);
    const entries = await auditFor(owner, u.id, { action: 'PIN_CHANGED' });
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries[0])).not.toContain('551177');
  });

  test('P1-AUTH-05-T19 a user without a PIN has pinSet=false in the login response and in the users list', async ({ owner, api, terminal, makeUser }) => {
    const u = await makeUser({ role: 'manager', pin: null });
    const { session } = await api.withTerminal(terminal('CASHIER_POS')).loginAs(u.username, u.password);
    expect(session.user.pinSet).toBe(false);
    const page = await json<Schemas['UserPage']>(await owner.get(EP.users, { query: { search: u.username } }));
    expect(page.items.find((x) => x.username === u.username)?.pinSet).toBe(false);
    const withPin = await makeUser({ role: 'manager', pin: '1357' });
    expect((await getUser(owner, withPin.id)).pinSet).toBe(true);
  });

  test('P1-AUTH-05-T22 only the owner (USER_MANAGE) can reset another user\'s PIN', async ({ apiAs, makeUser }) => {
    const u = await makeUser({ role: 'cashier' });
    for (const role of ['manager', 'cashier'] as const) {
      await expectProblem(await (await apiAs(role)).post(EP.resetPin(u.id), { body: { newPin: '2468' } }), 403, 'FORBIDDEN');
    }
  });

  test('P1-AUTH-05-T11 PINs are stored hashed (bcrypt / argon2)', async () => {
    test.skip(true, 'Verified by manual DB inspection (signoff.md) and the backend integration tests; no API exposes the hash');
  });
});

test.describe('P1-AUTH-05 approvals (first x-approval operation, M1.2)', { tag: '@api' }, () => {
  test.fixme('P1-AUTH-05-T01 correct manager PIN approves an action the manager can approve', async () => {});
  test.fixme('P1-AUTH-05-T02 wrong PIN is rejected with 403 APPROVAL_INVALID', async () => {});
  test.fixme('P1-AUTH-05-T03 three wrong PINs in a row lock the PIN: the correct PIN then gets 423 PIN_LOCKED', async () => {});
  test.fixme('P1-AUTH-05-T04 two wrong PINs then the correct one resets the counter', async () => {});
  test.fixme('P1-AUTH-05-T05 PIN lock lasts 5 minutes (locked at 4:59, open at 5:00): test clock', async () => {});
  test.fixme('P1-AUTH-05-T06 PIN lock does not block the user\'s password login', async () => {});
  test.fixme('P1-AUTH-05-T07 PIN lock is per user: the owner can still approve', async () => {});
  test.fixme('P1-AUTH-05-T09 a cashier\'s correct PIN never approves (approver lacks the permission)', async () => {});
  test.fixme('P1-AUTH-05-T10 manager PIN is rejected where owner approval is required (DISCOUNT_OWNER, M1.4)', async () => {});
  test.fixme('P1-AUTH-05-T15 approval stores the approver on the record and in the audit log', async () => {});
  test.fixme('P1-AUTH-05-T16 unknown approver username gets the same APPROVAL_INVALID as a wrong PIN', async () => {});
  test.fixme('P1-AUTH-05-T20 unlockUser clears the PIN lock and resets the PIN counter (a PIN lock can only be produced by an approval)', async () => {});
  test.fixme('P1-AUTH-05-T21 missing approval object returns 403 APPROVAL_REQUIRED', async () => {});
});

test.describe('P1-AUTH-05 PinPrompt dialog', () => {
  test.fixme('P1-AUTH-05-T13 PinPrompt masks a numeric PIN and shows the locked message on 423 (M1.2)', async () => {});
});
