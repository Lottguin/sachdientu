/*
  CHAT AI – nút nổi ở góc phải + khung trò chuyện.
  Cấu hình (tuỳ chọn) bằng cách khai báo TRƯỚC khi nạp file này:

    window.CHAT_CONFIG = { endpoint: "http://localhost:3000/api/chat" };

  Lưu ý: KHÔNG đặt API key trong file này. Key nằm ở máy chủ (chat-server.js).
*/
(function () {
  const cfg = Object.assign(
    {
      endpoint: "/api/chat",
      title: "Trợ lý Hóa học",
      subtitle: "Hỏi về nội dung trong sách",
      greeting:
        "Chào bạn! Mình là trợ lý AI của cuốn sách này. Bạn cần giải thích phần nào về kim loại, hợp kim hay ăn mòn?",
      suggestions: [
        "Vì sao thuỷ ngân là kim loại ở thể lỏng?",
        "Cryolite có vai trò gì khi điện phân Al₂O₃?",
        "Phân biệt ăn mòn hoá học và ăn mòn điện hoá",
      ],
      maxHistory: 12,
      timeoutMs: 45000,
    },
    window.CHAT_CONFIG || {},
  );

  const history = []; // [{role, content}] chỉ gồm các lượt đã có phản hồi
  let busy = false;
  let cooling = false; // đang trong thời gian chờ sau khi hết lượt
  let coolTimer = null;

  /* ---------- Dựng giao diện ---------- */
  const root = document.createElement("div");
  root.className = "ai-chat";
  root.innerHTML = `
    <section class="ai-chat__panel" id="ai-chat-panel" role="dialog"
             aria-label="${cfg.title}" aria-hidden="true">
      <header class="ai-chat__header">
        <div class="ai-chat__title">
          <strong>${cfg.title}</strong>
          <span>${cfg.subtitle}</span>
        </div>
        <button type="button" class="ai-chat__reset" title="Xoá cuộc trò chuyện" aria-label="Xoá cuộc trò chuyện">
          <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5"/></svg>
        </button>
        <button type="button" class="ai-chat__close" title="Đóng" aria-label="Đóng khung chat">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </header>
      <div class="ai-chat__messages" aria-live="polite"></div>
      <form class="ai-chat__form" autocomplete="off">
        <textarea rows="1" placeholder="Nhập câu hỏi của bạn…" aria-label="Câu hỏi"></textarea>
        <button type="submit" class="ai-chat__send" title="Gửi" aria-label="Gửi">
          <svg viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
        </button>
      </form>
    </section>

    <button type="button" class="ai-chat__fab" aria-expanded="false"
            aria-controls="ai-chat-panel" title="Trò chuyện với AI" aria-label="Mở khung chat AI">
      <svg class="icon-chat" viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M9 11h6M9 14h3"/></svg>
      <svg class="icon-close" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
  `;
  document.body.appendChild(root);

  const fab = root.querySelector(".ai-chat__fab");
  const panel = root.querySelector(".ai-chat__panel");
  const list = root.querySelector(".ai-chat__messages");
  const form = root.querySelector(".ai-chat__form");
  const input = form.querySelector("textarea");
  const sendBtn = form.querySelector(".ai-chat__send");

  /* ---------- Hiển thị tin nhắn ---------- */
  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Markdown rút gọn: **đậm**, `code`, danh sách gạch đầu dòng / số
  function renderMarkdown(text) {
    const inline = (s) =>
      s
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/`([^`]+)`/g, "<code>$1</code>");

    let html = "";
    let inList = false;
    let para = [];

    const flushPara = () => {
      if (para.length) {
        html += "<p>" + inline(para.join("<br>")) + "</p>";
        para = [];
      }
    };
    const closeList = () => {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
    };

    escapeHtml(text)
      .split("\n")
      .forEach((line) => {
        const li = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
        if (li) {
          flushPara();
          if (!inList) {
            html += "<ul>";
            inList = true;
          }
          html += "<li>" + inline(li[1]) + "</li>";
        } else if (line.trim() === "") {
          flushPara();
          closeList();
        } else {
          closeList();
          para.push(line);
        }
      });
    flushPara();
    closeList();
    return html;
  }

  function scrollToBottom() {
    list.scrollTop = list.scrollHeight;
  }

  function addMessage(role, text) {
    const el = document.createElement("div");
    el.className = "ai-msg ai-msg--" + role;
    if (role === "bot") el.innerHTML = renderMarkdown(text);
    else el.textContent = text;
    list.appendChild(el);
    scrollToBottom();
    return el;
  }

  function addTyping() {
    const el = document.createElement("div");
    el.className = "ai-msg ai-msg--bot";
    el.innerHTML =
      '<span class="ai-typing" aria-label="AI đang trả lời"><i></i><i></i><i></i></span>';
    list.appendChild(el);
    scrollToBottom();
    return el;
  }

  function showWelcome() {
    addMessage("bot", cfg.greeting);
    if (!cfg.suggestions.length) return;

    const box = document.createElement("div");
    box.className = "ai-chat__suggest";
    cfg.suggestions.forEach((q) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = q;
      b.addEventListener("click", () => {
        box.remove();
        send(q);
      });
      box.appendChild(b);
    });
    list.appendChild(box);
  }

  /* ---------- Gửi câu hỏi ---------- */
  function setBusy(state) {
    busy = state;
    sendBtn.disabled = busy || cooling;
  }

  // Khoá nút gửi và đếm ngược khi AI hết lượt / quá tải
  function startCooldown(seconds) {
    clearInterval(coolTimer);
    cooling = true;
    sendBtn.disabled = true;
    const normalHint = "Nhập câu hỏi của bạn…";
    let left = Math.max(1, Math.round(seconds));

    const tick = () => {
      if (left <= 0) {
        clearInterval(coolTimer);
        cooling = false;
        input.placeholder = normalHint;
        sendBtn.disabled = busy;
        return;
      }
      input.placeholder = "Vui lòng đợi " + left + " giây rồi hỏi tiếp…";
      left--;
    };
    tick();
    coolTimer = setInterval(tick, 1000);
  }

  async function send(text) {
    text = text.trim();
    if (!text || busy || cooling) return;

    const suggest = list.querySelector(".ai-chat__suggest");
    if (suggest) suggest.remove();

    // Nhắc khi chưa thay địa chỉ mẫu trong sachdientu.html
    if (/TEN-WORKER|TEN-BAN/.test(cfg.endpoint)) {
      addMessage("user", text);
      input.value = "";
      autosize();
      addMessage(
        "error",
        "Chưa cấu hình AI: hãy thay địa chỉ endpoint mẫu trong sachdientu.html bằng địa chỉ Worker của bạn.",
      );
      return;
    }

    addMessage("user", text);
    input.value = "";
    autosize();
    setBusy(true);
    const typing = addTyping();

    const payload = history
      .concat({ role: "user", content: text })
      .slice(-cfg.maxHistory);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

    try {
      const res = await fetch(cfg.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payload }),
        signal: controller.signal,
      });

      let data = {};
      try {
        data = await res.json();
      } catch (_) {}

      if (!res.ok || !data.reply) {
        const e = new Error(data.error || "Máy chủ trả về lỗi " + res.status + ".");
        e.code = data.code; // quota | busy | rate
        e.retryAfter = data.retryAfter;
        throw e;
      }

      history.push({ role: "user", content: text });
      history.push({ role: "assistant", content: data.reply });
      typing.remove();
      addMessage("bot", data.reply);
    } catch (err) {
      typing.remove();

      // Hết lượt / quá tải: báo nhẹ nhàng, đếm ngược, trả câu hỏi về ô nhập để gửi lại
      if (err.code === "quota" || err.code === "busy" || err.code === "rate") {
        addMessage("notice", err.message);
        input.value = text;
        autosize();
        startCooldown(err.retryAfter || 60);
        return;
      }

      const msg =
        err.name === "AbortError"
          ? "AI phản hồi quá lâu. Bạn thử gửi lại nhé."
          : err instanceof TypeError
            ? "Không kết nối được máy chủ chat. Hãy kiểm tra mạng, và địa chỉ endpoint trong sachdientu.html đã đúng với địa chỉ Worker của bạn chưa."
            : err.message;
      addMessage("error", msg);
    } finally {
      clearTimeout(timer);
      setBusy(false);
      input.focus();
    }
  }

  /* ---------- Mở / đóng ---------- */
  function setOpen(open) {
    root.classList.toggle("is-open", open);
    fab.setAttribute("aria-expanded", String(open));
    fab.setAttribute("aria-label", open ? "Đóng khung chat AI" : "Mở khung chat AI");
    panel.setAttribute("aria-hidden", String(!open));
    if (open) setTimeout(() => input.focus(), 150);
  }

  function resetChat() {
    history.length = 0;
    list.innerHTML = "";
    showWelcome();
  }

  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 110) + "px";
  }

  /* ---------- Sự kiện ---------- */
  fab.addEventListener("click", () =>
    setOpen(!root.classList.contains("is-open")),
  );
  root.querySelector(".ai-chat__close").addEventListener("click", () => {
    setOpen(false);
    fab.focus();
  });
  root.querySelector(".ai-chat__reset").addEventListener("click", resetChat);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    send(input.value);
  });

  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    // Enter = gửi, Shift+Enter = xuống dòng. Bỏ qua khi đang gõ dấu tiếng Việt (IME).
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send(input.value);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && root.classList.contains("is-open")) {
      setOpen(false);
      fab.focus();
    }
  });

  showWelcome();
})();
