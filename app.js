/* TradeSim — plain HTML/JS stock & options simulator */

const INITIAL_PRICE = 100
const TICK_MS = 500
const DEFAULT_CASH = 1000
const EXPIRY_DURATIONS = [60_000, 180_000]
const EXPIRY_LABELS = { 60000: '1 Min', 180000: '3 Min' }

const MODE_DRIFT = { bull: 0.0025, bear: -0.0025, neutral: 0 }
const MODE_VOLATILITY = { bull: 0.012, bear: 0.014, neutral: 0.01 }

// ── Math helpers ──────────────────────────────────────────────

function gaussianRandom() {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function normalCDF(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911
  const sign = x < 0 ? -1 : 1
  const absX = Math.abs(x) / Math.sqrt(2)
  const t = 1 / (1 + p * absX)
  const y = 1 - (((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t*Math.exp(-absX*absX))
  return 0.5 * (1 + sign * y)
}

function blackScholes(spot, strike, timeToExpiry, type, volatility = 0.25) {
  if (timeToExpiry <= 0) {
    return type === 'call' ? Math.max(0, spot - strike) : Math.max(0, strike - spot)
  }
  const T = timeToExpiry / (365 * 24 * 60 * 60 * 1000)
  const r = 0.05, sigma = volatility
  const d1 = (Math.log(spot / strike) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T))
  const d2 = d1 - sigma * Math.sqrt(T)
  if (type === 'call') return spot * normalCDF(d1) - strike * Math.exp(-r * T) * normalCDF(d2)
  return strike * Math.exp(-r * T) * normalCDF(-d2) - spot * normalCDF(-d1)
}

function formatExpiry(expiry, now) {
  const remaining = Math.max(0, expiry - now)
  const secs = Math.floor(remaining / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  return `${mins}m ${secs % 60}s`
}

function formatMoney(n) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function optionBreakeven(type, strike, premiumPerShare) {
  const be = type === 'call' ? strike + premiumPerShare : strike - premiumPerShare
  return Math.max(0.01, Math.round(be * 100) / 100)
}

function optionTotalCost(ask, contracts) {
  return ask * contracts * 100
}

// ── Price engine ──────────────────────────────────────────────

function createPriceTick(currentPrice, mode) {
  const drift = MODE_DRIFT[mode]
  const vol = MODE_VOLATILITY[mode]
  const dt = TICK_MS / 1000
  const logReturn = drift * dt + vol * Math.sqrt(dt) * gaussianRandom()
  const price = Math.max(1, Math.round(currentPrice * Math.exp(logReturn) * 100) / 100)
  return { price, time: Date.now() }
}

function seedPriceHistory(mode, count = 60) {
  const history = []
  let price = INITIAL_PRICE
  let time = Date.now() - count * TICK_MS
  for (let i = 0; i < count; i++) {
    const logReturn = MODE_DRIFT[mode] * 0.5 + MODE_VOLATILITY[mode] * gaussianRandom()
    price = Math.max(1, Math.round(price * Math.exp(logReturn) * 100) / 100)
    history.push({ time, price })
    time += TICK_MS
  }
  return history
}

function getStrikes(spot) {
  const base = Math.round(spot / 5) * 5
  const strikes = []
  for (let i = -2; i <= 2; i++) {
    const s = Math.max(5, base + i * 5)
    if (!strikes.includes(s)) strikes.push(s)
  }
  return strikes.sort((a, b) => a - b)
}

function generateOrderBook(spot, mode, now) {
  const strikes = getStrikes(spot)
  const vol = mode === 'bull' ? 0.22 : mode === 'bear' ? 0.28 : 0.25
  const calls = [], puts = []

  for (const dur of EXPIRY_DURATIONS) {
    const expiry = now + dur
    const timeLeft = dur
    for (const strike of strikes) {
      for (const type of ['call', 'put']) {
        const fair = blackScholes(spot, strike, timeLeft, type, vol)
        const mid = Math.max(0.01, fair + gaussianRandom() * 0.02)
        const spread = Math.max(0.02, mid * 0.08 + 0.03)
        const level = {
          strike,
          bid: Math.max(0.01, Math.round((mid - spread / 2) * 100) / 100),
          ask: Math.round((mid + spread / 2) * 100) / 100,
          expiry,
          duration: dur,
          type,
        }
        if (type === 'call') calls.push(level)
        else puts.push(level)
      }
    }
  }
  return { calls, puts }
}

function settleOption(spot, type, strike) {
  return type === 'call' ? Math.max(0, spot - strike) : Math.max(0, strike - spot)
}

// ── Game state ────────────────────────────────────────────────

const state = {
  mode: 'neutral',
  price: INITIAL_PRICE,
  history: seedPriceHistory('neutral'),
  cash: DEFAULT_CASH,
  shares: 0,
  avgCost: 0,
  options: [],
  orderBook: { calls: [], puts: [] },
  logs: [],
  selectedDuration: null,
  optionTab: 'call',
  shareQty: 1,
  optionContracts: 1,
}

// ── DOM refs ──────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => document.querySelectorAll(sel)

const els = {
  headerCash: $('#header-cash'),
  currentPrice: $('#current-price'),
  priceChange: $('#price-change'),
  chart: $('#price-chart'),
  sharesHeld: $('#shares-held'),
  marketPrice: $('#market-price'),
  positionValue: $('#position-value'),
  shareQty: $('#share-qty'),
  estCost: $('#est-cost'),
  buyShares: $('#buy-shares'),
  sellShares: $('#sell-shares'),
  expiryTabs: $('#expiry-tabs'),
  orderbookBody: $('#orderbook-body'),
  spotPrice: $('#spot-price'),
  openOptions: $('#open-options'),
  openOptionsList: $('#open-options-list'),
  totalEquity: $('#total-equity'),
  totalPnl: $('#total-pnl'),
  breakdownCash: $('#breakdown-cash'),
  breakdownShares: $('#breakdown-shares'),
  breakdownSharesLabel: $('#breakdown-shares-label'),
  breakdownOptions: $('#breakdown-options'),
  logList: $('#log-list'),
  optionContracts: $('#option-contracts'),
}

// ── Logging ───────────────────────────────────────────────────

function addLog(message, type = 'info') {
  state.logs.unshift({ id: Date.now() + Math.random(), time: Date.now(), message, type })
  if (state.logs.length > 50) state.logs.length = 50
  renderLogs()
}

function renderLogs() {
  if (state.logs.length === 0) {
    els.logList.innerHTML = '<div class="log-empty">No trades yet</div>'
    return
  }
  els.logList.innerHTML = state.logs.map(log => {
    const t = new Date(log.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    return `<div class="log-entry log-${log.type}"><span class="log-time">${t}</span><span class="log-msg">${log.message}</span></div>`
  }).join('')
}

// ── Chart (canvas) ────────────────────────────────────────────

const CHART_PAD = { top: 12, right: 12, bottom: 24, left: 52 }
const Y_TICKS = 5

function niceStep(range, targetTicks) {
  const rough = range / targetTicks
  const pow = Math.pow(10, Math.floor(Math.log10(rough)))
  for (const mult of [1, 2, 2.5, 5, 10]) {
    const step = mult * pow
    if (step >= rough) return step
  }
  return 10 * pow
}

function computeYScale(prices) {
  const rawMin = Math.min(...prices)
  const rawMax = Math.max(...prices)
  const mid = (rawMin + rawMax) / 2
  const rawRange = rawMax - rawMin

  // Keep a sensible minimum range so tiny ticks don't fill the whole chart
  const minRange = Math.max(mid * 0.04, 2)
  const span = Math.max(rawRange, minRange)
  const step = niceStep(span, Y_TICKS - 1)

  let minP = Math.floor((mid - span / 2) / step) * step
  let maxP = Math.ceil((mid + span / 2) / step) * step

  if (maxP - minP < step * (Y_TICKS - 1)) {
    const extra = (step * (Y_TICKS - 1) - (maxP - minP)) / 2
    minP -= extra
    maxP += extra
  }

  return { minP, maxP, step }
}

function formatAxisPrice(value) {
  if (value >= 100) return '$' + value.toFixed(0)
  if (value >= 10) return '$' + value.toFixed(1)
  return '$' + value.toFixed(2)
}

function drawChart() {
  const canvas = els.chart
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (w === 0 || h === 0) return

  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)

  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  const data = state.history
  if (data.length < 2) return

  const prices = data.map(d => d.price)
  const { minP, maxP, step } = computeYScale(prices)
  const range = maxP - minP || 1

  const first = data[0].price
  const last = data[data.length - 1].price
  const isUp = last >= first
  const lineColor = isUp ? '#1a8f5a' : '#c43e3e'
  const fillColor = isUp ? 'rgba(26,143,90,0.12)' : 'rgba(196,62,62,0.12)'

  const plotX = CHART_PAD.left
  const plotY = CHART_PAD.top
  const plotW = w - CHART_PAD.left - CHART_PAD.right
  const plotH = h - CHART_PAD.top - CHART_PAD.bottom
  const baseline = plotY + plotH

  // grid + y-axis labels
  ctx.strokeStyle = '#e2dfd8'
  ctx.lineWidth = 1
  ctx.fillStyle = '#7a756c'
  ctx.font = '10px JetBrains Mono'
  ctx.textAlign = 'right'

  for (let val = minP; val <= maxP + step * 0.001; val += step) {
    const t = (val - minP) / range
    const y = baseline - t * plotH
    ctx.beginPath()
    ctx.moveTo(plotX, y)
    ctx.lineTo(w - CHART_PAD.right, y)
    ctx.stroke()
    ctx.fillText(formatAxisPrice(val), plotX - 6, y + 3)
  }

  const points = data.map((d, i) => ({
    x: plotX + (i / (data.length - 1)) * plotW,
    y: baseline - ((d.price - minP) / range) * plotH,
  }))

  // area fill
  ctx.beginPath()
  ctx.moveTo(points[0].x, baseline)
  points.forEach(p => ctx.lineTo(p.x, p.y))
  ctx.lineTo(points[points.length - 1].x, baseline)
  ctx.closePath()
  ctx.fillStyle = fillColor
  ctx.fill()

  // price line
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  points.forEach(p => ctx.lineTo(p.x, p.y))
  ctx.strokeStyle = lineColor
  ctx.lineWidth = 2
  ctx.stroke()

  // last price dot
  const lastPt = points[points.length - 1]
  ctx.beginPath()
  ctx.arc(lastPt.x, lastPt.y, 3, 0, Math.PI * 2)
  ctx.fillStyle = lineColor
  ctx.fill()
}

// ── Render ────────────────────────────────────────────────────

function getOptionsValue() {
  return state.options.reduce((sum, pos) => {
    const book = pos.type === 'call' ? state.orderBook.calls : state.orderBook.puts
    const level = book.find(l => l.strike === pos.strike && l.duration === pos.duration)
    const mid = level ? (level.bid + level.ask) / 2 : pos.entryPremium
    const sign = pos.side === 'short' ? -1 : 1
    return sum + sign * mid * pos.quantity * 100
  }, 0)
}

function render() {
  const shareValue = state.shares * state.price
  const optionsValue = getOptionsValue()
  const totalEquity = state.cash + shareValue + optionsValue
  const pnl = totalEquity - DEFAULT_CASH
  const sharePnl = state.shares > 0 ? (state.price - state.avgCost) * state.shares : 0

  const firstPrice = state.history[0]?.price ?? state.price
  const change = ((state.price - firstPrice) / firstPrice) * 100
  const isUp = change >= 0

  els.headerCash.textContent = formatMoney(state.cash)
  els.currentPrice.textContent = formatMoney(state.price)
  els.priceChange.textContent = (isUp ? '+' : '') + change.toFixed(2) + '%'
  els.priceChange.className = 'price-change ' + (isUp ? 'up' : 'down')

  els.sharesHeld.textContent = state.shares
  els.marketPrice.textContent = formatMoney(state.price)
  els.positionValue.textContent = formatMoney(shareValue)
  els.spotPrice.textContent = formatMoney(state.price)

  const qty = state.shareQty
  els.estCost.textContent = formatMoney(qty * state.price)
  els.buyShares.textContent = `Buy ${qty} Share${qty !== 1 ? 's' : ''}`
  els.sellShares.textContent = `Sell ${qty} Share${qty !== 1 ? 's' : ''}`
  els.buyShares.disabled = qty * state.price > state.cash || qty < 1
  els.sellShares.disabled = qty > state.shares || state.shares === 0

  els.totalEquity.textContent = formatMoney(totalEquity)
  els.totalPnl.textContent = (pnl >= 0 ? '+' : '') + formatMoney(pnl) + ' P&L'
  els.totalPnl.className = 'equity-pnl ' + (pnl >= 0 ? 'up' : 'down')

  els.breakdownCash.textContent = formatMoney(state.cash)
  els.breakdownSharesLabel.textContent = `Shares (${state.shares})`
  els.breakdownShares.innerHTML = formatMoney(shareValue) +
    (state.shares > 0 ? ` <small class="${sharePnl >= 0 ? 'up' : 'down'}">(${sharePnl >= 0 ? '+' : ''}${formatMoney(sharePnl)})</small>` : '')
  els.breakdownOptions.textContent = formatMoney(optionsValue)

  renderOrderBook()
  renderOpenOptions()
  drawChart()
}

function syncExpiryTabActive() {
  els.expiryTabs.querySelectorAll('button[data-duration]').forEach(btn => {
    const val = btn.dataset.duration
    const isActive = val === 'all'
      ? state.selectedDuration === null
      : Number(val) === state.selectedDuration
    btn.classList.toggle('active', isActive)
  })
}

function initExpiryTabs() {
  let html = '<button type="button" data-duration="all">All</button>'
  for (const dur of EXPIRY_DURATIONS) {
    html += `<button type="button" data-duration="${dur}">${EXPIRY_LABELS[dur]}</button>`
  }
  els.expiryTabs.innerHTML = html
  syncExpiryTabActive()

  els.expiryTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-duration]')
    if (!btn) return
    const val = btn.dataset.duration
    state.selectedDuration = val === 'all' ? null : Number(val)
    syncExpiryTabActive()
    renderOrderBook()
  })
}

