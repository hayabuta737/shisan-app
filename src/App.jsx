import { useState, useMemo } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import {
  applyDefaults,
  buildYearlySchedule,
  lifetimeRequired,
  requiredRemainingLine,
  simulateActual,
  findRequiredMonthlyContribution,
  findCrossoverAge,
  householdSize as calcHouseholdSize,
  livingCostDefault as calcLivingCostDefault,
  incomeDefault as calcIncomeDefault,
  SCENARIO_RATES,
} from './lib/lifeplan'
import { LIFE_EXPECTANCY, PENSION_MONTHLY } from './data/officialData'
import './App.css'

// 各商品の想定年率(rate, 単位%)。
// すべて「長期平均・一般的な水準を参考にした想定値(近似値)」であり、
// 将来の運用成果を保証するものではない(免責は画面下部に常時表示)。
// 各行に「参考にした指数・期間の考え方」を出典コメントとして明記する
// (CLAUDE.md 第3章「金融データの信頼性が最優先」ルールに基づく)。
const PRODUCTS = [
  // メガバンク普通預金金利の一般的水準(2025年時点で概ね0.1%前後)
  { name: '日本普通預金', rate: 0.1 },
  // メガバンク1年もの定期預金の一般的水準(日銀の利上げ後、概ね0.2〜0.3%)
  { name: '円定期預金', rate: 0.3 },
  // 財務省「個人向け国債(固定5年)」の近年の発行利率水準(概ね1%前後)
  { name: '国債 固定5年', rate: 1.0 },
  // 大手事業債(A格相当・年限5年程度)の利回り目安(概ね1.5%前後)
  { name: '社債 日本大手企業', rate: 1.5 },
  // 東証REIT指数の予想分配金利回りの一般的水準(概ね4%台)
  { name: 'J-REIT（日本不動産）', rate: 4.0 },
  // 米国10年国債利回りの近年の水準(概ね4%台)。※円/ドルの為替変動は非考慮
  { name: '米国債10年', rate: 4.3 },
  // MSCI ACWI(全世界株式)の長期年率リターン(配当込・名目)を保守的に設定
  { name: 'eMAXIS SLIM 全世界株式（オルカン）', rate: 6.0 },
  // S&P500の長期年率リターン(実質ベース)の一般的水準。名目より保守的に設定
  { name: 'S&P500', rate: 7.0 },
]

const MAX_PRODUCTS = 5
// 金額入力の共通上限(100億円)。商品配分・生活費・年金・自由記入イベントの
// すべてに適用し、極端な入力による表示破綻を防ぐ
const MAX_ALLOCATION = 10_000_000_000
// 年齢入力の上限
const MAX_AGE = 120

const formatCompactYen = (value) => {
  const oku = 100000000
  const man = 10000
  const abs = Math.abs(value)
  if (abs >= oku) return `${(value / oku).toLocaleString(undefined, { maximumFractionDigits: 1 })}億円`
  if (abs >= man) return `${(value / man).toLocaleString(undefined, { maximumFractionDigits: 1 })}万円`
  return `${value.toLocaleString()}円`
}

const formatYen = (value) => `${Math.round(value).toLocaleString()}円`

// 数字文字列 → number | undefined(空)
const parseNum = (s) => (s === '' ? undefined : Number(s))

// 金額入力の共通処理: 全角数字を半角へ変換 → 数字以外を除去 → 上限クランプ。
// (inputMode="numeric"はキーボードのヒントに過ぎず全角変換はしないため、
//  IMEで全角入力された値がサイレントに消えるのを防ぐ)
const sanitizeAmount = (raw) => {
  const digits = raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[^0-9]/g, '')
  if (digits === '') return ''
  return String(Math.min(Number(digits), MAX_ALLOCATION))
}

