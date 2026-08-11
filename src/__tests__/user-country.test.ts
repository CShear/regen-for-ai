import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import {
  setUserCountry,
  setUserCountryIfMissing,
  getUserCountryBySubscriberId,
} from "../server/db.js";

/**
 * Mini in-memory schema mirroring just the columns these helpers touch (#119).
 * Avoids spinning up the full getDb() — those migrations pull in many other tables.
 */
function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      country TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id)
    );
  `);
  return db;
}

function seedUser(db: Database.Database, country: string | null = null): number {
  const r = db.prepare("INSERT INTO users (country) VALUES (?)").run(country);
  return Number(r.lastInsertRowid);
}

function seedSubscriber(db: Database.Database, userId: number): number {
  const r = db.prepare("INSERT INTO subscribers (user_id) VALUES (?)").run(userId);
  return Number(r.lastInsertRowid);
}

describe("user country helpers (#119)", () => {
  let db: Database.Database;

  beforeEach(() => { db = makeDb(); });
  afterEach(() => { db.close(); });

  describe("setUserCountry", () => {
    it("uppercases and stores a valid alpha-2 code", () => {
      const userId = seedUser(db);
      setUserCountry(db, userId, "us");
      const row = db.prepare("SELECT country FROM users WHERE id = ?").get(userId) as { country: string };
      expect(row.country).toBe("US");
    });

    it("accepts sub-national codes like US-OR", () => {
      const userId = seedUser(db);
      setUserCountry(db, userId, "us-or");
      const row = db.prepare("SELECT country FROM users WHERE id = ?").get(userId) as { country: string };
      expect(row.country).toBe("US-OR");
    });

    it("nulls out invalid input rather than persisting garbage", () => {
      const userId = seedUser(db, "DE");
      setUserCountry(db, userId, "not a country");
      const row = db.prepare("SELECT country FROM users WHERE id = ?").get(userId) as { country: string | null };
      expect(row.country).toBeNull();
    });

    it("explicit null clears the column", () => {
      const userId = seedUser(db, "DE");
      setUserCountry(db, userId, null);
      const row = db.prepare("SELECT country FROM users WHERE id = ?").get(userId) as { country: string | null };
      expect(row.country).toBeNull();
    });
  });

  describe("setUserCountryIfMissing", () => {
    it("sets country when null", () => {
      const userId = seedUser(db, null);
      const changed = setUserCountryIfMissing(db, userId, "BR");
      expect(changed).toBe(true);
      const row = db.prepare("SELECT country FROM users WHERE id = ?").get(userId) as { country: string };
      expect(row.country).toBe("BR");
    });

    it("does NOT overwrite an existing value", () => {
      const userId = seedUser(db, "DE");
      const changed = setUserCountryIfMissing(db, userId, "BR");
      expect(changed).toBe(false);
      const row = db.prepare("SELECT country FROM users WHERE id = ?").get(userId) as { country: string };
      expect(row.country).toBe("DE");
    });

    it("returns false on invalid input without touching the row", () => {
      const userId = seedUser(db, null);
      const changed = setUserCountryIfMissing(db, userId, "garbage123");
      expect(changed).toBe(false);
      const row = db.prepare("SELECT country FROM users WHERE id = ?").get(userId) as { country: string | null };
      expect(row.country).toBeNull();
    });

    it("ignores empty string", () => {
      const userId = seedUser(db, null);
      expect(setUserCountryIfMissing(db, userId, "")).toBe(false);
      expect(setUserCountryIfMissing(db, userId, "   ")).toBe(false);
    });
  });

  describe("getUserCountryBySubscriberId", () => {
    it("returns the user's country for a subscriber", () => {
      const userId = seedUser(db, "KE");
      const subId = seedSubscriber(db, userId);
      expect(getUserCountryBySubscriberId(db, subId)).toBe("KE");
    });

    it("returns null when the user has no country set", () => {
      const userId = seedUser(db, null);
      const subId = seedSubscriber(db, userId);
      expect(getUserCountryBySubscriberId(db, subId)).toBeNull();
    });

    it("returns null for an unknown subscriber id", () => {
      expect(getUserCountryBySubscriberId(db, 99999)).toBeNull();
    });
  });
});
