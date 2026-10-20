import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { NextRequest } from 'next/server';
import { isAuthenticated, sessionCookieOptions, signSession } from './auth';
import {
  AUTH_MAX_FAILURES,
  AUTH_THROTTLE_WINDOW_MS,
  bodyTooLarge,
  clearAuthFailures,
  isThrottled,
  recordAuthFailure,
  resetAuthThrottle,
  retryAfterSeconds,
} from './authRateLimit';

const original = { password: process.env.API_PASSWORD, secret: process.env.SESSION_SECRET, embedded: process.env.EMBEDDED_PREVIEW_COOKIES };
const secret='test-only-preview-session-signing-secret';
function request(headers: Record<string,string>={}, cookie?: string): NextRequest {
  return { headers: new Headers(headers), cookies: { get: () => cookie ? { value: cookie } : undefined } } as unknown as NextRequest;
}
before(()=>{process.env.API_PASSWORD='test-only-password';process.env.SESSION_SECRET=secret;});
after(()=>{
  for (const [key,value] of Object.entries({ API_PASSWORD: original.password, SESSION_SECRET: original.secret, EMBEDDED_PREVIEW_COOKIES: original.embedded })) {
    if(value===undefined) delete process.env[key];else process.env[key]=value;
  }
});
describe('preview session authentication (gateway header replacement)',()=>{
  it('keeps strict HttpOnly sessions outside opt-in previews',()=>{
    delete process.env.EMBEDDED_PREVIEW_COOKIES;
    assert.equal(sessionCookieOptions().sameSite,'strict');
    assert.equal(sessionCookieOptions().httpOnly,true);
    assert.equal('partitioned' in sessionCookieOptions(),false);
  });
  it('requires Secure partitioned cookies in opt-in previews',()=>{
    process.env.EMBEDDED_PREVIEW_COOKIES='true';
    assert.equal(sessionCookieOptions().secure,true);
    assert.equal(sessionCookieOptions().sameSite,'none');
    assert.equal(sessionCookieOptions().partitioned,true);
  });
  it('accepts signed preview header even when proxy replaces Authorization',async()=>{
    process.env.EMBEDDED_PREVIEW_COOKIES='true';
    const token=await signSession(Date.now()+60_000,secret);
    assert.equal(await isAuthenticated(request({authorization:'Bearer proxy-owned-value','x-tc-preview-session':token})),true);
  });
  it('does not accept a preview header without explicit deployment opt-in',async()=>{
    delete process.env.EMBEDDED_PREVIEW_COOKIES;
    const token=await signSession(Date.now()+60_000,secret);
    assert.equal(await isAuthenticated(request({'x-tc-preview-session':token})),false);
  });
  it('rejects forged, tampered, expired and wrong-secret preview sessions',async()=>{
    process.env.EMBEDDED_PREVIEW_COOKIES='true';
    const valid=await signSession(Date.now()+60_000,secret);
    for(const token of ['arbitrary-value',valid.slice(0,-1)+(valid.at(-1)==='0'?'1':'0'),await signSession(Date.now()-1000,secret),await signSession(Date.now()+60_000,'other-secret')]) {
      assert.equal(await isAuthenticated(request({'x-tc-preview-session':token})),false);
    }
  });
  it('never accepts the master password in the preview session header',async()=>{
    process.env.EMBEDDED_PREVIEW_COOKIES='true';
    assert.equal(await isAuthenticated(request({'x-tc-preview-session':'test-only-password'})),false);
  });
  it('preserves existing bearer-password and signed-cookie authentication',async()=>{
    delete process.env.EMBEDDED_PREVIEW_COOKIES;
    assert.equal(await isAuthenticated(request({authorization:'Bearer test-only-password'})),true);
    assert.equal(await isAuthenticated(request({},await signSession(Date.now()+60_000,secret))),true);
  });
  it('refuses every credential if authentication is unconfigured',async()=>{
    process.env.EMBEDDED_PREVIEW_COOKIES='true';
    delete process.env.API_PASSWORD;
    assert.equal(await isAuthenticated(request({'x-tc-preview-session':await signSession(Date.now()+60_000,secret)})),false);
    process.env.API_PASSWORD='test-only-password';
  });
});

