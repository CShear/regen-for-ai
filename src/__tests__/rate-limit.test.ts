import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { createCheckoutLimiter, createWebhookLimiter } from "../server/rate-limit.js";

function withApp(setup: (app: express.Express) => void) {
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    const app = express();
    app.set("trust proxy", 1);
    setup(app);
    const server = app.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

describe("rate-limit middleware", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.REGEN_RATELIMIT_CHECKOUT_PER_MIN = "3";
    process.env.REGEN_RATELIMIT_WEBHOOK_PER_MIN = "5";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("checkout limiter allows up to N requests then returns 429", async () => {
    const app = await withApp((a) => {
      a.post("/subscribe", createCheckoutLimiter(), (_req, res) => res.json({ ok: true }));
    });

    try {
      const send = () => fetch(`${app.url}/subscribe`, { method: "POST" });
      const r1 = await send();
      const r2 = await send();
      const r3 = await send();
      const r4 = await send();
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(r3.status).toBe(200);
      expect(r4.status).toBe(429);
      const body = await r4.json();
      expect(body.error).toMatch(/too many/i);
    } finally {
      await app.close();
    }
  });

  it("webhook limiter has a separate, higher budget", async () => {
    const app = await withApp((a) => {
      a.post("/webhook", createWebhookLimiter(), (_req, res) => res.json({ ok: true }));
    });

    try {
      const send = () => fetch(`${app.url}/webhook`, { method: "POST" });
      // 5 allowed, 6th blocked
      for (let i = 0; i < 5; i++) {
        const r = await send();
        expect(r.status).toBe(200);
      }
      const r6 = await send();
      expect(r6.status).toBe(429);
    } finally {
      await app.close();
    }
  });

  it("emits a RateLimit-* header (draft-7 policy/limit)", async () => {
    const app = await withApp((a) => {
      a.post("/subscribe", createCheckoutLimiter(), (_req, res) => res.json({ ok: true }));
    });
    try {
      const r = await fetch(`${app.url}/subscribe`, { method: "POST" });
      // draft-7 emits a single combined "RateLimit" header (e.g. "limit=3, remaining=2, reset=60")
      // and a "RateLimit-Policy" header. Either is sufficient evidence the limiter ran.
      const combined = r.headers.get("ratelimit");
      const policy = r.headers.get("ratelimit-policy");
      expect(combined ?? policy).toBeTruthy();
      if (combined) expect(combined).toMatch(/limit=3/);
      if (policy) expect(policy).toMatch(/3/);
    } finally {
      await app.close();
    }
  });
});