function renderOrderBook() {
  const type = state.optionTab
  const contracts = state.optionContracts
  let levels = type === 'call' ? state.orderBook.calls : state.orderBook.puts
  if (state.selectedDuration !== null) {
    levels = levels.filter(l => l.duration === state.selectedDuration)
  }
  levels = [...levels].sort((a, b) => a.strike - b.strike || a.duration - b.duration)

  if (levels.length === 0) {
    els.orderbookBody.innerHTML = '<div class="log-empty">No contracts available</div>'
    return
  }

  els.orderbookBody.innerHTML = levels.map((l, i) => {
    const itm = type === 'call' ? state.price > l.strike : state.price < l.strike
    const breakeven = optionBreakeven(type, l.strike, l.ask)
    const total = optionTotalCost(l.ask, contracts)
    const canAfford = total <= state.cash
    return `<div class="orderbook-row ${itm ? 'itm' : ''}">
      <span class="strike">$${l.strike}</span>
      <span class="bid">$${l.bid.toFixed(2)}</span>
      <span class="ask">$${l.ask.toFixed(2)}</span>
      <span class="breakeven">$${breakeven.toFixed(2)}</span>
      <span class="total ${canAfford ? '' : 'over-budget'}">${formatMoney(total)}</span>
      <span class="exp">${EXPIRY_LABELS[l.duration]}</span>
      <button class="btn-mini btn-buy" data-ob-buy="${i}" ${canAfford ? '' : 'disabled'}>Buy</button>
      <button class="btn-mini btn-sell" data-ob-sell="${i}">Sell</button>
    </div>`
  }).join('')

  els.orderbookBody.querySelectorAll('[data-ob-buy]').forEach(btn => {
    btn.addEventListener('click', () => buyOption(levels[Number(btn.dataset.obBuy)]))
  })
  els.orderbookBody.querySelectorAll('[data-ob-sell]').forEach(btn => {
    btn.addEventListener('click', () => writeOption(levels[Number(btn.dataset.obSell)]))
  })
}

