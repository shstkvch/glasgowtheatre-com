const test = require("node:test");
const assert = require("node:assert");

/**
 * The provider chain: DeepSeek first, OpenRouter when it will not answer.
 *
 * The environment is read at call time, not at require time, so each test can
 * set the keys it needs and the module picks them up.
 */

function withKeys(keys, fn) {
  const saved = {
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  };
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  Object.assign(process.env, keys);
  try {
    return fn();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const ok = (payload) => async () => ({
  ok: true,
  status: 200,
  json: async () => payload,
});

const completion = (content) => ({
  model: "some-model",
  usage: { prompt_tokens: 100, completion_tokens: 20 },
  choices: [{ finish_reason: "stop", message: { content } }],
});

test("DeepSeek answers first, and OpenRouter is not asked", () =>
  withKeys(
    { DEEPSEEK_API_KEY: "ds", OPENROUTER_API_KEY: "or" },
    async () => {
      const { chat } = require("../scripts/llm");
      const urls = [];
      const fetchImpl = async (url) => {
        urls.push(url);
        return ok(completion('{"ok":true}'))();
      };
      const answer = await chat({ messages: [{ role: "user", content: "hi" }], fetchImpl });
      assert.equal(answer.provider, "deepseek");
      assert.deepStrictEqual(urls, ["https://api.deepseek.com/chat/completions"]);
    },
  ));

test("a DeepSeek failure falls through to OpenRouter with the same prompt", () =>
  withKeys(
    { DEEPSEEK_API_KEY: "ds", OPENROUTER_API_KEY: "or" },
    async () => {
      const { chat } = require("../scripts/llm");
      const seen = [];
      const fetchImpl = async (url, options) => {
        seen.push({ url, body: JSON.parse(options.body) });
        if (url.includes("deepseek")) throw new Error("fetch failed");
        return ok(completion('{"ok":true}'))();
      };
      const answer = await chat({
        messages: [{ role: "user", content: "hi" }],
        schema: { name: "tags", schema: { type: "object" } },
        fetchImpl,
      });
      assert.equal(answer.provider, "openrouter");
      assert.equal(seen.length, 2);
      assert.equal(seen[0].body.messages[0].content, seen[1].body.messages[0].content);
    },
  ));

test("DeepSeek is asked for JSON, not for a schema it does not support", () =>
  withKeys({ DEEPSEEK_API_KEY: "ds" }, async () => {
    const { chat } = require("../scripts/llm");
    let body;
    const fetchImpl = async (url, options) => {
      body = JSON.parse(options.body);
      return ok(completion('{"ok":true}'))();
    };
    await chat({
      messages: [{ role: "user", content: "hi" }],
      schema: { name: "tags", schema: { type: "object" } },
      fetchImpl,
    });
    assert.deepStrictEqual(body.response_format, { type: "json_object" });
    assert.equal(body.reasoning_effort, "low");
    // JSON mode wants the word "json" somewhere in the conversation.
    assert.ok(
      body.messages.some((message) => /json/i.test(String(message.content))),
    );
  }));

test("OpenRouter is asked for the strict schema", () =>
  withKeys({ OPENROUTER_API_KEY: "or" }, async () => {
    const { chat } = require("../scripts/llm");
    let body;
    const fetchImpl = async (url, options) => {
      body = JSON.parse(options.body);
      return ok(completion('{"ok":true}'))();
    };
    const schema = { name: "tags", schema: { type: "object" } };
    await chat({ messages: [{ role: "user", content: "hi" }], schema, fetchImpl });
    assert.deepStrictEqual(body.response_format, {
      type: "json_schema",
      json_schema: schema,
    });
    assert.deepStrictEqual(body.reasoning, { enabled: false });
  }));

test("an empty answer is a failure, so the next provider is tried", () =>
  withKeys(
    { DEEPSEEK_API_KEY: "ds", OPENROUTER_API_KEY: "or" },
    async () => {
      const { chat } = require("../scripts/llm");
      const fetchImpl = async (url) => {
        if (url.includes("deepseek")) {
          return ok({
            usage: { prompt_tokens: 10, completion_tokens: 10 },
            choices: [
              { finish_reason: "length", message: { content: "", reasoning_content: "…" } },
            ],
          })();
        }
        return ok(completion('{"ok":true}'))();
      };
      const answer = await chat({ messages: [{ role: "user", content: "hi" }], fetchImpl });
      assert.equal(answer.provider, "openrouter");
    },
  ));

test("with no keys at all the call fails loudly rather than silently", () =>
  withKeys({}, async () => {
    const { chat, availableProviders } = require("../scripts/llm");
    assert.deepStrictEqual(availableProviders(), []);
    await assert.rejects(
      () => chat({ messages: [{ role: "user", content: "hi" }] }),
      /No model provider configured/,
    );
  }));

test("every provider failing names them all", () =>
  withKeys(
    { DEEPSEEK_API_KEY: "ds", OPENROUTER_API_KEY: "or" },
    async () => {
      const { chat } = require("../scripts/llm");
      await assert.rejects(
        () =>
          chat({
            messages: [{ role: "user", content: "hi" }],
            fetchImpl: async () => {
              throw new Error("network down");
            },
          }),
        (error) =>
          /DeepSeek: network down/.test(error.message) &&
          /OpenRouter: network down/.test(error.message),
      );
    },
  ));

test("DeepSeek's cost is estimated from its token usage", () =>
  withKeys({ DEEPSEEK_API_KEY: "ds" }, async () => {
    const { chat } = require("../scripts/llm");
    const answer = await chat({
      messages: [{ role: "user", content: "hi" }],
      fetchImpl: ok(completion('{"ok":true}')),
    });
    // 100 prompt + 20 completion tokens at the published per-million rates.
    assert.ok(answer.cost > 0);
    assert.ok(answer.cost < 0.001);
  }));

test("a fenced JSON answer is unwrapped", () =>
  withKeys({ DEEPSEEK_API_KEY: "ds" }, async () => {
    const { chat } = require("../scripts/llm");
    const answer = await chat({
      messages: [{ role: "user", content: "hi" }],
      fetchImpl: ok(completion('```json\n{"ok":true}\n```')),
    });
    assert.equal(answer.content, '{"ok":true}');
  }));

test("an answer keyed by index is still one row per listing", () => {
  const { indexedResults } = require("../scripts/llm");
  // DeepSeek's json_object mode answers this way rather than with `results`.
  const keyed = '{"0":{"from":14,"to":43.5},"1":{"from":9}}';
  assert.deepStrictEqual(indexedResults(keyed, 2), [
    { index: 0, from: 14, to: 43.5 },
    { index: 1, from: 9 },
  ]);
});

test("a bare array, a results envelope and a readings envelope all read", () => {
  const { indexedResults } = require("../scripts/llm");
  assert.deepStrictEqual(indexedResults('[{"index":0,"form":"play"}]', 1), [
    { index: 0, form: "play" },
  ]);
  assert.deepStrictEqual(
    indexedResults('{"results":[{"index":0,"form":"play"}]}', 1),
    [{ index: 0, form: "play" }],
  );
  assert.deepStrictEqual(
    indexedResults('{"readings":[{"index":0,"from":5}]}', 1),
    [{ index: 0, from: 5 }],
  );
});

test("a single unwrapped answer is read, but a missing row is not invented", () => {
  const { indexedResults } = require("../scripts/llm");
  assert.deepStrictEqual(indexedResults('{"from":14}', 1), [{ index: 0, from: 14 }]);
  // Two listings, one answer: one row, and the callers' index check fails it.
  assert.strictEqual(indexedResults('[{"index":0}]', 2).length, 1);
});

test("an answer that is not JSON, or not a list, is an error", () => {
  const { indexedResults } = require("../scripts/llm");
  assert.throws(() => indexedResults("not json", 1), /not JSON/);
  assert.throws(() => indexedResults('{"a":"b","c":"d"}', 2), /not a list/);
});

test("the schema is spelled out for the provider that cannot enforce it", () => {
  const { shapeText } = require("../scripts/llm");
  const shape = shapeText({
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: { type: "integer" },
            form: { type: "string", enum: ["play", "musical"] },
            inScope: { type: "boolean" },
          },
          required: ["index", "form", "inScope"],
        },
      },
    },
    required: ["results"],
  });
  assert.strictEqual(
    shape,
    '{"results": [{"index": <integer>, "form": "play" | "musical", "inScope": <true or false>}]}',
  );
});

test("DeepSeek is told the exact property names, not just 'json'", () =>
  withKeys({ DEEPSEEK_API_KEY: "ds" }, async () => {
    const { chat } = require("../scripts/llm");
    let body;
    await chat({
      messages: [{ role: "user", content: "hi" }],
      schema: {
        name: "tags",
        schema: {
          type: "object",
          properties: {
            results: {
              type: "array",
              items: {
                type: "object",
                properties: { index: { type: "integer" }, form: { type: "string" } },
                required: ["index", "form"],
              },
            },
          },
          required: ["results"],
        },
      },
      fetchImpl: async (url, options) => {
        body = JSON.parse(options.body);
        return ok(completion('{"results":[]}'))();
      },
    });
    const reminder = body.messages[body.messages.length - 1].content;
    assert.match(reminder, /"form"/);
    assert.match(reminder, /do not rename any key/);
  }));
