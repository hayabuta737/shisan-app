import { describe, it, expect } from 'vitest'
import {
  inflate,
  applyDefaults,
  householdSize,
  livingCostDefault,
  incomeDefault,
  educationCostAtChildAge,
  buildYearlySchedule,
  lifetimeRequired,
  requiredRemainingLine,
  simulateAssets,
  simulateActual,
  findRequiredMonthlyContribution,
  findCrossoverAge,
  computeSummary,
  type LifeplanInput,
} from './lifeplan'
import {
  LIVING_COST_MONTHLY,
  HOUSEHOLD_INCOME_MONTHLY,
  EDUCATION_COST_YEARLY,
  UNIVERSITY_COST,
  PENSION_MONTHLY,
} from '../data/officialData.js'

// テスト用の基本入力(インフレ0%・子ども0人・収入0など、手計算しやすい値)
const base: LifeplanInput = {
  currentAge: 60,
  lifespan: 64,
  monthlyExpense: 100_000,
  monthlyIncome: 0, // simulateActualを使うテストでは個別に上書きする
  startingAssets: 0,
  hasSpouse: true,
  childrenCount: 0,
  educationPolicy: 'public',
  retireAge: 62,
  pensionMonthly: 0,
  extraEvents: [],
  inflationRatePercent: 0,
}

describe('inflate（インフレ適用）', () => {
  it('0年なら元の金額のまま', () => {
    expect(inflate(100_000, 2, 0)).toBe(100_000)
  })

  it('年10%・2年 → 100 × 1.1^2 = 121（手計算）', () => {
    expect(inflate(100, 10, 2)).toBeCloseTo(121, 10)
  })
})

describe('applyDefaults（政府データによる補完）', () => {
  it('未入力は公式データで補完される（生活費=夫婦2人世帯、年金=モデル年金、寿命=100歳）', () => {
    const d = applyDefaults({})
    // 子ども0人 → 世帯人数2人 → 家計調査の2人世帯 268,755円/月
    expect(d.monthlyExpense).toBe(LIVING_COST_MONTHLY.byMembers[2])
    // 収入は二人以上勤労者世帯の可処分所得、資産は0で開始
    expect(d.monthlyIncome).toBe(HOUSEHOLD_INCOME_MONTHLY.multiWorker)
    expect(d.startingAssets).toBe(0)
    expect(d.pensionMonthly).toBe(PENSION_MONTHLY.modelCouple)
    expect(d.lifespan).toBe(100)
    expect(d.retireAge).toBe(65)
    expect(d.inflationRatePercent).toBe(2)
  })

  it('子ども2人 → 世帯人数4人の生活費(341,400円/月)で補完される', () => {
    const d = applyDefaults({ childrenCount: 2 })
    expect(d.monthlyExpense).toBe(LIVING_COST_MONTHLY.byMembers[4])
  })

  it('独身・子0人 → 単身世帯の生活費・収入・本人分のみの年金で補完される', () => {
    const d = applyDefaults({ hasSpouse: false })
    expect(d.monthlyExpense).toBe(LIVING_COST_MONTHLY.single) // 169,547
    expect(d.monthlyIncome).toBe(HOUSEHOLD_INCOME_MONTHLY.single) // 305,863
    expect(d.pensionMonthly).toBe(PENSION_MONTHLY.selfModel) // 166,671(本人分のみ)
  })

  it('配偶者あり・子0人 → 2人世帯の生活費・年金は本人分+配偶者分(=モデル年金)', () => {
    const d = applyDefaults({ hasSpouse: true })
    expect(d.monthlyExpense).toBe(LIVING_COST_MONTHLY.byMembers[2])
    // 検算: selfModel(166,671) + spouseBasic(70,608) = 237,279 = modelCouple
    expect(d.pensionMonthly).toBe(PENSION_MONTHLY.selfModel + PENSION_MONTHLY.spouseBasic)
    expect(d.pensionMonthly).toBe(PENSION_MONTHLY.modelCouple)
  })

  it('独身・子1人 → 世帯人数2人の生活費で補完される', () => {
    const d = applyDefaults({ hasSpouse: false, childrenCount: 1 })
    expect(d.monthlyExpense).toBe(LIVING_COST_MONTHLY.byMembers[2])
  })

  it('入力した現在の金融資産・収入・支出はそのまま使われる', () => {
    const d = applyDefaults({ startingAssets: 5_000_000, monthlyIncome: 400_000, monthlyExpense: 250_000 })
    expect(d.startingAssets).toBe(5_000_000)
    expect(d.monthlyIncome).toBe(400_000)
    expect(d.monthlyExpense).toBe(250_000)
  })
})