function renderOpenOptions() {
  if (state.options.length === 0) {
    els.openOptions.hidden = true
    return
  }
  els.openOptions.hidden = false
  els.openOptionsList.innerHTML = state.options.map((pos, i) => {
    const isShort = pos.side === 'short'
    const book = pos.type === 'call' ? state.orderBook.calls : state.orderBook.puts
    const level = book.find(l => l.strike === pos.strike && l.duration === pos.duration)
    const closePrice = isShort
      ? (level ? level.ask : pos.entryPremium * 1.5)
      : (level ? level.bid : pos.entryPremium * 0.5)
    const pnl = isShort
      ? (pos.entryPremium - closePrice) * pos.quantity * 100
      : (closePrice - pos.entryPremium) * pos.quantity * 100
    const pnlClass = pnl >= 0 ? 'up' : 'down'
    const pnlStr = (pnl >= 0 ? '+' : '') + formatMoney(pnl)
    const sideLabel = isShort ? 'SHORT' : 'LONG'
    const sideClass = isShort ? 'short' : 'long'
    const closeLabel = isShort ? 'Buy Back' : 'Close'
    return `
    <div class="option-position">
      <div class="pos-info">
        <span class="pos-side ${sideClass}">${sideLabel}</span>
        <span class="pos-type ${pos.type}">${pos.type.toUpperCase()}</span>
        <span>$${pos.strike}</span>
        <span class="pos-qty">×${pos.quantity}</span>
        <span class="pos-entry">@ $${pos.entryPremium.toFixed(2)}</span>
        <span class="pos-exp">exp ${formatExpiry(pos.expiry, Date.now())}</span>
        <span class="pos-pnl ${pnlClass}">${pnlStr}</span>
      </div>
      <div class="pos-actions">
        <button class="btn-mini ${isShort ? 'btn-buy' : 'btn-sell'}" data-close-one="${i}">${closeLabel} 1</button>
        <button class="btn-mini ${isShort ? 'btn-buy' : 'btn-sell'}" data-close-all="${i}">${closeLabel} All</button>
      </div>
    </div>
  `}).join('')

  els.openOptionsList.querySelectorAll('[data-close-one]').forEach(btn => {
    btn.addEventListener('click', () => closePosition(state.options[Number(btn.dataset.closeOne)], 1))
  })
  els.openOptionsList.querySelectorAll('[data-close-all]').forEach(btn => {
    const pos = state.options[Number(btn.dataset.closeAll)]
    btn.addEventListener('click', () => closePosition(pos, pos.quantity))
  })
}

