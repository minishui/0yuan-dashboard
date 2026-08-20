/*
 * 落地页主链路分析看板 — 数据导入入口
 * 客户端解析 xlsx/xls/csv（依赖本地 SheetJS），自动识别列、
 * 按 (pagekey, 日期, 端, 用户类型) 聚合 UV，生成与 data.js 同构的数据对象，
 * 再调用 app.js 暴露的 window.applyImportedData 热替换并重建看板。
 * 无需服务器、离线可用（SheetJS 已本地化）。
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(dt) { return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()); }

  function fmtDate(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date) return ymd(v);
    var s = String(v).replace(/\//g, '-').replace(/T[\s\S]*/, '').trim();
    var m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return m[1] + '-' + pad(+m[2]) + '-' + pad(+m[3]);
    var m2 = s.match(/(\d{4})(\d{2})(\d{2})/);
    if (m2) return m2[1] + '-' + m2[2] + '-' + m2[3];
    return s;
  }
  function bizLine(name) {
    if (name && String(name).indexOf('阅读') >= 0) return '阅读';
    return '数学';
  }
  function uniq(arr) { var s = {}, o = []; arr.forEach(function (x) { if (!s[x]) { s[x] = 1; o.push(x); } }); return o; }

  function detect(headers) {
    function find(cands) {
      for (var h = 0; h < headers.length; h++) {
        var s = String(headers[h] == null ? '' : headers[h]).trim();
        for (var k = 0; k < cands.length; k++) if (s.indexOf(cands[k]) >= 0) return h;
      }
      return -1;
    }
    return {
      code: find(['事件标识', '事件码', 'eventid', 'event']),
      date: find(['事件日期', '日期', 'date']),
      name: find(['页面名称', '页面', '名称']),
      ut: find(['用户类型', '用户']),
      end: find(['端', 'end']),
      pk: find(['pagekey', 'page']),
      uv: find(['uv', 'pv量', 'pv', '人数'])
    };
  }

  function setStatus(msg, type) {
    var el = $('import-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'import-status' + (type ? ' ' + type : '');
  }

  function buildData(rows) {
    if (!rows || !rows.length) throw new Error('文件无数据行');
    var headers = rows[0];
    if (!Array.isArray(headers)) throw new Error('首行不是表头');
    var idx = detect(headers);
    var missing = [];
    if (idx.code < 0) missing.push('事件标识');
    if (idx.date < 0) missing.push('事件日期');
    if (idx.pk < 0) missing.push('pagekey');
    if (idx.uv < 0) missing.push('uv');
    if (missing.length) throw new Error('缺少必要列：' + missing.join('、') + '（需与「百川数据看板」结构一致：含事件标识/事件日期/pagekey/uv 等列）。');

    var map = {}, pkName = {}, pkBl = {};
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      if (!r) continue;
      var code = String(r[idx.code] == null ? '' : r[idx.code]).trim();
      if (!code || code === 'undefined') continue;
      if (code === 'fristPagePv') code = 'firstPagePv';
      var date = fmtDate(r[idx.date]);
      if (!date) continue;
      var pk = String(r[idx.pk] == null ? '' : r[idx.pk]).trim();
      if (!pk || pk === 'undefined') continue;
      var end = idx.end >= 0 ? String(r[idx.end] == null ? '' : r[idx.end]).trim() : '全部';
      var ut = idx.ut >= 0 ? String(r[idx.ut] == null ? '' : r[idx.ut]).trim() : '全部';
      var uv = parseFloat(r[idx.uv]);
      if (!isFinite(uv) || uv <= 0) continue;
      var name = idx.name >= 0 ? String(r[idx.name] == null ? '' : r[idx.name]).trim() : pk;
      pkName[pk] = name;
      if (!pkBl[pk]) pkBl[pk] = bizLine(name);
      var key = pk + '|' + date + '|' + (end || '全部') + '|' + (ut || '全部');
      if (!map[key]) map[key] = { pk: pk, d: date, e: end || '全部', ut: ut || '全部', ev: {} };
      var ev = map[key].ev;
      ev[code] = (ev[code] || 0) + uv;
    }
    var facts = Object.keys(map).map(function (k) { return map[k]; });
    if (!facts.length) throw new Error('未解析出有效事件数据，请检查列内容与数值格式。');

    var pagekeys = Object.keys(pkName).map(function (pk) {
      var visit = 0;
      facts.forEach(function (f) { if (f.pk === pk) visit += (f.ev['firstPagePv'] || 0); });
      return { pk: pk, nm: pkName[pk] || pk, bl: pkBl[pk] || '数学', visit_uv: visit };
    });
    pagekeys.sort(function (a, b) { return b.visit_uv - a.visit_uv; });
    var allCodes = {};
    facts.forEach(function (f) { Object.keys(f.ev).forEach(function (c) { allCodes[c] = 1; }); });
    var ds = facts.map(function (f) { return f.d; }); ds.sort();

    return {
      meta: {
        generated_at: new Date().toLocaleString('zh-CN'),
        source: '用户导入',
        date_min: ds[0],
        date_max: ds[ds.length - 1],
        business_lines: ['阅读', '数学'],
        ends: uniq(facts.map(function (f) { return f.e; })),
        user_types: uniq(facts.map(function (f) { return f.ut; })),
        pagekeys: pagekeys,
        all_event_codes: Object.keys(allCodes)
      },
      facts: facts
    };
  }

  function readAndImport(file) {
    if (typeof XLSX === 'undefined') { setStatus('✗ 解析库未加载，请刷新页面重试。', 'err'); return; }
    setStatus('正在解析「' + file.name + '」…');
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = new Uint8Array(e.target.result);
        var wb = XLSX.read(data, { type: 'array' });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
        var built = buildData(rows);
        if (window.applyImportedData) {
          window.applyImportedData(built);
          setStatus('✓ 导入成功：' + built.facts.length + ' 条记录，' + built.meta.pagekeys.length +
            ' 个 pagekey（' + built.meta.date_min + ' ~ ' + built.meta.date_max + '）', 'ok');
        } else {
          setStatus('✗ 看板主程序未就绪，请刷新页面后重试。', 'err');
        }
      } catch (err) {
        setStatus('✗ 导入失败：' + err.message, 'err');
        console.error(err);
      }
    };
    reader.onerror = function () { setStatus('✗ 文件读取失败', 'err'); };
    reader.readAsArrayBuffer(file);
  }

  function init() {
    var inp = $('f-import');
    var btn = $('btn-import');
    if (inp) inp.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (file) readAndImport(file);
      e.target.value = ''; // 允许重复导入同一文件
    });
    if (btn) btn.addEventListener('click', function () { if (inp) inp.click(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  /* 暴露构建函数，便于脚本化/测试调用（不影响正常导入流程） */
  window.buildDataFromRows = buildData;
})();
