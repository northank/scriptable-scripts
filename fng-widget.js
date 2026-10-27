const PAD = 8
const W = smallSide() - PAD * 2
const SCALE = [
  [10, '#b74d34'], [25, '#d17339'], [35, '#e39d64'],
  [46, '#d8bc59'], [54, '#dfce60'], [63, '#c6bf22'],
  [75, '#9bbe44'], [89, '#79d23c'], [100, '#65c64c'],
]

const widget = new ListWidget()
widget.setPadding(PAD, PAD, PAD, PAD)
widget.url = 'https://alternative.me/crypto/fear-and-greed-index/'

try {
  const data = await fetchFng(31)
  const secs = Number(data[0].time_until_update) || 3600
  build(data, secs)
  widget.refreshAfterDate = secondsFromNow(secs + 60)
} catch (e) {
  widget.backgroundColor = new Color('#16161a')
  txt(widget, 'No data', Font.semiboldRoundedSystemFont(13), Color.white())
  txt(widget, String(e), Font.systemFont(8), Color.gray()).lineLimit = 4
  widget.refreshAfterDate = secondsFromNow(15 * 60)
}

if (!config.runsInWidget) await widget.presentSmall()
Script.setWidget(widget)
Script.complete()

// ---------- layout ----------
function build(data, secs) {
  const vals = data.map(d => Number(d.value))
  const now = vals[0]
  const col = new Color(colorFor(now))

  const bg = new LinearGradient()
  bg.colors = [new Color('#16161a'), new Color(colorFor(now), 0.28)]
  bg.locations = [0.35, 1]
  bg.startPoint = new Point(0, 0)
  bg.endPoint = new Point(1, 1)
  widget.backgroundGradient = bg

  // шапка: иконка, заголовок, таймер
  const h = widget.addStack()
  h.centerAlignContent()
  const sym = SFSymbol.named('bitcoinsign.circle.fill')
  const ic = h.addImage(sym.image)
  ic.imageSize = new Size(11, 11)
  ic.tintColor = Color.orange()
  h.addSpacer(3)
  txt(h, 'F&G', Font.boldRoundedSystemFont(10), Color.white())
  h.addSpacer(4)
  const t = h.addDate(secondsFromNow(secs))
  t.applyTimerStyle()
  t.font = Font.mediumMonospacedSystemFont(9)
  t.textColor = Color.gray()
  t.rightAlignText()

  widget.addSpacer(2)

  // значение, статус и изменение за сутки
  const r = widget.addStack()
  r.centerAlignContent()
  txt(r, String(now), Font.boldRoundedSystemFont(34), col)
  r.addSpacer(5)
  const c = r.addStack()
  c.layoutVertically()
  const cl = txt(c, data[0].value_classification, Font.semiboldRoundedSystemFont(11), col)
  cl.lineLimit = 2
  if (vals[1] != null) {
    const d = now - vals[1]
    const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '•'
    txt(c, `${arrow}${Math.abs(d)} 24h`, Font.mediumRoundedSystemFont(9),
      d > 0 ? Color.green() : d < 0 ? Color.red() : Color.gray())
  }

  widget.addSpacer(4)

  // шкала 0–100
  const g = widget.addImage(gauge(now, W, 5))
  g.imageSize = new Size(W, 9)

  widget.addSpacer(4)

  // график за 30 дней (слева старые значения)
  const s = widget.addImage(spark(vals.slice().reverse(), W, 26))
  s.imageSize = new Size(W, 26)

  widget.addSpacer(3)

  // 1d / 7d / 30d / avg
  const st = widget.addStack()
  const avg = Math.round(vals.slice(0, 30).reduce((a, b) => a + b, 0) / Math.min(30, vals.length))
  stat(st, '1d', vals[1]); st.addSpacer()
  stat(st, '7d', vals[7]); st.addSpacer()
  stat(st, '30d', vals[30]); st.addSpacer()
  stat(st, 'avg', avg)
}

function stat(parent, label, v) {
  const s = parent.addStack()
  s.layoutVertically()
  txt(s, label, Font.mediumRoundedSystemFont(8), Color.gray())
  txt(s, v == null ? '–' : String(v), Font.mediumMonospacedSystemFont(11),
    v == null ? Color.gray() : new Color(colorFor(v)))
}

function txt(stack, str, font, color) {
  const t = stack.addText(str)
  t.font = font
  t.textColor = color
  t.lineLimit = 1
  t.minimumScaleFactor = 0.6
  return t
}

// ---------- drawing ----------
function gauge(v, w, h) {
  const H = h + 4
  const dc = new DrawContext()
  dc.size = new Size(w, H)
  dc.opaque = false
  dc.respectScreenScale = true
  let prev = 0
  for (const [max, hex] of SCALE) {
    dc.setFillColor(new Color(hex, 0.85))
    dc.fillRect(new Rect(prev / 100 * w, 2, (max - prev) / 100 * w, h))
    prev = max
  }
  const x = Math.min(Math.max(v / 100 * w, H / 2), w - H / 2)
  dc.setFillColor(Color.white())
  dc.fillEllipse(new Rect(x - H / 2, 0, H, H))
  dc.setFillColor(new Color(colorFor(v)))
  dc.fillEllipse(new Rect(x - H / 2 + 2, 2, H - 4, H - 4))
  return dc.getImage()
}

function spark(vals, w, h) {
  const dc = new DrawContext()
  dc.size = new Size(w, h)
  dc.opaque = false
  dc.respectScreenScale = true

  const lo = Math.max(0, Math.min(...vals) - 5)
  const hi = Math.min(100, Math.max(...vals) + 5)
  const y = v => h - 2 - (v - lo) / (hi - lo || 1) * (h - 4)
  const x = i => i / (vals.length - 1) * (w - 3)

  // линия нейтрального уровня 50, если попадает в диапазон
  if (50 > lo && 50 < hi) {
    const p = new Path()
    p.move(new Point(0, y(50)))
    p.addLine(new Point(w, y(50)))
    dc.addPath(p)
    dc.setStrokeColor(new Color('#ffffff', 0.18))
    dc.setLineWidth(0.5)
    dc.strokePath()
  }

  // отрезки, окрашенные по зоне
  dc.setLineWidth(1.4)
  for (let i = 1; i < vals.length; i++) {
    const p = new Path()
    p.move(new Point(x(i - 1), y(vals[i - 1])))
    p.addLine(new Point(x(i), y(vals[i])))
    dc.addPath(p)
    dc.setStrokeColor(new Color(colorFor(vals[i])))
    dc.strokePath()
  }

  // точка на последнем значении
  const last = vals[vals.length - 1]
  dc.setFillColor(Color.white())
  dc.fillEllipse(new Rect(x(vals.length - 1) - 1.5, y(last) - 1.5, 3, 3))
  return dc.getImage()
}

// ---------- helpers ----------
function colorFor(v) {
  return SCALE.find(([max]) => v <= max)[1]
}

async function fetchFng(limit) {
  const res = await new Request(`https://api.alternative.me/fng/?limit=${limit}`).loadJSON()
  if (!res?.data?.length) throw new Error('Empty API response')
  return res.data
}

function secondsFromNow(secs) {
  return new Date(Date.now() + secs * 1000)
}

// примерный размер маленького виджета (pt) по высоте экрана
function smallSide() {
  const s = Device.screenSize()
  const hgt = Math.max(s.width, s.height)
  const map = { 956: 170, 932: 170, 926: 170, 896: 169, 874: 162, 852: 158,
                844: 158, 812: 155, 736: 159, 667: 148, 568: 141 }
  return map[hgt] || 150
}
