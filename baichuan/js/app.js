/*
 * 落地页主链路分析看板 — 主逻辑
 * 依赖：config.js（window.CONFIG）、data.js（window.DASHBOARD_DATA）、echarts（全局）
 */
(function () {
  'use strict';
  var D = window.DASHBOARD_DATA, C = window.CONFIG;
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return (n == null ? 0 : n).toLocaleString('zh-CN'); };
  var pct = function (x, d) { return (x * 100).toFixed(d == null ? 1 : d) + '%'; };
  var pctSigned = function (x) { return (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%'; };

  var state = { bl: '全部', selPks: '全部', end: '全部', ut: '全部', dateMode: 'all', ds: null, de: null, pkSearch: '' };
  var currentTab = 'overview';
  var charts = {};
  var overviewSort = { col: 'visit', dir: -1 };

  /* ---------------- 数据工具 ---------------- */
  function blOf(pk) {
    if (C.BUSINESS_LINE_OVERRIDE[pk]) return C.BUSINESS_LINE_OVERRIDE[pk];
    var p = D.meta.pagekeys.find(function (x) { return x.pk === pk; });
    return p ? p.bl : '数学';
  }
  function allPksOfBl(bl) {
    return D.meta.pagekeys.filter(function (p) { return bl === '全部' || p.bl === bl; }).map(function (p) { return p.pk; });
  }
  function effectivePks() {
    var base = allPksOfBl(state.bl);
    if (state.selPks === '全部') return base;
    return base.filter(function (pk) { return state.selPks.has(pk); });
  }
  /* 日期工具：返回 dateStr 往前 n 天的 YYYY-MM-DD */
  function dayBefore(dateStr, n) {
    var p = String(dateStr).split('-');
    var dt = new Date(+p[0], +p[1] - 1, +p[2]);
    dt.setDate(dt.getDate() - n);
    function pad(x) { return (x < 10 ? '0' : '') + x; }
    return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate());
  }
  function matchBase(f) {
    if (state.end !== '全部' && f.e !== state.end) return false;
    if (state.ut !== '全部' && f.ut !== state.ut) return false;
    if (state.dateMode === 'custom') {
      // 直接读取输入框当前值，避免依赖可能过期的 state.ds/de
      var ds = $('f-ds').value || D.meta.date_min;
      var de = $('f-de').value || D.meta.date_max;
      if (ds > de) { var _t = ds; ds = de; de = _t; } // 起止倒置时自动纠正，避免全空
      if (f.d < ds || f.d > de) return false;
    } else if (state.dateMode === 'recent30' || state.dateMode === 'recent7') {
      var days = state.dateMode === 'recent30' ? 30 : 7;
      if (f.d < dayBefore(D.meta.date_max, days)) return false;
    }
    return true;
  }
  function filteredFacts() {
    var pks = effectivePks();
    var gs = C.ORDER_GAP_START, ge = C.ORDER_GAP_END, rate = C.ORDER_FILL_RATE;
    return D.facts.filter(function (f) {
      if (pks.indexOf(f.pk) === -1) return false;
      return matchBase(f);
    }).map(function (f) {
      // 订单缺口补齐：接入期 3/25–4/8 订单埋点缺失，按“支付×99%”估算补齐（不删除数据）
      if (gs && ge && f.d >= gs && f.d <= ge) {
        var ev = f.ev || {};
        if (!ev.zero_order_success && ev.paysubmit > 0) {
          var filled = Math.round(ev.paysubmit * rate);
          return { pk: f.pk, d: f.d, e: f.e, ut: f.ut, ev: Object.assign({}, ev, { zero_order_success: filled }) };
        }
      }
      return f;
    });
  }
  function sumFromFacts(facts) {
    var m = {};
    for (var i = 0; i < facts.length; i++) {
      var ev = facts[i].ev;
      for (var c in ev) m[c] = (m[c] || 0) + ev[c];
    }
    return m;
  }
  function dailyByEvent(facts) {
    var m = {};
    for (var i = 0; i < facts.length; i++) {
      var f = facts[i];
      if (!m[f.d]) m[f.d] = {};
      for (var c in f.ev) m[f.d][c] = (m[f.d][c] || 0) + f.ev[c];
    }
    return m;
  }
  function sumDaily(daily, days) {
    var m = {}, ds = days || Object.keys(daily);
    for (var i = 0; i < ds.length; i++) {
      var row = daily[ds[i]] || {};
      for (var c in row) m[c] = (m[c] || 0) + row[c];
    }
    return m;
  }
  function activeWindows(daily) {
    var days = Object.keys(daily).filter(function (d) { return (daily[d]['firstPagePv'] || 0) > 0; }).sort();
    return { days: days, recent: days.slice(-7), prev: days.slice(-14, -7) };
  }
  function stepUV(step, agg) {
    var uv = step.codes.reduce(function (s, c) { return s + (agg[c] || 0); }, 0);
    // 合并口径封顶：选择年级合并主链路 choosegrade 与半弹窗 gradehalftoast，
    // 两事件存在少量重叠用户，UV 不应超访问，封顶至访问 UV 以保漏斗单调。
    if (step.cap === 'visit') uv = Math.min(uv, agg['firstPagePv'] || 0);
    return uv;
  }
  function buildFunnel(steps, agg) {
    var visit = stepUV(steps[0], agg), prev = null, out = [];
    for (var i = 0; i < steps.length; i++) {
      var uv = stepUV(steps[i], agg);
      out.push({
        key: steps[i].key, name: steps[i].name, uv: uv,
        conv: visit > 0 ? uv / visit : 0,
        stepConv: prev === null ? 1 : (prev > 0 ? uv / prev : 0),
        optional: !!steps[i].optional
      });
      prev = uv;
    }
    return out;
  }
  function periodAgg(period) {
    var facts = filteredFacts(), daily = dailyByEvent(facts);
    var w = activeWindows(daily);
    if (period === 'recent') return sumDaily(daily, w.recent);
    if (period === 'prev') return sumDaily(daily, w.prev);
    return sumFromFacts(facts);
  }
  function pkStat(pk) {
    var facts = D.facts.filter(function (f) { return f.pk === pk && matchBase(f); });
    if (!facts.length) return null;
    var daily = dailyByEvent(facts), w = activeWindows(daily);
    var aggAll = sumDaily(daily), aggR = sumDaily(daily, w.recent), aggP = sumDaily(daily, w.prev);
    var visit = aggAll['firstPagePv'] || 0;
    var order = aggAll['zero_order_success'] || 0;
    var rRate = (aggR['firstPagePv'] || 0) ? (aggR['zero_order_success'] || 0) / aggR['firstPagePv'] : 0;
    var pRate = (aggP['firstPagePv'] || 0) ? (aggP['zero_order_success'] || 0) / aggP['firstPagePv'] : 0;
    return {
      pk: pk, nm: (D.meta.pagekeys.find(function (x) { return x.pk === pk; }) || {}).nm || pk,
      bl: blOf(pk), visit: visit, order: order,
      conv: visit ? order / visit : 0,
      rRate: rRate, pRate: pRate,
      delta: pRate ? (rRate - pRate) / pRate : 0,
      activeDays: w.days.length
    };
  }

  /* ---------------- 图表 ---------------- */
  function chart(id) {
    if (charts[id]) charts[id].dispose();
    var el = $(id);
    if (!el) return null;
    charts[id] = echarts.init(el);
    return charts[id];
  }
  function funnelOption(title, data, color) {
    return {
      title: { text: title, left: 'center', textStyle: { fontSize: 14, color: '#333' } },
      tooltip: { trigger: 'item', formatter: function (p) {
        var convLine = '环节转化: ' + pct(p.data.stepConv);
        return (p.name + (p.data.optional ? '（非必要）' : '')) + '<br/>UV: ' + fmt(p.value) + '<br/>占访问: ' + pct(p.data.conv) + '<br/>' + convLine;
      } },
      series: [{
        type: 'funnel', top: 40, bottom: 10, left: '8%', width: '84%',
        minSize: '24%', maxSize: '100%', sort: 'none', gap: 2,
        label: { show: true, position: 'inside', formatter: function (p) { return p.name + (p.data.optional ? '（非必要）' : '') + ' ' + pct(p.data.conv); }, color: '#fff', fontSize: 12 },
        itemStyle: { color: color, borderColor: '#fff', borderWidth: 1 },
        data: data.map(function (d) { return { name: d.name, value: d.uv, conv: d.conv, stepConv: d.stepConv, optional: d.optional }; })
      }]
    };
  }
  function lineOption(title, steps, series, xDays, markLines) {
    var legend = steps.map(function (s) { return s.name; });
    var opt = {
      title: { text: title, left: 'center', textStyle: { fontSize: 14, color: '#333' } },
      tooltip: { trigger: 'axis', valueFormatter: function (v) { return v == null ? '-' : pct(v); } },
      legend: { bottom: 0, data: legend, textStyle: { fontSize: 11 } },
      grid: { left: 50, right: 20, top: 46, bottom: 46 },
      xAxis: { type: 'category', data: xDays, axisLabel: { fontSize: 10, rotate: 45 } },
      yAxis: { type: 'value', axisLabel: { formatter: function (v) { return (v * 100).toFixed(0) + '%'; } } },
      series: steps.map(function (s, i) {
        var ser = {
          name: s.name, type: 'line', smooth: true, showSymbol: false, data: series[i],
          lineStyle: { width: 2 }
        };
        if (i === 0 && markLines && markLines.length) {
          ser.markLine = {
            symbol: 'none', lineStyle: { color: '#e67e22', type: 'dashed' },
            label: { formatter: function (p) { return p.name; }, fontSize: 10, color: '#e67e22' },
            data: markLines
          };
        }
        return ser;
      })
    };
    return opt;
  }
  function versionMarkLines() {
    var bl = state.bl;
    return C.VERSION_CHANGES.filter(function (v) {
      return bl === '全部' || v.scope === '全部' || v.scope === bl;
    }).map(function (v) { return { xAxis: v.date, name: v.label }; });
  }

  /* ---------------- 渲染：总览 ---------------- */
  function renderOverview(facts, agg) {
    var visit = agg['firstPagePv'] || 0;
    var order = agg['zero_order_success'] || 0;
    var auth = (agg['authorizeLoginSuccess'] || 0) + (agg['70'] || 0);
    var daily = dailyByEvent(facts), w = activeWindows(daily);
    var aggR = sumDaily(daily, w.recent);
    var recentConv = (aggR['firstPagePv'] || 0) ? (aggR['zero_order_success'] || 0) / aggR['firstPagePv'] : 0;
    var pks = effectivePks();

    // KPI
    var kpis = [
      { l: '访问 UV', v: fmt(visit) },
      { l: '订单成功 UV', v: fmt(order) },
      { l: '整体转化率', v: pct(visit ? order / visit : 0) },
      { l: '访问→授权登录', v: pct(visit ? auth / visit : 0) },
      { l: '近期(最近7活跃日)转化率', v: pct(recentConv) },
      { l: '活跃 pagekey', v: fmt(pks.length) }
    ];
    $('ov-kpi').innerHTML = kpis.map(function (k) {
      return '<div class="kpi"><div class="kpi-v">' + k.v + '</div><div class="kpi-l">' + k.l + '</div></div>';
    }).join('');

    // 业务线对比
    var lines = ['阅读', '数学'];
    var blHtml = '<div class="bl-compare">';
    lines.forEach(function (ln) {
      var lfacts = facts.filter(function (f) { return blOf(f.pk) === ln; });
      var la = sumFromFacts(lfacts);
      var lv = la['firstPagePv'] || 0, lo = la['zero_order_success'] || 0;
      blHtml += '<div class="bl-card"><div class="bl-name" style="color:' + (C.LINE_COLORS[ln] || '#555') + '">' + ln + '</div>' +
        '<div class="bl-row"><span>访问</span><b>' + fmt(lv) + '</b></div>' +
        '<div class="bl-row"><span>订单成功</span><b>' + fmt(lo) + '</b></div>' +
        '<div class="bl-row"><span>转化率</span><b>' + pct(lv ? lo / lv : 0) + '</b></div></div>';
    });
    blHtml += '</div>';
    $('ov-bizline').innerHTML = blHtml;

    // 漏斗
    chart('ov-funnel-main');
    if (charts['ov-funnel-main']) charts['ov-funnel-main'].setOption(funnelOption('主链路（访问→订单成功）', buildFunnel(C.MAIN_FUNNEL, agg), '#2f7ed8'));

    // pagekey 排行表
    var rows = pks.map(pkStat).filter(Boolean);
    var cols = [
      { k: 'nm', t: '页面名称', s: false },
      { k: 'pk', t: 'pagekey', s: false },
      { k: 'bl', t: '业务线', s: false },
      { k: 'visit', t: '访问UV', s: true, f: fmt },
      { k: 'order', t: '订单成功UV', s: true, f: fmt },
      { k: 'conv', t: '整体转化率', s: true, f: function (x) { return pct(x); } },
      { k: 'delta', t: '近期环比', s: true, f: function (x) { return pctSigned(x); } }
    ];
    rows.sort(function (a, b) {
      var va = a[overviewSort.col], vb = b[overviewSort.col];
      if (va < vb) return -1 * overviewSort.dir; if (va > vb) return 1 * overviewSort.dir; return 0;
    });
    var totalVisit = rows.reduce(function (s, r) { return s + r.visit; }, 0);
    var totalOrder = rows.reduce(function (s, r) { return s + r.order; }, 0);
    var head = '<tr>' + cols.map(function (c) {
      var arrow = overviewSort.col === c.k ? (overviewSort.dir === -1 ? ' ▼' : ' ▲') : '';
      return '<th data-k="' + c.k + '"' + (c.s ? ' class="sortable"' : '') + '>' + c.t + arrow + '</th>';
    }).join('') + '</tr>';
    var body = rows.map(function (r) {
      return '<tr>' + cols.map(function (c) {
        var v = c.f ? c.f(r[c.k]) : r[c.k];
        var cls = '';
        if (c.k === 'delta') cls = r.delta < 0 ? 'neg' : (r.delta > 0 ? 'pos' : '');
        if (c.k === 'bl') cls = 'bl-' + r.bl;
        return '<td class="' + cls + '">' + v + '</td>';
      }).join('') + '</tr>';
    }).join('');
    var totalRow = '<tr class="total"><td>总计</td><td></td><td></td><td>' + fmt(totalVisit) + '</td><td>' + fmt(totalOrder) +
      '</td><td>' + pct(totalVisit ? totalOrder / totalVisit : 0) + '</td><td></td></tr>';
    $('ov-table').innerHTML = '<table><thead>' + head + '</thead><tbody>' + body + totalRow + '</tbody></table>';
    Array.prototype.forEach.call($('ov-table').querySelectorAll('th.sortable'), function (th) {
      th.onclick = function () {
        var k = th.getAttribute('data-k');
        if (overviewSort.col === k) overviewSort.dir *= -1; else { overviewSort.col = k; overviewSort.dir = -1; }
        renderOverview(facts, agg);
      };
    });
  }

  /* ---------------- 渲染：漏斗分析 ---------------- */
  function renderFunnel(facts, agg) {
    var period = $('fn-period') ? $('fn-period').value : 'all';
    var a = periodAgg(period);
    chart('fn-main');
    if (charts['fn-main']) charts['fn-main'].setOption(funnelOption('主链路', buildFunnel(C.MAIN_FUNNEL, a), '#2f7ed8'));
    // 分步转化率表
    var main = buildFunnel(C.MAIN_FUNNEL, a);
    function stepTable(title, data) {
      return '<h4>' + title + '</h4><table><thead><tr><th>环节</th><th>UV</th><th>占访问</th><th>环节转化</th></tr></thead><tbody>' +
        data.map(function (d) {
          var sc = pct(d.stepConv);
          var nameCell = d.name + (d.optional ? ' <span class="badge-opt">非必要</span>' : '');
          return '<tr><td>' + nameCell + '</td><td>' + fmt(d.uv) + '</td><td>' + pct(d.conv) + '</td><td>' + sc + '</td></tr>';
        }).join('') +
        '</tbody></table>';
    }
    $('fn-table').innerHTML = stepTable('主链路分步转化', main);
  }

  /* ---------------- 渲染：趋势预警 ---------------- */
  function renderTrend(facts) {
    var daily = dailyByEvent(facts);
    var days = Object.keys(daily).sort();
    var visitByDay = days.map(function (d) { return daily[d]['firstPagePv'] || 0; });
    function rateSeries(codes) {
      return days.map(function (d) {
        var v = daily[d]['firstPagePv'] || 0;
        if (!v) return null;
        var s = codes.reduce(function (a, c) { return a + (daily[d][c] || 0); }, 0);
        return s / v;
      });
    }
    var ml = versionMarkLines();
    // 主链路趋势
    var mainSteps = C.MAIN_FUNNEL.slice(1); // 除访问
    var mainSeries = mainSteps.map(function (s) { return rateSeries(s.codes); });
    chart('tr-main');
    if (charts['tr-main']) charts['tr-main'].setOption(lineOption('主链路各步 ÷ 访问（趋势）', mainSteps, mainSeries, days, ml));
    // 最近7 vs 前7 对比
    var w = activeWindows(daily);
    var aggR = sumDaily(daily, w.recent), aggP = sumDaily(daily, w.prev);
    function cmpRows(steps) {
      return steps.map(function (s) {
        var r = (aggR['firstPagePv'] || 0) ? stepUV(s, aggR) / aggR['firstPagePv'] : 0;
        var p = (aggP['firstPagePv'] || 0) ? stepUV(s, aggP) / aggP['firstPagePv'] : 0;
        return { name: s.name, r: r, p: p, d: p ? (r - p) / p : 0 };
      });
    }
    function cmpTable(title, steps) {
      var rows = cmpRows(steps);
      return '<h4>' + title + '（最近7活跃日 vs 前7活跃日，分母为访问）</h4><table><thead><tr><th>环节</th><th>前7</th><th>最近7</th><th>环比</th></tr></thead><tbody>' +
        rows.map(function (r) { return '<tr><td>' + r.name + '</td><td>' + pct(r.p) + '</td><td>' + pct(r.r) + '</td><td class="' + (r.d < 0 ? 'neg' : 'pos') + '">' + pctSigned(r.d) + '</td></tr>'; }).join('') +
        '</tbody></table>';
    }
    $('tr-cmp').innerHTML = cmpTable('主链路', C.MAIN_FUNNEL.slice(1));
    $('tr-window').textContent = '活跃日窗口：最近7 = [' + (w.recent[0] || '-') + ' ~ ' + (w.recent[w.recent.length - 1] || '-') +
      ']，前7 = [' + (w.prev[0] || '-') + ' ~ ' + (w.prev[w.prev.length - 1] || '-') + ']';

    renderAlerts(facts);
    renderVersionSection();
  }

  function renderAlerts(facts) {
    var pks = effectivePks();
    var alerts = [];
    // 全局汇总
    var daily = dailyByEvent(facts), w = activeWindows(daily);
    var aggR = sumDaily(daily, w.recent), aggP = sumDaily(daily, w.prev);
    var gR = (aggR['firstPagePv'] || 0) ? (aggR['zero_order_success'] || 0) / aggR['firstPagePv'] : 0;
    var gP = (aggP['firstPagePv'] || 0) ? (aggP['zero_order_success'] || 0) / aggP['firstPagePv'] : 0;
    var gDrop = gP ? (gP - gR) / gP : 0;
    var globalCard = '<div class="alert-card ' + (gDrop >= C.ALERT.redDrop ? 'red' : (gDrop >= C.ALERT.yellowDrop ? 'yellow' : 'ok')) + '">' +
      '<div class="alert-h">全局（当前筛选）订单成功/访问 环比</div>' +
      '<div class="alert-b">前7：' + pct(gP) + ' → 最近7：' + pct(gR) + '（' + pctSigned(-gDrop) + '）</div></div>';
    $('al-global').innerHTML = globalCard;

    pks.forEach(function (pk) {
      var st = pkStat(pk);
      if (!st || st.activeDays === 0) return;
      if (st.pRate > 0) {
        var drop = (st.pRate - st.rRate) / st.pRate;
        if (drop >= C.ALERT.redDrop) alerts.push({ level: 'red', pk: pk, nm: st.nm, type: 'conv', drop: drop, rRate: st.rRate, pRate: st.pRate });
        else if (drop >= C.ALERT.yellowDrop) alerts.push({ level: 'yellow', pk: pk, nm: st.nm, type: 'conv', drop: drop, rRate: st.rRate, pRate: st.pRate });
      }
    });
    alerts.sort(function (a, b) {
      if (a.level !== b.level) return a.level === 'red' ? -1 : 1;
      return (b.drop || 0) - (a.drop || 0);
    });
    alerts = alerts.slice(0, C.ALERT.maxAlerts);

    if (!alerts.length) { $('al-list').innerHTML = '<div class="alert-empty">当前筛选下未触发红/黄预警 ✓</div>'; return; }
    var html = alerts.map(function (x) {
      var body, action = '';
      if (x.type === 'conv') {
        body = '<b>' + x.nm + '</b>（' + x.pk + '）<br/>订单成功/访问：' + pct(x.pRate) + ' → ' + pct(x.rRate) + '（' + pctSigned(-x.drop) + '）';
        action = '排查顺序：① 近期新增热点/推广人/活动；② 用户城市·年级·人群是否变化；③ 是否课程不足或年级无课；④ 推广话术与页面承诺是否一致；⑤ 最后再判断是否重做页面。';
      }
      return '<div class="alert-card ' + x.level + '"><div class="alert-h">' +
        '🔴 转化明显下降' + '</div>' +
        '<div class="alert-b">' + body + '</div><div class="alert-action">建议：' + action + '</div></div>';
    }).join('');
    $('al-list').innerHTML = html;
  }

  function renderVersionSection() {
    var box = $('al-version');
    if (!C.VERSION_CHANGES.length) {
      box.innerHTML = '<div class="ver-empty">版本变化待补充：在 <code>js/config.js</code> 的 <code>VERSION_CHANGES</code> 中填写数学线/阅读线的换版日期与范围后，趋势图会自动叠加标注线。</div>';
      return;
    }
    box.innerHTML = C.VERSION_CHANGES.map(function (v) {
      return '<div class="ver-item"><b>' + v.date + '</b> · ' + v.label + ' · <span class="bl-' + v.scope + '">' + v.scope + '</span>' + (v.note ? ' — ' + v.note : '') + '</div>';
    }).join('');
  }

  /* ---------------- 渲染：阻断分析 ---------------- */
  function renderBlocking(facts, agg) {
    var visit = agg['firstPagePv'] || 0;
    var pks = effectivePks();
    // 汇总占比卡片
    var cards = C.BLOCK_EVENTS.map(function (b) {
      var uv = stepUV(b, agg);
      return '<div class="kpi"><div class="kpi-v">' + pct(visit ? uv / visit : 0) + '</div><div class="kpi-l">' + b.name + '<br/><span class="sub">UV ' + fmt(uv) + '</span></div></div>';
    }).join('');
    $('bk-cards').innerHTML = cards;
    $('bk-note').textContent = '注：阻断事件 UV 可能存在重复（同一用户可同时触发多类），占比不可直接相加。';

    // 按 pagekey 排名（按访问UV取 Top 20）
    var rows = pks.map(function (pk) {
      var pf = D.facts.filter(function (f) { return f.pk === pk && matchBase(f); });
      var a = sumFromFacts(pf), v = a['firstPagePv'] || 0;
      return { nm: (D.meta.pagekeys.find(function (x) { return x.pk === pk; }) || {}).nm || pk, pk: pk, visit: v,
        a: (a['notFoundOptionalCourse'] || 0), b: (a['createordererror'] || 0), c: (a['38'] || 0) };
    }).filter(function (r) { return r.visit > 0; }).sort(function (x, y) { return y.visit - x.visit; }).slice(0, 20);

    // 堆叠柱状：三类阻断占比
    chart('bk-chart');
    if (charts['bk-chart']) {
      charts['bk-chart'].setOption({
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' },
          formatter: function (ps) { var s = ps[0].name + '<br/>'; ps.forEach(function (p) { s += p.seriesName + '：' + pct(p.value) + '<br/>'; }); return s; } },
        legend: { bottom: 0, data: C.BLOCK_EVENTS.map(function (b) { return b.name; }) },
        grid: { left: 120, right: 30, top: 20, bottom: 40 },
        xAxis: { type: 'value', axisLabel: { formatter: function (v) { return (v * 100).toFixed(0) + '%'; } } },
        yAxis: { type: 'category', data: rows.map(function (r) { return r.nm; }), axisLabel: { fontSize: 10 } },
        series: C.BLOCK_EVENTS.map(function (b, i) {
          var key = ['a', 'b', 'c'][i];
          return { name: b.name, type: 'bar', stack: 't', data: rows.map(function (r) { return r.visit ? r[key] / r.visit : 0; }) };
        })
      });
    }
    // 表（含总计行）
    var head = '<tr><th>页面名称</th><th>pagekey</th><th>访问UV</th><th>无可选课程</th><th>下单失败</th><th>拒绝手机号授权</th></tr>';
    var body = rows.map(function (r) {
      return '<tr><td>' + r.nm + '</td><td>' + r.pk + '</td><td>' + fmt(r.visit) + '</td><td>' + pct(r.visit ? r.a / r.visit : 0) + '</td><td>' + pct(r.visit ? r.b / r.visit : 0) + '</td><td>' + pct(r.visit ? r.c / r.visit : 0) + '</td></tr>';
    }).join('');
    var tv = rows.reduce(function (s, r) { return s + r.visit; }, 0);
    var ta = rows.reduce(function (s, r) { return s + r.a; }, 0);
    var tb = rows.reduce(function (s, r) { return s + r.b; }, 0);
    var tc = rows.reduce(function (s, r) { return s + r.c; }, 0);
    var total = '<tr class="total"><td>Top20 合计</td><td></td><td>' + fmt(tv) + '</td><td>' + pct(tv ? ta / tv : 0) + '</td><td>' + pct(tv ? tb / tv : 0) + '</td><td>' + pct(tv ? tc / tv : 0) + '</td></tr>';
    $('bk-table').innerHTML = '<table><thead>' + head + '</thead><tbody>' + body + total + '</tbody></table>';
  }

  /* ---------------- 渲染：按月分析 ---------------- */
  function renderMonthly(facts) {
    var m = {};
    facts.forEach(function (f) {
      var ym = f.d.slice(0, 7);
      if (!m[ym]) m[ym] = {};
      for (var c in f.ev) m[ym][c] = (m[ym][c] || 0) + f.ev[c];
    });
    var months = Object.keys(m).sort();
    if (!months.length) {
      $('mn-table').innerHTML = '<div class="alert-empty">当前筛选无数据</div>';
      if (charts['mn-chart']) charts['mn-chart'].clear();
      return;
    }
    var totEv = {};
    var rows = months.map(function (ym) {
      var a = m[ym];
      Object.keys(a).forEach(function (c) { totEv[c] = (totEv[c] || 0) + a[c]; });
      var visit = a['firstPagePv'] || 0;
      var auth = (a['authorizeLoginSuccess'] || 0) + (a['70'] || 0);
      var choose = a['choosecourse'] || 0;
      var pay = a['paysubmit'] || 0;
      var order = a['zero_order_success'] || 0;
      return {
        ym: ym, visit: visit, order: order,
        conv: visit ? order / visit : 0,
        authR: visit ? auth / visit : 0,
        chooseR: auth ? choose / auth : 0,
        payR: choose ? pay / choose : 0,
        orderR: pay ? order / pay : 0
      };
    });
    var tv = totEv['firstPagePv'] || 0, tauth = (totEv['authorizeLoginSuccess'] || 0) + (totEv['70'] || 0);
    var tchoose = totEv['choosecourse'] || 0, tpay = totEv['paysubmit'] || 0, torder = totEv['zero_order_success'] || 0;

    // 组合图：访问UV / 订单成功UV（柱） + 整体转化率（折线，右轴）
    chart('mn-chart');
    if (charts['mn-chart']) charts['mn-chart'].setOption({
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, data: ['访问UV', '订单成功UV', '整体转化率'] },
      grid: { left: 64, right: 64, top: 44, bottom: 56 },
      xAxis: { type: 'category', data: months, axisLabel: { fontSize: 11 } },
      yAxis: [
        { type: 'value', name: 'UV', axisLabel: { formatter: function (v) { return (v / 1000).toFixed(0) + 'k'; } } },
        { type: 'value', name: '转化率', min: 0, max: 1, axisLabel: { formatter: function (v) { return (v * 100).toFixed(0) + '%'; } } }
      ],
      series: [
        { name: '访问UV', type: 'bar', data: rows.map(function (r) { return r.visit; }), itemStyle: { color: '#2f7ed8' } },
        { name: '订单成功UV', type: 'bar', data: rows.map(function (r) { return r.order; }), itemStyle: { color: '#27ae60' } },
        { name: '整体转化率', type: 'line', yAxisIndex: 1, smooth: true, data: rows.map(function (r) { return r.conv; }), lineStyle: { width: 3 }, itemStyle: { color: '#e67e22' } }
      ]
    });

    // 明细表
    var cols = [
      { t: '月份', f: function (r) { return r.ym; } },
      { t: '访问UV', s: true, f: function (r) { return fmt(r.visit); } },
      { t: '订单成功UV', s: true, f: function (r) { return fmt(r.order); } },
      { t: '整体转化率', s: true, f: function (r) { return pct(r.conv); } },
      { t: '访问→授权', s: true, f: function (r) { return pct(r.authR); } },
      { t: '授权→选课', s: true, f: function (r) { return pct(r.chooseR); } },
      { t: '选课→支付', s: true, f: function (r) { return pct(r.payR); } },
      { t: '支付→订单', s: true, f: function (r) { return pct(r.orderR); } },
    ];
    var head = '<tr>' + cols.map(function (c) { return '<th' + (c.s ? ' class="sortable"' : '') + '>' + c.t + '</th>'; }).join('') + '</tr>';
    var body = rows.map(function (r) {
      return '<tr>' + cols.map(function (c) { return '<td>' + c.f(r) + '</td>'; }).join('') + '</tr>';
    }).join('');
    var total = '<tr class="total"><td>总计</td><td>' + fmt(tv) + '</td><td>' + fmt(torder) + '</td><td>' + pct(tv ? torder / tv : 0) + '</td><td>' + pct(tv ? tauth / tv : 0) + '</td><td>' + pct(tauth ? tchoose / tauth : 0) + '</td><td>' + pct(tchoose ? tpay / tchoose : 0) + '</td><td>' + pct(tpay ? torder / tpay : 0) + '</td></tr>';
    $('mn-table').innerHTML = '<table><thead>' + head + '</thead><tbody>' + body + total + '</tbody></table>';
  }

  /* ---------------- 渲染：口径说明 ---------------- */
  function renderNotes() {
    var map = C.EVENT_MAP;
    var gmap = { main: '主链路', block: '阻断', other: '其他参考' };
    var groups = ['main', 'block', 'other'];
    var html = groups.map(function (g) {
      var rows = Object.keys(map).filter(function (c) { return map[c].group === g; })
        .map(function (c) { return '<tr><td><code>' + c + '</code></td><td>' + map[c].zh + '</td></tr>'; }).join('');
      return '<h4>' + gmap[g] + '</h4><table class="ev-map"><thead><tr><th>事件码</th><th>中文名</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }).join('');
    $('nt-map').innerHTML = html;

    $('nt-cal').innerHTML =
      '<ul>' +
      '<li><b>分母统一为“访问 UV”</b>（展现PV，已合并拼写变体 fristPagePv）。</li>' +
      '<li><b>主链路</b>：访问 → 滑动（非必要）→ 选择年级 → 授权登录成功 → 选择课程 → 立即支付 →（订单成功）。</li>' +
      '<li><b>“选择年级”口径</b>：仅含主链路「选择年级」(choosegrade)。原双入口的「年级半弹窗展示」(gradehalftoast) 为已删除链路事件，不并入主链路漏斗，避免虚增环节 UV 与漏斗倒挂。</li>' +
      '<li><b>半弹窗选年级（历史背景）</b>：双入口链路删除前，通过半弹窗选年级的触达约 245,716 人；该数据仍保留在底表中，仅作历史参照，不进入当前主链路漏斗统计。</li>' +
      '<li><b>转化率口径</b>：整体转化率 = 环节UV / 访问UV；环节转化 = 本环节 / 上一环节。</li>' +
      '<li><b>数据接入期订单补齐（不删除）</b>：底表最早 2026-03-25，但「订单成功」(zero_order_success) 埋点 2026-04-09 才上线，2026-03-25~2026-04-08 整段“有支付、无订单”。该区间订单按“支付×99%”估算补齐，数据保留不删除；补齐后全量「支付→订单」≈ <b>98.26%</b>（缺口仅占全量支付约 6.47%，故未完全拉至 99%）。</li>' +
      '<li><b>“最近7活跃日 vs 前7活跃日”</b>：活跃日 = 访问UV>0 的日期；取末尾 7 个与前 7 个。</li>' +
      '<li><b>业务线归类</b>：页面名称含「阅读 / 经典 / 茅盾 / 诵读 / 征文 / 全球青少年」等阅读品牌→阅读，其余（原“数学”+“通用”）→数学（可在 config.js 覆盖）。页面筛选面板支持按名称/业务线搜索。</li>' +
      '</ul>' +
      '<h4>已知局限 / 前置条件</h4>' +
      '<ul>' +
      '<li>⚠️ <b>缺页面换版时间</b>：目前只能说“同一 pagekey 近期转化效率下降”，<b>不能直接归因到某次视觉改版</b>。请在 config.js 的 VERSION_CHANGES 补充换版日期与范围后再下结论。</li>' +
      '<li>阻断事件 UV 可能重叠，占比不可直接相加。</li>' +
      '<li>数据来源：' + D.meta.source + '（生成于 ' + D.meta.generated_at + '，日期 ' + D.meta.date_min + ' ~ ' + D.meta.date_max + '）。</li>' +
      '</ul>';
  }

  /* ---------------- 渲染调度 ---------------- */
  function renderActive() {
    var facts = filteredFacts(), agg = sumFromFacts(facts);
    if (!facts.length) {
      ['ov-kpi', 'ov-bizline', 'ov-table', 'fn-table', 'tr-cmp', 'al-list', 'bk-cards', 'bk-table', 'nt-map', 'nt-cal', 'mn-table'].forEach(function (id) { if ($(id)) $(id).innerHTML = '<div class="alert-empty">当前筛选无数据</div>'; });
      ['ov-funnel-main', 'fn-main', 'tr-main', 'bk-chart', 'mn-chart'].forEach(function (id) { if (charts[id]) charts[id].clear(); });
      return;
    }
    if (currentTab === 'overview') renderOverview(facts, agg);
    else if (currentTab === 'funnel') renderFunnel(facts, agg);
    else if (currentTab === 'trend') renderTrend(facts);
    else if (currentTab === 'blocking') renderBlocking(facts, agg);
    else if (currentTab === 'monthly') renderMonthly(facts);
    else if (currentTab === 'notes') renderNotes();
  }

  /* ---------------- 筛选器 UI ---------------- */
  function buildFilters() {
    // 业务线
    var blBox = $('f-bl');
    blBox.innerHTML = ''; // 清空以便导入新数据后重建
    ['全部', '阅读', '数学'].forEach(function (bl) {
      var b = document.createElement('button');
      b.textContent = bl; b.className = 'chip' + (state.bl === bl ? ' on' : '');
      b.onclick = function () {
        state.bl = bl; state.selPks = '全部';
        Array.prototype.forEach.call(blBox.children, function (c) { c.className = 'chip' + (c.textContent === bl ? ' on' : ''); });
        buildPkPanel(); renderActive();
      };
      blBox.appendChild(b);
    });
    buildPkPanel();

    // 端 / 用户类型
    function fill(sel, vals) {
      sel.innerHTML = vals.map(function (v) { return '<option value="' + v + '">' + v + '</option>'; }).join('');
      sel.value = '全部';
      sel.onchange = function () { if (sel === $('f-end')) state.end = sel.value; else if (sel === $('f-ut')) state.ut = sel.value; onDateMode(); renderActive(); };
    }
    fill($('f-end'), ['全部'].concat(D.meta.ends));
    fill($('f-ut'), ['全部'].concat(D.meta.user_types));
    // 日期：快捷预设 + 自定义
    (function () {
      var sel = $('f-date');
      var opts = [['all', '累计'], ['recent30', '最近30天'], ['recent7', '最近7天'], ['custom', '自定义']];
      sel.innerHTML = opts.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('');
      sel.value = 'all';
      sel.onchange = function () { state.dateMode = sel.value; onDateMode(); renderActive(); };
    })();
    $('f-ds').value = D.meta.date_min; $('f-de').value = D.meta.date_max;
    $('f-ds').onchange = function () { renderActive(); };
    $('f-de').onchange = function () { renderActive(); };
    onDateMode();
  }
  function onDateMode() {
    var custom = state.dateMode === 'custom';
    // 自定义：展示起止输入框；其余模式隐藏（display:'' 还原为 input 默认 inline 显示）
    $('f-ds').style.display = custom ? '' : 'none';
    $('f-de').style.display = custom ? '' : 'none';
    if (custom) { $('f-ds').focus(); }
  }
  function buildPkPanel() {
    var box = $('f-pk');
    var pks = D.meta.pagekeys.filter(function (p) { return state.bl === '全部' || p.bl === state.bl; });
    box.innerHTML = '';
    /* 折叠标题栏 */
    var hdr = document.createElement('div'); hdr.className = 'pk-hdr';
    var ttl = document.createElement('span'); ttl.className = 'pk-ttl';
    ttl.textContent = '页面（PAGEKEY）';
    var arr = document.createElement('span'); arr.className = 'pk-arr'; arr.textContent = '▸';
    var cntBadge = document.createElement('span'); cntBadge.className = 'pk-cnt-badge';
    hdr.appendChild(ttl); hdr.appendChild(arr); hdr.appendChild(cntBadge);
    hdr.onclick = function () { box.classList.toggle('pk-open'); };
    box.className = 'pk-panel'; /* reset class */
    box.appendChild(hdr);
    /* 内容区 */
    var body = document.createElement('div'); body.className = 'pk-body';
    /* 搜索框：按页面名称 + 业务线 模糊匹配过滤选项 */
    var search = document.createElement('input');
    search.type = 'text'; search.id = 'f-pk-search'; search.className = 'pk-search';
    search.placeholder = '搜索页面名称 / 业务线…';
    search.value = state.pkSearch || '';
    search.oninput = function () { state.pkSearch = search.value; applyPkSearch(); };
    body.appendChild(search);
    var bar = document.createElement('div'); bar.className = 'pk-bar';
    var all = document.createElement('button'); all.textContent = '全选'; all.className = 'mini';
    all.onclick = function (e) { e.stopPropagation(); state.selPks = '全部'; markPks(); renderActive(); };
    var none = document.createElement('button'); none.textContent = '清空'; none.className = 'mini';
    none.onclick = function (e) { e.stopPropagation(); state.selPks = new Set(); markPks(); renderActive(); };
    bar.appendChild(all); bar.appendChild(none);
    var cnt = document.createElement('span'); cnt.className = 'pk-cnt'; bar.appendChild(cnt);
    var matchCnt = document.createElement('span'); matchCnt.className = 'pk-match'; bar.appendChild(matchCnt);
    body.appendChild(bar);
    var list = document.createElement('div'); list.className = 'pk-list';
    pks.forEach(function (p) {
      var lab = document.createElement('label'); lab.className = 'pk-item';
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = p.pk;
      cb.onchange = function () {
        if (state.selPks === '全部') state.selPks = new Set(effectivePks());
        if (cb.checked) state.selPks.add(p.pk); else state.selPks.delete(p.pk);
        markPks(); renderActive();
      };
      lab.appendChild(cb);
      var sp = document.createElement('span'); sp.innerHTML = p.nm + ' <i>' + p.bl + '</i>';
      lab.appendChild(sp);
      list.appendChild(lab);
    });
    body.appendChild(list);
    box.appendChild(body);
    function applyPkSearch() {
      var q = (state.pkSearch || '').trim().toLowerCase();
      var shown = 0;
      Array.prototype.forEach.call(list.querySelectorAll('.pk-item'), function (item) {
        var hit = !q || item.textContent.toLowerCase().indexOf(q) !== -1;
        item.style.display = hit ? '' : 'none';
        if (hit) shown++;
      });
      matchCnt.textContent = q ? ('命中 ' + shown) : '';
    }
    markPks();
    applyPkSearch();
    function markPks() {
      var sel = state.selPks === '全部' ? new Set(pks.map(function (p) { return p.pk; })) : state.selPks;
      Array.prototype.forEach.call(list.querySelectorAll('input'), function (cb) { cb.checked = sel.has(cb.value); });
      cnt.textContent = '已选 ' + sel.size + ' / ' + pks.length;
    }
  }

  /* ---------------- Tab ---------------- */
  function bindTabs() {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.onclick = function () {
        currentTab = t.getAttribute('data-tab');
        Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (x) { x.className = 'tab' + (x === t ? ' on' : ''); });
        Array.prototype.forEach.call(document.querySelectorAll('.panel'), function (p) { p.style.display = p.id === ('panel-' + currentTab) ? '' : 'none'; });
        renderActive();
      };
    });
  }

  /* ---------------- init ---------------- */
  function init() {
    buildFilters(); bindTabs();
    window.addEventListener('resize', function () { for (var k in charts) if (charts[k]) charts[k].resize(); });
    renderActive();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  /* ---------------- 数据导入热替换（供 import.js 调用） ---------------- */
  window.applyImportedData = function (data) {
    window.DASHBOARD_DATA = data;
    D = data;
    state = { bl: '全部', selPks: '全部', end: '全部', ut: '全部', dateMode: 'all', ds: null, de: null, pkSearch: '' };
    currentTab = 'overview';
    $('f-ds').value = D.meta.date_min; $('f-de').value = D.meta.date_max;
    buildFilters();
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (x) {
      x.className = 'tab' + (x.getAttribute('data-tab') === 'overview' ? ' on' : '');
    });
    Array.prototype.forEach.call(document.querySelectorAll('.panel'), function (p) {
      p.style.display = (p.id === 'panel-overview') ? '' : 'none';
    });
    renderActive();
    var m = D.meta;
    var ml = $('meta-line');
    if (ml) ml.textContent = '数据 ' + m.date_min + ' ~ ' + m.date_max + ' · ' + m.pagekeys.length + ' 个 pagekey · 导入于 ' + m.generated_at;
  };
})();
