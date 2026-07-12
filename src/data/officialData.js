// =============================================================================
// 政府公式データ定数ファイル (v2要件定義書 3章)
//
// データ確認日: 2026-07-12（年1回の手動更新を想定。次回更新目安: 2027-07）
//
// ルール(docs/v2-requirements.md 3章):
// - すべての数値に出典コメント必須（統計名・調査年・URL）
// - 実在しない統計値を創作しない。確認できない数値は収録しない
// =============================================================================

/**
 * 基本生活費（月額）の補完値
 *
 * 出典: 総務省統計局「家計調査報告（家計収支編）2024年（令和6年）平均」
 *       (公表: 2025年2月)
 *       https://www.stat.go.jp/data/kakei/sokuhou/tsuki/pdf/fies_gaikyo2024.pdf
 *       https://www.soumu.go.jp/menu_news/s-news/01toukei07_01000267.html
 *
 * 世帯人員別は、家計調査年報（家計収支編）2024年 第3表
 * 「世帯人員・世帯主の年齢階級別」（二人以上の世帯）の「消費支出」行より。
 *       https://www.e-stat.go.jp/stat-search/files?page=1&layout=datalist&lid=000001463049
 *       (e-Stat 統計表ID: statInfId=000040297516)
 * 検算: 同表の「平均」列 300,243円 が上記報道発表の公表値と一致することを確認済み。
 */
export const LIVING_COST_MONTHLY = {
  single: 169547, // 単身世帯: 月平均169,547円
  multiAverage: 300243, // 二人以上の世帯 平均(平均世帯人員2.88人): 月300,243円
  byMembers: {
    2: 268755, // 2人世帯: 月268,755円
    3: 310096, // 3人世帯: 月310,096円
    4: 341400, // 4人世帯: 月341,400円
    5: 359917, // 5人世帯: 月359,917円
    6: 368655, // 6人以上の世帯: 月368,655円
  },
}

/**
 * 世帯の手取り月収（可処分所得 = 実収入 − 税・社会保険料）の補完値
 *
 * 出典: 総務省統計局「家計調査（家計収支編）2024年（令和6年）平均」勤労者世帯
 *       https://www.stat.go.jp/data/kakei/sokuhou/tsuki/pdf/fies_gaikyo2024.pdf
 *
 * - 二人以上の勤労者世帯: 可処分所得 月522,569円
 *   (e-Stat 第3表「世帯人員・世帯主の年齢階級別」勤労者世帯シート, statInfId=000040297516)
 * - 単身の勤労者世帯:     可処分所得 月305,863円
 *   (e-Stat 単身世帯 収支表 勤労者世帯シート, statInfId=000040246952)
 *
 * 可処分所得はリタイア前の勤労収入(手取り)の目安。リタイア後は年金で置き換わる。
 */
export const HOUSEHOLD_INCOME_MONTHLY = {
  single: 305863, // 単身の勤労者世帯
  multiWorker: 522569, // 二人以上の勤労者世帯
}

/**
 * 平均寿命（寿命想定セレクタの参考表示用）
 *
 * 出典: 厚生労働省「令和6年簡易生命表の概況」(2024年・公表: 2025年7月)
 *       https://www.mhlw.go.jp/toukei/saikin/hw/life/life24/index.html
 *
 * - 男性の平均寿命(0歳平均余命): 81.09年
 * - 女性の平均寿命(0歳平均余命): 87.13年
 */
export const LIFE_EXPECTANCY = {
  male: 81.09,
  female: 87.13,
}

/**
 * 教育費（子ども1人あたり・年額）: 幼稚園〜高校
 *
 * 出典: 文部科学省「令和5年度子供の学習費調査」(2023年度・公表: 2024年12月25日、
 *       令和8年1月16日訂正版)
 *       https://www.mext.go.jp/b_menu/toukei/chousa03/gakushuuhi/kekka/k_detail/mext_00002.html
 *       https://www.mext.go.jp/content/20260116-mxt_chousa01-000039333_1.pdf
 *
 * 「学習費総額」= 学校教育費 + 学校給食費 + 学校外活動費(塾・習い事含む) の年額。
 * years は標準在学年数。
 */
