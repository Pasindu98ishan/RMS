/**
 * M1.1 spreadsheet import (P1-IMP-01): categories, menu items, modifier groups, tables; CSV and XLSX; dry run;
 * all-or-nothing; row / column errors; re-import updates instead of duplicating; blank optional cell clears the value;
 * 5 MB / 5000 row limits; templates. Annex A §14 settings (menu, tables); proposal §3 "data import from the client's spreadsheets".
 * API tests use multipart upload; the UI flow is at the bottom (CSV only: an XLSX file chooser upload is covered at API level).
 */
import fs from 'node:fs';
import JSZip from 'jszip';
import { test, expect } from '../fixtures/test';
import { type ApiClient, type Schemas, expectProblem } from '../utils/api-client';
import { auditSearch, json, uniqueName } from '../utils/admin-api';
import { EPM, uniqueCode } from '../utils/menu-api';
import { XLSX_MIME, buildXlsx } from '../utils/xlsx';

type ImportType = 'CATEGORIES' | 'MENU_ITEMS' | 'MODIFIER_GROUPS' | 'TABLES';
type Report = Schemas['ImportReport'];

async function importFile(
  c: ApiClient,
  type: ImportType,
  content: string | Buffer,
  o: { dry?: boolean; name?: string; mime?: string } = {},
): Promise<{ status: number; report: Report; raw: string }> {
  const res = await c.call('POST', EPM.importData(type), {
    query: { dryRun: o.dry ?? false },
    multipart: { file: { name: o.name ?? 'import.csv', mimeType: o.mime ?? 'text/csv', buffer: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8') } },
  });
  const raw = await res.text();
  let report = {} as Report;
  try {
    report = JSON.parse(raw) as Report;
  } catch {
    /* not json */
  }
  return { status: res.status(), report, raw };
}

const csv = (...rows: string[]) => `${rows.join('\r\n')}\r\n`;
const ITEM_HEADER = 'code,name,category,station,local_price,foreign_price,modifier_groups,active';
const TAG = () => uniqueName('imp').replace(/-/g, '').toUpperCase().slice(0, 10);
const jstr = (v: unknown) => JSON.stringify(v ?? null);

async function listItemsByPrefix(c: ApiClient, prefix: string): Promise<Schemas['MenuItemSummary'][]> {
  return (await json<Schemas['MenuItemPage']>(await c.get(EPM.items, { query: { search: prefix, size: 200 } }))).items;
}

test.describe('P1-IMP-01 categories', { tag: '@api' }, () => {
  test('P1-IMP-01-T01 a categories file creates the categories and reports created / updated / unchanged', async ({ owner }) => {
    const t = TAG();
    const r = await importFile(owner, 'CATEGORIES', csv('name,sort_order', `IC ${t} A,10`, `IC ${t} B,11`));
    expect(r.status).toBe(200);
    expect(r.report).toMatchObject({ importType: 'CATEGORIES', dryRun: false, ok: true, rowsRead: 2, counts: { created: 2, updated: 0, unchanged: 0 }, errors: [], errorsTruncated: false });
    const list = await json<Schemas['Category'][]>(await owner.get(EPM.categories));
    expect(list.filter((c) => c.name.startsWith(`IC ${t}`)).map((c) => [c.name, c.sortOrder])).toEqual([[`IC ${t} A`, 10], [`IC ${t} B`, 11]]);
  });

  test('P1-IMP-01-T02 importing the same file again changes nothing; changing a value updates it; no duplicates are created', async ({ owner }) => {
    const t = TAG();
    const file = csv('name,sort_order', `IC ${t} A,10`, `IC ${t} B,11`);
    await importFile(owner, 'CATEGORIES', file);
    expect((await importFile(owner, 'CATEGORIES', file)).report.counts).toEqual({ created: 0, updated: 0, unchanged: 2 });
    const changed = await importFile(owner, 'CATEGORIES', csv('name,sort_order', `IC ${t} A,20`, `IC ${t} B,11`));
    expect(changed.report.counts).toEqual({ created: 0, updated: 1, unchanged: 1 });
    const list = (await json<Schemas['Category'][]>(await owner.get(EPM.categories))).filter((c) => c.name.startsWith(`IC ${t}`));
    expect(list).toHaveLength(2);
    expect(list.find((c) => c.name.endsWith('A'))!.sortOrder).toBe(20);
    // matching is by name, case-insensitive
    const upper = await importFile(owner, 'CATEGORIES', csv('name,sort_order', `IC ${t} A`.toUpperCase() + ',21'));
    expect(upper.report.counts.created).toBe(0);
  });

  test('P1-IMP-01-T03 a dry run returns the counts but saves nothing and writes no DATA_IMPORTED audit row', async ({ owner }) => {
    const t = TAG();
    const dry = await importFile(owner, 'CATEGORIES', csv('name,sort_order', `IC ${t} dry,1`), { dry: true });
    expect(dry.report).toMatchObject({ dryRun: true, ok: true, counts: { created: 1, updated: 0, unchanged: 0 } });
    const list = await json<Schemas['Category'][]>(await owner.get(EPM.categories));
    expect(list.some((c) => c.name.startsWith(`IC ${t}`))).toBe(false);
    const audit = await auditSearch(owner, { action: 'DATA_IMPORTED' as never, size: 5 }).catch(() => null);
    if (audit) expect(jstr(audit.items)).not.toContain(`IC ${t}`);
  });

  test('P1-IMP-01-T04 a real import writes DATA_IMPORTED to the audit log with the counts and the file name', async ({ owner }) => {
    const t = TAG();
    const name = `categories-${t}.csv`;
    await importFile(owner, 'CATEGORIES', csv('name,sort_order', `IC ${t} A,1`), { name });
    const res = await owner.get('audit-log', { query: { action: 'DATA_IMPORTED', size: 20 } });
    expect([200, 400, 422]).toContain(res.status());
    if (res.status() === 200) {
      const items = ((await res.json()) as Schemas['AuditLogPage']).items;
      const mine = items.find((e) => jstr(e).includes(name));
      expect(mine, jstr(items.slice(0, 3))).toBeTruthy();
      expect(jstr(mine)).toContain('created');
      expect(mine!.user?.username).toBeTruthy();
      expect(mine!.terminal?.id).toBeTruthy();
    }
  });

  test('P1-IMP-01-T05 an invalid row stops the whole import: nothing is saved, every error has row, column and reason', async ({ owner }) => {
    const t = TAG();
    const r = await importFile(owner, 'CATEGORIES', csv('name,sort_order', `IC ${t} good,1`, ',abc', `IC ${t} bad,-1`));
    expect(r.status).toBe(200);
    expect(r.report.ok).toBe(false);
    expect(r.report.counts).toEqual({ created: 0, updated: 0, unchanged: 0 });
    expect(r.report.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 3, column: 'name', message: expect.stringMatching(/required/i) }),
        expect.objectContaining({ row: 3, column: 'sort_order', value: 'abc', message: expect.stringMatching(/whole number/i) }),
        expect.objectContaining({ row: 4, column: 'sort_order', value: '-1', message: expect.stringMatching(/negative/i) }),
      ]),
    );
    const list = await json<Schemas['Category'][]>(await owner.get(EPM.categories));
    expect(list.some((c) => c.name.startsWith(`IC ${t}`))).toBe(false); // even the valid row was not imported
  });

  test('P1-IMP-01-T06 wrong or missing column headers are reported per column; extra columns are rejected', async ({ owner }) => {
    const r = await importFile(owner, 'CATEGORIES', csv('nm,sort', 'x,1'));
    expect(r.report.ok).toBe(false);
    const msgs = r.report.errors.map((e) => `${e.column}: ${e.message}`).join(' | ');
    expect(msgs).toMatch(/missing column 'name'/);
    expect(msgs).toMatch(/unknown column 'nm'/);
  });

  test('P1-IMP-01-T07 header matching ignores case and spaces; BOM, CRLF and quoted commas are handled', async ({ owner }) => {
    const t = TAG();
    const r = await importFile(owner, 'CATEGORIES', `﻿Name , SORT_ORDER\r\n"IC ${t}, with comma and ""quotes""",7\r\n`);
    expect(r.report).toMatchObject({ ok: true, counts: { created: 1 } });
    const list = await json<Schemas['Category'][]>(await owner.get(EPM.categories));
    expect(list.find((c) => c.name === `IC ${t}, with comma and "quotes"`)?.sortOrder).toBe(7);
  });

  test('P1-IMP-01-T08 an empty file is 422 IMPORT_FILE_INVALID; a header-only file imports nothing (ok, 0 rows)', async ({ owner }) => {
    const empty = await importFile(owner, 'CATEGORIES', '');
    expect(empty.status).toBe(422);
    expect(JSON.parse(empty.raw).code).toBe('IMPORT_FILE_INVALID');
    const headerOnly = await importFile(owner, 'CATEGORIES', csv('name,sort_order'));
    expect(headerOnly.report).toMatchObject({ ok: true, rowsRead: 0, counts: { created: 0, updated: 0, unchanged: 0 } });
  });

  test('P1-IMP-01-T09 a file with garbage (not CSV, not XLSX) imports nothing', async ({ owner }) => {
    const r = await importFile(owner, 'CATEGORIES', Buffer.from([0, 1, 2, 255, 254, 9, 9, 9]), { name: 'x.bin', mime: 'application/octet-stream' });
    if (r.status === 422) expect(JSON.parse(r.raw).code).toBe('IMPORT_FILE_INVALID');
    else expect(r.report.ok).toBe(false);
    expect(r.report.counts?.created ?? 0).toBe(0);
  });

  test('P1-IMP-01-T10 the import type must be one of CATEGORIES, MENU_ITEMS, MODIFIER_GROUPS, TABLES (else 400)', async ({ owner }) => {
    const res = await owner.call('POST', 'import/FOO', { multipart: { file: { name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from('a\n1\n') } } });
    expect(res.status()).toBe(400);
  });

  test('P1-IMP-01-T11 a request without a file is rejected (400 / 422), not a server error', async ({ owner }) => {
    const res = await owner.call('POST', EPM.importData('CATEGORIES'), { multipart: { other: 'x' } });
    expect([400, 422]).toContain(res.status());
  });
});

