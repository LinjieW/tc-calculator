/* Local UI copy. Language changes touch text only, never calculator state. */
(function () {
  "use strict";
  var copy = {
  "加班与总薪酬测算": "Overtime & Total Compensation",
  "加班费、年终奖与雇主福利折算成总薪酬包，再估算税后到手（单身、DC、2026 税表）。预填的是示例数字，改成你自己的即可，数据只存在本机。": "Turn overtime, bonuses and employer benefits into a total compensation package, then estimate take-home pay (single filer, DC, 2026 tax tables). Start with the sample figures and enter your own. Data stays on this device.",
  "这个页面需要 JavaScript，而现在它没有在运行。": "This page needs JavaScript, which is not running.",
  "所有数字都是打开时算出来的，所以你看到的是一堆占位符 —— 页面本身没坏。 iOS 的「文件」预览（Quick Look）和邮件附件预览都只渲染 HTML 和 CSS、不执行脚本； iOS 18.5 之后 Safari 也不再允许直接打开本地 HTML 文件。 在 iPhone 上要用它，最省事的是把它放到一个网址上、用 Safari 打开。": "These figures are calculated when the page opens. iOS Files and email previews do not run JavaScript. To use this calculator on an iPhone, open the hosted page in Safari.",
  "薪酬测算": "Compensation",
  "数值精度": "Number precision",
  "整数": "Whole",
  "精确": "Cents",
  "切换深色 / 浅色主题": "Toggle dark / light theme",
  "测算": "Calculate",
  "构成": "Breakdown",
  "税后": "After tax",
  "反查": "Target",
  "明细表": "Schedule",
  "假设": "Assumptions",
  "把加班费和固定年终奖一起，折算成「相当于多少比例的年终奖」": "Combine overtime pay and a fixed bonus into an equivalent bonus percentage",
  "等效年终奖的定义": "Equivalent bonus definition",
  "（加班费 + 固定年终奖）÷ 基本工资。它把两笔钱当成一笔按基本工资计算的传统年终奖来看，方便和「涨 X% 年终奖」这类说法直接比较。": "(Overtime pay + fixed bonus) ÷ base salary. This expresses both payments as one traditional bonus based on salary, making comparisons with an “X% bonus” straightforward.",
  "，算出含雇主福利的总薪酬包，再估算税后到手（单身、住 DC、2026 税表）。 预填的是": ", add employer benefits to get total compensation, and estimate take-home pay (single filer, DC, 2026 tax tables). These are ",
  "示例数字": "sample figures",
  "在「假设」里换成你自己的": "enter your own under Assumptions",
  "，改完即时生效，只保存在本机。": ". Changes apply immediately and stay on this device.",
  "总薪酬包 · TOTAL PACKAGE": "TOTAL COMPENSATION",
  "加班小时": "Overtime hours",
  "年加班小时": "Annual overtime hours",
  "精确小时数": "Exact hours",
  "h / 年": "h / year",
  "折合每工作周": "Per working week",
  "h / 周": "h / week",
  "加班费": "Overtime pay",
  "加班小时 × 加班时薪": "Overtime hours × overtime rate",
  "变动薪酬": "Variable pay",
  "加班费 + 年终奖": "Overtime pay + bonus",
  "等效年终奖": "Equivalent bonus",
  "占基本工资比例": "As a share of base salary",
  "总现金薪酬": "Total cash pay",
  "基本工资 + 变动": "Base salary + variable pay",
  "401(k) 雇主匹配": "401(k) employer match",
  "利润分享": "Profit sharing",
  "通讯补贴": "Phone allowance",
  "标准时薪": "Regular hourly rate",
  "加班时薪": "Overtime hourly rate",
  "雇主福利合计": "Total employer benefits",
  "实际工作小时": "Actual hours worked",
  "实际时薪": "Effective hourly pay",
  "PTO 名义价值": "PTO face value",
  "总薪酬包构成": "Compensation breakdown",
  "总薪酬包的构成": "Total compensation breakdown",
  "各块之和严格等于中间的总薪酬包。「PTO」是从基本工资里切出来的——两块加起来才是全额基本工资，不是额外的钱。指向或点按任意一块（或旁边列表里的行，也可以用键盘聚焦），那一块会弹出来、其余变暗；点一下钉住，再点一次、点空白处或按 Esc 取消。": "The slices add up to the total in the center. PTO is carved out of base salary: the two slices together equal your full salary, with no extra pay. Hover, tap or focus a legend row to highlight a slice. Click to pin it; click again, click blank space or press Esc to clear.",
  "税后到手": "Take-home pay",
  "2026 税率": "2026 tax rates",
  "单身申报，不考虑逐项扣除、抵免、州外收入和其他所得。这是一个估算，不是报税结论。 所有税率、档位和上限都可以在下面的「税表与参数」里改——每年查到新数字自己更新即可。": "Single filer; excludes itemized deductions, credits, out-of-state income and other income. This is an estimate, not a tax filing result. Edit rates, brackets and limits under Tax tables & parameters as new annual figures become available.",
  "到手现金": "Take-home cash",
  "扣完税与供款": "After taxes & contributions",
  "税负合计": "Total tax",
  "联邦 + DC + FICA": "Federal + DC + FICA",
  "有效税率": "Effective tax rate",
  "占总现金薪酬": "As a share of total cash pay",
  "边际税率": "Marginal tax rate",
  "下一美元": "On the next dollar",
  "税后实际时薪": "After-tax hourly pay",
  "每加班小时净得": "Net per overtime hour",
  "税后每工作周": "Take-home per working week",
  "税前供款": "Contributions",
  "401(k) 员工供款": "Employee 401(k)",
  "上限 24,500": "Limit 24,500",
  "HSA 供款": "HSA contribution",
  "上限 4,400": "Limit 4,400",
  "HSA 走工资扣除（同时免 FICA）": "HSA through payroll (also exempt from FICA)",
  "传统 IRA 供款": "Traditional IRA contribution",
  "上限 7,500": "Limit 7,500",
  "有公司退休计划（401(k)、利润分享等）": "Covered by an employer retirement plan (401(k), profit sharing, etc.)",
  "口径开关": "Tax options",
  "FICA（社保 + 医保）": "FICA (Social Security + Medicare)",
  "计入": "Include",
  "不计": "Exclude",
  "OBBBA 加班扣除（仅 FLSA 非豁免）": "OBBBA overtime deduction (FLSA nonexempt only)",
  "DC 也扣加班扣除": "Apply overtime deduction to DC",
  "项目": "Item",
  "金额": "Amount",
  "税表与参数": "Tax tables & parameters",
  "预填的是 2026 年的数字（联邦档位与标准扣除来自 IRS Rev. Proc. 2025-32； DC 档位自 2022 年起未变，标准扣除取自 OTR 2026 年 D-40ES；社保工资上限来自 SSA； 供款上限与 IRA 退坡区间来自 IRS）。每年新数字出来之后，直接在这里改； 页面更新了默认税表时，会自动换成新的一年，你的供款和开关保留。": "Defaults are for 2026: federal brackets and standard deduction from IRS Rev. Proc. 2025-32; DC brackets unchanged since 2022 and standard deduction from OTR 2026 D-40ES; Social Security wage base from SSA; contribution limits and IRA phaseout from IRS. Edit these when new figures are published. Updates to the default tax tables migrate the year while retaining your contributions and switches.",
  "联邦": "Federal",
  "taxable = AGI − 标准扣除 − 加班扣除": "taxable = AGI − standard deduction − overtime deduction",
  "联邦标准扣除": "Federal standard deduction",
  "该档上限 ($)": "Bracket ceiling ($)",
  "税率 (%)": "Rate (%)",
  "操作": "Action",
  "加一档": "Add bracket",
  "taxable = AGI − DC 标准扣除": "taxable = AGI − DC standard deduction",
  "DC 标准扣除": "DC standard deduction",
  "FICA 与 OBBBA": "FICA & OBBBA",
  "社保税率": "Social Security rate",
  "社保工资上限": "Social Security wage base",
  "医保税率": "Medicare rate",
  "附加医保税率": "Additional Medicare rate",
  "附加医保起征点": "Additional Medicare threshold",
  "加班扣除上限": "Overtime deduction cap",
  "加班扣除退坡起点": "Overtime phaseout starts",
  "401(k) 上限": "401(k) limit",
  "HSA 上限": "HSA limit",
  "IRA 上限": "IRA limit",
  "IRA 抵扣退坡起点": "IRA phaseout starts",
  "IRA 抵扣退坡终点": "IRA phaseout ends",
  "税表年度": "Tax year",
  "年": "year",
  "恢复默认税表": "Restore default tax tables",
  "撤销": "Undo",
  "反查：想拿到等效年终奖，需要加多少班": "Target bonus: how much overtime would it take?",
  "目标等效年终奖": "Target equivalent bonus",
  "占基本工资 %": "% of base salary",
  "需要加班": "Overtime needed",
  "目标 %": "Target %",
  "需要加班 (h)": "Overtime needed (h)",
  "折合每周 (h)": "Per week (h)",
  "届时总薪酬包": "Total compensation",
  "公式与原表一致：": "Same formula as the original workbook: ",
  "ROUND(MAX(0,(目标% × 基本工资 − 年终奖) / 加班时薪), 0)": "ROUND(MAX(0,(target% × base salary − bonus) / overtime hourly rate), 0)",
  "。点任意一行可把上面的测算跳到该小时数。": ". Click any row to calculate at those hours.",
  "复制表格": "Copy table",
  "导出 CSV": "Export CSV",
  "打印 / PDF": "Print / PDF",
  "加班 (h)": "Overtime (h)",
  "401(k) 匹配": "401(k) match",
  "总薪酬包": "Total compensation",
  "当前选中的小时数所在行高亮；点任意一行可切换过去。": "The current hours are highlighted. Click a row to select those hours.",
  "恢复默认": "Restore defaults",
  "预填的是示例数字，换成你自己的即可；改动即时生效，只保存在本机。公式逐格对应原表 Backup 工作表。": "These are sample figures; enter your own. Changes apply immediately and stay on this device. Formulas match the original workbook’s Backup sheet.",
  "基本工资": "Base salary",
  "$ / 年": "$ / year",
  "标准年工时": "Standard annual hours",
  "加班倍率": "Overtime multiplier",
  "年终奖（固定）": "Fixed annual bonus",
  "% of 基本 + 加班费": "% of base + overtime",
  "匹配的计算基数": "Match basis",
  "原表口径": "Workbook basis",
  "含加班费": "Include overtime",
  "仅基本工资": "Base salary only",
  "% of 基本工资": "% of base salary",
  "PTO（带薪休假）": "PTO (paid time off)",
  "明细表上限": "Schedule maximum",
  "显示步长": "Row interval",
  "10 小时": "10 hours",
  "25 小时": "25 hours",
  "50 小时": "50 hours",
  "100 小时": "100 hours",
  "口径说明": "Calculation notes",
  "「等效年终奖 %」把加班费与固定年终奖合并，视作一笔传统的、按基本工资计算的年终奖。": "Equivalent bonus % combines overtime pay and the fixed bonus into one traditional bonus expressed as a percentage of base salary.",
  "总薪酬包 = 总现金薪酬 + 401(k) 雇主匹配 + 利润分享 + 通讯补贴。": "Total compensation = total cash pay + 401(k) employer match + profit sharing + phone allowance. ",
  "不含": "Excludes ",
  "员工本人的 401(k) / HSA 供款。": "employee 401(k) / HSA contributions.",
  "401(k) 匹配的计算基数可切换。原表按「基本工资 + 加班费」计算；如果你的计划文件把加班费排除在 eligible compensation 之外，切到「仅基本工资」，匹配额就不再随加班增长。切成后者时结果会与原表不一致，页面上会标出来。": "The 401(k) match basis is adjustable. The workbook uses base salary plus overtime. If your plan excludes overtime from eligible compensation, choose Base salary only; the match will no longer rise with overtime. The page flags this departure from the workbook.",
  "这只是现金薪酬与雇主福利的比较。加班需要额外付出工时，这一点和传统年终奖不同。利润分享按当年经济价值计入，即使次年 3、4 月才发放。": "This compares cash pay and employer benefits. Overtime requires extra working hours, unlike a traditional bonus. Profit sharing counts toward the year’s economic value even if paid the following March or April.",
  "关于 PTO": "About PTO",
  "：带薪休假不改变任何一个金额——它本来就含在基本工资里，所以基本工资、加班费、总薪酬包、401(k) 匹配和全部税额，加不加 PTO 都一样。加班时薪仍然按": ": paid leave changes none of the dollar amounts because it is already included in base salary. Salary, overtime pay, total compensation, the 401(k) match and all taxes stay the same. The overtime rate still uses ",
  "基本工资 ÷ 标准年工时": "base salary ÷ standard annual hours",
  "算（这是薪资口径：除数是「工资覆盖的小时数」，PTO 不缩小它；除以 1,920 会把加班时薪算高）。PTO 真正改变的是两件事：": " (the payroll divisor is the number of paid hours; PTO does not reduce it, and dividing by 1,920 would overstate the rate). PTO affects two things: ",
  "实际每工作一小时值多少": "value per actual hour worked",
  "（总现金 ÷ 扣掉 PTO、加上加班的实际工时），以及": " (total cash divided by actual hours, subtracting PTO and adding overtime), and ",
  "加班要挤进多少周": "how many weeks absorb the overtime",
  "——四周 PTO 意味着只有 48 个工作周，同样 250 小时加班就从每周 4.8 变成 5.2 小时。": ". Four weeks of PTO leaves 48 working weeks, so 250 overtime hours rise from 4.8 to 5.2 hours per week.",
  "税前部分的公式逐格对应原 Excel 模型的 Backup 工作表（预填数字是示例，不是原表里的数）。税后板块是额外加的，原表里没有。": "Pre-tax formulas match the original Excel model’s Backup sheet cell by cell. The sample figures are generic. The after-tax section is an addition and was not in the workbook.",
  "税后板块的口径": "After-tax assumptions",
  "：单身申报、只用标准扣除。401(k) 减联邦和 DC 的应税收入但": ": single filer, standard deduction only. Employee 401(k) reduces federal and DC taxable income but ",
  "不减 FICA": "does not reduce FICA",
  "；HSA 走工资扣除时连 FICA 一起减，不走工资扣除则只减所得税。": ". Payroll HSA contributions also reduce FICA; non-payroll HSA contributions reduce income tax only.",
  "OBBBA 加班扣除": "OBBBA overtime deduction",
  "（2025–2028 税年）：只有": " (tax years 2025–2028): only ",
  "FLSA 要求支付的加班": "overtime required by the FLSA",
  "才算——豁免（exempt）员工即使公司按 1.5 倍付了加班费，也不能扣，这时把开关切到「不计」。能扣的只是时薪一倍以上、至多 1.5 倍的那部分溢价（倍率更高时多出来的部分不算），上限 12,500；MAGI 超过 150,000 后，": " qualifies. Exempt employees do not qualify even if their employer pays 1.5×; choose Exclude in that case. Only the premium above the regular rate, up to 1.5×, qualifies (any higher premium is excluded), capped at $12,500. Above $150,000 MAGI, ",
  "从扣除额里": "the deduction is reduced",
  "每满 1,000 美元减 100 美元（不足 1,000 的部分不计）。DC 是否跟随逐年在变、仍有争议：默认按 DC 首席财务官对 2026 年的说明计入，报税前以 OTR 当年的表格为准。": " by $100 for each full $1,000 of excess income; partial thousands are ignored. DC conformity varies by year and remains disputed. The default follows the DC CFO’s 2026 guidance; check the applicable OTR forms before filing.",
  "传统 IRA": "Traditional IRA",
  "：有公司退休计划时，抵扣按 MAGI（": ": when covered by an employer retirement plan, deductibility phases out based on MAGI (",
  "不扣 IRA 本身": "without subtracting the IRA contribution",
  "）退坡，2026 年单身是 81,000–91,000；区间内按比例减少（取整到 10 美元，最少 200），超过终点就不可抵扣。不可抵扣的部分照样从到手里扣掉，只是不减税。": "). The 2026 single-filer range is $81,000–$91,000. Within the range the limit falls proportionately, rounded up to $10 with a $200 minimum; above it there is no deduction. Nondeductible contributions still reduce take-home cash but do not reduce tax."
};
  // Fragments are limited to the calculator's existing composed messages.
  // Longer phrases win; user-entered values are never passed through this catalog.
  var phrases = {
    "基本工资（在岗）": "Base salary (working time)", "年终奖": "Annual bonus",
    "与原表口径不同": "Different from workbook", "到手": "Take-home",
    "请先填写有效的基本工资与标准年工时。": "Enter a valid base salary and standard annual hours first.",
    "标准年工时为 0，没有可用的工作周，折合每周无法计算。": "Standard annual hours are zero; hours per working week cannot be calculated.",
    "PTO 几乎占满了标准年工时，没有可用的工作周，折合每周无法计算。": "PTO uses nearly all standard annual hours; hours per working week cannot be calculated.",
    "基本工资必须大于 0，否则时薪与等效年终奖都无法计算。": "Base salary must be greater than zero to calculate hourly pay and equivalent bonus.",
    "标准年工时必须大于 0。": "Standard annual hours must be greater than zero.",
    "当前加班小时超出了明细表上限，曲线与表格只画到上限为止。": "Selected overtime exceeds the schedule maximum. The chart and table stop at that maximum.",
    "PTO 几乎占满了标准年工时，没有工作周可言，「折合每工作周」和「实际时薪」都算不出来。": "PTO uses nearly all standard annual hours; hours per working week and effective hourly pay cannot be calculated.",
    "需要有效的加班时薪": "Enter a valid overtime hourly rate",
    "联邦所得税": "Federal income tax", "DC 所得税": "DC income tax",
    "只有 FLSA 要求支付的加班才算：豁免（exempt）员工即使公司按 1.5 倍付了加班费，也不能扣。": " Only FLSA-required overtime qualifies. Exempt employees do not qualify even if their employer pays 1.5×.",
    "不计入加班扣除，加班费按普通工资全额计税。": "Overtime deduction excluded. All overtime pay is taxed as ordinary wages.",
    "当前没有可扣除的加班溢价（没有加班，或倍率不高于 1 倍）。": "There is no eligible overtime premium (no overtime, or a multiplier of 1× or less).",
    "可扣除的加班溢价 ": "Eligible overtime premium: ",
    "（时薪一倍以上、至多 1.5 倍的那部分）": " (the premium above regular pay, up to 1.5×)",
    "，按上限 ": ", capped at ", " 计": "", "；MAGI 超过 ": "; MAGI exceeds ",
    "，退坡扣减 ": ", phaseout reduction: ", "，实际扣除 ": "; actual deduction: ",
    "联邦和 DC 都扣。": "applied to federal and DC income tax.", "只作用于联邦所得税。": "applied to federal income tax only.",
    "有公司退休计划时，传统 IRA 的抵扣按 MAGI（不扣 IRA 本身）在 ": "With an employer retirement plan, the traditional IRA deduction phases out over MAGI (before the IRA deduction) of ",
    " 之间退坡。你的 MAGI 约 ": ". Your MAGI is about ",
    "可抵扣额度降到 ": "the deduction limit falls to ", "，这笔供款仍然全部可抵扣。": "; this contribution remains fully deductible.",
    "只能抵扣 ": "deductible amount: ", "，其余不可抵扣": "; the rest is nondeductible", "这笔供款不可抵扣": "this contribution is nondeductible",
    "；税额已按此计算，不可抵扣的部分照样从到手里扣掉。": ". Tax reflects this treatment; the nondeductible portion still reduces take-home cash.",
    "：超出部分只有 50 岁以上的追加供款（catch-up）才成立，页面按你填的数计算。": ". The excess requires age-50+ catch-up eligibility. Calculations use your entered amount.",
    "HSA 供款超过上限 ": "HSA contributions exceed the limit of ",
    "：只有家庭计划或 55 岁以上的追加供款才可能更高，页面按你填的数计算。": ". A higher limit requires family coverage or age-55+ catch-up eligibility. Calculations use your entered amount.",
    "IRA 供款超过上限 ": "IRA contributions exceed the limit of ",
    "：可抵扣的部分以上限为准；50 岁以上有追加额度，请把「IRA 上限」改成对应数字。": ". Deductibility is capped at this limit. For age-50+ catch-up contributions, update the IRA limit accordingly.",
    "供款合计 ": "Total contributions of ", " 超过了总现金薪酬 ": " exceed total cash pay of ",
    "，到手成了负数——请检查供款或工资。": ", making take-home cash negative. Check contributions and salary.",
    "表格已复制，可直接粘进 Excel。": "Table copied. You can paste it into Excel.",
    "复制失败，请改用导出 CSV。": "Copy failed. Try Export CSV instead.",
    "已导出 ": "Exported ", "导出失败：": "Export failed: ",
    "已恢复默认示例值——10 秒内可以按旁边的「撤销」撤回。": "Sample defaults restored. Use Undo within 10 seconds to revert.",
    "已撤销恢复。": "Reset undone.",
    " 年的默认值，你的供款和开关没有动；10 秒内可以撤回。": " defaults. Contributions and switches are unchanged. Undo within 10 seconds to revert.",
    "税表已恢复到 ": "Tax tables restored to ",
    "税表已从 ": "Tax tables updated from ", " 年更新到 ": " to ", " 年的默认值": " defaults",
    " 供款跟着上限从 ": " contribution followed the limit from ", " 调到 ": " to ",
    "；其余供款和开关保持不变。": "; other contributions and switches are unchanged.",
    "，你的供款和开关保持不变。": ". Your contributions and switches are unchanged.",
    "401(k) 匹配计算基数": "401(k) match basis", "基本工资 + 加班费（原表口径）": "Base salary + overtime (workbook basis)",
    "工作周数（扣除 PTO）": "Working weeks (excluding PTO)", "实际工作小时（含加班）": "Actual hours worked (including overtime)",
    "（工资扣除）": " (payroll)", "（非工资扣除）": " (non-payroll)", "其中可抵扣的 IRA": "Deductible IRA portion",
    "（未计入）": " (excluded)", "联邦应税所得": "Federal taxable income", "DC 应税所得": "DC taxable income",
    "（扣加班扣除）": " (with overtime deduction)", "（不扣加班扣除）": " (without overtime deduction)",
    "每加班小时税后净得": "Net per overtime hour", "反查：目标等效年终奖 → 需要加班小时": "Target bonus → overtime hours needed",
    "找不到样式表，无法生成打印页。": "Stylesheet missing; cannot generate the print page.",
    "已在浏览器中打开打印页，按 ⌘P 打印或存为 PDF。": "Print page opened in your browser. Press ⌘P to print or save as PDF.",
    "无法打开浏览器。": "Could not open the browser.", "生成打印页失败：": "Could not generate the print page: ",
    "目标": "Target", "加班扣除": "overtime deduction", "以上": "No ceiling", "删": "Remove"
  };
  var patterns = [
    [/^在 (.+) 加班下，总现金薪酬 (.+) \+ 雇主福利 (.+)。$/, 'At $1 overtime: $2 cash pay + $3 employer benefits.'],
    [/^税后到手约 (.+)（估算，见下方「税后」）$/, 'Estimated take-home: $1 (see After tax below).'],
    [/^按 (.+) 个工作周折算（一年 52 周，减去 (.+) 小时 PTO）。滑杆与两个输入框始终同步；下方「显示步长」只决定明细表每行的间隔。$/, 'Based on $1 working weeks (52 weeks minus $2 hours of PTO). The slider and both inputs stay in sync; Row interval only controls the schedule spacing.'],
    [/明细表上限相对步长过大，表格已截断到 (\d+) 行。/g, 'The schedule maximum is too large for this interval; the table is limited to $1 rows.'],
    [/^折合每周 (.+) h，届时总薪酬包 (.+)$/, '$1 h per week · total compensation $2'],
    [/^总薪酬包 (.+?) 的构成：/, 'Breakdown of $1 total compensation: '],
    [/^第 (\d+) 档上限$/, 'Bracket $1 ceiling'], [/^第 (\d+) 档税率$/, 'Bracket $1 rate'], [/^删除第 (\d+) 档$/, 'Remove bracket $1'],
    [/ · 第 (\d+) 行，跳到这个小时数$/, ' · row $1, calculate at these hours'],
    [/^(.+) 税率$/, '$1 tax rates'], [/^上限 (.+)$/, 'Limit $1'], [/^恢复 (\d+) 默认税表$/, 'Restore $1 tax tables'],
    [/第 (\d+) 档上限留空表示「以上全部」，它后面的档都不会参与计算——只有最后一档可以留空。/g, 'Bracket $1 has no ceiling, so later brackets are ignored. Only the last bracket may have a blank ceiling.'],
    [/第 (\d+) 档上限不高于上一档，这一档没有参与计算。/g, 'Bracket $1 does not exceed the previous ceiling and is ignored.'],
    [/^OBBBA 加班扣除只适用于 2025–2028 税年，(\d+) 年不计。$/, 'The OBBBA overtime deduction applies only in 2025–2028, not $1.'],
    [/401\(k\) 供款超过 (\d+) 年上限 /g, '401(k) contributions exceed the $1 limit of '],
    [/^税后（(\d+) 税表，单身，标准扣除）$/, 'After tax ($1 tables, single filer, standard deduction)']
  ];
  var all = Object.assign({}, copy, phrases);
  var escapeRE = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };
  var fragmentRE = new RegExp(Object.keys(all).sort(function (a,b) { return b.length-a.length; }).map(escapeRE).join('|'), 'g');
  function english(s) {
    if (!/[\u3400-\u9fff]/.test(s)) return s;
    var norm = s.replace(/\s+/g, ' ').trim();
    if (Object.prototype.hasOwnProperty.call(all, norm)) return all[norm];
    var result = norm;
    patterns.forEach(function (p) { result = result.replace(p[0], p[1]); });
    return result.replace(fragmentRE, function (part) { return all[part]; }).replace(/，/g, ', ').replace(/。/g, '.').replace(/；/g, '; ');
  }
  var lang = 'zh';
  try { if (localStorage.getItem('tc_language') === 'en') lang = 'en'; } catch (_) {}
  var reverse = {};
  Object.keys(all).forEach(function (key) { if (all[key]) reverse[all[key].trim()] = key; });
  var records = new WeakMap();
  var attrs = ['aria-label', 'title', 'placeholder', 'data-label', 'content'];
  var observer;
  function update(node, key, read, write) {
    var value = read(), saved = records.get(node) || {};
    var rec = saved[key];
    if (!rec || value !== rec.shown) rec = { source: reverse[value.trim()] || value };
    var translated = lang === 'en' ? english(rec.source) : rec.source;
    if (lang === 'en' && key === 'text' && node.parentElement && node.parentElement.closest('#topbarTitle')) {
      if (rec.source.trim() === '总薪酬包') translated = 'Total ';
      if (rec.source.trim() === '到手') translated = 'Net pay ';
      if (rec.source.trim() === '有效税率') translated = 'Tax rate ';
    }
    // Preserve whitespace around inline elements; the dictionary owns prose spacing.
    if (lang === 'en' && key === 'text' && translated !== rec.source) {
      translated = (/^\s/.test(rec.source) ? ' ' : '') + translated + (/\s$/.test(rec.source) ? ' ' : '');
    }
    rec.shown = translated;
    saved[key] = rec; records.set(node, saved);
    if (value !== translated) write(translated);
  }
  function visit(root) {
    if (root.nodeType === 3) {
      if (root.parentElement && !root.parentElement.closest('script,style,noscript,#languageToggle')) {
        update(root, 'text', function () { return root.nodeValue; }, function (s) { root.nodeValue = s; });
      }
    } else if (root.nodeType === 1 || root.nodeType === 9) {
      if (root.nodeType === 1) {
        if (root.matches('script,style,noscript,#languageToggle')) return;
        attrs.forEach(function (a) {
          if (root.hasAttribute(a)) update(root, a, function () { return root.getAttribute(a); }, function (s) { root.setAttribute(a,s); });
        });
      }
      Array.from(root.childNodes).forEach(visit);
    }
  }
  function observe() { observer.observe(document.documentElement, {subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:attrs}); }
  function flush() {
    observer.disconnect();
    visit(document.documentElement);
    observe();
  }
  observer = new MutationObserver(function (changes) {
    observer.disconnect();
    changes.forEach(function (m) {
      if (m.type === 'childList') Array.from(m.addedNodes).forEach(visit);
      else visit(m.target);
    });
    observe();
  });
  function sourceText(el) {
    return Array.from(el.childNodes).map(function (n) {
      var rec = records.get(n);
      return n.nodeType === 3 ? (rec && rec.text ? rec.text.source : n.nodeValue) : sourceText(n);
    }).join('');
  }
  function chrome() {
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
    var button = document.getElementById('languageToggle');
    button.textContent = lang === 'en' ? '中文' : 'EN';
    button.setAttribute('aria-label', lang === 'en' ? 'Switch to Chinese' : '切换到英文');
    try {
      if (window.webkit && window.webkit.messageHandlers.app) window.webkit.messageHandlers.app.postMessage({type:'language',value:lang});
    } catch (_) {}
    button.title = lang === 'en' ? 'Switch to Chinese' : 'Switch to English';
  }
  window.TCI18n = {
    text: function (s) { return lang === 'en' ? english(String(s)) : s; },
    sourceText: sourceText,
    flush: flush
  };
  document.getElementById('languageToggle').addEventListener('click', function () {
    var y = window.scrollY, x = window.scrollX;
    lang = lang === 'en' ? 'zh' : 'en';
    try { localStorage.setItem('tc_language', lang); } catch (_) {}
    chrome(); flush();
    window.dispatchEvent(new Event('languagechange'));
    window.scrollTo(x,y);
  });
  chrome(); flush();
}());
