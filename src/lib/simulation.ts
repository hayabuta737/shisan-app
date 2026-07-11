// 資産運用の複利シミュレーション（UI非依存の純ロジック）。
// このファイルは App.jsx から独立させ、単体テスト可能にすることを目的とする
// （CLAUDE.md 第5章 P2 / 「計算ロジックの変更は検算とセット」ルール）。

/** 保有商品。rate は年率(%)、amount は初期投資額(円) */
export interface Holding {
  rate: number
  amount: number
}

/** 資産推移の1行。age 歳時点の合計資産額(円未満は四捨五入) */
export interface GrowthRow {
  age: number
  amount: number
}

/**
 * 複利計算（単一商品の将来価値）。
 *
 *   将来価値 = 元本 × (1 + 年率/100) ^ 年数
 *
 * 検算例: compoundAmount(1_000_000, 5, 10) = 1,000,000 × 1.05^10
 *        ≈ 1,628,894.63 円（四捨五入で約 162.9 万円。CLAUDE.md の検算例に一致）
 *
 * @param principal          元本（円）
 * @param annualRatePercent  年率（%表記。例: 5 は 5%）
 * @param years              運用年数（0以上）
 * @returns 将来価値（四捨五入しない生の値）
 */
export function compoundAmount(
  principal: number,
  annualRatePercent: number,
  years: number,
): number {
  return principal * Math.pow(1 + annualRatePercent / 100, years)
}

/**
 * 複数商品を合算した資産推移を、開始年齢から終了年齢まで1年刻みで算出する。
 *
 * UI側からは入力途中の値（空文字など）がそのまま渡り得るため、
 * 引数は number | string を受け付け、整数でなければ空配列を返す。
 *
 * @param startAge  開始年齢（整数）
 * @param endAge    終了年齢（整数, startAge以上）
 * @param holdings  保有商品の配列
 * @returns 各年齢時点の合計資産額。入力が不正な場合は空配列。
 */
export function simulateGrowth(
  startAge: number | string,
  endAge: number | string,
  holdings: Holding[],
): GrowthRow[] {
  const rows: GrowthRow[] = []

  // 年齢が整数でない（空文字・小数・NaN等）場合は計算しない
  if (!Number.isInteger(startAge) || !Number.isInteger(endAge)) {
    return rows
  }
  const start = startAge as number
  const years = (endAge as number) - start
  if (years < 0 || !Array.isArray(holdings) || holdings.length === 0) {
    return rows
  }

  for (let i = 0; i <= years; i++) {
    const total = holdings.reduce(
      (sum, h) => sum + compoundAmount(h.amount || 0, h.rate, i),
      0,
    )
    rows.push({
      age: start + i,
      amount: Math.round(total),
    })
  }
  return rows
}
