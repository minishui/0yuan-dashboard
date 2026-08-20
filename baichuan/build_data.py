import pandas as pd, json, datetime, os, glob, re

# ===== 动态识别最新百川底表 =====
# 扫描 ~/Downloads 下「百川数据看板*2026-*.xlsx」，按文件名日期（YYYY-MM-DD）取最新，
# 同日多个文件则取修改时间(mtime)最新。兜底：无日期匹配时取 mtime 最新。
def find_latest_baichuan():
    pattern = os.path.expanduser('~/Downloads/百川数据看板*2026-*.xlsx')
    files = glob.glob(pattern)
    if not files:
        # 兜底：任意百川 xlsx
        files = glob.glob(os.path.expanduser('~/Downloads/百川数据看板*.xlsx'))
    if not files:
        raise SystemExit('未找到百川底表（~/Downloads/百川数据看板*2026-*.xlsx）')
    date_re = re.compile(r'(\d{4})-(\d{2})-(\d{2})')
    def key(f):
        m = date_re.search(os.path.basename(f))
        d = m.group(0) if m else '0000-00-00'
        return (d, os.path.getmtime(f))
    files.sort(key=key)
    return files[-1]

SRC = find_latest_baichuan()
# 输出路径锚定脚本自身所在目录（baichuan/ 下的 js/data.js），脚本放哪都能用
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'js', 'data.js')

# 新底表(2026-08-20)事件名称为中文显示名，且缺少旧的「端」「用户类型」两列。
# 这里把中文名映射回看板 config.EVENT_MAP 依赖的标准英文事件码；
# 未列出的事件名（如实时加微曝光、switchPhone* 等）保留原名，看板不引用、无害。
def map_code(x):
    x = str(x).strip()
    exact = {
        '展现PV': 'firstPagePv',
        'slideScreen': 'slideScreen',
        '选择年级': 'choosegrade',
        '授权登录成功': 'authorizeLoginSuccess',
        '选择课程': 'choosecourse',
        'zero_order_success': 'zero_order_success',
        '获取课程详情后，无可选课程': 'notFoundOptionalCourse',
        '下单失败': 'createordererror',
        '用户拒绝获取手机号': '38',
        '用户授权同意获取手机号': '39',
        '授权注册成功': '90',
        '手机号授权登录失败': 'authorizeLoginFail',
        '用户是否登录': 'loginstate',
        'getTokenWithCode': 'getTokenWithCode',
        '选择课程弹窗显示了': 'coursePopIsShown',
        '选择年级半弹窗展示': 'gradehalftoast',
        '点击立即购买': 'buy',  # 原双入口事件，保留数据不进漏斗
    }
    if x in exact:
        return exact[x]
    if '立即支付' in x:          # 提交支付信息【点击“立即支付”时】
        return 'paysubmit'
    return x

print("读取底表...")
df = pd.read_excel(SRC, sheet_name='sheet',
    usecols=['事件日期', '页面名称', '事件名称', 'pagekey', 'uv'],
    engine='openpyxl')
# 新底表事件名称为中文显示名，rename 为「事件标识」后映射回标准英文码；
# 事件名称为空(NaN)的行无有效事件码，直接剔除（多为未命名曝光，不进漏斗）。
df = df[df['事件名称'].notna()].copy()
df.rename(columns={'事件名称': '事件标识'}, inplace=True)
df['事件标识'] = [map_code(x) for x in df['事件标识']]
df['uv'] = df['uv'].fillna(0).astype(int)
df['事件日期'] = pd.to_datetime(df['事件日期']).dt.strftime('%Y-%m-%d')

# 业务线归类：阅读品牌(含“阅读”及经典/茅盾/诵读/征文/全球青少年等阅读活动品牌)
# ->阅读，其余（原“数学”+“通用”）->数学。
READ_KEYWORDS = ['阅读', '经典', '茅盾', '诵读', '征文', '全球青少年']

def biz_line(name):
    for k in READ_KEYWORDS:
        if k in name:
            return '阅读'
    return '数学'

pk_name = df.groupby(['pagekey', '页面名称']).size().reset_index(name='c')
pk_name = pk_name.sort_values('c', ascending=False).drop_duplicates('pagekey')
pk2name = dict(zip(pk_name['pagekey'], pk_name['页面名称']))
pk2bl = {pk: biz_line(nm) for pk, nm in pk2name.items()}

print("聚合 facts (同组同事件码求和)... 维度已合并为单一「全部」(新底表无端/用户类型列)")
facts = {}
for (pk, d), g in df.groupby(['pagekey', '事件日期']):
    ev = {}
    for code, uv in zip(g['事件标识'], g['uv']):
        uv = int(uv)
        if uv > 0:
            ev[code] = ev.get(code, 0) + uv  # 关键：求和而非覆盖
    if not ev:
        continue
    facts[(pk, d)] = ev

facts_list = [{'pk': pk, 'd': d, 'e': '全部', 'ut': '全部', 'ev': ev}
              for (pk, d), ev in facts.items()]

all_codes = sorted(set(df['事件标识'].tolist()))
dates = sorted(df['事件日期'].unique())
pagekeys = [{'pk': pk, 'nm': pk2name.get(pk, pk), 'bl': pk2bl.get(pk, '数学')}
            for pk in sorted(df['pagekey'].unique())]
visit_by_pk = df[df['事件标识'] == 'firstPagePv'].groupby('pagekey')['uv'].sum().to_dict()
for p in pagekeys:
    p['visit_uv'] = int(visit_by_pk.get(p['pk'], 0))
pagekeys.sort(key=lambda x: -x['visit_uv'])

meta = {
    'generated_at': datetime.datetime.now().strftime('%Y-%m-%d %H:%M'),
    'source': os.path.basename(SRC),
    'date_min': dates[0], 'date_max': dates[-1],
    'business_lines': ['阅读', '数学'],
    'ends': ['全部'],
    'user_types': ['全部'],
    'pagekeys': pagekeys, 'all_event_codes': all_codes,
}

data = {'meta': meta, 'facts': facts_list}
with open(OUT, 'w', encoding='utf-8') as f:
    f.write('window.DASHBOARD_DATA = ')
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')

size = os.path.getsize(OUT)
print(f"facts 条数: {len(facts_list):,}")
print(f"pagekey 数: {len(pagekeys)}  (阅读={sum(1 for p in pagekeys if p['bl'] == '阅读')}, 数学={sum(1 for p in pagekeys if p['bl'] == '数学')})")
print(f"data.js 大小: {size / 1024 / 1024:.2f} MB -> {OUT}")