function App() {
  // ── ステップ1: 必要額フォームの状態(文字列で保持し、空=未入力=政府データ補完) ──
  const [ageStr, setAgeStr] = useState('')
  const [incomeStr, setIncomeStr] = useState('') // 世帯収入(月・手取り)
  const [expenseStr, setExpenseStr] = useState('') // 世帯支出(月)
  const [lifespan, setLifespan] = useState(100)
  const [hasSpouse, setHasSpouse] = useState(true)
  const [childrenCount, setChildrenCount] = useState(0)
  const [educationPolicy, setEducationPolicy] = useState('public')
  const [retireAgeStr, setRetireAgeStr] = useState('')
  // 年金は「自分」と「配偶者」に分けて入力(独身時は配偶者分を計算に含めない)
  const [pensionSelfStr, setPensionSelfStr] = useState('')
  const [pensionSpouseStr, setPensionSpouseStr] = useState('')
  const [extraEvents, setExtraEvents] = useState([])

  // ── ステップ2: 商品選択(旧v1を吸収) ──
  const [selectedNames, setSelectedNames] = useState([])
  const [allocations, setAllocations] = useState({})
  // 現在の金融資産: 商品別の保有額 + その他(現金など)。開始残高に使う
  const [holdings, setHoldings] = useState({})
  const [otherAssetsStr, setOtherAssetsStr] = useState('')

  const selectedProducts = useMemo(
    () => PRODUCTS.filter((p) => selectedNames.includes(p.name)),
    [selectedNames],
  )
  const totalPrincipal = selectedNames.reduce((sum, name) => sum + (allocations[name] || 0), 0)

  const toggleProduct = (name) => {
    setSelectedNames((prev) => {
      if (prev.includes(name)) return prev.filter((n) => n !== name)
      if (prev.length >= MAX_PRODUCTS) return prev
      return [...prev, name]
    })
    setAllocations((prev) => {
      const next = { ...prev }
      if (name in next) delete next[name]
      else next[name] = 0
      return next
    })
  }

  const setAllocation = (name, amount) => {
    // 上限(100億円)を超える入力はクランプして異常値を防ぐ
    const capped = Math.min(amount, MAX_ALLOCATION)
    setAllocations((prev) => ({ ...prev, [name]: capped }))
  }

  // 商品構成の配分加重平均利回り = 標準シナリオ。未選択・配分0なら初期値4%
  const standardRate = useMemo(() => {
    if (selectedProducts.length === 0 || totalPrincipal <= 0) return SCENARIO_RATES.standard
    const weighted = selectedProducts.reduce(
      (sum, p) => sum + p.rate * (allocations[p.name] || 0),
      0,
    )
    return weighted / totalPrincipal
  }, [selectedProducts, allocations, totalPrincipal])

  // 悲観・楽観は標準±2%(docs/v2-requirements.md 6章)
  const pessimisticRate = standardRate - 2
  const optimisticRate = standardRate + 2

  // ── 入力バリデーション ──
  const currentAge = parseNum(ageStr)
  const retireAge = parseNum(retireAgeStr)
  const validationError = (() => {
    if (currentAge === undefined) return null // 未入力は案内表示(エラーではない)
    if (!Number.isInteger(currentAge) || currentAge < 0 || currentAge > MAX_AGE)
      return `現在の年齢は0〜${MAX_AGE}の整数で入力してください。`
    if (retireAge !== undefined) {
      if (!Number.isInteger(retireAge) || retireAge < currentAge || retireAge > lifespan)
        return `リタイア年齢は現在の年齢〜${lifespan}の整数で入力してください。`
    }
    // 自由記入イベント: 何か入力済みの行は年齢・金額の両方を要求し、
    // 範囲外の年齢が「黙って計算から無視される」ことを防ぐ
    for (const ev of extraEvents) {
      const touched = ev.label !== '' || ev.amount !== '' || ev.age !== ''
      if (!touched) continue
      const evAge = parseNum(ev.age)
      if (evAge === undefined || ev.amount === '')
        return '「その他の予定」には金額と年齢の両方を入力してください（不要な行は×で削除できます）。'
      if (!Number.isInteger(evAge) || evAge < currentAge || evAge >= lifespan)
        return `「その他の予定」の年齢は現在の年齢〜${lifespan - 1}の整数で入力してください。`
    }
    return null
  })()

  // 年金の合計月額(必要総額に反映)。未入力の欄は世帯構成に応じた既定値で補完。
  // 独身時は配偶者分を一切含めない。
  const pensionSelf = parseNum(pensionSelfStr) ?? PENSION_MONTHLY.selfModel
  const pensionSpouse = hasSpouse
    ? (parseNum(pensionSpouseStr) ?? PENSION_MONTHLY.spouseBasic)
    : 0
  const pensionMonthly = pensionSelf + pensionSpouse

  // 現在の金融資産(開始残高) = 商品別の保有額 + その他。上限クランプは入力側で実施。
  const startingAssets =
    PRODUCTS.reduce((sum, p) => sum + (holdings[p.name] || 0), 0) + (parseNum(otherAssetsStr) ?? 0)

  // 世帯収入・支出(月)。未入力は政府データ(可処分所得/家計調査)で補完。
  const monthlyIncome = parseNum(incomeStr) ?? calcIncomeDefault(hasSpouse, childrenCount)
  const monthlyExpense = parseNum(expenseStr) ?? calcLivingCostDefault(hasSpouse, childrenCount)
  const actualMonthlySaving = monthlyIncome - monthlyExpense

  // ── 計算(ステップ3) ──
  const result = useMemo(() => {
    if (currentAge === undefined || validationError) return null
    const input = applyDefaults({
      currentAge,
      lifespan,
      monthlyExpense,
      monthlyIncome,
      startingAssets,
      hasSpouse,
      childrenCount,
      educationPolicy,
      retireAge,
      pensionMonthly,
      extraEvents: extraEvents
        .filter((ev) => ev.amount !== '' && ev.age !== '')
        .map((ev) => ({ label: ev.label, amount: Number(ev.amount), age: Number(ev.age) })),
    })
    const schedule = buildYearlySchedule(input)
    const required = lifetimeRequired(schedule)
    const minMonthly = findRequiredMonthlyContribution(input, schedule, standardRate)
    const line = requiredRemainingLine(schedule, standardRate)
    // 実際の推移: 世帯収入−世帯支出を貯蓄として積み上げる(3シナリオ)
    const sims = {
      pessimistic: simulateActual(input, schedule, pessimisticRate),
      standard: simulateActual(input, schedule, standardRate),
      optimistic: simulateActual(input, schedule, optimisticRate),
    }
    const crossoverAge = findCrossoverAge(sims.standard.rows, line)
    // グラフ用に年齢で結合
    const lineByAge = new Map(line.map((r) => [r.age, r.assets]))
    const chart = sims.standard.rows.map((row, i) => ({
      age: row.age,
      standard: row.assets,
      pessimistic: sims.pessimistic.rows[i]?.assets,
      optimistic: sims.optimistic.rows[i]?.assets,
      required: lineByAge.get(row.age),
    }))
    return {
      input,
      required,
      minMonthly,
      actualMonthlySaving,
      crossoverAge,
      chart,
      gain: sims.standard.totalInterest,
    }
  }, [currentAge, validationError, lifespan, monthlyExpense, monthlyIncome, startingAssets, actualMonthlySaving, hasSpouse, childrenCount, educationPolicy, retireAge, pensionMonthly, extraEvents, standardRate, pessimisticRate, optimisticRate])

  // 補完値の案内用。計算(lifeplan.applyDefaults)と同じ関数を使い、表示と計算の
  // 世帯人数ロジックを一元化する
  const householdSize = calcHouseholdSize(hasSpouse, childrenCount)
  const expenseDefault = calcLivingCostDefault(hasSpouse, childrenCount)
  const incomeHintDefault = calcIncomeDefault(hasSpouse, childrenCount)

  const crossoverYear =
    result && result.crossoverAge !== null
      ? new Date().getFullYear() + (result.crossoverAge - result.input.currentAge)
      : null

  const updateExtraEvent = (idx, field, value) => {
    setExtraEvents((prev) => prev.map((ev, i) => (i === idx ? { ...ev, [field]: value } : ev)))
  }

  const setHolding = (name, amount) => {
    setHoldings((prev) => ({ ...prev, [name]: Math.min(amount, MAX_ALLOCATION) }))
  }

  return (
    <div className="app-container">
      <div className="app-header">
        <span className="app-kicker">Lifetime Money Plan</span>
        <h1>生涯マネープラン</h1>
        <p className="app-lead">
          3つのステップで、「自分が生涯どれくらいお金が必要か」と「毎月いくら積み立てれば自由になれるか」が分かります。
        </p>
        <div className="app-divider" />
      </div>

      {/* ───────── ステップ1: 必要額を知る ───────── */}
      <div className="panel">
        <p className="step-label">ステップ 1</p>
        <p className="panel-title">必要額を知る</p>
        <p className="panel-note">
          分かる項目だけ入力すればOK。空欄は政府統計の平均値で自動補完します。
        </p>
        <div className="form">
          <label>
            現在の年齢（必須）
            <input
              type="number"
              value={ageStr}
              min={0}
              max={MAX_AGE}
              placeholder="例: 30"
              onChange={(e) => setAgeStr(e.target.value)}
            />
          </label>

          <label>
            世帯収入（月・手取り）
            <input
              type="text"
              inputMode="numeric"
              value={incomeStr === '' ? '' : Number(incomeStr).toLocaleString()}
              placeholder={`未入力: ${incomeHintDefault.toLocaleString()}円`}
              onChange={(e) => setIncomeStr(sanitizeAmount(e.target.value))}
            />
            <span className="field-hint">
              手取りの世帯月収。補完値は総務省・家計調査(2024年)の勤労者世帯の可処分所得です
            </span>
          </label>

          <label>
            世帯支出（月・家賃/ローン含む）
            <input
              type="text"
              inputMode="numeric"
              value={expenseStr === '' ? '' : Number(expenseStr).toLocaleString()}
              placeholder={`未入力: ${expenseDefault.toLocaleString()}円`}
              onChange={(e) => setExpenseStr(sanitizeAmount(e.target.value))}
            />
            <span className="field-hint">
              補完値は総務省・家計調査(2024年)の{householdSize}人世帯平均です
            </span>
          </label>

          <label>
            配偶者の有無
            <select
              value={hasSpouse ? 'yes' : 'no'}
              onChange={(e) => setHasSpouse(e.target.value === 'yes')}
            >
              <option value="yes">配偶者あり（二人暮らし）</option>
              <option value="no">独身（一人暮らし）</option>
            </select>
            <span className="field-hint">
              生活費の世帯人数と、年金（配偶者分を含めるか）の計算に反映されます
            </span>
          </label>

          <label>
            寿命想定
            <select value={lifespan} onChange={(e) => setLifespan(Number(e.target.value))}>
              <option value={90}>90歳</option>
              <option value={95}>95歳</option>
              <option value={100}>100歳（推奨）</option>
            </select>
            <span className="field-hint">
              参考: 平均寿命は男{LIFE_EXPECTANCY.male}歳・女{LIFE_EXPECTANCY.female}歳（厚労省・令和6年簡易生命表）。長生きに備えて長めが安心です
            </span>
          </label>

          <label>
            子どもの人数
            <select value={childrenCount} onChange={(e) => setChildrenCount(Number(e.target.value))}>
              {[0, 1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>{n}人</option>
              ))}
            </select>
          </label>

          {/* 教育方針は子どもが1人以上のときのみ表示（0人なら教育費は発生しない） */}
          {childrenCount >= 1 && (
            <label>
              教育方針
              <select value={educationPolicy} onChange={(e) => setEducationPolicy(e.target.value)}>
                <option value="public">公立中心（大学は国立）</option>
                <option value="private">私立中心（大学は私立）</option>
              </select>
              <span className="field-hint">教育費は文科省・令和5年度子供の学習費調査等で計算します</span>
            </label>
          )}

          <label>
            リタイア年齢
            <input
              type="number"
              value={retireAgeStr}
              min={0}
              max={MAX_AGE}
              placeholder="未入力: 65歳"
              onChange={(e) => setRetireAgeStr(e.target.value)}
            />
          </label>

          <label>
            {hasSpouse ? 'あなたの年金の見込み月額' : '年金の見込み月額'}
            <input
              type="text"
              inputMode="numeric"
              value={pensionSelfStr === '' ? '' : Number(pensionSelfStr).toLocaleString()}
              placeholder={`未入力: ${PENSION_MONTHLY.selfModel.toLocaleString()}円`}
              onChange={(e) => setPensionSelfStr(sanitizeAmount(e.target.value))}
            />
            <span className="field-hint">
              毎年誕生月に届く「ねんきん定期便」の「老齢年金の見込額」欄で確認できます。補完値は会社員本人のモデル年金（厚労省・令和8年度）です
            </span>
          </label>

          {/* 配偶者ありのときだけ配偶者分の年金を入力（必要総額に合算される） */}
          {hasSpouse && (
            <label>
              配偶者の年金の見込み月額
              <input
                type="text"
                inputMode="numeric"
                value={pensionSpouseStr === '' ? '' : Number(pensionSpouseStr).toLocaleString()}
                placeholder={`未入力: ${PENSION_MONTHLY.spouseBasic.toLocaleString()}円`}
                onChange={(e) => setPensionSpouseStr(sanitizeAmount(e.target.value))}
              />
              <span className="field-hint">
                補完値は配偶者の老齢基礎年金・満額（厚労省・令和8年度）です。共働き等はねんきん定期便の額を入力してください
              </span>
            </label>
          )}
        </div>

        <div className="extra-events">
          <p className="extra-events-title">その他の予定（住宅の頭金・車の買い替えなど）</p>
          {extraEvents.map((ev, idx) => (
            <div key={ev.id} className="extra-event-row">
              <input
                type="text"
                placeholder="項目名（例: 車）"
                value={ev.label}
                onChange={(e) => updateExtraEvent(idx, 'label', e.target.value)}
              />
              <input
                type="text"
                inputMode="numeric"
                placeholder="金額（円）"
                value={ev.amount === '' ? '' : Number(ev.amount).toLocaleString()}
                onChange={(e) => updateExtraEvent(idx, 'amount', sanitizeAmount(e.target.value))}
              />
              <input
                type="number"
                placeholder="年齢"
                value={ev.age}
                min={0}
                max={MAX_AGE}
                onChange={(e) => updateExtraEvent(idx, 'age', e.target.value)}
              />
              <button
                type="button"
                className="row-remove"
                aria-label="この行を削除"
                onClick={() => setExtraEvents((prev) => prev.filter((_, i) => i !== idx))}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="row-add"
            onClick={() =>
              setExtraEvents((prev) => [
                ...prev,
                // keyにindexを使うと行削除時にフォーカスが隣の行へ飛ぶため安定IDを持たせる
                { id: crypto.randomUUID(), label: '', amount: '', age: '' },
              ])
            }
          >
            ＋ 予定を追加
          </button>
        </div>
      </div>

      {/* ───────── ステップ2: 運用を選ぶ ───────── */}
      <div className="panel">
        <p className="step-label">ステップ 2</p>
        <p className="panel-title">運用を選ぶ</p>
        <p className="panel-note">
          積み立てる商品の組み合わせを選ぶと、その配分に応じた期待利回りでシミュレーションします（最大{MAX_PRODUCTS}つ。選択中：{selectedNames.length}/{MAX_PRODUCTS}）。選ばない場合は年4%（標準）で計算します。
        </p>
        <div className="product-list">
          {PRODUCTS.map((p) => {
            const checked = selectedNames.includes(p.name)
            const disabled = !checked && selectedNames.length >= MAX_PRODUCTS
            return (
              <div key={p.name} className={`product-item ${disabled ? 'disabled' : ''}`}>
                <label className="product-item-label">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggleProduct(p.name)}
                  />
                  {p.name}（年{p.rate}%）
                </label>
                {checked && (
                  <>
                    <input
                      type="text"
                      inputMode="numeric"
                      className="allocation-input"
                      placeholder="毎月の配分イメージ（円）"
                      value={allocations[p.name] ? allocations[p.name].toLocaleString() : ''}
                      onChange={(e) => {
                        const digits = sanitizeAmount(e.target.value)
                        setAllocation(p.name, digits === '' ? 0 : Number(digits))
                      }}
                    />
                    {allocations[p.name] === MAX_ALLOCATION && (
                      <p className="allocation-note">配分額の上限は100億円です。</p>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
        <p className="total-principal">
          期待利回り（配分加重平均）: 年{standardRate.toFixed(1)}%
          {totalPrincipal > 0 && ` ／ 配分合計: ${totalPrincipal.toLocaleString()}円`}
        </p>

        <div className="assets-section">
          <p className="assets-title">現在の金融資産（今持っている額・任意）</p>
          <p className="panel-note">
            入力するとその額を開始残高としてシミュレーションします（未入力は0円）。同じ運用商品の項目に加え、それ以外は「その他」にまとめて入力してください。なお計算上、保有資産は上の「期待利回り」で成長すると仮定します。
          </p>
          <div className="assets-grid">
            {PRODUCTS.map((p) => (
              <label key={p.name} className="asset-row">
                <span className="asset-name">{p.name}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  value={holdings[p.name] ? holdings[p.name].toLocaleString() : ''}
                  onChange={(e) => {
                    const digits = sanitizeAmount(e.target.value)
                    setHolding(p.name, digits === '' ? 0 : Number(digits))
                  }}
                />
              </label>
            ))}
            <label className="asset-row">
              <span className="asset-name">その他（現金・預金など）</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={otherAssetsStr === '' ? '' : Number(otherAssetsStr).toLocaleString()}
                onChange={(e) => setOtherAssetsStr(sanitizeAmount(e.target.value))}
              />
            </label>
          </div>
          <p className="total-principal">
            現在の金融資産の合計：{startingAssets.toLocaleString()}円
          </p>
        </div>
      </div>

      {/* ───────── ステップ3: 自由になる日を見る ───────── */}
      <div className="panel">
        <p className="step-label">ステップ 3</p>
        <p className="panel-title">自由になる日を見る</p>

        {validationError ? (
          <p className="error">{validationError}</p>
        ) : !result ? (
          <p className="guide">ステップ1で「現在の年齢」を入力すると、結果が表示されます。</p>
        ) : (
          <>
            <div className="summary-cards">
              <div className="summary-card">
                <p className="summary-card-label">生涯必要額</p>
                <p className="summary-card-value">{formatCompactYen(result.required)}</p>
                <p className="summary-card-sub">寿命{result.input.lifespan}歳までの支出 − 年金</p>
              </div>
              <div className="summary-card">
                <p className="summary-card-label">あなたの毎月の貯蓄額</p>
                <p className="summary-card-value">
                  {result.actualMonthlySaving < 0
                    ? `−${formatCompactYen(-result.actualMonthlySaving)}`
                    : `月${formatCompactYen(result.actualMonthlySaving)}`}
                </p>
                <p className="summary-card-sub">
                  世帯収入 − 世帯支出。
                  {result.minMonthly === null
                    ? ''
                    : ` 必要な最低額は月${formatCompactYen(result.minMonthly)}`}
                </p>
              </div>
              <div className="summary-card">
                <p className="summary-card-label">運用で増えた分</p>
                <p className="summary-card-value">{formatCompactYen(result.gain)}</p>
                <p className="summary-card-sub">時間があなたの味方です</p>
              </div>
            </div>

            {result.crossoverAge !== null ? (
              <div className="crossover-banner">
                <p className="crossover-label">あなたがお金の心配から自由になる日</p>
                <p className="crossover-value">
                  {crossoverYear}年（{result.crossoverAge}歳）
                </p>
                <p className="crossover-sub">
                  今の貯蓄ペースなら、この時点で資産がその後の人生に必要な額を上回り、以後は働かなくてもお金が尽きない見込みです
                </p>
              </div>
            ) : (
              <div className="crossover-banner">
                <p className="crossover-label">安心ラインへの道のり</p>
                <p className="crossover-sub">
                  今の貯蓄ペースでは寿命までに安心ラインへ到達しません。世帯支出を見直す・リタイア年齢を遅らせる・収入や運用利回りを上げるなど、条件を変えて試してみてください。
                </p>
              </div>
            )}

            <div className="chart-wrapper">
              <ResponsiveContainer width="100%" height={380}>
                <LineChart data={result.chart} margin={{ top: 16, right: 16, left: 4, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2d6b8" />
                  <XAxis
                    dataKey="age"
                    stroke="#8a7d56"
                    tick={{ fontSize: 11 }}
                    interval="preserveStartEnd"
                    tickFormatter={(v) => `${v}歳`}
                  />
                  <YAxis
                    width={72}
                    stroke="#8a7d56"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => formatCompactYen(v)}
                  />
                  <Tooltip
                    formatter={(value) => formatYen(value)}
                    labelFormatter={(label) => `${label}歳`}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="optimistic" name={`楽観(年${optimisticRate.toFixed(1)}%)`} stroke="#e0c27a" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="standard" name={`標準(年${standardRate.toFixed(1)}%)`} stroke="#c9a14a" strokeWidth={2.5} dot={false} />
                  <Line type="monotone" dataKey="pessimistic" name={`悲観(年${pessimisticRate.toFixed(1)}%)`} stroke="#a89f8d" strokeWidth={1.5} strokeDasharray="6 3" dot={false} />
                  <Line type="monotone" dataKey="required" name="安心ライン(必要残額)" stroke="#24365c" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
              <p className="chart-note">
                将来は不確実です。幅で考えることが大切です。3本の曲線は現在の金融資産を起点に「世帯収入−世帯支出」を貯蓄・運用した資産の推移です。「安心ライン」はその年齢で働くのをやめた場合に、以降の生活（支出−年金）を寿命まで賄うのに必要な額です。曲線が安心ラインを上回った時点が「自由になる日」です。
              </p>
            </div>
          </>
        )}
      </div>

      <div className="disclaimer">
        <p className="disclaimer-title">ご利用にあたっての注意</p>
        <p>
          本シミュレーションで使用する年利は、各商品の過去の実績等を参考にした想定値（近似値）であり、将来の運用成果を保証するものではありません。実際の利回りは市場環境により変動します。
        </p>
        <p>
          世帯収入・支出・教育費・年金などの補完値は政府統計（総務省家計調査、文科省子供の学習費調査、厚労省年金額改定等）に基づく平均値です。計算にはインフレ率年2%の仮定を含み、世帯収入・支出は名目で年2%成長する一方、年金は名目固定（インフレ非連動）と仮定します。収入・生活費の既定値は世帯構成の細かな違い（共働きか否か等）までは反映していません。世帯人数・収入・年金は入力（配偶者の有無・子どもの人数）に応じて計算します。子どもは現在0歳と仮定しています。
        </p>
        <p>
          また、本アプリは特定の商品を推奨するものでは決してありません。資産運用・投資の判断は、必ずお客様ご自身の責任において実施してください。
        </p>
      </div>
    </div>
  )
}

export default App
