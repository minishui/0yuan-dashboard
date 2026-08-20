/*
 * 落地页主链路分析看板 — 配置层
 * 事件口径、漏斗步骤、预警阈值、版本变化占位，均集中在此，
 * 便于业务侧在“不改动逻辑代码”的前提下调整映射与阈值。
 *
 * 事件映射已用底表反推验证（全局 + 单页 B26-0YD-Njpf 均与对话数字精确吻合）。
 */

window.CONFIG = {

  /* 订单缺口补齐（数据接入期，不删除、只补齐）
   * 订单成功事件 zero_order_success 的埋点于 2026-04-09 才首次有数据；
   * 此前 2026-03-25 ~ 2026-04-08 为数据接入初期，“有支付、无订单”。
   * 该区间订单按“支付 × ORDER_FILL_RATE”估算补齐，数据保留、不删除，
   * 使全量口径“支付→订单”贴近真实（≈99%，实际补齐后受缺口占比影响略低）。 */
  ORDER_GAP_START: '2026-03-25',
  ORDER_GAP_END:   '2026-04-08',
  ORDER_FILL_RATE: 0.99,

  /* 事件码 → 中文名 / 分组
   * group: main(主链路) | block(阻断) | other(其他参考)
   * 注：fristPagePv 已在数据生成阶段合并进 firstPagePv。 */
  EVENT_MAP: {
    // —— 主链路 ——
    'firstPagePv':     { zh: '访问（展现PV）', group: 'main' },
    'slideScreen':     { zh: '滑动',           group: 'main' },
    'authorizeLoginSuccess': { zh: '授权登录成功', group: 'main' },
    '70':              { zh: '授权登录成功',   group: 'main' },
    'choosecourse':    { zh: '选择课程',       group: 'main' },
    'paysubmit':       { zh: '立即支付',       group: 'main' },
    'zero_order_success': { zh: '订单成功',    group: 'main' },
    'choosegrade':     { zh: '选择年级',       group: 'main' },
    // —— 阻断事件 ——
    'notFoundOptionalCourse': { zh: '无可选课程',   group: 'block' },
    'createordererror': { zh: '下单失败',       group: 'block' },
    '38':              { zh: '拒绝手机号授权', group: 'block' },
    // —— 其他参考事件 ——
    '39':              { zh: '用户授权同意获取手机号', group: 'other' },
    '90':              { zh: '授权注册成功',   group: 'other' },
    'authorizeLoginFail': { zh: '手机号授权登录失败', group: 'other' },
    'loginstate':      { zh: '用户是否登录',   group: 'other' },
    'getTokenWithCode':{ zh: 'getTokenWithCode', group: 'other' },
    'coursePopIsShown':{ zh: '选择课程弹窗显示了', group: 'other' },
    'showselectcoursedialog': { zh: '显示选课弹窗', group: 'other' },
    'click_order_btn': { zh: 'click_order_btn', group: 'other' },
    'zero_start_order':{ zh: 'zero_start_order', group: 'other' },
    'ordernum':        { zh: '下单成功',       group: 'other' },
    '34':              { zh: '34（未命名点击）', group: 'other' },
    '8':               { zh: '授权网络错误',   group: 'other' },
    'switchPhoneLoginClick': { zh: '切换手机号登录点击', group: 'other' },
    'switchPhonePageReload': { zh: '切换手机号页刷新', group: 'other' },
    'switchPhoneRefuse': { zh: '切换手机号拒绝', group: 'other' },
    'switchPhoneSuccess': { zh: '切换手机号成功', group: 'other' },
    'tal_token_change':{ zh: 'tal_token_change', group: 'other' },
    'completion_page_view': { zh: '实时加微页面曝光', group: 'other' },
    'completion_qrcode_time_show': { zh: '实时二维码曝光', group: 'other' },
    'completion_qrcode_time_press': { zh: '实时二维码长按', group: 'other' },
    'completion_qrcode_back_show': { zh: '兜底二维码曝光', group: 'other' },
    'completion_qrcode_back_press': { zh: '兜底二维码长按', group: 'other' },
    'completion_default_show': { zh: '默认完成页展示', group: 'other' },
    'completion_float_btn_click': { zh: '悬浮按钮点击', group: 'other' },
    'customerservice': { zh: '点击客服', group: 'other' },
    'custommodule':    { zh: '模块点击', group: 'other' },
    'dialogshow':      { zh: '弹窗显示', group: 'other' },
    'dialogShow':      { zh: '弹框展示', group: 'other' },
    'donotgotoast':    { zh: '挽留弹窗展示', group: 'other' },
    'downloadapp':     { zh: '点击下载app', group: 'other' },
    'duration':        { zh: '记录页面浏览时长', group: 'other' },
    'cancleUpdate':    { zh: 'cancleUpdate', group: 'other' },
    'bind':            { zh: '老带新关系绑定', group: 'other' },
    'calllogin':       { zh: '唤起登录弹窗', group: 'other' },
    'codechange':      { zh: '输入短信验证码格式正确', group: 'other' },
    'getPay':          { zh: '获取到确认订单页数据', group: 'other' },
    'auto_time_conflict_dialog_click_jump': { zh: '自动弹出时间冲突弹窗点击跳转', group: 'other' },
    'auto_time_conflict_dialog_show': { zh: '自动弹出时间冲突弹窗曝光', group: 'other' },
    'auto_time_conflict_toast_show': { zh: '自动弹出时间冲突toast曝光', group: 'other' },
    'grade_select_after_confirm': { zh: 'grade_select_after_confirm', group: 'other' },
    'grade_select_after_dialog_show': { zh: 'grade_select_after_dialog_show', group: 'other' },
    'timeconflictoast':{ zh: 'timeconflictoast', group: 'other' },
    'toast_error':     { zh: '前端toast提示埋点', group: 'other' },
    'txloadsdk':       { zh: 'txloadsdk', group: 'other' },
    'wakeUpApp':       { zh: 'wakeUpApp', group: 'other' }
  },

  /* 主链路漏斗步骤（访问→滑动→选择年级→授权→选择课程→立即支付→订单成功）
   * 顺序即漏斗层级；滑动 标 optional 表示非必要步骤（用户可跳过）。 */
  MAIN_FUNNEL: [
    { key: 'visit',  name: '访问',       codes: ['firstPagePv'] },
    { key: 'slide',  name: '滑动',       codes: ['slideScreen'], optional: true },
    { key: 'grade',  name: '选择年级',   codes: ['choosegrade'] },
    { key: 'auth',   name: '授权登录',   codes: ['authorizeLoginSuccess', '70'] },
    { key: 'choose', name: '选择课程',   codes: ['choosecourse'] },
    { key: 'pay',    name: '立即支付',   codes: ['paysubmit'] },
    { key: 'order',  name: '订单成功',   codes: ['zero_order_success'] }
  ],

  /* 阻断事件（占访问比例，UV 可能重叠，不可直接相加） */
  BLOCK_EVENTS: [
    { key: 'noCourse',   name: '无可选课程',   codes: ['notFoundOptionalCourse'] },
    { key: 'orderFail',  name: '下单失败',     codes: ['createordererror'] },
    { key: 'rejectAuth', name: '拒绝手机号授权', codes: ['38'] }
  ],

  /* 预警阈值（沿用对话口径）
   * 以“订单成功/访问”的环比变化（最近7活跃日 vs 前7活跃日）为红黄主判据。 */
  ALERT: {
    redDrop: 0.20,    // 相对下降 ≥ 20% → 红
    yellowDrop: 0.10, // 相对下降 ≥ 10% 且 < 20% → 黄
    maxAlerts: 15     // 预警面板最多展示条数（按严重度+下降幅度排序）
  },

  /* 业务线分类覆盖（可选）
   * 数据生成时已按页面名称自动归类（含“阅读”→阅读，其余（原“通用”）→数学）。
   * 如个别 pagekey 归类有误，在此以 { pagekey: '阅读'|'数学' } 覆盖。 */
  BUSINESS_LINE_OVERRIDE: {
    // 示例：'B25-0CX-xxxx': '数学'
  },

  /* 版本变化标注（待补充）
   * 水水将在此填写数学线/阅读线的换版时间节点与范围。
   * 填写后，趋势图会自动叠加竖向标注线，并在“版本变化”区列出。
   * 字段说明：
   *   date  : 换版生效日期 'YYYY-MM-DD'（标注线落点）
   *   label : 简短说明，如 '数学线A版→B版'
   *   scope : 适用业务线 '数学' | '阅读' | '全部'（与当前业务线筛选匹配才显示）
   *   note  : 备注（可选）
   * 示例：
   *   { date:'2026-06-01', label:'数学线视觉改版', scope:'数学', note:'B版头图上线' }
   */
  VERSION_CHANGES: [
    // 在此补充……
  ],

  /* 业务线对比配色 */
  LINE_COLORS: { '阅读': '#2f7ed8', '数学': '#8e44ad' }
};

/* 取事件中文名（未知码回退为原码） */
window.eventZh = function (code) {
  var m = window.CONFIG.EVENT_MAP[code];
  return m ? m.zh : code;
};
