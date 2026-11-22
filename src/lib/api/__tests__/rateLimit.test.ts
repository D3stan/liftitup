import test from 'node:test';
import assert from 'node:assert/strict';
import module from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const srcRoot = path.resolve(process.cwd(), 'src');
module.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL && context.parentURL.includes('/node_modules/')) {
      return nextResolve(specifier, context);
    }
    if (specifier === 'next/server') {
      return nextResolve('next/server.js', context);
    }
    let target = specifier;
    if (specifier.startsWith('@/')) {
      target = path.join(srcRoot, specifier.slice(2));
    } else if (
      specifier.startsWith('.') &&
      context.parentURL &&
      !specifier.endsWith('.ts') &&
      !specifier.endsWith('.tsx') &&
      !specifier.endsWith('.mjs')
    ) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      target = path.resolve(parentDir, specifier);
    }
    if (target !== specifier) {
      for (const candidate of [
        target,
        `${target}.ts`,
        `${target}.tsx`,
        path.join(target, 'index.ts'),
      ]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return nextResolve(pathToFileURL(candidate).href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const { NextRequest, NextResponse } = await import('next/server');
const { ApiError, withApiHandler } = await import('@/lib/api/handler');
const {
  MAX_RATE_LIMIT_KEYS,
  checkRequestRateLimit,
  consumeRateLimit,
  extractClientIp,
  getRateLimitPolicyForRoute,
  resetRateLimitForTests,
} = await import('@/lib/api/rateLimit');
const { resetMetricsBufferForTests } = await import('@/lib/admin/metrics');

test('extractClientIp handles reverse-proxy headers and fallback cleanly', () => {
  const reqXff = new NextRequest('https://lift.example.test/api/auth/login', {
    headers: {
      'x-forwarded-for': '203.0.113.10, 10.0.0.1',
      'x-real-ip': '198.51.100.2',
    },
  });
  assert.equal(extractClientIp(reqXff), '203.0.113.10');

  const reqRealIp = new NextRequest('https://lift.example.test/api/auth/login', {
    headers: {
      'x-real-ip': '198.51.100.2',
    },
  });
  assert.equal(extractClientIp(reqRealIp), '198.51.100.2');

  const reqCf = new NextRequest('https://lift.example.test/api/auth/login', {
    headers: {
      'cf-connecting-ip': '2001:db8::1',
    },
  });
  assert.equal(extractClientIp(reqCf), '2001:db8::1');

  const reqNoIp = new NextRequest('https://lift.example.test/api/auth/login');
  assert.equal(extractClientIp(reqNoIp), 'unknown');
});

test('getRateLimitPolicyForRoute assigns differentiated limits across endpoint tiers', () => {
  const login = getRateLimitPolicyForRoute('auth.login');
  const register = getRateLimitPolicyForRoute('auth.register');
  const aiImport = getRateLimitPolicyForRoute('ai.import');
  const appleHealth = getRateLimitPolicyForRoute('integrations.appleHealth.post');
  const mcp = getRateLimitPolicyForRoute('mcp.post');
  const photosUpload = getRateLimitPolicyForRoute('photos.create');
  const exportGet = getRateLimitPolicyForRoute('export.get');
  const adminOverview = getRateLimitPolicyForRoute('admin.overview.get');
  const workoutsGet = getRateLimitPolicyForRoute('workouts.date.get');

  assert.equal(login.tier, 'auth');
  assert.equal(register.tier, 'auth');
  assert.ok(register.limit <= login.limit);
  assert.ok(login.limit < workoutsGet.limit);

  assert.equal(aiImport.tier, 'expensive');
  assert.equal(appleHealth.tier, 'expensive');
  assert.equal(photosUpload.tier, 'expensive');
  assert.equal(exportGet.tier, 'expensive');
  assert.equal(mcp.tier, 'mcp');
  assert.equal(adminOverview.tier, 'admin');
  assert.equal(workoutsGet.tier, 'general');
});

test('consumeRateLimit enforces sliding window, Retry-After, and bounded memory cap', () => {
  resetRateLimitForTests();
  const policy = {
    tier: 'auth' as const,
    bucket: 'test.bucket',
    limit: 3,
    windowMs: 10_000,
  };

  const t0 = 1_700_000_000_000;
  assert.equal(consumeRateLimit('k1', policy, '1.2.3.4', t0).remaining, 2);
  assert.equal(consumeRateLimit('k1', policy, '1.2.3.4', t0 + 1000).remaining, 1);
  assert.equal(consumeRateLimit('k1', policy, '1.2.3.4', t0 + 2000).remaining, 0);

  const blocked = consumeRateLimit('k1', policy, '1.2.3.4', t0 + 2500);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.retryAfterSeconds, 8); // (t0 + 10_000 - (t0 + 2500)) = 7500ms -> 8s

  // Once oldest timestamp expires after windowMs, 1 slot frees up
  const reopened = consumeRateLimit('k1', policy, '1.2.3.4', t0 + 10_001);
  assert.equal(reopened.allowed, true);
  assert.equal(reopened.remaining, 0);

  // Memory bound check: exceed MAX_RATE_LIMIT_KEYS unique keys without throwing or unbounded growth
  resetRateLimitForTests();
  const storeSym = Symbol.for('liftitup.api.rateLimitStore');
  const map = (globalThis as Record<symbol, Map<string, unknown>>)[storeSym];
  for (let i = 0; i < MAX_RATE_LIMIT_KEYS + 250; i += 1) {
    consumeRateLimit(`ip_${i}`, policy, `10.0.${Math.floor(i / 255)}.${i % 255}`, t0 + i);
  }
  assert.ok(map.size <= MAX_RATE_LIMIT_KEYS);
});

test('withApiHandler returns 429 RATE_LIMITED with standard JSON error, headers, env overrides, and bypass', async (t) => {
  resetRateLimitForTests();
  resetMetricsBufferForTests();
  const prevEnabled = process.env.RATE_LIMIT_ENABLED;
  const prevAuthMax = process.env.RATE_LIMIT_AUTH_MAX;
  const prevAuthWindow = process.env.RATE_LIMIT_AUTH_WINDOW_MS;

  t.after(() => {
    resetRateLimitForTests();
    resetMetricsBufferForTests();
    if (prevEnabled === undefined) delete process.env.RATE_LIMIT_ENABLED;
    else process.env.RATE_LIMIT_ENABLED = prevEnabled;
    if (prevAuthMax === undefined) delete process.env.RATE_LIMIT_AUTH_MAX;
    else process.env.RATE_LIMIT_AUTH_MAX = prevAuthMax;
    if (prevAuthWindow === undefined) delete process.env.RATE_LIMIT_AUTH_WINDOW_MS;
    else process.env.RATE_LIMIT_AUTH_WINDOW_MS = prevAuthWindow;
  });

  process.env.RATE_LIMIT_ENABLED = 'true';
  process.env.RATE_LIMIT_AUTH_MAX = '2';
  process.env.RATE_LIMIT_AUTH_WINDOW_MS = '60000';

  const loginHandler = withApiHandler('auth.login', async () => {
    return NextResponse.json({ ok: true });
  });
  const workoutsHandler = withApiHandler('workouts.date.get', async () => {
    throw ApiError.badRequest('bad date');
  });

  const makeLoginReq = (ip: string) =>
    new NextRequest('https://lift.example.test/api/auth/login', {
      method: 'POST',
      headers: { 'x-forwarded-for': ip },
    });

  const r1 = await loginHandler(makeLoginReq('198.51.100.10'), {
    params: Promise.resolve({}),
  });
  assert.equal(r1.status, 200);
  assert.equal(r1.headers.get('x-ratelimit-limit'), '2');
  assert.equal(r1.headers.get('x-ratelimit-remaining'), '1');
  assert.ok(r1.headers.get('x-ratelimit-reset'));

  const r2 = await loginHandler(makeLoginReq('198.51.100.10'), {
    params: Promise.resolve({}),
  });
  assert.equal(r2.status, 200);
  assert.equal(r2.headers.get('x-ratelimit-remaining'), '0');

  const r3 = await loginHandler(makeLoginReq('198.51.100.10'), {
    params: Promise.resolve({}),
  });
  assert.equal(r3.status, 429);
  assert.equal(r3.headers.get('x-ratelimit-limit'), '2');
  assert.equal(r3.headers.get('x-ratelimit-remaining'), '0');
  assert.ok(Number(r3.headers.get('retry-after')) >= 1);
  assert.ok(r3.headers.get('x-request-id'));

  const body3 = (await r3.json()) as {
    error: { code: string; message: string };
    requestId: string;
  };
  assert.equal(body3.error.code, 'RATE_LIMITED');
  assert.match(body3.error.message, /too many requests/i);
  assert.equal(body3.requestId, r3.headers.get('x-request-id'));

  // Different IP is unaffected
  const otherIpRes = await loginHandler(makeLoginReq('198.51.100.99'), {
    params: Promise.resolve({}),
  });
  assert.equal(otherIpRes.status, 200);

  // Different bucket (general workouts) for same IP is unaffected and keeps headers on ApiError
  const workoutRes = await workoutsHandler(
    new NextRequest('https://lift.example.test/api/workouts/2026-11-22', {
      method: 'GET',
      headers: { 'x-forwarded-for': '198.51.100.10' },
    }),
    { params: Promise.resolve({}) },
  );
  assert.equal(workoutRes.status, 400);
  assert.ok(workoutRes.headers.get('x-ratelimit-limit'));
  assert.ok(workoutRes.headers.get('x-ratelimit-remaining'));

  // RATE_LIMIT_ENABLED=false bypasses checks cleanly
  process.env.RATE_LIMIT_ENABLED = 'false';
  assert.equal(checkRequestRateLimit(makeLoginReq('198.51.100.10'), 'auth.login'), null);
  const bypassedRes = await loginHandler(makeLoginReq('198.51.100.10'), {
    params: Promise.resolve({}),
  });
  assert.equal(bypassedRes.status, 200);
  assert.equal(bypassedRes.headers.get('x-ratelimit-limit'), null);
});
