// Курсы валют — виджет для Scriptable (iOS)
// Фьючерсы EUR/RUB F, USD/RUB F и биржевой юань — МосБиржа (ISS, задержка ~15 мин)
// Курсы ЦБ — cbr-xml-daily.ru, BTC/USD — CoinGecko
//
// Размеры: Large — вся таблица, Medium — компактно, Small — 5 строк.
// Параметр виджета (необязательно): свой список строк через запятую, например
//   EUR/RUB F, CNY Бирж, EUR ЦБ, BTC/USD

const ALL_ROWS = [
  "EUR/RUB F", "USD/RUB F", "CNY Бирж",
  "EUR ЦБ", "USD ЦБ", "CNY ЦБ",
  "BTC/USD",
];
const SMALL_ROWS = ["EUR/RUB F", "USD/RUB F", "CNY Бирж", "EUR ЦБ", "BTC/USD"];

const CACHE_FILE = "rates_widget_cache.json";

// ---------- утилиты ----------

const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), CACHE_FILE);

function fmt(n, digits = 2) {
  return n.toLocaleString("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtChange(d) {
  const abs = fmt(Math.abs(d));
  if (abs === fmt(0)) return abs;
  return (d > 0 ? "+" : "−") + abs;
}

function colorName(d) {
  if (d === null || d === undefined || isNaN(d) || Math.abs(d) < 0.005) return "none";
  return d > 0 ? "green" : "red";
}

// Время и дата по Москве
function mskHHMM(ts) {
  return new Date(ts * 1000 + 3 * 3600 * 1000).toISOString().slice(11, 16);
}
function mskDDMM(iso) {
  const s = new Date(Date.parse(iso) + 3 * 3600 * 1000).toISOString();
  return s.slice(8, 10) + "." + s.slice(5, 7);
}

function readCache() {
  try {
    if (fm.fileExists(cachePath)) return JSON.parse(fm.readString(cachePath));
  } catch (e) {}
  return {};
}

function writeCache(byId) {
  try { fm.writeString(cachePath, JSON.stringify(byId)); } catch (e) {}
}

async function loadJSON(url) {
  const r = new Request(url);
  r.timeoutInterval = 8;
  return await r.loadJSON();
}

// ---------- источники ----------

function issTable(json, block) {
  const b = json[block];
  if (!b) return [];
  return b.data.map(row => Object.fromEntries(b.columns.map((c, i) => [c, row[i]])));
}

async function moexRow(id, name, group, path, board) {
  const j = await loadJSON("https://iss.moex.com" + path +
    "?iss.meta=off&iss.only=marketdata,securities");
  const pick = rows => rows.find(r => r.BOARDID === board) || rows[0];
  const md = pick(issTable(j, "marketdata"));
  const sec = pick(issTable(j, "securities"));
  const last = md.LAST ?? md.SETTLEPRICE ?? sec.PREVPRICE;
  const prev = sec.PREVPRICE;
  const diff = last != null && prev != null ? last - prev : null;
  return {
    id, name, group,
    time: (md.UPDATETIME || md.TIME || "").slice(0, 5) || "—",
    value: last != null ? fmt(last) : "—",
    right: diff != null ? fmtChange(diff) : "—",
    color: colorName(diff),
  };
}

async function cbrRows() {
  const j = await loadJSON("https://www.cbr-xml-daily.ru/daily_json.js");
  const date = mskDDMM(j.Date);
  return ["USD", "EUR", "CNY"].map(code => {
    const v = j.Valute[code];
    const val = v.Value / v.Nominal;
    const diff = val - v.Previous / v.Nominal;
    return {
      id: code + " ЦБ", name: code, group: "ЦБ", time: date,
      value: fmt(val), right: fmtChange(diff), color: colorName(diff),
    };
  });
}

async function btcRow() {
  const j = await loadJSON("https://api.coingecko.com/api/v3/simple/price" +
    "?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true");
  const b = j.bitcoin;
  const diff = b.usd - b.usd / (1 + b.usd_24h_change / 100);
  return {
    id: "BTC/USD", name: "BTC/USD", group: "",
    time: b.last_updated_at ? mskHHMM(b.last_updated_at) : "—",
    value: fmt(b.usd), right: fmtChange(diff), color: colorName(diff),
  };
}

// Все запросы идут параллельно; не ответивший источник берётся из кэша
async function getRows() {
  const tasks = [
    moexRow("USD/RUB F", "USD/RUB F", "",
      "/iss/engines/futures/markets/forts/securities/USDRUBF.json", "RFUD").then(r => [r]),
    moexRow("EUR/RUB F", "EUR/RUB F", "",
      "/iss/engines/futures/markets/forts/securities/EURRUBF.json", "RFUD").then(r => [r]),
    moexRow("CNY Бирж", "CNY", "Бирж.",
      "/iss/engines/currency/markets/selt/boards/CETS/securities/CNYRUB_TOM.json", "CETS").then(r => [r]),
    cbrRows(),
    btcRow().then(r => [r]),
  ];
  const results = await Promise.allSettled(tasks);
  const cache = readCache();
  let fresh = 0;
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const row of r.value) { cache[row.id] = row; fresh++; }
  }
  if (fresh) writeCache(cache);
  return { byId: cache, offline: fresh === 0 };
}

