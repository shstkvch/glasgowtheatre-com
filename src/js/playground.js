/**
 * The /api/examples.html playground.
 *
 * The browser fetches a small snapshot from this site's own API and sends it
 * to the sandbox as stdin. That keeps the example programs simple, works
 * without the sandbox having network access, and makes the same files usable
 * locally with `curl | node`.
 */
(function () {
  "use strict";

  const examples = Array.isArray(window.API_EXAMPLES) ? window.API_EXAMPLES : [];
  if (!examples.length) return;
  const byKey = new Map(examples.map((example) => [example.key, example]));
  const editor = document.getElementById("api-code");
  const output = document.getElementById("api-output");
  const status = document.getElementById("api-run-status");
  const runButton = document.getElementById("api-run");
  const resetButton = document.getElementById("api-reset");
  const clearButton = document.getElementById("api-clear");
  const tabs = [...document.querySelectorAll(".lang-tab")];
  if (!editor || !output || !status || !runButton) return;

  const drafts = new Map();
  const storageKey = (key) => `glasgowtheatre-api-example:${key}`;
  let current = examples[0].key;
  let busy = false;
  let cooldownUntil = 0;

  const readDraft = (key) => {
    if (drafts.has(key)) return drafts.get(key);
    try {
      const saved = window.localStorage.getItem(storageKey(key));
      if (saved != null) return saved;
    } catch {
      /* private mode, or storage disabled */
    }
    return byKey.get(key).source;
  };

  const saveDraft = (key, value) => {
    drafts.set(key, value);
    try {
      window.localStorage.setItem(storageKey(key), value);
    } catch {
      /* not important */
    }
  };

  const say = (message) => {
    status.textContent = message;
  };

  const setBusy = (value) => {
    busy = value;
    runButton.disabled = value;
    runButton.textContent = value ? "Running…" : "Run code ↗";
  };

  const setLanguage = (key) => {
    if (!byKey.has(key)) return;
    saveDraft(current, editor.value);
    current = key;
    for (const tab of tabs) {
      const active = tab.dataset.lang === key;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-pressed", String(active));
    }
    const example = byKey.get(key);
    editor.value = readDraft(key);
    say(`Ready. Uses ${example.label} ${example.runtime}.`);
    updateCount();
  };

  const updateCount = () => {
    const lines = editor.value.split("\n").length;
    const counter = document.getElementById("api-code-count");
    if (counter) counter.textContent = `${lines} lines`;
  };

  const encode = (value) => {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  };

  const decode = (value) => {
    if (!value) return "";
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    return new TextDecoder().decode(bytes);
  };

  const clearOutput = () => {
    output.textContent = "Press Run to see the result.";
    output.classList.remove("has-output", "has-error");
  };

  const showResult = (result, example) => {
    const compileOutput = decode(result.compile_output);
    const stdout = decode(result.stdout);
    const stderr = decode(result.stderr);
    const message = decode(result.message);
    const parts = [];
    if (compileOutput) parts.push(compileOutput.trimEnd());
    if (stdout) parts.push(stdout.trimEnd());
    if (stderr) parts.push(stderr.trimEnd());
    if (message && !parts.length) parts.push(message);
    if (!parts.length) {
      parts.push(
        result.status?.description
          ? `Finished (${result.status.description}) with no output.`
          : "Finished with no output.",
      );
    }
    output.textContent = parts.join("\n\n");
    output.classList.add("has-output");
    const failed =
      result.status && ![3, 4].includes(result.status.id) // 3 accepted, 4 wrong answer
        ? true
        : Boolean(stderr || compileOutput || message);
    output.classList.toggle("has-error", failed);
    const facts = [
      result.status?.description,
      result.time ? `${result.time}s` : null,
      result.memory ? `${Math.round(result.memory / 1024)} MB` : null,
    ].filter(Boolean);
    say(`${example.label}: ${facts.join(" · ") || "finished"}.`);
  };

  const run = async () => {
    if (busy) return;
    const wait = cooldownUntil - Date.now();
    if (wait > 0) {
      say(`Please wait ${Math.ceil(wait / 1000)}s before running again.`);
      return;
    }
    const example = byKey.get(current);
    saveDraft(current, editor.value);
    setBusy(true);
    output.textContent = "";
    output.classList.remove("has-output", "has-error");
    say(`Fetching the API snapshot, then compiling ${example.label}…`);

    try {
      const format = example.stdin === "txt" ? "txt" : "json";
      const previewUrl = `${window.API_PREVIEW}.${format}`;
      const preview = await fetch(previewUrl, {
        headers: { Accept: format === "txt" ? "text/plain" : "application/json" },
      });
      if (!preview.ok) {
        throw new Error(`The API snapshot returned ${preview.status}.`);
      }
      const stdin = await preview.text();
      const runner =
        window.API_RUNNER ||
        "https://ce.judge0.com/submissions?base64_encoded=true&wait=true";
      const response = await fetch(runner, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_code: encode(editor.value),
          language_id: example.id,
          stdin: encode(stdin),
          cpu_time_limit: example.key === "go" ? 10 : 5,
          wall_time_limit: example.key === "go" ? 20 : 12,
          memory_limit: 256000,
        }),
      });
      if (!response.ok) {
        if (response.status === 429) {
          throw new Error(
            "The public sandbox is rate limiting requests. Wait a moment, or run the example locally.",
          );
        }
        const detail = await response.text();
        throw new Error(
          `The sandbox returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}.`,
        );
      }
      const result = await response.json();
      showResult(result, example);
    } catch (error) {
      output.textContent =
        `${error.message}\n\n` +
        "You can always run the same file locally:\n" +
        `  curl -s '${window.API_PREVIEW}.${example.stdin === "txt" ? "txt" : "json"}' | ${example.key === "c" ? "./shows" : example.key === "javascript" ? "node shows.js" : example.key === "python" ? "python3 shows.py" : example.key === "php" ? "php shows.php" : "go run ."}`;
      output.classList.add("has-output", "has-error");
      say("Could not run the example.");
    } finally {
      setBusy(false);
      cooldownUntil = Date.now() + 2500;
      updateCount();
    }
  };

  for (const tab of tabs) {
    tab.addEventListener("click", () => setLanguage(tab.dataset.lang));
  }
  editor.addEventListener("input", updateCount);
  editor.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText("  ", start, end, "end");
    saveDraft(current, editor.value);
    updateCount();
  });
  runButton.addEventListener("click", run);
  resetButton.addEventListener("click", () => {
    const example = byKey.get(current);
    drafts.set(current, example.source);
    try {
      window.localStorage.removeItem(storageKey(current));
    } catch {
      /* ignore */
    }
    editor.value = example.source;
    say(`Reset to the original ${example.label} example.`);
    updateCount();
  });
  if (clearButton) clearButton.addEventListener("click", clearOutput);

  setLanguage(current);
  clearOutput();
})();