// ── Trading actions ───────────────────────────────────────────

function expireOptions(now) {
  const remaining = []
  let cashDelta = 0

  for (const pos of state.options) {
    if (pos.expiry <= now) {
      const payout = settleOption(state.price, pos.type, pos.strike)
      const total = payout * pos.quantity * 100
      const isShort = pos.side === 'short'
      const itm = payout > 0
      if (isShort) {
        cashDelta -= total
        addLog(
          `SHORT ${pos.type.toUpperCase()} $${pos.strike} expired ${itm ? `ITM — paid out ${formatMoney(total)}` : 'OTM — kept premium'}`,
          itm ? 'expire' : 'sell'
        )
      } else {
        cashDelta += total
        addLog(
          `${pos.type.toUpperCase()} $${pos.strike} expired ${itm ? `ITM — settled ${formatMoney(total)}` : 'OTM — worthless'}`,
          'expire'
        )
      }
    } else {
      remaining.push(pos)
    }
  }

  if (cashDelta > 0 || remaining.length !== state.options.length) {
    state.cash += cashDelta
    state.options = remaining
  }
}

function buyShares(qty) {
  if (qty <= 0) return
  const cost = qty * state.price
  if (cost > state.cash) { addLog('Insufficient cash for share purchase'); return }

  const totalShares = state.shares + qty
  state.avgCost = (state.shares * state.avgCost + qty * state.price) / totalShares
  state.shares = totalShares
  state.cash -= cost
  addLog(`Bought ${qty} shares @ ${formatMoney(state.price)}`, 'buy')
  render()
}

