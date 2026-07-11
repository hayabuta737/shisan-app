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
import { simulateGrowth } from './lib/simulation'
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
  // 暗号資産は極めて高ボラティリティで、将来の再現性がない。
  // 過去の長期実績は年率数十%超だが、それをそのまま将来に当てはめるのは危険なため、
  // 大幅に保守化した想定値とする(あくまで参考。投資判断は自己責任)。
  { name: 'ビットコイン', rate: 15.0 },
]

const MAX_PRODUCTS = 5
// 1商品あたりの配分額の上限(100億円)。極端な入力を防ぐためのガード
const MAX_ALLOCATION = 10_000_000_000
// 年齢入力の上限
const MAX_AGE = 120

function App() {
  const [age, setAge] = useState(30)
  const [endAge, setEndAge] = useState(65)
  const [selectedNames, setSelectedNames] = useState([PRODUCTS[0].name])
  const [allocations, setAllocations] = useState({ [PRODUCTS[0].name]: 1000000 })

  const selectedProducts = PRODUCTS.filter((p) => selectedNames.includes(p.name))
  const totalPrincipal = selectedNames.reduce((sum, name) => sum + (allocations[name] || 0), 0)

  const toggleProduct = (name) => {
    setSelectedNames((prev) => {
      if (prev.includes(name)) {
        return prev.filter((n) => n !== name)
      }
      if (prev.length >= MAX_PRODUCTS) {
        return prev
      }
      return [...prev, name]
    })
    setAllocations((prev) => {
      const next = { ...prev }
      if (name in next) {
        delete next[name]
      } else {
        next[name] = 0
      }
      return next
    })
  }

  const setAllocation = (name, amount) => {
    // 上限(100億円)を超える入力はクランプして異常値を防ぐ
    const capped = Math.min(amount, MAX_ALLOCATION)
    setAllocations((prev) => ({ ...prev, [name]: capped }))
  }

  const data = useMemo(() => {
    // 計算ロジックは src/lib/simulation.js に分離（テスト可能にするため）。
    // 選択商品の年率と配分額を holdings 形式に変換して渡す。
    const holdings = selectedProducts.map((p) => ({
      rate: p.rate,
      amount: allocations[p.name] || 0,
    }))
    return simulateGrowth(age, endAge, holdings)
  }, [age, endAge, selectedProducts, allocations])

  const formatCompactYen = (value) => {
    const oku = 100000000
    const man = 10000
    if (value >= oku) return `${(value / oku).toLocaleString(undefined, { maximumFractionDigits: 1 })}億円`
    if (value >= man) return `${(value / man).toLocaleString(undefined, { maximumFractionDigits: 1 })}万円`
    return `${value.toLocaleString()}円`
  }

  const formatYen = (value) => `${value.toLocaleString()}円`

  // 入力バリデーション。問題があれば最初のエラーメッセージを返し、なければ null。
  // 年齢は「空・範囲外・非整数」を、期間は前後関係を、商品は選択有無をチェックする。
  const validationError = (() => {
    if (age === '') return '現在の年齢を入力してください。'
    if (!Number.isInteger(age) || age < 0 || age > MAX_AGE)
      return `現在の年齢は0〜${MAX_AGE}の整数で入力してください。`
    if (endAge === '') return '終了年齢を入力してください。'
    if (!Number.isInteger(endAge) || endAge < 0 || endAge > MAX_AGE)
      return `終了年齢は0〜${MAX_AGE}の整数で入力してください。`
    if (endAge < age) return '終了年齢は現在の年齢以上に設定してください。'
    if (selectedProducts.length === 0) return '商品を1つ以上選択してください。'
    return null
  })()

  return (
    <div className="app-container">
      <div className="app-header">
        <span className="app-kicker">Private Wealth Simulation</span>
        <h1>資産シミュレーション</h1>
        <div className="app-divider" />
      </div>

      <div className="panel">
        <p className="panel-title">基本情報</p>
        <div className="form">
          <label>
            現在の年齢
            <input
              type="number"
              value={age}
              min={0}
              max={120}
              onChange={(e) => setAge(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </label>

          <label>
            終了年齢
            <input
              type="number"
              value={endAge}
              min={0}
              max={120}
              onChange={(e) => setEndAge(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </label>
        </div>
      </div>

      <div className="panel">
        <p className="panel-title">
          商品の選択（最大{MAX_PRODUCTS}つまで選択できます。選択中：{selectedNames.length}/{MAX_PRODUCTS}）
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
                      placeholder="配分額（円）"
                      value={allocations[p.name] ? allocations[p.name].toLocaleString() : ''}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/[^0-9]/g, '')
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
        <p className="total-principal">初期投資額の合計：{totalPrincipal.toLocaleString()}円</p>
      </div>

      {validationError ? (
        <p className="error">{validationError}</p>
      ) : (
        <div className="chart-wrapper">
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={data} margin={{ top: 20, right: 30, left: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2d6b8" />
              <XAxis dataKey="age" stroke="#8a7d56" label={{ value: '年齢', position: 'insideBottomRight', offset: -5, fill: '#8a7d56' }} />
              <YAxis width={90} stroke="#8a7d56" tickFormatter={(v) => formatCompactYen(v)} />
              <Tooltip formatter={(value) => formatYen(value)} labelFormatter={(label) => `${label}歳`} />
              <Legend />
              <Line
                type="monotone"
                dataKey="amount"
                name="予想資産額（合計）"
                stroke="#c9a14a"
                strokeWidth={2.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="disclaimer">
        <p className="disclaimer-title">ご利用にあたっての注意</p>
        <p>
          本シミュレーションで使用する年利は、各商品の過去の実績等を参考にした想定値（近似値）であり、将来の運用成果を保証するものではありません。実際の利回りは市場環境により変動します。
        </p>
        <p>
          また、本アプリは特定の商品を推奨するものでは決してありません。資産運用・投資の判断は、必ずお客様ご自身の責任において実施してください。
        </p>
      </div>
    </div>
  )
}

export default App
