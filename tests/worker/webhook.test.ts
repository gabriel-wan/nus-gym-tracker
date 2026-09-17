import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

const SECRET = "test-webhook-secret";

function update(text: string, chatId = 1) {
  return {
    update_id: 1,
    message: { message_id: 1, chat: { id: chatId, type: "private" }, text },
  };
}

function post(body: unknown, secret?: string) {
  return SELF.fetch("https://example.com/telegram", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret === undefined ? {} : { "X-Telegram-Bot-Api-Secret-Token": secret }),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  // The pool exposes env as a mutable object, so the handler sees this secret.
  // wrangler.toml holds no secrets, so without this the check compares against
  // undefined and every request is a 403 - which would pass the rejection
  // tests for entirely the wrong reason.
  env.TELEGRAM_WEBHOOK_SECRET = SECRET;
});

describe("webhook authentication", () => {
  it("rejects a request with no secret header", async () => {
    expect((await post(update("/gym"))).status).toBe(403);
  });

  it("rejects a wrong secret", async () => {
    expect((await post(update("/gym"), "guessed")).status).toBe(403);
  });

  it("accepts the correct secret", async () => {
    expect((await post(update("/help"), SECRET)).status).toBe(200);
  });
});

describe("webhook responses", () => {
  // Telegram redelivers anything we do not answer 200, so every authentic
  // request must succeed even when we intend to say nothing.
  it("answers 200 to an unknown command", async () => {
    expect((await post(update("/nonsense"), SECRET)).status).toBe(200);
  });

  it("answers 200 to an ordinary chat message", async () => {
    expect((await post(update("hello"), SECRET)).status).toBe(200);
  });

  it("answers 200 to an update with no message at all", async () => {
    expect((await post({ update_id: 7 }, SECRET)).status).toBe(200);
  });
});

describe("other routes", () => {
  it("does not treat a GET on the webhook path as an update", async () => {
    const response = await SELF.fetch("https://example.com/telegram");
    expect(await response.text()).toContain("nus-gym-tracker");
  });

  it("serves /health", async () => {
    const response = await SELF.fetch("https://example.com/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty("gyms");
  });
});
