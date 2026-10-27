// Расчёт ₽ → ¥ → дин. → € — виджет для Scriptable (iOS)
//
// 1) рубли → юани по биржевому курсу CNY (МосБиржа, CNYRUB_TOM), комиссия 0,7 %
// 2) юани → динары по курсу UnionPay (RSD → CNY), комиссия 4 %
// 3) динары → евро по курсу продажи EUR в обменнике funta.rs
//
// Small — расчёт по шагам, Medium/Large — расчёт и использованные курсы.

const CALC = {
  amountRub: 100,
  feeRubCny: 0.007, // 0,7 %
  feeCnyRsd: 0.04,  // 4 %
  label: "₽ → ¥ → €",
};

const CACHE_FILE = "calc_widget_cache.json";

// ---------- утилиты ----------

const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), CACHE_FILE);

function fmt(n, digits = 2) {
  return n.toLocaleString("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtPct(p) {
  return (p * 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " %";
}

function readCache() {
  try {
    if (fm.fileExists(cachePath)) return JSON.parse(fm.readString(cachePath));
  } catch (e) {}
  return {};
}

function writeCache(data) {
  try { fm.writeString(cachePath, JSON.stringify(data)); } catch (e) {}
}

async function loadJSON(url) {
  const r = new Request(url);
  r.timeoutInterval = 8;
  return await r.loadJSON();
}

// ---------- источники ----------

// Биржевой курс юаня (МосБиржа, задержка ~15 мин)
async function cnyRub() {
  const j = await loadJSON("https://iss.moex.com/iss/engines/currency/markets/selt/boards/CETS" +
    "/securities/CNYRUB_TOM.json?iss.meta=off&iss.only=marketdata,securities");
  const row = block => {
    const b = j[block];
    const rows = b.data.map(r => Object.fromEntries(b.columns.map((c, i) => [c, r[i]])));
    return rows.find(r => r.BOARDID === "CETS") || rows[0];
  };
  const md = row("marketdata"), sec = row("securities");
  const num = md.LAST ?? sec.PREVPRICE;
  if (!num) throw new Error("no CNY");
  return { cny: num, cnyTime: (md.UPDATETIME || "").slice(0, 5) };
}

// Курс конвертации UnionPay RSD → CNY; пока файла на сегодня нет — предыдущий день
async function unionPay() {
  for (let back = 0; back < 4; back++) {
    const d = new Date(Date.now() - back * 86400000);
    const ymd = d.getFullYear() +
      String(d.getMonth() + 1).padStart(2, "0") +
      String(d.getDate()).padStart(2, "0");
    try {
      const j = await loadJSON(`https://www.unionpayintl.com/upload/jfimg/${ymd}.json`);
      const x = (j.exchangeRateJson || []).find(r => r.transCur === "RSD" && r.baseCur === "CNY");
      if (x && x.rateData) {
        return { rsdPerCny: 1 / x.rateData, upDate: ymd.slice(6, 8) + "." + ymd.slice(4, 6) };
      }
    } catch (e) {}
  }
  throw new Error("no UnionPay rate");
}

// Курс продажи EUR в обменнике funta.rs
async function funtaEur() {
  const r = new Request("https://funta.rs/");
  r.timeoutInterval = 8;
  const html = await r.loadString();
  const rows = html.match(/<tr[\s\S]*?<\/tr>/g) || [];
  const eurRow = rows.find(tr => /<td/.test(tr) && />\s*EUR\s*</.test(tr));
  if (!eurRow) throw new Error("no EUR row");
  const cells = [...eurRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
  const num = parseFloat(cells[2].replace(/<[^>]+>/g, "").replace(/[^0-9,.]/g, "").replace(",", "."));
  if (!num) throw new Error("bad EUR rate");
  return { eurRsd: num };
}

// Все запросы параллельно; не ответивший источник берётся из кэша
async function getRates() {
  const results = await Promise.allSettled([cnyRub(), unionPay(), funtaEur()]);
  const data = readCache();
  let fresh = 0;
  for (const r of results) {
    if (r.status === "fulfilled") { Object.assign(data, r.value); fresh++; }
  }
  if (fresh) writeCache(data);
  return { ...data, offline: fresh === 0 };
}

function calculate(r) {
  if (!r.cny || !r.rsdPerCny || !r.eurRsd) return null;
  const yuan = CALC.amountRub / r.cny * (1 - CALC.feeRubCny);
  const dinars = yuan * r.rsdPerCny * (1 - CALC.feeCnyRsd);
  const euros = dinars / r.eurRsd;
  return { yuan, dinars, euros, rubPerEur: CALC.amountRub / euros };
}

// ---------- отрисовка ----------

const C = {
  bg: Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e")),
  fg: Color.dynamic(new Color("#111111"), new Color("#f2f2f7")),
  muted: Color.dynamic(new Color("#9a9aa0"), new Color("#8e8e93")),
};

function text(parent, str, font, color, align) {
  const s = parent.addStack();
  if (align === "right") s.addSpacer();
  const t = s.addText(str);
  t.font = font;
  t.textColor = color;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.6;
  if (align !== "right") s.addSpacer();
}

// Строка «подпись … значение»
function pair(parent, label, value, size) {
  const s = parent.addStack();
  s.centerAlignContent();
  const l = s.addText(label);
  l.font = Font.systemFont(size);
  l.textColor = C.muted;
  l.lineLimit = 1;
  s.addSpacer();
  const v = s.addText(value);
  v.font = Font.semiboldMonospacedSystemFont(size);
  v.textColor = C.fg;
  v.lineLimit = 1;
  v.minimumScaleFactor = 0.6;
}

function drawSteps(parent, res, big) {
  const num = Font.regularMonospacedSystemFont(big ? 13 : 11);
  text(parent, CALC.label, Font.semiboldSystemFont(big ? 13 : 11), C.muted, "left");
  parent.addSpacer(big ? 6 : 4);
  text(parent, fmt(CALC.amountRub, 0) + " ₽", num, C.fg, "left");
  parent.addSpacer(2);
  text(parent, fmt(res.yuan) + " ¥", num, C.fg, "left");
  parent.addSpacer(2);
  text(parent, fmt(res.dinars, 0) + " дин.", num, C.fg, "left");
  parent.addSpacer();
  text(parent, fmt(res.euros) + " €", Font.boldMonospacedSystemFont(big ? 24 : 18), C.fg, "left");
  parent.addSpacer(2);
  text(parent, fmt(res.rubPerEur) + " ₽/€", Font.regularMonospacedSystemFont(big ? 12 : 10), C.muted, "left");
}

function drawRates(parent, r, size) {
  text(parent, "Курсы", Font.semiboldSystemFont(size), C.muted, "left");
  parent.addSpacer(4);
  pair(parent, `CNY бирж.${r.cnyTime ? " " + r.cnyTime : ""}`, fmt(r.cny), size);
  parent.addSpacer(3);
  pair(parent, `UnionPay ${r.upDate || ""}`, fmt(r.rsdPerCny), size);
  parent.addSpacer(3);
  pair(parent, "funta EUR", fmt(r.eurRsd), size);
  parent.addSpacer();
  pair(parent, "Комиссии", `${fmtPct(CALC.feeRubCny)} · ${fmtPct(CALC.feeCnyRsd)}`, size - 1);
}

async function buildWidget(family) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(14, 16, 14, 16);
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  const rates = await getRates();
  const res = calculate(rates);

  if (!res) {
    text(w, CALC.label, Font.semiboldSystemFont(12), C.muted, "left");
    w.addSpacer();
    text(w, "Нет данных", Font.semiboldSystemFont(14), C.fg, "left");
    w.addSpacer();
    return w;
  }

  if (family === "small") {
    drawSteps(w, res, false);
  } else {
    const big = family === "large";
    const cols = w.addStack();
    const left = cols.addStack();
    left.layoutVertically();
    drawSteps(left, res, big);
    cols.addSpacer(big ? 20 : 14);
    const right = cols.addStack();
    right.layoutVertically();
    drawRates(right, rates, big ? 13 : 11);
  }
  if (rates.offline) {
    w.addSpacer(2);
    text(w, "нет сети · кэш", Font.systemFont(9), C.muted, "left");
  }
  return w;
}

// ---------- запуск ----------

const family = config.runsInWidget ? config.widgetFamily : "medium";
const widget = await buildWidget(family);

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();
