import { describe, expect, it } from 'vitest'
import { roundCentavos } from './money'

describe('roundCentavos', () => {
  it('leaves whole and clean-centavo amounts unchanged', () => {
    expect(roundCentavos(5000)).toBe(5000)
    expect(roundCentavos(333.33)).toBe(333.33)
    expect(roundCentavos(0)).toBe(0)
  })

  it('rounds repeating decimals to whole centavos', () => {
    expect(roundCentavos(1000 / 3)).toBe(333.33) // 333.3333...
    expect(roundCentavos(2000 / 3)).toBe(666.67) // 666.6666...
    expect(roundCentavos(1 / 7)).toBe(0.14)
  })

  it('rounds half-centavo values up despite float representation error', () => {
    expect(roundCentavos(1.005)).toBe(1.01)
    expect(roundCentavos(2.675)).toBe(2.68)
  })
})