describe('incomeDefault（世帯収入の既定値）', () => {
  it('1人世帯は単身勤労者、2人以上は二人以上勤労者の可処分所得', () => {
    expect(incomeDefault(false, 0)).toBe(HOUSEHOLD_INCOME_MONTHLY.single)
    expect(incomeDefault(true, 0)).toBe(HOUSEHOLD_INCOME_MONTHLY.multiWorker)
    expect(incomeDefault(false, 2)).toBe(HOUSEHOLD_INCOME_MONTHLY.multiWorker) // 独身+子2=3人
  })
})

describe('householdSize / livingCostDefault（表示と計算で共有するヘルパー）', () => {
  it('世帯人数 = 本人(+配偶者) + 子ども。子どもは0〜4にクランプ', () => {
    expect(householdSize(false, 0)).toBe(1) // 独身
    expect(householdSize(true, 0)).toBe(2) // 夫婦
    expect(householdSize(true, 2)).toBe(4)
    expect(householdSize(true, 9)).toBe(6) // 子は4にクランプ → 2+4=6
    expect(householdSize(false, -3)).toBe(1) // 負数もクランプ
  })

  it('生活費の既定値は世帯人数に対応する（1人=単身、上限6人）', () => {
    expect(livingCostDefault(false, 0)).toBe(LIVING_COST_MONTHLY.single)
    expect(livingCostDefault(true, 0)).toBe(LIVING_COST_MONTHLY.byMembers[2])
    expect(livingCostDefault(true, 4)).toBe(LIVING_COST_MONTHLY.byMembers[6])
  })
})

describe('educationCostAtChildAge（教育費の段階判定）', () => {
  it('各段階の年額が学習費調査の値と一致する（公立）', () => {
    expect(educationCostAtChildAge(0, 'public')).toBe(0) // 未就園
    expect(educationCostAtChildAge(4, 'public')).toBe(EDUCATION_COST_YEARLY.kindergarten.public)
    expect(educationCostAtChildAge(8, 'public')).toBe(EDUCATION_COST_YEARLY.elementary.public)
    expect(educationCostAtChildAge(13, 'public')).toBe(EDUCATION_COST_YEARLY.juniorHigh.public)
    expect(educationCostAtChildAge(16, 'public')).toBe(EDUCATION_COST_YEARLY.highSchool.public)
    expect(educationCostAtChildAge(22, 'public')).toBe(0) // 卒業後
  })

  it('大学は18歳のみ入学料が加算される（公立中心=国立）', () => {
    const u = UNIVERSITY_COST.national
    expect(educationCostAtChildAge(18, 'public')).toBe(u.tuitionYearly + u.admissionFee)
    expect(educationCostAtChildAge(19, 'public')).toBe(u.tuitionYearly)
  })

  it('各段階の年齢境界が正しい（2/3歳・5/6歳・21/22歳など）', () => {
    const e = EDUCATION_COST_YEARLY
    expect(educationCostAtChildAge(2, 'public')).toBe(0) // 入園前
    expect(educationCostAtChildAge(3, 'public')).toBe(e.kindergarten.public)
    expect(educationCostAtChildAge(5, 'public')).toBe(e.kindergarten.public)
    expect(educationCostAtChildAge(6, 'public')).toBe(e.elementary.public)
    expect(educationCostAtChildAge(11, 'public')).toBe(e.elementary.public)
    expect(educationCostAtChildAge(12, 'public')).toBe(e.juniorHigh.public)
    expect(educationCostAtChildAge(14, 'public')).toBe(e.juniorHigh.public)
    expect(educationCostAtChildAge(15, 'public')).toBe(e.highSchool.public)
    expect(educationCostAtChildAge(17, 'public')).toBe(e.highSchool.public)
    expect(educationCostAtChildAge(21, 'public')).toBe(UNIVERSITY_COST.national.tuitionYearly)
    expect(educationCostAtChildAge(22, 'public')).toBe(0) // 卒業後
  })
})