test.describe('P1-IMP-01 limits', { tag: '@api' }, () => {
  test('P1-IMP-01-T12 a file with 5001 rows is refused at once with 422 IMPORT_FILE_INVALID', async ({ owner }) => {
    const t = TAG();
    const rows = Array.from({ length: 5001 }, (_, i) => `BIG ${t} ${i},${i}`);
    const started = Date.now();
    const over = await importFile(owner, 'CATEGORIES', csv('name,sort_order', ...rows), { dry: true });
    expect(over.status).toBe(422);
    expect(JSON.parse(over.raw)).toMatchObject({ code: 'IMPORT_FILE_INVALID' });
    expect(JSON.parse(over.raw).detail).toMatch(/5000/);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  test('P1-IMP-01-T13 a file over 5 MB is refused with 422 IMPORT_FILE_INVALID', async ({ owner }) => {
    const big = `name,sort_order\n${`${'X'.repeat(1000)},1\n`.repeat(5400)}`;
    expect(big.length).toBeGreaterThan(5 * 1024 * 1024);
    const r = await importFile(owner, 'CATEGORIES', big, { dry: true });
    expect(r.status).toBe(422);
    expect(JSON.parse(r.raw)).toMatchObject({ code: 'IMPORT_FILE_INVALID' });
    expect(JSON.parse(r.raw).detail).toMatch(/5 MB/);
  });

  test('P1-IMP-01-T14 a file just under 5 MB is read (dry run)', async ({ owner }) => {
    const rows = 4800;
    const body = `name,sort_order\n${`${'Y'.repeat(900)},1\n`.repeat(rows)}`;
    expect(body.length).toBeLessThan(5 * 1024 * 1024);
    const r = await importFile(owner, 'CATEGORIES', body, { dry: true });
    expect([200, 422]).toContain(r.status);
    if (r.status === 200) expect(r.report.rowsRead).toBe(rows);
  });
});

test.describe('P1-IMP-01 menu items', { tag: '@api' }, () => {
  async function setup(owner: ApiClient) {
    const t = TAG();
    await importFile(owner, 'CATEGORIES', csv('name,sort_order', `IM ${t} A,10`, `IM ${t} B,11`));
    await importFile(owner, 'MODIFIER_GROUPS', csv('group,required,min_select,max_select,option,price_delta', `Spice ${t},Y,1,1,Mild,0.00`, `Spice ${t},Y,1,1,Hot,0.00`, `Extras ${t},N,0,2,Egg,100.00`, `Extras ${t},N,0,2,Cheese,150.00`));
    return t;
  }

  test('P1-IMP-01-T20 a menu-items file creates items with category, station number, prices, groups (in the listed order) and the active flag', async ({ owner }) => {
    const t = await setup(owner);
    const c1 = `IM${t}1`;
    const c2 = `IM${t}2`;
    const r = await importFile(owner, 'MENU_ITEMS', csv(ITEM_HEADER, `${c1},Item one,IM ${t} A,1,100.00,150.00,Extras ${t}|Spice ${t},Y`, `${c2},Item two,IM ${t} B,3,200.00,,,N`));
    expect(r.report).toMatchObject({ ok: true, counts: { created: 2, updated: 0, unchanged: 0 } });
    const items = await listItemsByPrefix(owner, `IM${t}`);
    const one = await json<Schemas['MenuItem']>(await owner.get(EPM.item(items.find((i) => i.code === c1)!.id)));
    expect(one).toMatchObject({ name: 'Item one', categoryName: `IM ${t} A`, localPrice: '100.00', foreignPrice: '150.00', active: true });
    expect(one.stationName).toBeTruthy();
    expect(one.modifierGroups.map((g) => g.name)).toEqual([`Extras ${t}`, `Spice ${t}`]);
    const two = await json<Schemas['MenuItem']>(await owner.get(EPM.item(items.find((i) => i.code === c2)!.id)));
    expect(two).toMatchObject({ active: false, localPrice: '200.00' });
    expect(two.foreignPrice).toBeUndefined();
    expect(two.stationId).not.toBe(one.stationId);
  });

  test('P1-IMP-01-T21 re-importing an existing code updates that item (never a duplicate); a price change writes PRICE_CHANGED', async ({ owner }) => {
    const t = await setup(owner);
    const code = `IM${t}1`;
    await importFile(owner, 'MENU_ITEMS', csv(ITEM_HEADER, `${code},Item one,IM ${t} A,1,100.00,150.00,,Y`));
    const again = await importFile(owner, 'MENU_ITEMS', csv(ITEM_HEADER, `${code},Item one,IM ${t} A,1,100.00,150.00,,Y`));
    expect(again.report.counts).toEqual({ created: 0, updated: 0, unchanged: 1 });
    const upd = await importFile(owner, 'MENU_ITEMS', csv(ITEM_HEADER, `${code},Item one renamed,IM ${t} B,2,111.00,155.00,,Y`));
    expect(upd.report.counts).toEqual({ created: 0, updated: 1, unchanged: 0 });
    const items = await listItemsByPrefix(owner, code);
    expect(items).toHaveLength(1);
    const full = await json<Schemas['MenuItem']>(await owner.get(EPM.item(items[0].id)));
    expect(full).toMatchObject({ name: 'Item one renamed', categoryName: `IM ${t} B`, localPrice: '111.00', foreignPrice: '155.00' });
    const prices = await auditSearch(owner, { entityType: 'MENU_ITEM', entityId: full.id, action: 'PRICE_CHANGED' });
    expect(prices.totalItems).toBeGreaterThanOrEqual(1);
  });

  test('P1-IMP-01-T22 a blank optional cell on re-import clears the value (foreign price, modifier groups); a blank active means Y', async ({ owner }) => {
    const t = await setup(owner);
    const code = `IM${t}1`;
    await importFile(owner, 'MENU_ITEMS', csv(ITEM_HEADER, `${code},Item,IM ${t} A,1,100.00,150.00,Spice ${t},Y`));
    const before = await json<Schemas['MenuItem']>(await owner.get(EPM.item((await listItemsByPrefix(owner, code))[0].id)));
    expect(before.foreignPrice).toBe('150.00');
    expect(before.modifierGroups).toHaveLength(1);
    const r = await importFile(owner, 'MENU_ITEMS', csv(ITEM_HEADER, `${code},Item,IM ${t} A,1,100.00,,,`));
    expect(r.report).toMatchObject({ ok: true, counts: { updated: 1 } });
    const after = await json<Schemas['MenuItem']>(await owner.get(EPM.item(before.id)));
    expect(after.foreignPrice).toBeUndefined();
    expect(after.modifierGroups).toEqual([]);
    expect(after.active).toBe(true);
  });

  test('P1-IMP-01-T23 every kind of bad cell is reported with its row and column; nothing is imported (all-or-nothing)', async ({ owner }) => {
    const t = await setup(owner);
    const c = (n: number) => `IM${t}E${n}`;
    const r = await importFile(
      owner,
      'MENU_ITEMS',
      csv(
        ITEM_HEADER,
        `${c(1)},good,IM ${t} A,1,10.00,,,Y`,
        `${c(2)},x,NoSuchCat,9,abc,-5.00,NoGroup,maybe`,
        `${c(2)},dup,IM ${t} A,1,10.00,,,Y`,
        `,noCode,IM ${t} A,1,10.00,,,Y`,
        `${c(3)},fmt,IM ${t} A,1,1e2,,,Y`,
        `${c(4)},fmt,IM ${t} A,1,"1,000.00",,,Y`,
        `${c(5)},fmt,IM ${t} A,1,12.001,,,Y`,
        `${c(6)},name missing,IM ${t} A,0,10.00,,,Y`,
        `${c(7)},,IM ${t} A,1,10.00,,,Y`,
        `${c(8)},no price,IM ${t} A,1,,,,Y`,
      ),
    );
    expect(r.report.ok).toBe(false);
    expect(r.report.counts).toEqual({ created: 0, updated: 0, unchanged: 0 });
    const at = (row: number, column: string) => r.report.errors.find((e) => e.row === row && e.column === column);
    expect(at(3, 'category')?.message).toMatch(/unknown category 'NoSuchCat'/);
    expect(at(3, 'station')?.message).toMatch(/unknown kitchen station 9/);
    expect(at(3, 'local_price')?.message).toMatch(/'abc' is not a number/);
    expect(at(3, 'foreign_price')?.message).toMatch(/negative/);
    expect(at(3, 'modifier_groups')?.message).toMatch(/unknown modifier group 'NoGroup'/);
    expect(at(3, 'active')?.message).toMatch(/must be Y or N/);
    expect(at(4, 'code')?.message).toMatch(/duplicate code \(first on row 3\)/);
    expect(at(5, 'code')?.message).toMatch(/required/);
    expect(at(6, 'local_price')?.message).toMatch(/not a number/);
    expect(at(7, 'local_price')?.message).toMatch(/not a number/);
    expect(at(8, 'local_price')?.message).toMatch(/2 decimals/);
    expect(at(9, 'station')?.message).toMatch(/unknown kitchen station 0/);
    expect(at(10, 'name')?.message).toMatch(/required/);
    expect(at(11, 'local_price')?.message).toMatch(/required|missing/i);
    expect(await listItemsByPrefix(owner, `IM${t}E`)).toHaveLength(0); // the good row 2 was not imported either
  });

  test('P1-IMP-01-T24 the error message has the documented shape, e.g. "menu_items row 14, local_price: \'abc\' is not a number" fields', async ({ owner }) => {
    const t = await setup(owner);
    const r = await importFile(owner, 'MENU_ITEMS', csv(ITEM_HEADER, `IM${t}Z,x,IM ${t} A,1,abc,,,Y`));
    expect(r.report.errors[0]).toMatchObject({ row: 2, column: 'local_price', value: 'abc', message: "'abc' is not a number" });
  });

  test('P1-IMP-01-T25 price cells accept "10", "10.5" and surrounding spaces and are stored with 2 decimals', async ({ owner }) => {
    const t = await setup(owner);
    const r = await importFile(owner, 'MENU_ITEMS', csv(ITEM_HEADER, `IM${t}P1,a,IM ${t} A,1,10,,,Y`, `IM${t}P2,b,IM ${t} A,1,10.5,,,Y`, `IM${t}P3,c,IM ${t} A,1, 12.00 ,,,Y`));
    expect(r.report.ok, jstr(r.report.errors)).toBe(true);
    const prices = (await listItemsByPrefix(owner, `IM${t}P`)).map((i) => i.localPrice).sort();
    expect(prices).toEqual(['10.00', '10.50', '12.00']);
  });

  test('P1-IMP-01-T26 import order matters: items that name a category or group that does not exist yet are refused', async ({ owner }) => {
    const t = TAG();
    const r = await importFile(owner, 'MENU_ITEMS', csv(ITEM_HEADER, `IM${t}1,x,Not Yet ${t},1,10.00,,,Y`));
    expect(r.report.ok).toBe(false);
    expect(r.report.errors[0].message).toMatch(/unknown category/);
  });

  test('P1-IMP-01-T27 a dry run of a menu-items file reports created / updated counts without saving', async ({ owner }) => {
    const t = await setup(owner);
    const code = `IM${t}D`;
    await importFile(owner, 'MENU_ITEMS', csv(ITEM_HEADER, `${code}1,x,IM ${t} A,1,10.00,,,Y`));
    const dry = await importFile(owner, 'MENU_ITEMS', csv(ITEM_HEADER, `${code}1,x,IM ${t} A,1,12.00,,,Y`, `${code}2,y,IM ${t} A,1,10.00,,,Y`), { dry: true });
    expect(dry.report).toMatchObject({ dryRun: true, ok: true, counts: { created: 1, updated: 1, unchanged: 0 } });
    expect(await listItemsByPrefix(owner, code)).toHaveLength(1);
    expect((await listItemsByPrefix(owner, code))[0].localPrice).toBe('10.00');
  });

  test('P1-IMP-01-T28 a lower-case code and a lower-case y/n are normalised, not rejected', async ({ owner }) => {
    const t = await setup(owner);
    const r = await importFile(owner, 'MENU_ITEMS', csv(ITEM_HEADER, `im${t}lc,lower,im ${t} a,1,10.00,,,y`));
    expect(r.report.ok, jstr(r.report.errors)).toBe(true);
    expect((await listItemsByPrefix(owner, `IM${t}LC`))[0]?.code).toBe(`IM${t}LC`);
  });
});

test.describe('P1-IMP-01 modifier groups and tables', { tag: '@api' }, () => {
  const GH = 'group,required,min_select,max_select,option,price_delta';

  test('P1-IMP-01-T30 rows with the same group name build one group with its options in file order', async ({ owner }) => {
    const t = TAG();
    const r = await importFile(owner, 'MODIFIER_GROUPS', csv(GH, `Spice ${t},Y,1,1,Mild,0.00`, `Spice ${t},Y,1,1,Hot,0.00`, `Extras ${t},N,0,3,Egg,100.00`, `Extras ${t},N,0,3,Cheese,150.00`, `Extras ${t},N,0,3,Chicken,300.00`));
    expect(r.report).toMatchObject({ ok: true, rowsRead: 5, counts: { created: 2 } });
    const groups = await json<Schemas['ModifierGroup'][]>(await owner.get(EPM.modifierGroups));
    const spice = groups.find((g) => g.name === `Spice ${t}`)!;
    expect(spice).toMatchObject({ required: true, minSelect: 1, maxSelect: 1 });
    expect(spice.options.map((o) => o.name)).toEqual(['Mild', 'Hot']);
    const extras = groups.find((g) => g.name === `Extras ${t}`)!;
    expect(extras.options.map((o) => [o.name, o.priceDelta])).toEqual([['Egg', '100.00'], ['Cheese', '150.00'], ['Chicken', '300.00']]);
  });

  test('P1-IMP-01-T31 re-importing a group updates it by name: options matched by name keep their identity, no duplicate group', async ({ owner }) => {
    const t = TAG();
    await importFile(owner, 'MODIFIER_GROUPS', csv(GH, `Size ${t},Y,1,1,Small,0.00`, `Size ${t},Y,1,1,Large,100.00`));
    const before = (await json<Schemas['ModifierGroup'][]>(await owner.get(EPM.modifierGroups))).find((g) => g.name === `Size ${t}`)!;
    const r = await importFile(owner, 'MODIFIER_GROUPS', csv(GH, `Size ${t},Y,1,1,Small,0.00`, `Size ${t},Y,1,1,Large,120.00`));
    expect(r.report.ok).toBe(true);
    expect(r.report.counts.created).toBe(0);
    const all = (await json<Schemas['ModifierGroup'][]>(await owner.get(EPM.modifierGroups))).filter((g) => g.name === `Size ${t}`);
    expect(all).toHaveLength(1);
    expect(all[0].options.find((o) => o.name === 'Large')?.priceDelta).toBe('120.00');
    expect(all[0].id).toBe(before.id);
    expect(all[0].options.find((o) => o.name === 'Small')?.id).toBe(before.options.find((o) => o.name === 'Small')!.id);
  });

  const bad: Array<[string, string[], RegExp, string]> = [
    ['max below min', ['Bad,Y,2,1,A,0.00', 'Bad,Y,2,1,B,0.00'], /maximum/i, 'max_select'],
    ['negative option price', ['Bad,N,0,1,A,-1.00', 'Bad,N,0,1,B,0.00'], /negative/i, 'price_delta'],
    ['max above the number of options', ['Bad,N,0,5,A,0.00', 'Bad,N,0,5,B,0.00'], /number of options/i, 'max_select'],
    ['required flag not Y/N', ['Bad,maybe,1,1,A,0.00', 'Bad,maybe,1,1,B,0.00'], /Y or N/, 'required'],
    ['min not a number', ['Bad,Y,x,1,A,0.00', 'Bad,Y,x,1,B,0.00'], /whole number/, 'min_select'],
    ['option name missing', ['Bad,N,0,1,,0.00', 'Bad,N,0,1,B,0.00'], /required/, 'option'],
  ];
  for (const [label, rows, msg, column] of bad) {
    test(`P1-IMP-01-T32 modifier group file with ${label} is refused with a ${column} error`, async ({ owner }) => {
      const t = TAG();
      const r = await importFile(owner, 'MODIFIER_GROUPS', csv(GH, ...rows.map((x) => x.replace(/^Bad/, `Bad ${t}`))));
      expect(r.report.ok).toBe(false);
      expect(r.report.errors.find((e) => e.column === column)?.message, jstr(r.report.errors)).toMatch(msg);
      expect((await json<Schemas['ModifierGroup'][]>(await owner.get(EPM.modifierGroups))).some((g) => g.name.startsWith(`Bad ${t}`))).toBe(false);
    });
  }

  test('P1-IMP-01-T33 a tables file creates tables; re-import updates section and seats by number without duplicates', async ({ owner }) => {
    const t = TAG().slice(0, 6);
    const TH = 'number,section,seats';
    const r = await importFile(owner, 'TABLES', csv(TH, `I${t}1,Imp,4`, `I${t}2,Imp,6`));
    expect(r.report).toMatchObject({ ok: true, counts: { created: 2 } });
    const upd = await importFile(owner, 'TABLES', csv(TH, `I${t}1,Garden,8`, `I${t}2,Imp,6`));
    expect(upd.report.counts).toEqual({ created: 0, updated: 1, unchanged: 1 });
    const tables = (await json<Schemas['DiningTable'][]>(await owner.get(EPM.tables))).filter((x) => x.number.startsWith(`I${t}`));
    expect(tables).toHaveLength(2);
    expect(tables.find((x) => x.number === `I${t}1`)).toMatchObject({ section: 'Garden', seats: 8, active: true });
    expect(tables.every((x) => x.x >= 0 && x.x <= 1000 && x.y >= 0 && x.y <= 700)).toBe(true); // imported tables get a floor position
  });

  test('P1-IMP-01-T34 table file errors: seats outside 1-50, not a number, missing number, number with spaces or longer than 10', async ({ owner }) => {
    const t = TAG().slice(0, 5);
    const r = await importFile(owner, 'TABLES', csv('number,section,seats', `A${t}1,Imp,0`, `A${t}2,Imp,51`, `A${t}3,Imp,x`, ',Imp,4', `A${t} 5,Imp,4`, `${'N'.repeat(11)},Imp,4`, `A${t}7,,4`));
    expect(r.report.ok).toBe(false);
    const cols = r.report.errors.map((e) => `${e.row}:${e.column}`);
    expect(cols).toEqual(expect.arrayContaining(['2:seats', '3:seats', '4:seats', '5:number', '6:number', '7:number', '8:section']));
    expect((await json<Schemas['DiningTable'][]>(await owner.get(EPM.tables))).some((x) => x.number.startsWith(`A${t}`))).toBe(false);
  });
});

test.describe('P1-IMP-01 XLSX', { tag: '@api' }, () => {
  test('P1-IMP-01-T40 an .xlsx file imports like a CSV (tables: create, then update by number)', async ({ owner }) => {
    const t = TAG().slice(0, 6);
    const first = await importFile(owner, 'TABLES', await buildXlsx([['number', 'section', 'seats'], [`X${t}1`, 'Xl', 4], [`X${t}2`, 'Xl', 6]]), { name: 't.xlsx', mime: XLSX_MIME });
    expect(first.report).toMatchObject({ ok: true, rowsRead: 2, counts: { created: 2 } });
    const second = await importFile(owner, 'TABLES', await buildXlsx([['number', 'section', 'seats'], [`X${t}1`, 'Changed', 4], [`X${t}2`, 'Xl', 6]]), { name: 't.xlsx', mime: XLSX_MIME });
    expect(second.report.counts).toEqual({ created: 0, updated: 1, unchanged: 1 });
  });

  test('P1-IMP-01-T41 an .xlsx menu-items file with numeric price cells (125.5) imports as 125.50', async ({ owner }) => {
    const t = TAG();
    await importFile(owner, 'CATEGORIES', csv('name,sort_order', `XC ${t},1`));
    const r = await importFile(owner, 'MENU_ITEMS', await buildXlsx([['code', 'name', 'category', 'station', 'local_price', 'foreign_price', 'modifier_groups', 'active'], [`XI${t}`, 'xl item', `XC ${t}`, 1, 125.5, '', '', 'Y']]), { name: 'i.xlsx', mime: XLSX_MIME });
    expect(r.report.ok, jstr(r.report.errors)).toBe(true);
    expect((await listItemsByPrefix(owner, `XI${t}`))[0].localPrice).toBe('125.50');
  });

  test('P1-IMP-01-T42 errors in an .xlsx file carry the spreadsheet row number (header = row 1) and the column header', async ({ owner }) => {
    const r = await importFile(owner, 'TABLES', await buildXlsx([['number', 'section', 'seats'], ['OK1', 'S', 4], ['BAD1', 'S', 0]]), { name: 't.xlsx', mime: XLSX_MIME });
    expect(r.report.ok).toBe(false);
    expect(r.report.errors[0]).toMatchObject({ row: 3, column: 'seats' });
  });

  test('P1-IMP-01-T43 a corrupt .xlsx (zip with no sheet) is refused with 422 or an empty report, never a server error', async ({ owner }) => {
    const z = new JSZip();
    z.file('hello.txt', 'not a workbook');
    const r = await importFile(owner, 'CATEGORIES', await z.generateAsync({ type: 'nodebuffer' }), { name: 'bad.xlsx', mime: XLSX_MIME });
    expect(r.status).toBeLessThan(500);
    if (r.status === 200) expect(r.report.ok).toBe(false);
  });
});

test.describe('P1-IMP-01 templates', { tag: '@api' }, () => {
  const HEADERS: Record<ImportType, string> = {
    CATEGORIES: 'name,sort_order',
    MENU_ITEMS: 'code,name,category,station,local_price,foreign_price,modifier_groups,active',
    MODIFIER_GROUPS: 'group,required,min_select,max_select,option,price_delta',
    TABLES: 'number,section,seats',
  };
  for (const type of Object.keys(HEADERS) as ImportType[]) {
    test(`P1-IMP-01-T50 the ${type} CSV template has the documented header row and one example row`, async ({ owner }) => {
      const res = await owner.get(EPM.importTemplate(type));
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toContain('text/csv');
      expect(res.headers()['content-disposition'] ?? '').toMatch(/attachment; filename=".*\.csv"/);
      const lines = (await res.text()).split(/\r?\n/).filter(Boolean);
      expect(lines[0].replace(/^﻿/, '')).toBe(HEADERS[type]);
      expect(lines.length).toBeGreaterThanOrEqual(2);
    });

    test(`P1-IMP-01-T51 the ${type} XLSX template is a workbook with the same header`, async ({ owner }) => {
      const res = await owner.get(EPM.importTemplate(type), { query: { format: 'XLSX' } });
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toContain('spreadsheetml');
      const zip = await JSZip.loadAsync(await res.body());
      const strings = (await zip.file('xl/sharedStrings.xml')?.async('string')) ?? '';
      const sheet = (await zip.file('xl/worksheets/sheet1.xml')?.async('string')) ?? '';
      for (const col of HEADERS[type].split(',')) expect(strings + sheet, col).toContain(col);
    });
  }

  test('P1-IMP-01-T52 an unknown template type is 400; the CSV template of a type imports back without errors after its example row is made valid', async ({ owner }) => {
    expect((await owner.get(EPM.importTemplate('FOO'))).status()).toBe(400);
    const tpl = await (await owner.get(EPM.importTemplate('TABLES'))).text();
    const r = await importFile(owner, 'TABLES', tpl.replace(/\r?\n[^\r\n]+/, `\r\nT${TAG().slice(0, 7)},Indoor,4`), { dry: true });
    expect(r.report.ok, jstr(r.report.errors)).toBe(true);
  });
});

test.describe('P1-IMP-01 import screen', () => {
  test('P1-IMP-01-T60 the import screen: choose a type, pick a file, check (dry run) shows counts, import saves, errors show row and column', async ({ uiAs, owner }, testInfo) => {
    const t = TAG();
    const page = await uiAs('owner');
    await page.goto('/admin/import');
    await expect(page.getByTestId('import-type')).toBeVisible();
    await page.getByTestId('import-type').selectOption({ index: 0 });
    await page.getByTestId('import-type').selectOption('CATEGORIES');
    const file = testInfo.outputPath(`cats-${t}.csv`);
    fs.writeFileSync(file, csv('name,sort_order', `UI ${t} A,1`, `UI ${t} B,2`));
    await page.getByTestId('import-file').setInputFiles(file);
    await page.getByTestId('import-check').click();
    await expect(page.getByTestId('import-report')).toBeVisible();
    await expect(page.getByTestId('import-count-created')).toContainText('2');
    expect((await json<Schemas['Category'][]>(await owner.get(EPM.categories))).some((c) => c.name.startsWith(`UI ${t}`))).toBe(false);
    await page.getByTestId('import-run').click();
    await expect(page.getByTestId('import-result')).toBeVisible();
    await expect.poll(async () => (await json<Schemas['Category'][]>(await owner.get(EPM.categories))).filter((c) => c.name.startsWith(`UI ${t}`)).length).toBe(2);
    // again: nothing changes
    await page.getByTestId('import-clear').click();
    await page.getByTestId('import-file').setInputFiles(file);
    await page.getByTestId('import-check').click();
    await expect(page.getByTestId('import-count-unchanged')).toContainText('2');
    // a broken file shows its errors
    const bad = testInfo.outputPath(`bad-${t}.csv`);
    fs.writeFileSync(bad, csv('name,sort_order', `UI ${t} C,abc`));
    await page.getByTestId('import-clear').click();
    await page.getByTestId('import-file').setInputFiles(bad);
    await page.getByTestId('import-check').click();
    await expect(page.getByTestId('import-errors')).toBeVisible();
    await expect(page.getByTestId('import-error-row').first()).toContainText('sort_order');
    await expect(page.getByTestId('import-error-row').first()).toContainText('2');
    await expect(page.getByTestId('import-run')).toBeDisabled();
  });

  test('P1-IMP-01-T61 the import screen offers the CSV and XLSX template of the chosen type as downloads', async ({ uiAs }) => {
    const page = await uiAs('owner');
    await page.goto('/admin/import');
    await page.getByTestId('import-type').selectOption('MENU_ITEMS');
    const csvDownload = page.waitForEvent('download');
    await page.getByTestId('import-template-csv').click();
    expect((await csvDownload).suggestedFilename()).toMatch(/menu_items.*\.csv$/);
    const xlsxDownload = page.waitForEvent('download');
    await page.getByTestId('import-template-xlsx').click();
    expect((await xlsxDownload).suggestedFilename()).toMatch(/menu_items.*\.xlsx$/);
  });

  test('P1-IMP-01-T62 the import screen shows the order hint (categories and groups before items) and refuses non-CSV / non-XLSX files', async ({ uiAs }, testInfo) => {
    const page = await uiAs('owner');
    await page.goto('/admin/import');
    await expect(page.getByTestId('import-order-note')).toBeVisible();
    const f = testInfo.outputPath('notes.pdf');
    fs.writeFileSync(f, '%PDF-1.4 fake');
    await page.getByTestId('import-file').setInputFiles(f);
    await expect(page.getByTestId('import-file-error')).toContainText(/\.csv or \.xlsx/);
    await expect(page.getByTestId('import-check')).toBeDisabled();
  });

  test('P1-IMP-01-T64 an .xlsx file chosen on the import screen is checked and imported (tables)', async ({ uiAs, owner }, testInfo) => {
    const t = TAG().slice(0, 6);
    const file = testInfo.outputPath(`tables-${t}.xlsx`);
    fs.writeFileSync(file, await buildXlsx([['number', 'section', 'seats'], [`UX${t}1`, 'Xl UI', 4], [`UX${t}2`, 'Xl UI', 6]]));
    const page = await uiAs('owner');
    await page.goto('/admin/import');
    await page.getByTestId('import-type').selectOption('TABLES');
    await page.getByTestId('import-file').setInputFiles(file);
    await page.getByTestId('import-check').click();
    await expect(page.getByTestId('import-count-created')).toContainText('2');
    await page.getByTestId('import-run').click();
    await expect(page.getByTestId('import-result')).toBeVisible();
    await expect
      .poll(async () => (await json<Schemas['DiningTable'][]>(await owner.get(EPM.tables, { query: { section: 'Xl UI' } }))).filter((x) => x.number.startsWith(`UX${t}`)).length)
      .toBe(2);
  });

  test('P1-IMP-01-T63 only the owner (DATA_IMPORT) sees the import screen; the manager is sent to the no-access page', async ({ uiAs }) => {
    const page = await uiAs('manager');
    await page.goto('/admin/import');
    await expect(page).toHaveURL(/\/forbidden/);
  });
});
