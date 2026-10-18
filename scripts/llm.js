/**
 * Who answers, and who pays for it.
 *
 * Three passes in the refresh ask a cheap model a question — what art form a
 * listing is, what its ticket wording means, how its artwork should be cropped.
 * All three used to call OpenRouter and nothing else.
 *
 * DeepSeek is now called directly first, and OpenRouter is the fallback. The
 * same model family serves both, so a listing read on one is read the same way
 * on the other; the difference is the transport. If DeepSeek has no key, times
 * out, rate-limits or answers nonsense, the request goes to OpenRouter with the
 * same prompt and the same schema, and the pass carries on.
 *
 * The two APIs are not identical, and pretending otherwise is how a fallback
 * quietly stops working:
 *
 *   DeepSeek has no strict JSON-schema mode, only `json_object`, so the shape
 *   is described in the prompt (it already is) and validated on the way back —
 *   which every caller does anyway, and did before.
 *
 *   The model reasons by default. `reasoning_effort: "low"` turns that off;
 *   without it a small answer can be eaten by reasoning tokens and come back
 *   empty with `finish_reason: "length"`.
 *
 *   OpenRouter reports what a request cost; DeepSeek reports tokens only, so
 *   its cost is estimated from the published per-million rates below.
 *
 * Failing open is the rule everywhere else in the refresh and it is the rule
 * here: no key at all on either provider gives `null`, and every caller falls
 * back to its deterministic reading rather than breaking a build.
 */
"use strict";

/** The reader's identity for cache keys: the model family, not the transport.
    A cached verdict stays valid when the request moves between providers. */
const READER_ID = process.env.READER_ID || "deepseek-v4";

/**
 * DeepSeek publishes per-million-token rates rather than a bill per request.
 * These are the published figures for the flash model; override with
 * DEEPSEEK_INPUT_USD_PER_MTOK / DEEPSEEK_OUTPUT_USD_PER_MTOK if they change.
 * The number only feeds the morning email's spend line.
 */
const DEEPSEEK_INPUT_USD_PER_MTOK = Number(
  process.env.DEEPSEEK_INPUT_USD_PER_MTOK ?? 0.28,
);
const DEEPSEEK_OUTPUT_USD_PER_MTOK = Number(
  process.env.DEEPSEEK_OUTPUT_USD_PER_MTOK ?? 0.42,
);

/**
 * The providers to try, in order. A provider with no key is skipped.
 *
 * `prepare` shapes one request for the provider: the body a caller builds is
 * the portable part (messages, temperature, max_tokens), and everything
 * provider-specific is added here so the callers never branch on who answers.
 */
const PROVIDERS = [
  {
    id: "deepseek",
    label: "DeepSeek",
    key: () => process.env.DEEPSEEK_API_KEY,
    url: () =>
      process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/chat/completions",
    model: () => process.env.DEEPSEEK_MODEL || "deepseek-flash",
    prepare: (body, schema) => ({
      ...body,
      // No strict schema mode: the prompt already describes the shape and
      // every caller validates the answer before it is used.
      ...(schema
        ? {
            response_format: { type: "json_object" },
            messages: withJsonReminder(body.messages, schema),
          }
        : {}),
      // This model reasons by default, and a reasoned answer costs tokens for
      // a judgement that does not need them.
      reasoning_effort: process.env.DEEPSEEK_REASONING_EFFORT || "low",
    }),
    cost: (usage) =>
      ((usage.prompt_tokens || 0) / 1e6) * DEEPSEEK_INPUT_USD_PER_MTOK +
      ((usage.completion_tokens || 0) / 1e6) * DEEPSEEK_OUTPUT_USD_PER_MTOK,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    key: () => process.env.OPENROUTER_API_KEY,
    url: () => "https://openrouter.ai/api/v1/chat/completions",
    model: () => process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-flash",
    prepare: (body, schema) => ({
      ...body,
      ...(schema
        ? { response_format: { type: "json_schema", json_schema: schema } }
        : {}),
      reasoning: { enabled: false },
    }),
    // OpenRouter bills per request and says so in the usage block.
    cost: (usage) => (typeof usage.cost === "number" ? usage.cost : 0),
  },
];

/**
 * A plain-language sketch of the schema, for the provider that cannot enforce
 * it. Built from the schema itself rather than hand-written per caller, so the
 * reminder cannot drift from the contract it describes.
 */
function shapeText(node) {
  if (!node || typeof node !== "object") return "value";
  if (node.type === "array") {
    return `[${node.items ? shapeText(node.items) : ""}]`;
  }
  if (node.type === "object" || node.properties) {
    const required = Array.isArray(node.required)
      ? node.required
      : Object.keys(node.properties || {});
    const fields = required.map(
      (key) => `"${key}": ${shapeText((node.properties || {})[key])}`,
    );
    return `{${fields.join(", ")}}`;
  }
  if (Array.isArray(node.type)) {
    return node.type.map((type) => shapeText({ ...node, type })).join(" or ");
  }
  if (Array.isArray(node.enum)) return node.enum.map((value) => `"${value}"`).join(" | ");
  switch (node.type) {
    case "string":
      return '"<text>"';
    case "number":
      return "<number>";
    case "integer":
      return "<integer>";
    case "boolean":
      return "<true or false>";
    default:
      return "value";
  }
}