describe('buildYearlySchedule / lifetimeRequired（生涯必要額）', () => {
  it('生活費のみ・インフレ0%: 月10万×4年 = 480万円（手計算）', () => {
    const schedule = buildYearlySchedule({ ...base, retireAge: 64 }) // 年金なし
    expect(schedule).toHaveLength(4) // 60,61,62,63歳の4年分
    expect(schedule[0].expense).toBe(1_200_000)
    expect(lifetimeRequired(schedule)).toBe(4_800_000)
  })

  it('年金が支出を上回る年はnetが負になり、生涯必要額から差し引かれる', () => {
    // 62歳リタイア後は年金20万/月 > 生活費10万/月 → 2年間で240万円の余剰
    // 生涯必要額 = 480万(支出) − 480万(年金2年分) = 0円
    const schedule = buildYearlySchedule({ ...base, pensionMonthly: 200_000 })
    expect(schedule[2].net).toBe(1_200_000 - 2_400_000) // 62歳: -120万
    expect(lifetimeRequired(schedule)).toBe(4_800_000 - 4_800_000)
  })

  it('インフレ2%が支出のみに複利で効く（2年目 = 1.2M × 1.02）', () => {
    const schedule = buildYearlySchedule({ ...base, inflationRatePercent: 2 })
    expect(schedule[1].expense).toBe(Math.round(1_200_000 * 1.02))
    expect(schedule[3].expense).toBe(Math.round(1_200_000 * 1.02 ** 3))
  })

  it('自由記入イベントは指定年齢の支出に加算される', () => {
    const schedule = buildYearlySchedule({
      ...base,
      extraEvents: [{ label: '車', amount: 3_000_000, age: 61 }],
    })
    expect(schedule[1].expense).toBe(1_200_000 + 3_000_000)
  })
})

describe('simulateAssets（資産曲線）', () => {
  it('利回り0%: 積立2年で 月5万×24か月 = 120万円、以後取り崩し（手計算）', () => {
    // 60-61歳: 積立5万/月。62-63歳: 生活費10万/月を取り崩し
    const schedule = buildYearlySchedule(base)
    const sim = simulateAssets(base, schedule, 50_000, 0)
    expect(sim.rows.map((r) => r.assets)).toEqual([
      0, // 60歳時点(起点): 資産0
      600_000, // 61歳時点: 5万×12
      1_200_000, // 62歳時点: +5万×12
      0, // 63歳時点: -120万(生活費)
      -1_200_000, // 64歳時点: -120万 → 枯渇
    ])
    expect(sim.depleted).toBe(true)
    expect(sim.totalContributed).toBe(1_200_000)
  })

  it('利回り100%なら毎年2倍+積立（手計算: 60→120+120=240万）', () => {
    const schedule = buildYearlySchedule({ ...base, lifespan: 62 })
    const sim = simulateAssets({ ...base, lifespan: 62 }, schedule, 100_000, 100)
    // 1年目: 0×2 + 120万 = 120万 / 2年目: 120万×2 + 120万 = 360万
    expect(sim.rows.map((r) => r.assets)).toEqual([0, 1_200_000, 3_600_000])
    expect(sim.totalInterest).toBe(1_200_000) // 2年目の運用益120万のみ
  })
})

describe('simulateActual（実際の資産推移: 収入−支出で貯蓄）', () => {
  it('利回り0%: 収入15万−支出10万=月5万貯蓄を2年、以後取り崩し（手計算）', () => {
    const input = { ...base, monthlyIncome: 150_000 }
    const schedule = buildYearlySchedule(input)
    const sim = simulateActual(input, schedule, 0)
    expect(sim.rows.map((r) => r.assets)).toEqual([
      0, // 60歳(起点)
      600_000, // 61歳: +（15万−10万）×12
      1_200_000, // 62歳: +60万
      0, // 63歳: リタイア後 -120万(支出のみ)
      -1_200_000, // 64歳: -120万 → 枯渇
    ])
    expect(sim.depleted).toBe(true)
    expect(sim.totalContributed).toBe(1_200_000) // プラス収支の累計
  })

  it('現在の金融資産を開始残高として使う（収支トントン→リタイア後に取り崩し）', () => {
    // 収入=支出(月10万)でリタイア前の貯蓄0。開始240万でリタイア後2年を賄う
    const input = { ...base, monthlyIncome: 100_000, startingAssets: 2_400_000 }
    const schedule = buildYearlySchedule(input)
    const sim = simulateActual(input, schedule, 0)
    expect(sim.rows.map((r) => r.assets)).toEqual([
      2_400_000, 2_400_000, 2_400_000, 1_200_000, 0,
    ])
    expect(sim.depleted).toBe(false)
  })
})

describe('findRequiredMonthlyContribution（必要な毎月積立額）', () => {
  it('利回り0%: リタイア後2年の生活費240万 ÷ 積立24か月 = 月10万円（手計算）', () => {
    const schedule = buildYearlySchedule(base)
    expect(findRequiredMonthlyContribution(base, schedule, 0)).toBe(100_000)
  })

  it('年金で支出が全て賄えるなら積立は0円', () => {
    const input = { ...base, pensionMonthly: 100_000 }
    const schedule = buildYearlySchedule(input)
    expect(findRequiredMonthlyContribution(input, schedule, 0)).toBe(0)
  })

  it('現在の金融資産が十分あれば追加の積立は0円（startingAssetsが起点になる）', () => {
    // リタイア後2年の支出240万を、開始残高240万で賄える → 積立不要
    const input = { ...base, startingAssets: 2_400_000 }
    const schedule = buildYearlySchedule(input)
    expect(findRequiredMonthlyContribution(input, schedule, 0)).toBe(0)
  })
})