// ---------- отрисовка ----------

const C = {
  bg: Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e")),
  fg: Color.dynamic(new Color("#111111"), new Color("#f2f2f7")),
  muted: Color.dynamic(new Color("#9a9aa0"), new Color("#8e8e93")),
  red: Color.dynamic(new Color("#f0393f"), new Color("#ff5a5f")),
  green: Color.dynamic(new Color("#1e9e4a"), new Color("#34c759")),
};

function changeColor(name) {
  if (name === "red") return C.red;
  if (name === "green") return C.green;
  return C.muted;
}

function cell(parent, text, width, font, color, align) {
  const s = parent.addStack();
  s.size = new Size(width, 0);
  s.centerAlignContent();
  if (align === "right") s.addSpacer();
  const t = s.addText(text);
  t.font = font;
  t.textColor = color;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.6;
  if (align !== "right") s.addSpacer();
}

const LAYOUTS = {
  large: { pad: 16, header: true, rowGap: 9, size: 15,
    cols: { group: 54, name: 42, time: 46, value: 92, right: 72 } },
  medium: { pad: 10, header: false, rowGap: 2, size: 12,
    cols: { group: 46, name: 36, time: 40, value: 92, right: 64 } },
  small: { pad: 10, header: false, rowGap: 3, size: 11, compact: true,
    cols: { group: 0, name: 62, time: 0, value: 46, right: 36 } },
};

function drawRows(w, rows, L) {
  const fBold = Font.semiboldSystemFont(L.size);
  const fReg = Font.systemFont(L.size);
  const fNum = Font.semiboldMonospacedSystemFont(L.size);
  const fTime = Font.regularMonospacedSystemFont(L.size - 1);
  const c = L.cols;
  let prevGroup = null;

  for (const r of rows) {
    const row = w.addStack();
    row.centerAlignContent();

    if (L.compact) {
      cell(row, r.group ? `${r.name} ${r.group}` : r.name, c.name, fBold, C.fg, "left");
    } else if (!r.group) {
      cell(row, r.name, c.group + c.name, fBold, C.fg, "left");
      prevGroup = null;
    } else {
      cell(row, r.group !== prevGroup ? r.group : "", c.group, fBold, C.fg, "left");
      cell(row, r.name, c.name, fReg, C.fg, "left");
      prevGroup = r.group;
    }

    if (c.time) cell(row, r.time, c.time, fTime, C.muted, "left");
    row.addSpacer();
    cell(row, r.value, c.value, fNum, C.fg, "right");
    cell(row, r.right, c.right, fNum, changeColor(r.color), "right");
    w.addSpacer(L.rowGap);
  }
}

async function buildWidget(family) {
  const L = LAYOUTS[family] || LAYOUTS.large;
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(L.pad, L.pad + 2, L.pad, L.pad + 2);
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  const { byId, offline } = await getRows();

  const param = (args.widgetParameter || "").trim();
  const wanted = param
    ? param.split(",").map(s => s.trim()).filter(Boolean)
    : (family === "small" ? SMALL_ROWS : ALL_ROWS);
  const norm = s => s.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  const all = Object.values(byId);
  const rows = wanted.map(id => all.find(r => norm(r.id) === norm(id))).filter(Boolean);

  if (!rows.length) {
    const t = w.addText("Нет данных");
    t.font = Font.semiboldSystemFont(14);
    t.textColor = C.fg;
    return w;
  }

  if (L.header) {
    const h = w.addStack();
    h.centerAlignContent();
    const t = h.addText("Курсы");
    t.font = Font.boldSystemFont(16);
    t.textColor = C.fg;
    h.addSpacer();
    const df = new DateFormatter();
    df.dateFormat = "HH:mm";
    const s = h.addText(offline ? "нет сети · кэш" : `обновлено ${df.string(new Date())}`);
    s.font = Font.systemFont(11);
    s.textColor = C.muted;
    w.addSpacer(12);
  } else {
    w.addSpacer();
  }

  drawRows(w, rows, L);
  w.addSpacer();
  return w;
}

// ---------- запуск ----------

const family = config.runsInWidget ? config.widgetFamily : "large";
const widget = await buildWidget(family);

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentLarge();
}
Script.complete();
