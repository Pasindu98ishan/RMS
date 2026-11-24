import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * jsdom does no layout, so the touch-target size (P1-NFR-02, screens.md "targets >= 48 px") is
 * checked on the component's own CSS. The Playwright NFR test measures the rendered button.
 */
const source = readFileSync(resolve(process.cwd(), 'src/components/UserMenu.vue'), 'utf8')

function ruleBody(selector: string): string {
  const start = source.indexOf(`${selector} {`)
  expect(start, `${selector} rule exists`).toBeGreaterThan(-1)
  return source.slice(start, source.indexOf('}', start))
}

describe('UserMenu button size', () => {
  it('P1-NFR-02 BUG-1-006 is at least 48 x 48 px (POS and kitchen headers)', () => {
    const body = ruleBody('.user-btn')
    const px = (prop: string) => Number(new RegExp(`${prop}:\\s*(\\d+)px`).exec(body)?.[1] ?? 0)
    expect(px('min-height')).toBeGreaterThanOrEqual(48)
    expect(px('min-width')).toBeGreaterThanOrEqual(48)
  })
})