describe('requiredRemainingLine（必要額ライン）', () => {
  it('利回り0%なら単純合計と一致する（手計算: 480万→360万→240万→120万→0）', () => {
    const schedule = buildYearlySchedule({ ...base, retireAge: 64 })
    const line = requiredRemainingLine(schedule, 0)
    expect(line.map((r) => r.assets)).toEqual([
      4_800_000, 3_600_000, 2_400_000, 1_200_000, 0,
    ])
  })

  it('利回りがあると割引現在価値になる（手計算: r=100%で120万/年×2年 → 90万）', () => {
    // 年末払い(simulateAssetsと同じ順序): 最終年 (0+120万)/2 = 60万
    // 前年 (60万+120万)/2 = 90万。検算: 90万→倍増180万→支出120万→残60万
    // →倍増120万→支出120万→残0 ✓
    const schedule = buildYearlySchedule({ ...base, lifespan: 62, retireAge: 62 })
    const line = requiredRemainingLine(schedule, 100)
    expect(line.map((r) => r.assets)).toEqual([900_000, 600_000, 0])
  })
})

describe('findCrossoverAge（クロスオーバーポイント）', () => {
  it('資産が必要残額に追いつく最初の年齢を返す', () => {
    // 月10万積立・利回り0%: 資産は61歳120万→62歳240万。
    // 必要残額: 60歳480万→61歳360万→62歳240万→63歳120万。
    // 62歳時点: 資産240万 ≥ 残額240万 → 交差は62歳
    const schedule = buildYearlySchedule({ ...base, retireAge: 64 })
    const sim = simulateAssets({ ...base, retireAge: 64 }, schedule, 100_000, 0)
    const line = requiredRemainingLine(schedule, 0)
    expect(findCrossoverAge(sim.rows, line)).toBe(62)
  })

  it('交差しない場合はnullを返す（積立不足で資産が枯渇するケース）', () => {
    // 月1,000円では62歳リタイア後の生活費(月10万)で資産がマイナスに落ち、
    // どの年齢でも必要残額に届かない → null
    const schedule = buildYearlySchedule(base)
    const sim = simulateAssets(base, schedule, 1_000, 0)
    expect(sim.depleted).toBe(true)
    const line = requiredRemainingLine(schedule, 0)
    expect(findCrossoverAge(sim.rows, line)).toBeNull()
  })

  it('最初から年金で賄えるなら現在年齢が即クロスオーバーになる', () => {
    // 既にリタイア済み・年金20万 > 生活費10万 → 必要残額は常に0
    const input = { ...base, retireAge: 60, pensionMonthly: 200_000 }
    const schedule = buildYearlySchedule(input)
    const sim = simulateAssets(input, schedule, 0, 0)
    const line = requiredRemainingLine(schedule, 0)
    expect(findCrossoverAge(sim.rows, line)).toBe(60)
  })
})

describe('computeSummary（サマリーカード一式）', () => {
  it('現実的な入力（政府データ補完）で各数値と到達年齢が矛盾なく計算される', () => {
    const s = computeSummary({ currentAge: 30, childrenCount: 1 })
    expect(s.lifetimeRequired).toBeGreaterThan(0)
    expect(s.requiredMonthlyContribution).not.toBeNull()
    expect(s.requiredMonthlyContribution!).toBeGreaterThan(0)
    // 世帯収入(可処分所得) > 世帯支出 なので貯蓄余力はプラス
    expect(s.actualMonthlySaving).toBeGreaterThan(0)
    expect(s.investmentGain).toBeGreaterThan(0)
    expect(s.crossoverAge).not.toBeNull()
    expect(s.crossoverAge!).toBeGreaterThan(30)
    expect(s.crossoverAge!).toBeLessThanOrEqual(100)
  })

  it('支出が収入を上回ると貯蓄余力がマイナスになり、資産が枯渇して到達しない', () => {
    const s = computeSummary({
      currentAge: 40,
      monthlyIncome: 200_000,
      monthlyExpense: 400_000,
      startingAssets: 0,
    })
    expect(s.actualMonthlySaving).toBe(-200_000)
    expect(s.crossoverAge).toBeNull()
  })
})
