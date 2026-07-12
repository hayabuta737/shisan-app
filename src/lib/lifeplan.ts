// 生涯マネープランの計算ロジック（UI非依存の純関数群）
// 仕様: docs/v2-requirements.md 3〜7章
//
// ── 仕様書にない前提(実装上の仮定。UIにも明示すること) ──
// 1. 子どもは「現在0歳」と仮定する(入力に子どもの年齢がないため)。
//    教育費は子どもが3〜21歳(幼稚園〜大学)の間、親の年齢に換算して計上する。
//    複数人の場合も全員同年齢(双子等)と仮定するため、実際とは教育費の
//    ピーク時期がずれる点に注意。
// 2. 世帯人数は「夫婦2人 + 子どもの人数」と仮定する(年金デフォルトが
//    夫婦2人のモデル年金であることと整合させる)。
// 3. リタイア前の生活費・教育費は勤労収入で賄われるとみなし、資産からは
//    支出しない。リタイア後は「支出 − 年金」を資産から取り崩す。
// 4. 年次モデル: 毎年末に「運用益 → 積立 → 取り崩し」の順で反映する。
// 5. 現在の保有資産は0円から開始する(v2.0の入力フォームに保有資産の
//    項目がないため)。既にリタイア済みの入力では積立フェーズが存在せず、
//    必要積立額が算出不能(null)になり得る。

import {
  LIVING_COST_MONTHLY,
  EDUCATION_COST_YEARLY,
  UNIVERSITY_COST,
  PENSION_MONTHLY,
  INFLATION_RATE_PERCENT,
} from '../data/officialData.js'

/** 自由記入の予定(例: 住宅頭金・車の買い替え) */
export interface ExtraEvent {
  label: string
  amount: number // 円(現在価値。インフレは計算側で適用)
  age: number // 発生時のユーザー年齢
}

export interface LifeplanInput {
  currentAge: number
  lifespan: number // 寿命想定(90/95/100)
  monthlyLivingCost: number // 基本生活費(月額円)
  childrenCount: number // 0〜4
  educationPolicy: 'public' | 'private' // 公立中心/私立中心
  retireAge: number
  pensionMonthly: number // 年金見込み(月額円)
  extraEvents: ExtraEvent[]
  inflationRatePercent: number // 年率%(既定2%)
}

/** 1年分の収支行 */
export interface YearRow {
  age: number
  expense: number // その年の支出合計(インフレ適用後)
  pension: number // その年の年金収入
  net: number // expense - pension
}

/** 資産推移の1行 */
export interface AssetRow {
  age: number
  assets: number
}

export interface AssetSimResult {
  rows: AssetRow[]
  totalContributed: number // 積立元本の累計
  totalInterest: number // 運用益の累計(サマリーカード③)
  depleted: boolean // 途中で資産がマイナスになったか
}

// シナリオ利回り(年率%)。docs/v2-requirements.md 6章の初期値。
// 根拠: 世界株式インデックスの長期名目リターンが年6%前後(MSCI ACWI等)、
// 債券を混ぜた保守的運用で年4%前後、さらに保守的な想定として年2%を置く。
// 将来は不確実であり、幅で考えるためにこの3本を同時に描く。
export const SCENARIO_RATES = {
  pessimistic: 2,
  standard: 4,
  optimistic: 6,
} as const

/**
 * インフレ適用。amount × (1+rate/100)^years
 * 検算: inflate(100, 10, 2) = 100 × 1.1^2 = 121
 */
export function inflate(amount: number, ratePercent: number, years: number): number {
  return amount * Math.pow(1 + ratePercent / 100, years)
}

/**
 * 未入力項目を政府公式データ(officialData.js)で補完した入力を作る。
 * 部分入力(Partial)を受け取り、完全な LifeplanInput を返す。
 */
export function applyDefaults(partial: Partial<LifeplanInput>): LifeplanInput {
  // 子どもの人数は仕様上0〜4。範囲外の値は防御的にクランプする
  const childrenCount = Math.max(0, Math.min(partial.childrenCount ?? 0, 4))
  // 仮定2: 世帯人数 = 夫婦2人 + 子ども(家計調査のbyMembersは6人以上が上限)
  const householdSize = Math.min(2 + childrenCount, 6)
  const byMembers = LIVING_COST_MONTHLY.byMembers as Record<number, number>
  return {
    currentAge: partial.currentAge ?? 30,
    lifespan: partial.lifespan ?? 100, // 既定100歳(3章)
    monthlyLivingCost: partial.monthlyLivingCost ?? byMembers[householdSize],
    childrenCount,
    educationPolicy: partial.educationPolicy ?? 'public',
    retireAge: partial.retireAge ?? 65,
    pensionMonthly: partial.pensionMonthly ?? PENSION_MONTHLY.modelCouple,
    extraEvents: partial.extraEvents ?? [],
    inflationRatePercent: partial.inflationRatePercent ?? INFLATION_RATE_PERCENT,
  }
}

