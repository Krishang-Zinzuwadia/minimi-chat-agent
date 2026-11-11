/* A tiny SSE decoder: keep partial lines and decode UTF-8 across network chunks. */
function createSSEParser(onEvent) {
  let buffer = "",
    event = "message",
    data = [];
  function line(value) {
    if (!value) {
      if (data.length) onEvent(event, JSON.parse(data.join("\n")));
      event = "message";
      data = [];
      return;
    }
    if (value.startsWith(":")) return;
    const colon = value.indexOf(":");
    const field = colon < 0 ? value : value.slice(0, colon);
    let content = colon < 0 ? "" : value.slice(colon + 1);
    if (content.startsWith(" ")) content = content.slice(1);
    if (field === "event") event = content;
    if (field === "data") data.push(content);
  }
  return {
    push(chunk) {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        line(buffer.slice(0, end).replace(/\r$/, ""));
        buffer = buffer.slice(end + 1);
      }
    },
    finish() {
      if (buffer) line(buffer.replace(/\r$/, ""));
      buffer = "";
      line("");
    },
  };
}
function safeSourceURL(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
if (typeof module !== "undefined")
  module.exports = { createSSEParser, safeSourceURL };
if (typeof document !== "undefined") {
  const $ = (id) => document.getElementById(id);
  const state = {
    conversation: null,
    pending: false,
    controller: null,
    loading: false,
  };
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function formatTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? "Time unavailable"
      : date.toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
  }
  function error(message) {
    $("error").textContent = message || "";
    $("error").hidden = !message;
  }
  function activity(message) {
    $("activity").textContent = message;
  }
  function scroll() {
    $("thread").scrollTop = $("thread").scrollHeight;
  }
  function controls() {
    const locked = state.pending || state.loading;
    $("new-chat").disabled = locked;
    $("send").disabled = locked;
    $("prompt").disabled = locked;
    $("stop").hidden = !state.pending;
    $("send").hidden = state.pending;
    $("activity").classList.toggle("busy", state.pending);
    document.querySelectorAll(".conversation,[data-prompt]").forEach((node) => {
      node.disabled = locked;
    });
  }
  async function request(path, options = {}) {
    const response = await fetch(path, options);
    if (!response.ok) {
      let details;
      try {
        const body = await response.json();
        details = body.error?.message || body.error || body.message;
      } catch {}
      throw new Error(
        typeof details === "string"
          ? details
          : `Request failed (${response.status}). Please try again.`,
      );
    }
    return response;
  }
  function showMessage(message) {
    $("welcome").hidden = true;
    const role = message.role === "user" ? "user" : "assistant";
    const article = el("article", `message ${role}`);
    const head = el("div", "message-head");
    head.append(
      el("span", "avatar", role === "user" ? "Y" : "r."),
      el("span", "", role === "user" ? "You" : "Recall"),
    );
    const time = el(
      "time",
      "",
      formatTime(message.createdAt || new Date().toISOString()),
    );
    if (message.createdAt) time.dateTime = message.createdAt;
    head.append(time);
    const body = el("div", "message-body", message.content || "");
    article.append(head, body);
    $("messages").append(article);
    if (message.sources?.length) {
      const sources = el("div", "sources");
      for (const source of message.sources) {
        const url = safeSourceURL(source.url);
        if (!url) continue;
        const citation = source.id ? `[${source.id}] ` : "";
        const link = el(
          "a",
          "source",
          citation + (source.title || new URL(url).hostname),
        );
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        const provenance = source.historical
          ? "Historical snapshot"
          : "Current source";
        link.append(
          el(
            "small",
            "",
            provenance +
              (source.retrievedAt
                ? ` · Retrieved ${formatTime(source.retrievedAt)}`
                : ""),
          ),
        );
        sources.append(link);
      }
      article.append(sources);
    }
    const metadata = message.metadata || {};
    const dates = metadata.memoryDates || metadata.memory?.dates;
    const count = metadata.memoryCount ?? metadata.memory?.count;
    if (Number.isFinite(count) && count > 0) memoryNote(article, count, dates);
    return { article, body };
  }
  function memoryNote(article, count, dates) {
    let note = article.querySelector(".provenance");
    if (!note) {
      note = el("div", "provenance");
      article.append(note);
    }
    note.textContent = `Context: ${count} earlier ${count === 1 ? "memory" : "memories"}${Array.isArray(dates) && dates.length ? " · " + [...new Set(dates.map(String))].join(" / ") : ""}`;
  }
  async function history() {
    const items = await (await request("/api/conversations")).json();
    $("conversations").replaceChildren();
    if (!items.length)
      $("conversations").append(
        el("p", "empty-history", "Your next thought starts here."),
      );
    for (const conversation of items) {
      const button = el(
        "button",
        `conversation${conversation.id === state.conversation ? " active" : ""}`,
      );
      button.type = "button";
      button.append(
        el("span", "", conversation.title || "New conversation"),
        el(
          "time",
          "",
          formatTime(conversation.updatedAt || conversation.createdAt),
        ),
      );
      button.setAttribute(
        "aria-current",
        conversation.id === state.conversation ? "page" : "false",
      );
      button.addEventListener("click", () => open(conversation.id));
      $("conversations").append(button);
    }
    controls();
    return items;
  }
  async function open(id) {
    if (state.pending || state.loading) return;
    state.loading = true;
    controls();
    error("");
    try {
      const data = await (
        await request(`/api/conversations/${encodeURIComponent(id)}`)
      ).json();
      state.conversation = id;
      $("messages").replaceChildren();
      $("welcome").hidden = data.messages.length > 0;
      data.messages.forEach(showMessage);
      await history();
      activity("Conversation loaded.");
      scroll();
    } catch (err) {
      error(`Couldn't load this conversation. ${err.message}`);
    } finally {
      state.loading = false;
      controls();
    }
  }
  $("new-chat").addEventListener("click", () => {
    if (state.pending || state.loading) return;
    state.conversation = null;
    $("messages").replaceChildren();
    $("welcome").hidden = false;
    error("");
    document.querySelectorAll(".conversation").forEach((node) => {
      node.classList.remove("active");
      node.setAttribute("aria-current", "false");
    });
    activity("A fresh conversation. Earlier context is still available.");
    $("prompt").focus();
  });
  $("stop").addEventListener("click", () => state.controller?.abort());
  document.querySelectorAll("[data-prompt]").forEach((button) =>
    button.addEventListener("click", () => {
      $("prompt").value = button.dataset.prompt;
      $("prompt").focus();
      resize();
    }),
  );
  function resize() {
    $("prompt").style.height = "auto";
    $("prompt").style.height = `${Math.min($("prompt").scrollHeight, 160)}px`;
  }
  $("prompt").addEventListener("input", resize);
  $("prompt").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      $("composer").requestSubmit();
    }
  });
  $("composer").addEventListener("submit", async (event) => {
    event.preventDefault();
    const draft = $("prompt").value.trim();
    if (!draft || state.pending || state.loading) return;
    state.pending = true;
    state.controller = new AbortController();
    controls();
    error("");
    activity("Getting your context…");
    let provisional,
      userMessage,
      done = false,
      memory = null,
      streamError = null;
    try {
      if (!state.conversation) {
        const conversation = await (
          await request("/api/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
            signal: state.controller.signal,
          })
        ).json();
        state.conversation = conversation.id;
      }
      userMessage = showMessage({ role: "user", content: draft });
      provisional = showMessage({ role: "assistant", content: "" });
      $("prompt").value = "";
      resize();
      scroll();
      const response = await request("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: state.conversation,
          message: draft,
          timezone,
        }),
        signal: state.controller.signal,
      });
      if (!response.body)
        throw new Error("Streaming is not available in this browser.");
      const parser = createSSEParser((type, data) => {
        if (done) return;
        if (type === "status") activity(data.message || "Working…");
        if (type === "memory") {
          memory = data;
          if (data.count > 0)
            memoryNote(provisional.article, data.count, data.dates);
        }
        if (type === "delta") {
          provisional.body.textContent += data.text || "";
          scroll();
        }
        if (type === "error")
          streamError = new Error(
            data.message || "The response could not be completed.",
          );
        if (type === "done") {
          done = true;
          provisional.article.remove();
          const saved = showMessage(data.message);
          if (memory?.count > 0 && !saved.article.querySelector(".provenance"))
            memoryNote(saved.article, memory.count, memory.dates);
          const seconds = Number(data.metrics?.durationMs);
          activity(
            Number.isFinite(seconds)
              ? `Complete · ${(seconds / 1000).toFixed(1)}s · ${data.metrics?.searches || 0} web searches`
              : "Complete.",
          );
          scroll();
        }
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          parser.push(decoder.decode(chunk.value, { stream: true }));
          if (streamError) throw streamError;
        }
        parser.push(decoder.decode());
        parser.finish();
      } finally {
        reader.releaseLock();
      }
      if (streamError) throw streamError;
      if (!done)
        throw new Error(
          "The connection ended before the response completed. Your draft is available below.",
        );
    } catch (err) {
      if (!done) {
        $("prompt").value = draft;
        resize();
        if (provisional) {
          provisional.article.classList.add("stopped");
          if (!provisional.body.textContent) provisional.article.remove();
          else
            provisional.article.append(
              el(
                "div",
                "provenance",
                "Incomplete response · not a final answer",
              ),
            );
        }
        if (err.name === "AbortError")
          activity("Stopped. Your draft is ready to edit or resend.");
        else {
          error(
            err.message || "Could not connect. Check the server and try again.",
          );
          activity("Response interrupted. Your draft was preserved.");
        }
      }
    } finally {
      state.pending = false;
      state.controller = null;
      controls();
      $("prompt").focus();
      try {
        await history();
      } catch {
        error(
          "Conversation history could not refresh. Your messages remain visible.",
        );
      }
    }
  });
  (async () => {
    try {
      const status = await (await request("/api/status")).json();
      $("mode").textContent =
        status.mode === "demo"
          ? "Offline demo • no live search"
          : "Live · web search enabled";
      $("mode").title =
        `${status.model || "Local agent"} · ${status.timezone || timezone}`;
      $("demo-banner").hidden = status.mode !== "demo";
    } catch (err) {
      $("mode").textContent = "Server unavailable";
      error(`Couldn't connect to Recall. ${err.message}`);
    }
    try {
      await history();
    } catch (err) {
      error(`Couldn't load conversation history. ${err.message}`);
    }
  })();
}