function sellShares(qty) {
  if (qty <= 0 || qty > state.shares) { addLog('Not enough shares to sell'); return }
  state.cash += qty * state.price
  state.shares -= qty
  if (state.shares === 0) state.avgCost = 0
  addLog(`Sold ${qty} shares @ ${formatMoney(state.price)}`, 'sell')
  render()
}

function buyOption(level) {
  const contracts = state.optionContracts
  const cost = level.ask * contracts * 100
  if (cost > state.cash) { addLog('Insufficient cash for option purchase'); return }

  const existing = state.options.find(
    p => p.side === 'long' && p.type === level.type && p.strike === level.strike && p.duration === level.duration
  )

  if (existing) {
    const totalQty = existing.quantity + contracts
    existing.entryPremium = (existing.entryPremium * existing.quantity + level.ask * contracts) / totalQty
    existing.quantity = totalQty
  } else {
    state.options.push({
      side: 'long',
      type: level.type,
      strike: level.strike,
      expiry: level.expiry,
      duration: level.duration,
      quantity: contracts,
      entryPremium: level.ask,
      openedAt: Date.now(),
    })
  }

  state.cash -= cost
  addLog(
    `Bought ${contracts}x ${level.type.toUpperCase()} $${level.strike} @ $${level.ask} (exp ${formatExpiry(level.expiry, Date.now())})`,
    'buy'
  )
  render()
}