/**
 * 子ども1人の「子ども年齢→その年の教育費(現在価値)」を返す。
 * 幼稚園3-5歳 / 小学校6-11歳 / 中学校12-14歳 / 高校15-17歳 / 大学18-21歳。
 * 大学は授業料+施設設備費(年額)、18歳時に入学料を加算。
 */
export function educationCostAtChildAge(
  childAge: number,
  policy: 'public' | 'private',
): number {
  const e = EDUCATION_COST_YEARLY
  if (childAge >= 3 && childAge <= 5) return e.kindergarten[policy]
  if (childAge >= 6 && childAge <= 11) return e.elementary[policy]
  if (childAge >= 12 && childAge <= 14) return e.juniorHigh[policy]
  if (childAge >= 15 && childAge <= 17) return e.highSchool[policy]
  if (childAge >= 18 && childAge <= 21) {
    // 公立中心→国立大学 / 私立中心→私立大学 とみなす
    const u = policy === 'public' ? UNIVERSITY_COST.national : UNIVERSITY_COST.private
    const yearly = u.tuitionYearly + u.facilityYearly
    return childAge === 18 ? yearly + u.admissionFee : yearly
  }
  return 0
}

/**
 * 現在年齢から寿命の前年まで、1年ごとの収支(支出・年金・差引)を作る。
 * - 支出 = (生活費12か月 + 教育費 + 自由記入イベント) にインフレ適用
 * - 年金 = リタイア年齢以降、毎年12か月分(名目のまま)
 */
export function buildYearlySchedule(input: LifeplanInput): YearRow[] {
  const rows: YearRow[] = []
  for (let age = input.currentAge; age < input.lifespan; age++) {
    const k = age - input.currentAge // 経過年数(インフレ用)
    const childAge = k // 仮定1: 子どもは現在0歳
    let base = input.monthlyLivingCost * 12
    base += input.childrenCount * educationCostAtChildAge(childAge, input.educationPolicy)
    for (const ev of input.extraEvents) {
      if (ev.age === age) base += ev.amount
    }
    const expense = inflate(base, input.inflationRatePercent, k)
    const pension = age >= input.retireAge ? input.pensionMonthly * 12 : 0
    rows.push({ age, expense: Math.round(expense), pension, net: Math.round(expense) - pension })
  }
  return rows
}

/** ⑴ 生涯必要額 = Σ(支出) − Σ(リタイア後の年金)。3章の定義どおり */
export function lifetimeRequired(schedule: YearRow[]): number {
  return schedule.reduce((sum, r) => sum + r.net, 0)
}

/**
 * ⑶ 必要額ライン: 各年齢時点の「その時点から寿命までに必要な残額」。
 *
 * 「残額」は割引現在価値で計算する: その年齢時点でこの金額の資産があれば、
 * 年率 annualRatePercent で運用しながら、以降の net(支出−年金)を寿命まで
 * すべて賄える金額。simulateAssets と同じ「運用益が付いた後の年末に支出」
 * というタイミングに揃え、末尾からの漸化式 acc = (acc + net)/(1+r) で求める。
 * ※単純な現金合計(利回り0扱い)にすると必要額が過大になり、
 *   クロスオーバーが寿命近くまで現れなくなる(金融的に不正確)。
 *   利回り0%を渡せば単純合計と一致するので手計算検証はそのまま可能。
 *
 * 検算: net=120万円/年が2年続く場合(r=100%)、
 *   最終年: acc = (0 + 120万)/2 = 60万
 *   前 年: acc = (60万 + 120万)/2 = 90万
 *   → 「90万円あれば賄える」: 90万→倍増180万→支出120万→残60万
 *      →倍増120万→支出120万→残0 ✓ (simulateAssetsと同じ順序)
 */
