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
import './App.css'

const PRODUCTS = [
  { name: '日本普通預金', rate: 0.1 },
  { name: '円定期預金', rate: 0.8 },
  { name: '国債 固定5年', rate: 1.86 },
  { name: '社債 日本大手企業', rate: 2 },
  { name: 'J-REIT（日本不動産）', rate: 3.5 },
  { name: '米国債10年', rate: 4 },
  { name: 'eMAXIS SLIM 全世界株式（オルカン）', rate: 6 },
  { name: 'S&P500', rate: 7 },
  { name: 'ビットコイン', rate: 50 },
  { name: 'Mr.Leeに預ける', rate: 200 },
]

const MAX_PRODUCTS = 5

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
    setAllocations((prev) => ({ ...prev, [name]: amount }))
  }

  const data = useMemo(() => {
    const rows = []
    const years = endAge - age
    if (age === '' || endAge === '' || years < 0 || selectedProducts.length === 0) {
      return rows
    }
    for (let i = 0; i <= years; i++) {
      const total = selectedProducts.reduce((sum, p) => {
        const amount = allocations[p.name] || 0
        return sum + amount * Math.pow(1 + p.rate / 100, i)
      }, 0)
      rows.push({
        age: age + i,
        amount: Math.round(total),
      })
    }
    return rows
  }, [age, endAge, selectedProducts, allocations])

  const formatCompactYen = (value) => {
    const oku = 100000000
    const man = 10000
    if (value >= oku) return `${(value / oku).toLocaleString(undefined, { maximumFractionDigits: 1 })}億円`
    if (value >= man) return `${(value / man).toLocaleString(undefined, { maximumFractionDigits: 1 })}万円`
    return `${value.toLocaleString()}円`
  }

  const formatYen = (value) => `${value.toLocaleString()}円`

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
                )}
              </div>
            )
          })}
        </div>
        <p className="total-principal">初期投資額の合計：{totalPrincipal.toLocaleString()}円</p>
      </div>

      {age !== '' && endAge !== '' && endAge < age ? (
        <p className="error">終了年齢は現在の年齢以上に設定してください。</p>
      ) : selectedProducts.length === 0 ? (
        <p className="error">商品を1つ以上選択してください。</p>
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
