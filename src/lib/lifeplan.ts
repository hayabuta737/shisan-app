// 生涯マネープランの計算ロジック（UI非依存の純関数群）
// 仕様: docs/v2-requirements.md 3〜7章
//
// ── 仕様書にない前提(実装上の仮定。UIにも明示すること) ──
// 1. 子どもは「現在0歳」と仮定する(入力に子どもの年齢がないため)。
//    教育費は子どもが3〜21歳(幼稚園〜大学)の間、親の年齢に換算して計上する。
//    複数人の場合も全員同年齢(双子等)と仮定するため、実際とは教育費の
//    ピーク時期がずれる点に注意。
// 2. 世帯人数は「本人(+配偶者) + 子どもの人数」で算出する。
//    hasSpouse=true なら本人+配偶者の2人、false なら本人1人を基数とし、
//    生活費(家計調査)と年金の既定値を世帯構成に合わせて補完する。
// 3. 年次モデル: 毎年末に「運用益 → 収支の反映」の順。
//    実際の推移(simulateActual)では、リタイア前は(世帯収入−世帯支出)を貯蓄として
//    資産に加え、リタイア後は(年金−世帯支出)を反映(不足なら取り崩す)。
// 4. 現在の金融資産(startingAssets)を開始残高とする。
// 5. 「安心ライン/クロスオーバー」は Financial Independence の考え方:
//    その年齢で働くのをやめた場合に、以降の(支出−年金)を寿命まで賄えるだけの
//    資産があるか、で判定する(requiredRemainingLineは勤労収入を除いた必要残額)。
// 6. 世帯収入・支出はインフレ率で名目成長させる(実質は一定と仮定)。
//    一方、年金は名目固定(インフレ非連動)とする。長生き・高インフレ時に
//    保守的(必要額が大きめ)になる。
// 7. 現在の金融資産(startingAssets)は、商品別の内訳にかかわらず、選択した
//    運用商品の期待利回り(標準シナリオ)で成長すると仮定する(簡略化)。