export const EDUCATION_COST_YEARLY = {
  kindergarten: {
    years: 3,
    public: 184646, // 公立幼稚園: 年184,646円
    private: 347338, // 私立幼稚園: 年347,338円
  },
  elementary: {
    years: 6,
    public: 336265, // 公立小学校: 年336,265円
    private: 1828112, // 私立小学校: 年1,828,112円
  },
  juniorHigh: {
    years: 3,
    public: 542475, // 公立中学校: 年542,475円
    private: 1560359, // 私立中学校: 年1,560,359円
  },
  highSchool: {
    years: 3,
    public: 597752, // 公立高等学校(全日制): 年597,752円
    private: 1030283, // 私立高等学校(全日制): 年1,030,283円
  },
}

/**
 * 大学費用（子ども1人あたり）
 *
 * 国立大学:
 *   出典: 文部科学省 省令による標準額（国立大学等の授業料その他の費用に関する省令）
 *         「国立大学と私立大学の授業料等の推移」
 *         https://www.mext.go.jp/b_menu/shingi/kokuritu/005/gijiroku/attach/1386502.htm
 *   - 授業料(標準額): 年535,800円 / 入学料(標準額): 282,000円
 *
 * 私立大学:
 *   出典: 文部科学省「私立大学等の令和5年度入学者に係る学生納付金等調査」(2023年度・公表: 2023年12月)
 *         https://www.mext.go.jp/a_menu/koutou/shinkou/07021403/1412031_00005.htm
 *   - 授業料: 年959,205円 / 入学料: 240,806円 / 施設設備費: 年165,271円
 */
export const UNIVERSITY_COST = {
  years: 4,
  national: {
    tuitionYearly: 535800, // 国立: 授業料標準額(年)
    admissionFee: 282000, // 国立: 入学料標準額(入学時のみ)
    facilityYearly: 0, // 国立: 施設設備費は標準額制度上なし
  },
  private: {
    tuitionYearly: 959205, // 私立平均: 授業料(年)
    admissionFee: 240806, // 私立平均: 入学料(入学時のみ)
    facilityYearly: 165271, // 私立平均: 施設設備費(年)
  },
}

/**
 * 公的年金の補完値（月額）
 *
 * 出典: 厚生労働省「令和8年度の年金額改定についてお知らせします」(2026年度・公表: 2026年1月)
 *       https://www.mhlw.go.jp/content/12502000/001639615.pdf
 *       日本年金機構「令和8年4月分からの年金額等について」
 *       https://www.nenkin.go.jp/oshirase/taisetu/kojin/2026/202604/0401.html
 *
 * - モデル年金(夫婦2人・老齢厚生年金+老齢基礎年金2人分): 月237,279円
 *   ※夫が平均的収入(平均標準報酬・賞与含む月額換算45.5万円)で40年間就業し、
 *     妻がその期間すべて専業主婦だった世帯の新規裁定水準
 * - 老齢基礎年金 満額(昭和31年4月2日以後生まれ・新規裁定): 月70,608円
 *
 * selfModel / spouseBasic は新規の統計値ではなく、上記モデル年金の「内訳」への分解:
 *   本人の年金総額(老齢厚生年金 + 本人の老齢基礎年金)
 *     = モデル年金 − 配偶者の基礎年金満額 = 237,279 − 70,608 = 166,671円/月
 * これにより「独身=selfModelのみ」「配偶者あり=selfModel+spouseBasic(=modelCouple)」
 * と、世帯構成に応じた年金の既定値を公式値と整合させて算出できる。
 *
 * 派生値は公式値(MODEL_COUPLE / BASIC_FULL)から演算で定義し、翌年度に公式値だけ
 * 更新して派生値の書き換えを忘れる「設計ドリフト」を防ぐ。
 */
const MODEL_COUPLE = 237279 // モデル年金(夫婦2人世帯)
const BASIC_FULL = 70608 // 老齢基礎年金 満額(1人分)
export const PENSION_MONTHLY = {
  modelCouple: MODEL_COUPLE,
  basicFull: BASIC_FULL,
  selfModel: MODEL_COUPLE - BASIC_FULL, // 本人の年金総額(独身の既定値) = 166,671
  spouseBasic: BASIC_FULL, // 配偶者(専業主婦等)の老齢基礎年金 満額
}

/**
 * インフレ率（年率）
 *
 * 出典: これは統計値ではなく、docs/v2-requirements.md 3章で定めた仮定値。
 * 「インフレ率 年2% を全支出に適用(定数として変更可能に)」に基づく。
 * (参考: 日本銀行の物価安定目標が消費者物価の前年比上昇率2%
 *  https://www.boj.or.jp/mopo/outline/qqe.htm)
 */
export const INFLATION_RATE_PERCENT = 2
