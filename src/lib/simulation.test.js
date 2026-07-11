import { describe, it, expect } from 'vitest'
import { compoundAmount, simulateGrowth } from './simulation'

describe('compoundAmount（単一商品の複利計算）', () => {
  it('100万円・年5%・10年 → 約1,628,895円（CLAUDE.mdの検算例）', () => {
    // 手計算: 1,000,000 × 1.05^10 = 1,628,894.626... ≈ 約162.9万円
    expect(compoundAmount(1_000_000, 5, 10)).toBeCloseTo(1_628_894.63, 2)
  })

  it('運用0年なら元本そのまま（利息はつかない）', () => {
    expect(compoundAmount(1_000_000, 7, 0)).toBe(1_000_000)
  })

  it('年利0%なら何年経っても元本のまま', () => {
    expect(compoundAmount(500_000, 0, 30)).toBe(500_000)
  })

  it('年100%なら1年ごとに倍になる', () => {
    // 手計算: 1,000,000 × 2^3 = 8,000,000
    expect(compoundAmount(1_000_000, 100, 3)).toBe(8_000_000)
  })
})

describe('simulateGrowth（複数商品の資産推移）', () => {
  it('30→32歳・年10%・100万円 → 100万/110万/121万の3行', () => {
    const rows = simulateGrowth(30, 32, [{ rate: 10, amount: 1_000_000 }])
    expect(rows).toEqual([
      { age: 30, amount: 1_000_000 }, // 100万 × 1.1^0
      { age: 31, amount: 1_100_000 }, // 100万 × 1.1^1
      { age: 32, amount: 1_210_000 }, // 100万 × 1.1^2
    ])
  })

  it('複数商品を合算する（年0%の100万 + 年100%の100万）', () => {
    const rows = simulateGrowth(40, 41, [
      { rate: 0, amount: 1_000_000 },
      { rate: 100, amount: 1_000_000 },
    ])
    // 開始時: 100万 + 100万 = 200万
    // 1年後: 100万(不変) + 200万(倍) = 300万
    expect(rows).toEqual([
      { age: 40, amount: 2_000_000 },
      { age: 41, amount: 3_000_000 },
    ])
  })

  it('円未満は四捨五入される（100万・年5%・10年目 → 1,628,895円）', () => {
    const rows = simulateGrowth(0, 10, [{ rate: 5, amount: 1_000_000 }])
    // 1,628,894.626... → Math.round → 1,628,895
    expect(rows.at(-1)).toEqual({ age: 10, amount: 1_628_895 })
  })

  it('終了年齢が開始年齢より小さいと空配列', () => {
    expect(simulateGrowth(50, 40, [{ rate: 5, amount: 1_000_000 }])).toEqual([])
  })

  it('商品が0件なら空配列', () => {
    expect(simulateGrowth(30, 60, [])).toEqual([])
  })

  it('年齢が整数でない（空文字など）と空配列', () => {
    expect(simulateGrowth('', 60, [{ rate: 5, amount: 1_000_000 }])).toEqual([])
    expect(simulateGrowth(30, 60.5, [{ rate: 5, amount: 1_000_000 }])).toEqual([])
  })
})
