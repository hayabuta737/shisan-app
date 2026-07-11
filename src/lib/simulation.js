// 資産運用の複利シミュレーション（UI非依存の純ロジック）。
// このファイルは App.jsx から独立させ、単体テスト可能にすることを目的とする
// （CLAUDE.md 第5章 P2 / 「計算ロジックの変更は検算とセット」ルール）。

/**
 * 複利計算（単一商品の将来価値）。
 *
 *   将来価値 = 元本 × (1 + 年率/100) ^ 年数
 *
 * 検算例: compoundAmount(1_000_000, 5, 10) = 1,000,000 × 1.05^10
 *        ≈ 1,628,894.63 円（四捨五入で約 162.9 万円。CLAUDE.md の検算例に一致）
 *
 * @param {number} principal          元本（円）
 * @param {number} annualRatePercent  年率（%表記。例: 5 は 5%）
 * @param {number} years              運用年数（0以上）
 * @returns {number} 将来価値（四捨五入しない生の値）
 */
export function compoundAmount(principal, annualRatePercent, years) {
  return principal * Math.pow(1 + annualRatePercent / 100, years)
}

/**
 * 複数商品を合算した資産推移を、開始年齢から終了年齢まで1年刻みで算出する。
 *
 * @param {number} startAge  開始年齢（整数）
 * @param {number} endAge    終了年齢（整数, startAge以上）
 * @param {{ rate: number, amount: number }[]} holdings
 *        保有商品の配列。rate は年率(%)、amount は初期投資額(円)。
 * @returns {{ age: number, amount: number }[]}
 *        各年齢時点の合計資産額（amount は円未満を四捨五入）。
 *        入力が不正な場合は空配列を返す。
 */
export function simulateGrowth(startAge, endAge, holdings) {
  const rows = []

  // 年齢が整数でない（空文字・小数・NaN等）場合は計算しない
  if (!Number.isInteger(startAge) || !Number.isInteger(endAge)) {
    return rows
  }
  const years = endAge - startAge
  if (years < 0 || !Array.isArray(holdings) || holdings.length === 0) {
    return rows
  }

  for (let i = 0; i <= years; i++) {
    const total = holdings.reduce(
      (sum, h) => sum + compoundAmount(h.amount || 0, h.rate, i),
      0,
    )
    rows.push({
      age: startAge + i,
      amount: Math.round(total),
    })
  }
  return rows
}