describe('mobile bearer sessions',()=>{
  it('accepts a signed session token as Authorization: Bearer',async()=>{
    delete process.env.EMBEDDED_PREVIEW_COOKIES;
    const token=await signSession(Date.now()+60_000,secret);
    assert.equal(await isAuthenticated(request({authorization:`Bearer ${token}`})),true);
  });
  it('rejects expired, tampered and foreign-secret session bearers',async()=>{
    delete process.env.EMBEDDED_PREVIEW_COOKIES;
    const valid=await signSession(Date.now()+60_000,secret);
    const tampered=valid.slice(0,-1)+(valid.at(-1)==='0'?'1':'0');
    for(const token of ['not-a-session',tampered,await signSession(Date.now()-1000,secret),await signSession(Date.now()+60_000,'other-secret')]) {
      assert.equal(await isAuthenticated(request({authorization:`Bearer ${token}`})),false);
    }
  });
  it('refuses a valid session bearer when auth is unconfigured',async()=>{
    const token=await signSession(Date.now()+60_000,secret);
    delete process.env.API_PASSWORD;
    assert.equal(await isAuthenticated(request({authorization:`Bearer ${token}`})),false);
    process.env.API_PASSWORD='test-only-password';
  });
  it('keeps accepting the operator password as a bearer',async()=>{
    delete process.env.EMBEDDED_PREVIEW_COOKIES;
    assert.equal(await isAuthenticated(request({authorization:'Bearer test-only-password'})),true);
    assert.equal(await isAuthenticated(request({authorization:'Bearer wrong'})),false);
  });
});

describe('failed-login throttling',()=>{
  it('allows attempts below the limit and refuses the limit-th attempt onward',()=>{
    resetAuthThrottle();
    const key='client-a';
    for(let i=0;i<AUTH_MAX_FAILURES-1;i++) recordAuthFailure(key);
    assert.equal(isThrottled(key),false);
    recordAuthFailure(key);
    assert.equal(isThrottled(key),true);
  });
  it('clears the window after a successful login',()=>{
    resetAuthThrottle();
    const key='client-b';
    for(let i=0;i<AUTH_MAX_FAILURES;i++) recordAuthFailure(key);
    assert.equal(isThrottled(key),true);
    clearAuthFailures(key);
    assert.equal(isThrottled(key),false);
  });
  it('expires the window instead of locking the operator out forever',()=>{
    resetAuthThrottle();
    const key='client-c';
    const start=1_000_000;
    for(let i=0;i<AUTH_MAX_FAILURES;i++) recordAuthFailure(key,start);
    assert.equal(isThrottled(key,start),true);
    assert.equal(isThrottled(key,start+AUTH_THROTTLE_WINDOW_MS+1),false);
  });
  it('reports a positive Retry-After while throttled',()=>{
    resetAuthThrottle();
    const key='client-d';
    const start=2_000_000;
    for(let i=0;i<AUTH_MAX_FAILURES;i++) recordAuthFailure(key,start);
    assert.ok(retryAfterSeconds(key,start)>0);
    assert.equal(retryAfterSeconds('never-seen',start),0);
  });
  it('rejects oversized credential bodies before parsing',()=>{
    const small=new Request('http://localhost/api/auth/login',{method:'POST',headers:{'content-length':'128'}});
    const huge=new Request('http://localhost/api/auth/login',{method:'POST',headers:{'content-length':'5000'}});
    const unknown=new Request('http://localhost/api/auth/login',{method:'POST'});
    assert.equal(bodyTooLarge(small),false);
    assert.equal(bodyTooLarge(huge),true);
    assert.equal(bodyTooLarge(unknown),false);
  });
});