function writeOption(level) {
  const contracts = state.optionContracts
  const proceeds = level.bid * contracts * 100

  const existing = state.options.find(
    p => p.side === 'short' && p.type === level.type && p.strike === level.strike && p.duration === level.duration
  )

  if (existing) {
    const totalQty = existing.quantity + contracts
    existing.entryPremium = (existing.entryPremium * existing.quantity + level.bid * contracts) / totalQty
    existing.quantity = totalQty
  } else {
    state.options.push({
      side: 'short',
      type: level.type,
      strike: level.strike,
      expiry: level.expiry,
      duration: level.duration,
      quantity: contracts,
      entryPremium: level.bid,
      openedAt: Date.now(),
    })
  }

  state.cash += proceeds
  addLog(
    `Sold (wrote) ${contracts}x ${level.type.toUpperCase()} $${level.strike} @ $${level.bid.toFixed(2)} (exp ${formatExpiry(level.expiry, Date.now())})`,
    'sell'
  )
  render()
}

function closePosition(pos, contracts) {
  if (!pos || contracts <= 0 || contracts > pos.quantity) return

  const book = pos.type === 'call' ? state.orderBook.calls : state.orderBook.puts
  const level = book.find(l => l.strike === pos.strike && l.duration === pos.duration)

  pos.quantity -= contracts
  if (pos.quantity <= 0) state.options = state.options.filter(p => p !== pos)

  if (pos.side === 'short') {
    const ask = level ? level.ask : pos.entryPremium * 1.5
    state.cash -= ask * contracts * 100
    addLog(`Bought back ${contracts}x ${pos.type.toUpperCase()} $${pos.strike} @ $${ask.toFixed(2)}`, 'buy')
  } else {
    const bid = level ? level.bid : pos.entryPremium * 0.5
    state.cash += bid * contracts * 100
    addLog(`Sold ${contracts}x ${pos.type.toUpperCase()} $${pos.strike} @ $${bid.toFixed(2)}`, 'sell')
  }
  render()
}

function resetGame() {
  state.cash = DEFAULT_CASH
  state.shares = 0
  state.avgCost = 0
  state.options = []
  state.logs = []
  state.history = seedPriceHistory(state.mode)
  state.price = state.history[state.history.length - 1]?.price ?? INITIAL_PRICE
  addLog('Portfolio reset — $1,000 cash')
  render()
  renderLogs()
}

// ── Tick loop ─────────────────────────────────────────────────

function tick() {
  const tickData = createPriceTick(state.price, state.mode)
  state.price = tickData.price
  state.history.push(tickData)
  if (state.history.length > 120) state.history.shift()

  const now = Date.now()
  expireOptions(now)
  state.orderBook = generateOrderBook(state.price, state.mode, now)

  render()
}

// ── Event listeners ───────────────────────────────────────────

$$('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.mode = btn.dataset.mode
    $$('.mode-btn').forEach(b => b.classList.toggle('active', b === btn))
  })
})

els.shareQty.addEventListener('input', () => {
  state.shareQty = Math.max(1, parseInt(els.shareQty.value) || 1)
  els.shareQty.value = state.shareQty
  render()
})

$('#qty-minus').addEventListener('click', () => {
  state.shareQty = Math.max(1, state.shareQty - 1)
  els.shareQty.value = state.shareQty
  render()
})

$('#qty-plus').addEventListener('click', () => {
  state.shareQty++
  els.shareQty.value = state.shareQty
  render()
})

$$('.qty-presets button').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.qty === 'max') {
      state.shareQty = Math.max(1, Math.floor(state.cash / state.price))
    } else {
      state.shareQty = Number(btn.dataset.qty)
    }
    els.shareQty.value = state.shareQty
    render()
  })
})

els.buyShares.addEventListener('click', () => buyShares(state.shareQty))
els.sellShares.addEventListener('click', () => sellShares(state.shareQty))

$$('.option-type-tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    state.optionTab = btn.dataset.type
    $$('.option-type-tabs button').forEach(b => {
      b.classList.toggle('active', b === btn)
      b.classList.toggle('call', b === btn && b.dataset.type === 'call')
      b.classList.toggle('put', b === btn && b.dataset.type === 'put')
    })
    renderOrderBook()
  })
})

els.optionContracts.addEventListener('input', () => {
  state.optionContracts = Math.max(1, parseInt(els.optionContracts.value) || 1)
  els.optionContracts.value = state.optionContracts
  renderOrderBook()
})

$('#reset-btn').addEventListener('click', resetGame)

window.addEventListener('resize', drawChart)

// ── Init ──────────────────────────────────────────────────────

state.price = state.history[state.history.length - 1]?.price ?? INITIAL_PRICE
state.orderBook = generateOrderBook(state.price, state.mode, Date.now())
initExpiryTabs()
render()
setInterval(tick, TICK_MS)