/**
 * JSON mode wants the word "json" somewhere in the conversation, and it does
 * not enforce the property names the schema asks for — asked for `form`, the
 * model answered `type`, and every verdict was then discarded as invalid.
 *
 * So the exact shape is spelled out too, and the word "json" is guaranteed.
 */
function withJsonReminder(messages, schema) {
  if (!Array.isArray(messages)) return messages;
  const shape = schema ? shapeText(schema.schema || schema) : null;
  const lines = [
    shape
      ? `Reply with one JSON object and nothing else, with exactly these keys:\n${shape}`
      : "Reply with one JSON object and nothing else.",
    shape && /results/.test(shape)
      ? "One entry per listing, in the order the listings were given, and do not rename any key."
      : null,
  ].filter(Boolean);
  return [...messages, { role: "system", content: lines.join("\n") }];
}

/**
 * The rows a model answered with, whatever envelope it used.
 *
 * DeepSeek has no strict-schema mode, so `{"results": [...]}` is a request, not
 * a guarantee. The same prompt and the same schema come back as a bare array,
 * as `{"results": [...]}`, or — most often — as an object keyed by index:
 * `{"0": {...}, "1": {...}}`. All three carry the same answer, so all three are
 * read rather than the batch being thrown away and re-asked.
 *
 * A row with no index is numbered in the order it arrived, which is the order
 * the listing was put in. What is not repaired is a *missing* row: the callers
 * still check that every index came back, because a partial answer used to
 * pass silently and cost twelve listings their classification.
 */
function indexedResults(content, count) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Response was not JSON");
  }

  let rows = null;
  if (Array.isArray(parsed)) {
    rows = parsed;
  } else if (parsed && Array.isArray(parsed.results)) {
    rows = parsed.results;
  } else if (parsed && Array.isArray(parsed.readings)) {
    rows = parsed.readings;
  } else if (parsed && typeof parsed === "object") {
    const values = Object.values(parsed);
    if (
      values.length &&
      values.every((value) => value && typeof value === "object" && !Array.isArray(value))
    ) {
      // Keyed by index, or by something else in the order the answers came.
      rows = values.map((value, index) => ({ index, ...value }));
    } else if (count === 1) {
      // A single listing can come back as the answer itself, unwrapped.
      rows = [parsed];
    }
  }

  if (!Array.isArray(rows)) throw new Error("Response was not a list of answers");
  if (rows.every((row) => row && row.index == null)) {
    rows = rows.map((row, index) => ({ index, ...row }));
  }
  return rows;
}

/**
 * The providers that have a key, in order. Empty when nothing is configured.
 * Pass ids to pin a call to particular providers.
 */
function availableProviders(ids = null) {
  return PROVIDERS.filter(
    (provider) => Boolean(provider.key()) && (!ids || ids.includes(provider.id)),
  );
}

/** What the next call will actually use, for a log line or the usage file. */
function describeProviders() {
  const ready = availableProviders();
  if (!ready.length) return "no provider configured";
  return ready.map((provider) => `${provider.label} (${provider.model()})`).join(" → ");
}

const stripFences = (text) =>
  String(text || "")
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();

/**
 * Ask one question and get one answer, from whichever provider will give it.
 *
 * Returns `{ content, provider, model, cost, promptTokens, completionTokens }`,
 * where `content` is the raw text the caller then parses and validates. Throws
 * only when every configured provider has failed, and the message names them
 * all so a morning report says which one broke.
 */
async function chat({
  messages,
  schema = null,
  temperature = 0,
  maxTokens = 2000,
  timeout = 60000,
  // Per-provider model overrides, for a pass that needs something other than
  // the default — reading artwork needs a model that can see an image.
  models = null,
  fetchImpl = globalThis.fetch,
  providers = availableProviders(),
} = {}) {
  if (!providers.length) {
    throw new Error(
      "No model provider configured (set DEEPSEEK_API_KEY or OPENROUTER_API_KEY)",
    );
  }

  const failures = [];
  for (const provider of providers) {
    const model = (models && models[provider.id]) || provider.model();
    const body = provider.prepare(
      { model, messages, temperature, max_tokens: maxTokens },
      schema,
    );

    try {
      const response = await fetchImpl(provider.url(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${provider.key()}`,
          "Content-Type": "application/json",
          // OpenRouter attributes traffic with these; DeepSeek ignores them.
          "HTTP-Referer": "https://glasgowtheatre.com",
          "X-Title": "Glasgow Theatre",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status}: ${detail.slice(0, 160)}`);
      }

      const payload = await response.json();
      if (payload.error) {
        throw new Error(payload.error.message || "API error");
      }

      const choice = payload.choices?.[0];
      const content = stripFences(choice?.message?.content);
      if (!content) {
        throw new Error(
          choice?.finish_reason === "length"
            ? "Response truncated before the model finished"
            : "Empty response from model",
        );
      }
      if (choice.finish_reason === "length") {
        throw new Error("Response truncated before the model finished");
      }

      const usage = payload.usage || {};
      return {
        content,
        provider: provider.id,
        model: payload.model || provider.model(),
        cost: provider.cost(usage),
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
      };
    } catch (error) {
      failures.push(`${provider.label}: ${error.message}`);
      // A truncated answer is the one failure worth retrying on the same
      // provider on the next call; here it just means try the other one.
    }
  }

  throw new Error(`Every model provider failed — ${failures.join("; ")}`);
}

module.exports = {
  READER_ID,
  indexedResults,
  shapeText,
  PROVIDERS,
  availableProviders,
  describeProviders,
  chat,
};