import {
  LIVING_COST_MONTHLY,
  HOUSEHOLD_INCOME_MONTHLY,
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
  monthlyExpense: number // 世帯支出(月額円・家賃/ローン含む)
  monthlyIncome: number // 世帯収入(手取り月額円・リタイア前の勤労収入)
  startingAssets: number // 現在の金融資産(シミュレーションの開始残高)
  hasSpouse: boolean // 配偶者の有無(世帯人数・年金の既定値に影響)
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
  income: number // その年の勤労収入(リタイア前のみ・インフレ適用後)
  pension: number // その年の年金収入(リタイア後のみ)
  net: number // expense - pension（働くのをやめた場合に資産で賄う額）
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
 * 世帯人数 = 本人(+配偶者) + 子ども。子どもは仕様上0〜4にクランプ。
 * (UIの生活費ヒント表示と計算の両方でこの1関数を使い、ロジック重複を避ける)
 */
export function householdSize(hasSpouse: boolean, childrenCount: number): number {
  return (hasSpouse ? 2 : 1) + Math.max(0, Math.min(childrenCount, 4))
}

/**
 * 生活費(月額)の既定値。1人は単身世帯、2〜6人は家計調査の世帯人員別平均
 * (6人以上が上限)を使う。
 */
export function livingCostDefault(hasSpouse: boolean, childrenCount: number): number {
  const size = householdSize(hasSpouse, childrenCount)
  const byMembers = LIVING_COST_MONTHLY.byMembers as Record<number, number>
  return size <= 1 ? LIVING_COST_MONTHLY.single : byMembers[Math.min(size, 6)]
}

/**
 * 世帯収入(手取り月額)の既定値。1人は単身勤労者世帯、2人以上は二人以上の
 * 勤労者世帯の可処分所得(家計調査2024)を使う。
 */
export function incomeDefault(hasSpouse: boolean, childrenCount: number): number {
  const size = householdSize(hasSpouse, childrenCount)
  return size <= 1 ? HOUSEHOLD_INCOME_MONTHLY.single : HOUSEHOLD_INCOME_MONTHLY.multiWorker
}

/**
 * 未入力項目を政府公式データ(officialData.js)で補完した入力を作る。
 * 部分入力(Partial)を受け取り、完全な LifeplanInput を返す。
 */
export function applyDefaults(partial: Partial<LifeplanInput>): LifeplanInput {
  // 子どもの人数は仕様上0〜4。範囲外の値は防御的にクランプする
  const childrenCount = Math.max(0, Math.min(partial.childrenCount ?? 0, 4))
  const hasSpouse = partial.hasSpouse ?? true
  const expenseDefault = livingCostDefault(hasSpouse, childrenCount)
  const monthlyIncomeDefault = incomeDefault(hasSpouse, childrenCount)
  // 年金の既定値: 独身は本人分のみ、配偶者ありは本人分+配偶者の基礎年金満額。
  // 配偶者あり時の合計は公式のモデル年金(夫婦2人)と一致する。
  // ※App.jsxは自前でpensionMonthlyを確定して渡すため、この既定値は
  //   computeSummary経由(テスト・lib直接呼び出し)でのみ使われる。
  const pensionDefault = hasSpouse
    ? PENSION_MONTHLY.selfModel + PENSION_MONTHLY.spouseBasic
    : PENSION_MONTHLY.selfModel
  return {
    currentAge: partial.currentAge ?? 30,
    lifespan: partial.lifespan ?? 100, // 既定100歳(3章)
    monthlyExpense: partial.monthlyExpense ?? expenseDefault,
    monthlyIncome: partial.monthlyIncome ?? monthlyIncomeDefault,
    startingAssets: partial.startingAssets ?? 0, // 現在の金融資産(未入力は0)
    hasSpouse,
    childrenCount,
    educationPolicy: partial.educationPolicy ?? 'public',
    retireAge: partial.retireAge ?? 65,
    pensionMonthly: partial.pensionMonthly ?? pensionDefault,
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
 * 現在年齢から寿命の前年まで、1年ごとの収支(支出・収入・年金・差引)を作る。
 * - 支出 = (世帯支出12か月 + 教育費 + 自由記入イベント) にインフレ適用
 * - 収入 = リタイア前のみ、世帯収入12か月分にインフレ適用
 * - 年金 = リタイア年齢以降、毎年12か月分(名目のまま)
 */
export function buildYearlySchedule(input: LifeplanInput): YearRow[] {
  const rows: YearRow[] = []
  for (let age = input.currentAge; age < input.lifespan; age++) {
    const k = age - input.currentAge // 経過年数(インフレ用)
    const childAge = k // 仮定1: 子どもは現在0歳
    let base = input.monthlyExpense * 12
    base += input.childrenCount * educationCostAtChildAge(childAge, input.educationPolicy)
    for (const ev of input.extraEvents) {
      if (ev.age === age) base += ev.amount
    }
    const expense = Math.round(inflate(base, input.inflationRatePercent, k))
    const income =
      age < input.retireAge
        ? Math.round(inflate(input.monthlyIncome * 12, input.inflationRatePercent, k))
        : 0
    const pension = age >= input.retireAge ? input.pensionMonthly * 12 : 0
    rows.push({ age, expense, income, pension, net: expense - pension })
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
 * 「必要な最低積立額」判定用の資産シミュレーション(年次)。
 * リタイア前の生活費は勤労収入で賄われる前提で、資産には毎年一定額
 * (monthlyContribution×12)だけ積み立てる。リタイア後は net(支出−年金)を取り崩す。
 * 開始残高は現在の金融資産(startingAssets)。
 */
export function simulateAssets(
  input: LifeplanInput,
  schedule: YearRow[],
  monthlyContribution: number,
  annualRatePercent: number,
): AssetSimResult {
  const r = annualRatePercent / 100
  let assets = input.startingAssets
  let totalContributed = 0
  let totalInterest = 0
  let depleted = false
  const rows: AssetRow[] = []
  if (schedule.length > 0) {
    rows.push({ age: schedule[0].age, assets: Math.round(assets) })
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
 * 実際の資産推移シミュレーション(年次)。グラフに表示する曲線。
 * 開始残高は現在の金融資産。毎年、運用益を付けたあとに実際の収支を反映する:
 *   リタイア前 = 世帯収入 − 世帯支出 (貯蓄。負なら取り崩し)
 *   リタイア後 = 年金 − 世帯支出   (通常は取り崩し)
 * totalContributed には貯蓄(プラスの収支)の累計を入れる。
 */
export function simulateActual(
  input: LifeplanInput,
  schedule: YearRow[],
  annualRatePercent: number,
): AssetSimResult {
  const r = annualRatePercent / 100
  let assets = input.startingAssets
  let totalContributed = 0
  let totalInterest = 0
  let depleted = false
  const rows: AssetRow[] = []
  if (schedule.length > 0) {
    rows.push({ age: schedule[0].age, assets: Math.round(assets) })
  }
  for (const row of schedule) {
    const interest = assets * r
    totalInterest += interest
    assets += interest
    const flow = row.income + row.pension - row.expense
    if (flow > 0) totalContributed += flow
    assets += flow
    if (assets < 0) depleted = true
    rows.push({ age: row.age + 1, assets: Math.round(assets) })
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

/** ⑸ サマリーカード分の計算結果 */
export interface LifeplanSummary {
  lifetimeRequired: number // ①生涯必要額
  requiredMonthlyContribution: number | null // 必要な最低積立額(月)
  actualMonthlySaving: number // あなたの毎月の貯蓄額(世帯収入−世帯支出)
  investmentGain: number // ③運用で増えた分(実際の推移・標準シナリオ)
  crossoverAge: number | null // 安心ライン(FI)に到達する年齢
}

/** 入力(部分可)から、サマリーカードに必要な数値一式を計算する */
export function computeSummary(partial: Partial<LifeplanInput>): LifeplanSummary {
  const input = applyDefaults(partial)
  const schedule = buildYearlySchedule(input)
  const required = lifetimeRequired(schedule)
  // 必要な最低積立額(参考): リタイア前に毎月いくら積み立てれば枯渇しないか
  const minMonthly = findRequiredMonthlyContribution(input, schedule, SCENARIO_RATES.standard)
  // 実際の推移: 世帯収入−世帯支出を貯蓄として積み上げ、クロスオーバーと運用益を出す
  const actual = simulateActual(input, schedule, SCENARIO_RATES.standard)
  const crossover = findCrossoverAge(
    actual.rows,
    requiredRemainingLine(schedule, SCENARIO_RATES.standard),
  )
  return {
    lifetimeRequired: required,
    requiredMonthlyContribution: minMonthly,
    actualMonthlySaving: input.monthlyIncome - input.monthlyExpense,
    investmentGain: actual.totalInterest,
    crossoverAge: crossover,
  }
}