export function requiredRemainingLine(
  schedule: YearRow[],
  annualRatePercent: number,
): AssetRow[] {
  const r = annualRatePercent / 100
  const line: AssetRow[] = []
  let acc = 0
  for (let i = schedule.length - 1; i >= 0; i--) {
    acc = (acc + schedule[i].net) / (1 + r)
    line.unshift({ age: schedule[i].age, assets: Math.max(Math.round(acc), 0) })
  }
  // 終端点: 寿命時点では全支出を払い終えており、必要残額は0円。
  // この点がないと「ちょうど枯渇しない最小積立」のケースで交差が検出できない
  if (schedule.length > 0) {
    line.push({ age: schedule[schedule.length - 1].age + 1, assets: 0 })
  }
  return line
}

/**
 * 資産曲線のシミュレーション(年次)。
 * 毎年: 運用益(年率r) → リタイア前なら積立(月額×12) → リタイア後なら
 * その年の net(支出−年金) を取り崩し。
 */
export function simulateAssets(
  input: LifeplanInput,
  schedule: YearRow[],
  monthlyContribution: number,
  annualRatePercent: number,
): AssetSimResult {
  const r = annualRatePercent / 100
  let assets = 0
  let totalContributed = 0
  let totalInterest = 0
  let depleted = false
  const rows: AssetRow[] = []
  // 起点(現在年齢・資産0円)。年金余剰などで「今すでに自由」なケースの
  // クロスオーバー判定を1年遅らせないために含める
  if (schedule.length > 0) {
    rows.push({ age: schedule[0].age, assets: 0 })
  }
  for (const row of schedule) {
    const interest = assets * r
    totalInterest += interest
    assets += interest
    if (row.age < input.retireAge) {
      assets += monthlyContribution * 12
      totalContributed += monthlyContribution * 12
    } else {
      assets -= row.net // netが負(年金余り)なら資産が増える
    }
    if (assets < 0) depleted = true
    rows.push({ age: row.age + 1, assets: Math.round(assets) }) // 年末時点
  }
  return { rows, totalContributed, totalInterest: Math.round(totalInterest), depleted }
}

/**
 * ⑵ 必要な毎月積立額: 寿命まで資産が枯渇しない最小の月額を二分探索で求める。
 * 上限1,000万円/月まで探索し、それでも枯渇する場合は null(現実的でない入力)。
 */
export function findRequiredMonthlyContribution(
  input: LifeplanInput,
  schedule: YearRow[],
  annualRatePercent: number,
): number | null {
  const feasible = (m: number) => !simulateAssets(input, schedule, m, annualRatePercent).depleted
  if (feasible(0)) return 0
  let lo = 0
  let hi = 10_000_000
  if (!feasible(hi)) return null
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (feasible(mid)) hi = mid
    else lo = mid
  }
  return hi
}

/**
 * ⑶ クロスオーバーポイント: 資産曲線が必要額ラインに初めて追いつく年齢。
 * 交差しない場合は null(UIは「積立額を月+○円で到達」と建設的に表示する)。
 */
export function findCrossoverAge(
  assetRows: AssetRow[],
  remainingLine: AssetRow[],
): number | null {
  const remainingByAge = new Map(remainingLine.map((r) => [r.age, r.assets]))
  for (const row of assetRows) {
    const remaining = remainingByAge.get(row.age)
    if (remaining !== undefined && row.assets >= remaining) return row.age
  }
  return null
}

/** ⑸ サマリーカード3枚分の計算結果 */
export interface LifeplanSummary {
  lifetimeRequired: number // ①生涯必要額
  monthlyContribution: number | null // ②必要な毎月積立額
  investmentGain: number // ③運用で増えた分(標準シナリオ・寿命時点)
  crossoverAge: number | null // 安心ラインに到達する年齢
}

/** 入力(部分可)から、サマリーカードに必要な数値一式を計算する */
export function computeSummary(partial: Partial<LifeplanInput>): LifeplanSummary {
  const input = applyDefaults(partial)
  const schedule = buildYearlySchedule(input)
  const required = lifetimeRequired(schedule)
  const monthly = findRequiredMonthlyContribution(input, schedule, SCENARIO_RATES.standard)
  const sim = simulateAssets(input, schedule, monthly ?? 0, SCENARIO_RATES.standard)
  const crossover = findCrossoverAge(
    sim.rows,
    requiredRemainingLine(schedule, SCENARIO_RATES.standard),
  )
  return {
    lifetimeRequired: required,
    monthlyContribution: monthly,
    investmentGain: sim.totalInterest,
    crossoverAge: crossover,
  }
}
