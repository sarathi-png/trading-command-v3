import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchJournalFills, stableUuid, type JournalFill } from "./fifo";
import { priorPredictionContext, csvCell } from "./context";
import { annotationPatch, reservedJournalTag } from "./annotations";
import { allocatePaperClose } from "../paper/accounting";
import { groupLegendRows, groupDonchianBounds, donchianBound, type LegendRow } from "../../components/chart/labels";
import type { AiPrediction } from "../ai/types";
const fill = (key: string, side: "buy"|"sell", price: number, quantity=1, fee=1, ts=1000): JournalFill => ({key,side,price,quantity,fee,ts,symbol:"BTCUSD",margin:"USDT",nativeFee:fee,fxRate:1,orderId:key});
const prediction = (patch: Partial<AiPrediction> = {}): AiPrediction => ({ id:"prior",symbol:"BTCUSD",timeframe:"5m",chartType:"candles",provider:"rules",model:"rules",direction:"LONG",createdAt:700_000,barTime:300_000,horizonBars:3,context:{dataSource:"live"},rationale:"closed-candle context",...patch } as AiPrediction);
describe("automatic journal and honest prediction context",()=>{
  it("matches longs with both opening and closing fees",()=>{const [t]=matchJournalFills([fill("b","buy",100),fill("s","sell",110,1,2,2000)]);assert.equal(t.pnl,7);assert.equal(t.fees,3);assert.equal(t.direction,"long");assert.equal(t.openedAt,new Date(1000).toISOString());});
  it("matches shorts without reversing the profit sign",()=>{const [t]=matchJournalFills([fill("s","sell",110),fill("b","buy",100,1,1,2000)]);assert.equal(t.direction,"short");assert.equal(t.pnl,8);});
  it("allocates fees across partial closes exactly once",()=>{const rows=matchJournalFills([fill("b","buy",100,2,2),fill("s1","sell",110,1,1,2000),fill("s2","sell",120,1,1,3000)]);assert.equal(rows.reduce((s,r)=>s+r.pnl,0),26);assert.equal(rows.reduce((s,r)=>s+r.fees,0),4);});
  it("handles flip remainder as a new opposite-side lot",()=>{const rows=matchJournalFills([fill("b","buy",100),fill("s","sell",110,2,2,2000),fill("b2","buy",105,1,1,3000)]);assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.direction),["short","long"]);assert.equal(rows.reduce((s,r)=>s+r.pnl,0),11);});
  it("never matches different margin wallets",()=>{assert.equal(matchJournalFills([fill("b","buy",100),{...fill("s","sell",110,1,1,2000),margin:"INR"}]).length,0);});
  it("stable UUIDs prevent duplicate journal records on repeated import",()=>{assert.equal(stableUuid("fill:a|fill:b"),stableUuid("fill:a|fill:b"));assert.match(stableUuid("fill:a|fill:b"),/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);assert.notEqual(stableUuid("a"),stableUuid("b"));});
  it("leaves unmatched openings as fill activity, not imaginary closed trades",()=>assert.equal(matchJournalFills([fill("b","buy",100)]).length,0));
  it("rejects corrupt quantities and timestamps",()=>{assert.throws(()=>matchJournalFills([fill("x","buy",100,0)]));assert.throws(()=>matchJournalFills([fill("x","buy",100,1,1,0)]));});
  it("paper partial plus final close cannot count partial profit twice",()=>{const first=allocatePaperClose(2,1,-2,110,.01,10);const last=allocatePaperClose(1,1,first.remainingCarry,120,.01,20);assert.ok(Math.abs(first.pnl+last.pnl-25.7)<1e-10);assert.ok(Math.abs(first.fees+last.fees-4.3)<1e-10);assert.equal(last.remainingCarry,0);});
  it("paper oversized flip charges only the closing quantity",()=>{const closed=allocatePaperClose(1,1,-1,110,.01,10);assert.ok(Math.abs(closed.pnl-7.9)<1e-10);assert.equal(closed.fees,2.1);});
  it("snapshots a same-source closed-candle prediction strictly before entry",()=>{const rows=priorPredictionContext([prediction()],"BTCUSD","long",800_000,"live");assert.equal(rows.length,1);assert.equal(rows[0].attribution,"prior-context-only");assert.equal(rows[0].agrees,true);});
  it("does not hindsight-match or mix demo/live/unknown sources",()=>{const rows=priorPredictionContext([prediction({createdAt:900_000}),prediction({context:{dataSource:"demo"} as AiPrediction["context"]}),prediction({context:{} as AiPrediction["context"]})],"BTCUSD","long",800_000,"live");assert.equal(rows.length,0);});
  it("rejects forming-bar evidence, stale calls and wrong symbols",()=>{assert.equal(priorPredictionContext([prediction({createdAt:500_000}),prediction({createdAt:700_000,symbol:"ETHUSD"})],"BTCUSD","long",800_000,"live").length,0);assert.equal(priorPredictionContext([prediction()],"BTCUSD","long",9_000_000,"live").length,0);});
  it("preserves disagreement and deduplicates context by provider/chart",()=>{const rows=priorPredictionContext([prediction(),prediction({id:"old",createdAt:650_000}),prediction({id:"ha",chartType:"heikin-ashi",direction:"SHORT"})],"BTCUSD","long",800_000,"live");assert.equal(rows.length,2);assert.equal(rows.find(r=>r.id==="ha")?.agrees,false);});
  it("refuses financial edits, attribution changes and provenance overrides",()=>{for(const field of ["pnl","fees","entry","qty","source","strategy","reason","predictionContext"]){assert.throws(()=>annotationPatch({id:"x",[field]:0}));}assert.deepEqual(annotationPatch({id:"x",notes:"Review"}),{id:"x",notes:"Review"});assert.throws(()=>annotationPatch({id:"x",tags:[7]}));});
  it("keeps reserved provenance tags separate from personal annotations",()=>{assert.equal(reservedJournalTag("market-source:live"),true);assert.equal(reservedJournalTag("fifo-estimate"),true);assert.equal(reservedJournalTag("my-setup"),false);});
  it("CSV escapes quotes, commas and spreadsheet formulas without changing numeric losses",()=>{assert.equal(csvCell('a,"b"'),'"a,""b"""');assert.equal(csvCell('=HYPERLINK("x")'),'"\'=HYPERLINK(""x"")"');assert.equal(csvCell(-12),'"-12"');});
  it("chart legend describes one resistance and one bound concept instead of every price/period",()=>{const rows:LegendRow[]=[{id:"r1",kind:"resistance",label:"RESISTANCE 1",token:"R",value:100},{id:"r2",kind:"resistance",label:"RESISTANCE 2",token:"R",value:110},...[20,50,100].map(p=>({id:`d${p}`,kind:"donchian" as const,label:donchianBound(p,"upper").full,token:donchianBound(p,"upper").compact,value:p}))];const groups=groupLegendRows(rows);assert.equal(groups.length,2);assert.equal(groups[0].rows.length,2);assert.equal(groups[1].rows.length,3);});
  it("merges equal Donchian axis bounds without merging distinct prices or upper/lower meanings",()=>{
    const groups=groupDonchianBounds({20:{upper:110,lower:90},50:{upper:110,lower:90},100:{upper:120,lower:90}});
    assert.equal(groups.length,3);
    assert.deepEqual(groups.find(g=>g.bound==="lower")?.periods,[20,50,100]);
    assert.deepEqual(groups.find(g=>g.bound==="upper"&&g.price===110)?.periods,[20,50]);
    assert.equal(groups.find(g=>g.price===120)?.periods.length,1);
  });
});

