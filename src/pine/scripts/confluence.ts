/**
 * The user's "Crypto Confluence Signals [8x]" script.
 *
 * It is kept verbatim as a regression fixture: if a change to the runtime
 * breaks this script, the test fails. Every construct it uses — user types,
 * arrays of objects, drawing objects, anchored VWAP, pivots, the time window
 * filter — is exercised by it.
 */
export const CONFLUENCE_SOURCE = `//@version=6
indicator("Crypto Confluence Signals [8x]", overlay = true, max_labels_count = 500, max_boxes_count = 500, max_lines_count = 50, max_bars_back = 5000)

// ▸ CORE ENGINE (SYNCED) ▸

string G1 = "Signal Engine"
int    emaLen    = input.int(100, "EMA Length", minval = 10, group = G1)
float  stFactor  = input.float(3.0, "SuperTrend Factor", minval = 0.5, step = 0.5, group = G1)
int    stLen     = input.int(10, "SuperTrend ATR Length", minval = 2, group = G1)
int    dcLen     = input.int(20, "Donchian Length", minval = 5, group = G1)
int    rsiLen    = input.int(14, "RSI Length", minval = 2, group = G1)
int    macdFast  = input.int(12, "MACD Fast", minval = 2, group = G1)
int    macdSlow  = input.int(26, "MACD Slow", minval = 5, group = G1)
int    macdSigLen = input.int(9, "MACD Signal", minval = 2, group = G1)
int    bbLen     = input.int(20, "BB Length", minval = 5, group = G1)
float  bbMult    = input.float(2.0, "BB StdDev", minval = 0.5, step = 0.5, group = G1)
string vwAnchor  = input.string("1D", "VWAP Anchor", options = ["1D", "1W"], group = G1)
int    chandLen  = input.int(22, "Chandelier Length", minval = 5, group = G1)
float  chandMult = input.float(3.0, "Chandelier ATR Mult", minval = 0.5, step = 0.5, group = G1)
int    adxLen    = input.int(14, "ADX Length", minval = 2, group = G1)
float  adxMin    = input.float(20.0, "ADX Minimum", minval = 5.0, step = 1.0, group = G1)
float  volRatio  = input.float(0.8, "Volume vs SMA Min", minval = 0.1, step = 0.1, group = G1)
int    volLen    = input.int(20, "Volume SMA Length", minval = 2, group = G1)
int    threshold = input.int(5, "Confluence Threshold", minval = 2, maxval = 7, group = G1)
int    resetBelow = input.int(3, "Re-arm level (hysteresis)", minval = 0, maxval = 6, group = G1)
bool   useTimeWin = input.bool(true, "Liquidity Time Window Filter", group = G1)
int    winStart  = input.int(7, "Window Start (UTC hour)", minval = 0, maxval = 23, group = G1)
int    winEnd    = input.int(22, "Window End (UTC hour)", minval = 0, maxval = 23, group = G1)

string G2 = "Risk and Exits"
int    atrLen    = input.int(14, "ATR Length", minval = 1, group = G2)
float  slMult    = input.float(2.0, "Stop ATR Multiplier", minval = 0.5, step = 0.25, group = G2)
float  rrRatio   = input.float(2.0, "Reward:Risk Ratio", minval = 0.5, step = 0.25, group = G2)
bool   tpAtSR    = input.bool(false, "TP at next S/R zone (else R:R)", group = G2)
bool   exitOpposite = input.bool(true, "Exit on opposite signal", group = G2)
float  beAfterR  = input.float(1.0, "Breakeven after +R", minval = 0.5, step = 0.25, group = G2)

string G3 = "Support and Resistance"
bool   autoTF    = input.bool(true, "Auto scale by timeframe", group = G3)
int    pivStrIn  = input.int(5, "Pivot Strength (manual)", minval = 1, maxval = 20, group = G3)
float  clustMult = input.float(0.5, "Cluster tolerance x ATR", minval = 0.1, step = 0.1, group = G3)
int    maxZones  = input.int(3, "Max zones per side", minval = 1, maxval = 6, group = G3)
int    zoneAgeIn = input.int(200, "Zone max age bars (manual)", minval = 20, group = G3)
bool   showSR    = input.bool(true, "Show S/R zones", group = G3)

string G4 = "Display (clean UI)"
bool   showLabels   = input.bool(true, "Show BUY/SELL labels", group = G4)
bool   showBoxes    = input.bool(true, "Show SL/TP boxes", group = G4)
bool   showTable    = input.bool(true, "Show info table", group = G4)
bool   showInternals = input.bool(false, "Show internals (lines)", group = G4)
int    maxPairs     = input.int(6, "Max SL/TP zone pairs shown", minval = 1, maxval = 20, group = G4)

int tfSec    = timeframe.in_seconds()
int pivStr   = autoTF ? (tfSec <= 900 ? 4 : tfSec <= 3600 ? 5 : tfSec <= 14400 ? 5 : 6) : pivStrIn
int zoneAge  = autoTF ? (tfSec <= 900 ? 150 : tfSec <= 3600 ? 200 : tfSec <= 14400 ? 150 : 120) : zoneAgeIn

float emaV     = ta.ema(close, emaLen)
[stLine, stDir] = ta.supertrend(stFactor, stLen)
float dcU      = ta.highest(high, dcLen)
float dcL      = ta.lowest(low, dcLen)
float dcMid    = (dcU + dcL) / 2.0
float rsiV     = ta.rsi(close, rsiLen)
[macdL, sigL, histV] = ta.macd(close, macdFast, macdSlow, macdSigLen)
float bbBasis  = ta.sma(close, bbLen)
float bbDev    = bbMult * ta.stdev(close, bbLen)
float bbUp     = bbBasis + bbDev
float bbLo     = bbBasis - bbDev
float vwapV    = ta.vwap(hlc3, timeframe.change(vwAnchor))
[diP, diM, adxV] = ta.dmi(adxLen, adxLen)
float atrV     = ta.atr(atrLen)
float volSma   = ta.sma(volume, volLen)
float atrCh    = ta.atr(chandLen)
float chandLong  = ta.highest(high, chandLen) - chandMult * atrCh
float chandShort = ta.lowest(low, chandLen) + chandMult * atrCh
int   utcH     = hour(time, "UTC")

int vEma   = not na(emaV) ? (close > emaV ? 1 : close < emaV ? -1 : 0) : 0
int vSt    = not na(stLine) ? (close > stLine ? 1 : close < stLine ? -1 : 0) : 0
int vDc    = not na(dcMid) and not na(dcMid[1]) ? (dcMid > dcMid[1] and close > dcMid ? 1 : dcMid < dcMid[1] and close < dcMid ? -1 : 0) : 0
int vRsi   = not na(rsiV) ? (rsiV > 50 ? 1 : rsiV < 50 ? -1 : 0) : 0
int vMacd  = not na(macdL) and not na(sigL) ? (macdL > sigL ? 1 : macdL < sigL ? -1 : 0) : 0
int vVwap  = not na(vwapV) ? (close > vwapV ? 1 : close < vwapV ? -1 : 0) : 0
int vBb    = not na(bbBasis) ? (close > bbBasis ? 1 : close < bbBasis ? -1 : 0) : 0

int longScore  = (vEma > 0 ? 1 : 0) + (vSt > 0 ? 1 : 0) + (vDc > 0 ? 1 : 0) + (vRsi > 0 ? 1 : 0) + (vMacd > 0 ? 1 : 0) + (vVwap > 0 ? 1 : 0) + (vBb > 0 ? 1 : 0)
int shortScore = (vEma < 0 ? 1 : 0) + (vSt < 0 ? 1 : 0) + (vDc < 0 ? 1 : 0) + (vRsi < 0 ? 1 : 0) + (vMacd < 0 ? 1 : 0) + (vVwap < 0 ? 1 : 0) + (vBb < 0 ? 1 : 0)

bool gateAdx = not na(adxV) and adxV >= adxMin
bool gateVol = not na(volSma) and not na(volume) and volume >= volSma * volRatio
bool inWindow = winStart <= winEnd ? (utcH >= winStart and utcH < winEnd) : (utcH >= winStart or utcH < winEnd)
bool gateTime = not useTimeWin or inWindow
bool gates   = gateAdx and gateVol and gateTime

var int longHy   = 0
var int shortHy  = 0
int longHyNext  = longScore >= threshold ? 1 : longScore <= resetBelow ? 0 : longHy
int shortHyNext = shortScore >= threshold ? 1 : shortScore <= resetBelow ? 0 : shortHy
bool buyCross   = longHyNext == 1 and longHy == 0
bool sellCross  = shortHyNext == 1 and shortHy == 0
longHy  := longHyNext
shortHy := shortHyNext

type SRZone
    float top  = na
    float bot  = na
    bool  isRes = false
    box   bx   = na
    int   origin = 0

var SRZone[] zoneList = array.new<SRZone>()

f_nearestRes(float fromP) =>
    float best = na
    int n = array.size(zoneList)
    if n > 0
        for i = 0 to n - 1
            SRZone z = zoneList.get(i)
            if z.isRes and z.bot > fromP
                best := na(best) ? z.bot : math.min(best, z.bot)
    best

f_nearestSup(float fromP) =>
    float best = na
    int n = array.size(zoneList)
    if n > 0
        for i = 0 to n - 1
            SRZone z = zoneList.get(i)
            if not z.isRes and z.top < fromP
                best := na(best) ? z.top : math.max(best, z.top)
    best

float phRaw = ta.pivothigh(high, pivStr, pivStr)
float plRaw = ta.pivotlow(low, pivStr, pivStr)
if not na(atrV)
    float zoneTol = atrV * clustMult
    if not na(phRaw)
        bool merged = false
        int zc = array.size(zoneList)
        if zc > 0
            for i = 0 to zc - 1
                SRZone z = zoneList.get(i)
                if z.isRes and phRaw <= z.top + zoneTol and phRaw >= z.bot - zoneTol
                    z.top := math.max(z.top, phRaw + zoneTol * 0.5)
                    z.bot := math.min(z.bot, phRaw - zoneTol * 0.5)
                    if not na(z.bx)
                        box.set_top(z.bx, z.top)
                        box.set_bottom(z.bx, z.bot)
                    merged := true
                    break
        if not merged
            int sideCount = 0
            int zc2 = array.size(zoneList)
            if zc2 > 0
                for i = 0 to zc2 - 1
                    if zoneList.get(i).isRes
                        sideCount += 1
            if sideCount >= maxZones
                int farIdx = -1
                float farDist = -1.0
                for i = 0 to zc2 - 1
                    SRZone z = zoneList.get(i)
                    if z.isRes
                        float d = math.abs((z.top + z.bot) / 2.0 - close)
                        if d > farDist
                            farDist := d
                            farIdx := i
                if farIdx >= 0
                    SRZone dz = zoneList.get(farIdx)
                    if not na(dz.bx)
                        box.delete(dz.bx)
                    zoneList.remove(farIdx)
            box nb = na
            if showSR
                nb := box.new(left = bar_index - pivStr, top = phRaw + zoneTol * 0.5, right = bar_index, bottom = phRaw - zoneTol * 0.5, border_color = color.new(#ff9800, 55), border_width = 1, bgcolor = color.new(#ff9800, 88))
            zoneList.push(SRZone.new(top = phRaw + zoneTol * 0.5, bot = phRaw - zoneTol * 0.5, isRes = true, bx = nb, origin = bar_index - pivStr))
    if not na(plRaw)
        bool merged = false
        int zc = array.size(zoneList)
        if zc > 0
            for i = 0 to zc - 1
                SRZone z = zoneList.get(i)
                if not z.isRes and plRaw <= z.top + zoneTol and plRaw >= z.bot - zoneTol
                    z.top := math.max(z.top, plRaw + zoneTol * 0.5)
                    z.bot := math.min(z.bot, plRaw - zoneTol * 0.5)
                    if not na(z.bx)
                        box.set_top(z.bx, z.top)
                        box.set_bottom(z.bx, z.bot)
                    merged := true
                    break
        if not merged
            int sideCount = 0
            int zc2 = array.size(zoneList)
            if zc2 > 0
                for i = 0 to zc2 - 1
                    if not zoneList.get(i).isRes
                        sideCount += 1
            if sideCount >= maxZones
                int farIdx = -1
                float farDist = -1.0
                for i = 0 to zc2 - 1
                    SRZone z = zoneList.get(i)
                    if not z.isRes
                        float d = math.abs((z.top + z.bot) / 2.0 - close)
                        if d > farDist
                            farDist := d
                            farIdx := i
                if farIdx >= 0
                    SRZone dz = zoneList.get(farIdx)
                    if not na(dz.bx)
                        box.delete(dz.bx)
                    zoneList.remove(farIdx)
            box nb = na
            if showSR
                nb := box.new(left = bar_index - pivStr, top = plRaw + zoneTol * 0.5, right = bar_index, bottom = plRaw - zoneTol * 0.5, border_color = color.new(#2962ff, 55), border_width = 1, bgcolor = color.new(#2962ff, 88))
            zoneList.push(SRZone.new(top = plRaw + zoneTol * 0.5, bot = plRaw - zoneTol * 0.5, isRes = false, bx = nb, origin = bar_index - pivStr))

if array.size(zoneList) > 0
    SRZone[] keep = array.new<SRZone>()
    int zs = array.size(zoneList)
    for i = 0 to zs - 1
        SRZone z = zoneList.get(i)
        bool broke = z.isRes ? close > z.top : close < z.bot
        bool aged = bar_index - z.origin > zoneAge
        if broke or aged
            if not na(z.bx)
                box.delete(z.bx)
        else
            if not na(z.bx)
                box.set_right(z.bx, bar_index)
            keep.push(z)
    zoneList := keep

// ◂ CORE ENGINE (SYNCED) ◂

type TradeBoxes
    box slB = na
    box tpB = na

var int trDir   = 0
var float trEntry = na
var float trSL   = na
var float trTP   = na
var float trRisk = na
var float trBe   = na
var TradeBoxes curPair = na
var bool pairActive = false
var TradeBoxes[] pairQ = array.new<TradeBoxes>()

var table infoTbl = table.new(position.top_right, 2, 4, border_width = 1, border_color = color.new(color.gray, 70))

bool confirmed = barstate.isconfirmed
bool buySignal  = false
bool sellSignal = false

f_closePair(int xRight) =>
    if pairActive
        if not na(curPair.slB)
            box.set_right(curPair.slB, xRight)
        if not na(curPair.tpB)
            box.set_right(curPair.tpB, xRight)

f_openPair(int xLeft, bool isLong, float entryP, float slP, float tpP) =>
    box sB = na
    box tB = na
    if showBoxes
        if isLong
            sB := box.new(left = xLeft, top = entryP, right = xLeft, bottom = slP, border_color = color.new(#f23645, 40), border_width = 1, bgcolor = color.new(#f23645, 86))
            tB := box.new(left = xLeft, top = tpP, right = xLeft, bottom = entryP, border_color = color.new(#089981, 40), border_width = 1, bgcolor = color.new(#089981, 86))
        else
            sB := box.new(left = xLeft, top = slP, right = xLeft, bottom = entryP, border_color = color.new(#f23645, 40), border_width = 1, bgcolor = color.new(#f23645, 86))
            tB := box.new(left = xLeft, top = entryP, right = xLeft, bottom = tpP, border_color = color.new(#089981, 40), border_width = 1, bgcolor = color.new(#089981, 86))
    TradeBoxes newPair = TradeBoxes.new(slB = sB, tpB = tB)
    pairQ.push(newPair)
    while array.size(pairQ) > maxPairs
        TradeBoxes old = pairQ.get(0)
        if not na(old.slB)
            box.delete(old.slB)
        if not na(old.tpB)
            box.delete(old.tpB)
        pairQ.remove(0)

if confirmed
    if trDir != 0 and pairActive
        if not na(curPair.slB)
            box.set_right(curPair.slB, bar_index)
        if not na(curPair.tpB)
            box.set_right(curPair.tpB, bar_index)

    bool slHit = false
    bool tpHit = false
    if trDir == 1
        slHit := not na(trSL) and low <= trSL
        tpHit := not na(trTP) and high >= trTP
    else if trDir == -1
        slHit := not na(trSL) and high >= trSL
        tpHit := not na(trTP) and low <= trTP

    if trDir != 0 and (slHit or tpHit)
        bool isSL = slHit
        f_closePair(bar_index)
        pairActive := false
        if showLabels
            label.new(bar_index, close, isSL ? "SL" : "TP", xloc = xloc.bar_index, yloc = yloc.price, color = isSL ? color.new(#f23645, 0) : color.new(#089981, 0), style = label.style_label_center, textcolor = color.white, size = size.tiny)
        alert(isSL ? "Confluence SL {{ticker}} @ {{close}}" : "Confluence TP {{ticker}} @ {{close}}", alert.freq_once_per_bar_close)
        trDir := 0
        trEntry := na
        trSL := na
        trTP := na
        trRisk := na
        trBe := na

    if trDir != 0
        bool beAct = trDir == 1 ? close >= trEntry + trRisk * beAfterR : close <= trEntry - trRisk * beAfterR
        if beAct
            float cand = trDir == 1 ? math.max(trEntry, chandLong) : math.min(trEntry, chandShort)
            trSL := trDir == 1 ? math.max(trSL, cand) : math.min(trSL, cand)
        if pairActive and not na(curPair.slB)
            if trDir == 1
                box.set_bottom(curPair.slB, trSL)
                box.set_right(curPair.slB, bar_index)
            else
                box.set_top(curPair.slB, trSL)
                box.set_right(curPair.slB, bar_index)
        if pairActive and not na(curPair.tpB)
            box.set_right(curPair.tpB, bar_index)

    buySignal := buyCross and gates and (trDir == 0 or (exitOpposite and trDir == -1))
    sellSignal := sellCross and gates and (trDir == 0 or (exitOpposite and trDir == 1))

    if buySignal
        if trDir == -1
            f_closePair(bar_index)
            pairActive := false
            if showLabels
                label.new(bar_index, close, "REV", xloc = xloc.bar_index, yloc = yloc.price, color = color.new(#787b86, 0), style = label.style_label_center, textcolor = color.white, size = size.tiny)
        float ent = close
        float slP = ent - slMult * atrV
        float srTP = tpAtSR ? f_nearestRes(ent) : na
        bool srOK = not na(srTP) and srTP - ent >= 0.25 * (ent - slP)
        float tpP = tpAtSR and srOK ? srTP : ent + rrRatio * (ent - slP)
        trDir := 1
        trEntry := ent
        trSL := slP
        trTP := tpP
        trRisk := ent - slP
        trBe := ent
        if showLabels
            label.new(bar_index, low, "BUY\\n" + str.tostring(longScore) + "/7 · RR " + str.tostring(rrRatio, "#.#"), xloc = xloc.bar_index, yloc = yloc.price, color = color.new(#089981, 0), style = label.style_label_up, textcolor = color.white, size = size.small)
        f_openPair(bar_index, true, ent, slP, tpP)
        curPair := pairQ.get(array.size(pairQ) - 1)
        pairActive := true
        if pairActive and not na(curPair.slB)
            box.set_right(curPair.slB, bar_index)
        if pairActive and not na(curPair.tpB)
            box.set_right(curPair.tpB, bar_index)

    if sellSignal
        if trDir == 1
            f_closePair(bar_index)
            pairActive := false
            if showLabels
                label.new(bar_index, close, "REV", xloc = xloc.bar_index, yloc = yloc.price, color = color.new(#787b86, 0), style = label.style_label_center, textcolor = color.white, size = size.tiny)
        float ent = close
        float slP = ent + slMult * atrV
        float srTP = tpAtSR ? f_nearestSup(ent) : na
        bool srOK = not na(srTP) and ent - srTP >= 0.25 * (slP - ent)
        float tpP = tpAtSR and srOK ? srTP : ent - rrRatio * (slP - ent)
        trDir := -1
        trEntry := ent
        trSL := slP
        trTP := tpP
        trRisk := slP - ent
        trBe := ent
        if showLabels
            label.new(bar_index, high, "SELL\\n" + str.tostring(shortScore) + "/7 · RR " + str.tostring(rrRatio, "#.#"), xloc = xloc.bar_index, yloc = yloc.price, color = color.new(#f23645, 0), style = label.style_label_down, textcolor = color.white, size = size.small)
        f_openPair(bar_index, false, ent, slP, tpP)
        curPair := pairQ.get(array.size(pairQ) - 1)
        pairActive := true
        if pairActive and not na(curPair.slB)
            box.set_right(curPair.slB, bar_index)
        if pairActive and not na(curPair.tpB)
            box.set_right(curPair.tpB, bar_index)

if barstate.islast and showTable
    int topScore = math.max(longScore, shortScore)
    string biasTxt = longScore > shortScore ? "LONG ▲" : shortScore > longScore ? "SHORT ▼" : "—"
    color biasCol = longScore > shortScore ? color.new(#089981, 0) : shortScore > longScore ? color.new(#f23645, 0) : color.silver
    table.cell(infoTbl, 0, 0, "CONF", text_color = color.silver, text_size = size.small, bgcolor = color.new(#1e222d, 0), text_halign = text.align_center)
    table.cell(infoTbl, 1, 0, str.tostring(topScore) + "/7", text_color = topScore >= threshold ? color.new(#089981, 0) : color.silver, text_size = size.small, bgcolor = color.new(#1e222d, 0), text_halign = text.align_center)
    table.cell(infoTbl, 0, 1, "BIAS", text_color = color.silver, text_size = size.small, bgcolor = color.new(#1e222d, 0), text_halign = text.align_center)
    table.cell(infoTbl, 1, 1, biasTxt, text_color = biasCol, text_size = size.small, bgcolor = color.new(#1e222d, 0), text_halign = text.align_center)
    table.cell(infoTbl, 0, 2, "ADX", text_color = color.silver, text_size = size.small, bgcolor = color.new(#1e222d, 0), text_halign = text.align_center)
    table.cell(infoTbl, 1, 2, str.tostring(nz(adxV), "#.#") + (gateAdx ? " ✓" : " ✗"), text_color = gateAdx ? color.new(#089981, 0) : color.new(#f23645, 0), text_size = size.small, bgcolor = color.new(#1e222d, 0), text_halign = text.align_center)
    table.cell(infoTbl, 0, 3, "ATR", text_color = color.silver, text_size = size.small, bgcolor = color.new(#1e222d, 0), text_halign = text.align_center)
    table.cell(infoTbl, 1, 3, str.tostring(nz(atrV), format.mintick), text_color = color.silver, text_size = size.small, bgcolor = color.new(#1e222d, 0), text_halign = text.align_center)

plot(emaV, "EMA100", color = color.new(#ff9800, 0), display = showInternals ? display.all : display.none)
plot(stLine, "SuperTrend", color = color.new(#26a69a, 0), style = plot.style_stepline, display = showInternals ? display.all : display.none)
plot(dcMid, "Donchian Mid", color = color.new(#42a5f5, 30), display = showInternals ? display.all : display.none)
plot(vwapV, "VWAP", color = color.new(#ab47bc, 0), display = showInternals ? display.all : display.none)
plot(bbBasis, "BB Basis", color = color.new(#787b86, 0), display = showInternals ? display.all : display.none)
plot(bbUp, "BB Upper", color = color.new(#787b86, 40), display = showInternals ? display.all : display.none)
plot(bbLo, "BB Lower", color = color.new(#787b86, 40), display = showInternals ? display.all : display.none)
plot(chandLong, "Chandelier Long", color = color.new(#f23645, 40), style = plot.style_stepline, display = showInternals ? display.all : display.none)
plot(chandShort, "Chandelier Short", color = color.new(#089981, 40), style = plot.style_stepline, display = showInternals ? display.all : display.none)

alertcondition(buySignal, title = "Confluence BUY", message = "Confluence BUY {{ticker}} @ {{close}}")
alertcondition(sellSignal, title = "Confluence SELL", message = "Confluence SELL {{ticker}} @ {{close}}")
`;
