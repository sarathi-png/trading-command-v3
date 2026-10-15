import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { currentDisplayCurrency, setDisplayCurrency, subscribeCurrency } from "./displayCurrency";
import { fmtUsd, fmtPrice, fmtCompactUsd, fmtNum, fmtPct } from "./format";
const original = Object.getOwnPropertyDescriptor(globalThis,"window");
before(()=>Object.defineProperty(globalThis,"window",{value:{},configurable:true}));
after(()=>{setDisplayCurrency({displayCurrency:"usd",usdInrRate:88});if(original)Object.defineProperty(globalThis,"window",original);else Reflect.deleteProperty(globalThis,"window");});
describe("currency conversion is display-only",()=>{
  it("converts USD monetary totals using the explicit manual rate",()=>{setDisplayCurrency({displayCurrency:"inr",usdInrRate:88});assert.equal(fmtUsd(10,{decimals:2}),"₹880.00");assert.equal(fmtUsd(-10,{decimals:2}),"-₹880.00");assert.equal(fmtUsd(10,{sign:true,decimals:2}),"+₹880.00");});
  it("converts price and compact notional without changing quantities or percentages",()=>{assert.equal(fmtPrice(1),"₹88.000");assert.equal(fmtCompactUsd(1000),"₹88.0K");assert.equal(fmtNum(.01,2),"0.01");assert.equal(fmtPct(2),"+2.00%");});
  it("does not mutate canonical execution prices",()=>{const trade={price:100,qty:.01};fmtPrice(trade.price);fmtUsd(trade.price*trade.qty);assert.deepEqual(trade,{price:100,qty:.01});});
  it("updates subscribed leaf components when preference changes",()=>{let n=0;const stop=subscribeCurrency(()=>n++);setDisplayCurrency({displayCurrency:"usd",usdInrRate:88});setDisplayCurrency({displayCurrency:"inr",usdInrRate:90});stop();assert.equal(n,2);assert.equal(fmtUsd(1),"₹90.00");});
  it("never displays an invalid conversion as a valid rupee figure",()=>{setDisplayCurrency({displayCurrency:"inr",usdInrRate:0});assert.equal(currentDisplayCurrency().displayCurrency,"usd");assert.equal(fmtUsd(10),"$10.00");});
  it("never leaks the browser preference into server formatting",()=>{setDisplayCurrency({displayCurrency:"inr",usdInrRate:88});Reflect.deleteProperty(globalThis,"window");assert.equal(fmtUsd(10),"$10.00");Object.defineProperty(globalThis,"window",{value:{},configurable:true});assert.equal(fmtUsd(10),"₹880.00");});
  it("reports unavailable values instead of NaN, Infinity or artificial zero",()=>{assert.equal(fmtUsd(Infinity),"—");assert.equal(fmtPrice(null),"N/A");assert.equal(fmtCompactUsd(NaN),"N/A");});
});