import { drawingBelongsToChart, chartDrawingLayout, analysisBelongsToChart, activeChartSignal } from "../chartScope";
import type { Analysis, StrategySignal } from "../types";
describe("chart-type research isolation", () => {
  it("keeps legacy drawings on normal candles, never Heikin-Ashi", () => {
    assert.equal(drawingBelongsToChart("default", "candles"), true);
    assert.equal(drawingBelongsToChart("default", "heikin-ashi"), false);
    assert.equal(drawingBelongsToChart(chartDrawingLayout("heikin-ashi"), "candles"), false);
    assert.equal(drawingBelongsToChart(chartDrawingLayout("heikin-ashi"), "heikin-ashi"), true);
  });
  it("requires explicitly tagged HA analysis on smoothed charts", () => {
    assert.equal(analysisBelongsToChart({} as Analysis, "heikin-ashi"), false);
    assert.equal(analysisBelongsToChart({ chartType: "heikin-ashi" } as Analysis, "candles"), false);
    assert.equal(analysisBelongsToChart({ chartType: "heikin-ashi" } as Analysis, "heikin-ashi"), true);
  });
  it("does not draw entry/stop/target or signal arrows for WAIT/WATCH candidates", () => {
    const signals = [{ entry: 100, status: "WATCH" }, { entry: 100, status: "WAIT" }] as StrategySignal[];
    assert.equal(activeChartSignal(signals), undefined);
    signals.push({ entry: 100, status: "SHORT_SETUP" } as StrategySignal);
    assert.equal(activeChartSignal(signals)?.status, "SHORT_SETUP");
  });
});
