/*
  Máy chủ chat cho sách điện tử (không cần cài thư viện, cần Node 18+).

  Chạy:
    Windows (PowerShell):  $env:ANTHROPIC_API_KEY="sk-ant-..." ; node chat-server.js
    macOS / Linux:         ANTHROPIC_API_KEY=sk-ant-... node chat-server.js

  Sau đó mở: http://localhost:3000/sachdientu.html

  Biến môi trường (tuỳ chọn):
    PORT            cổng chạy (mặc định 3000)
    CLAUDE_MODEL    tên model (mặc định claude-sonnet-5)
    ALLOWED_ORIGIN  domain được phép gọi API, ví dụ https://ten-cua-ban.com (mặc định *)
*/
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";

const MAX_MESSAGES = 12; // số tin nhắn gần nhất được gửi lên AI
const MAX_CHARS = 2000; // độ dài tối đa mỗi tin nhắn
const RATE_LIMIT = 20; // số lượt hỏi tối đa / phút / IP

const SYSTEM_PROMPT = `Bạn là trợ lý học tập trong cuốn sách điện tử Hóa học lớp 12, chương "Đại cương về kim loại".
Nội dung sách gồm: cấu tạo nguyên tử và tinh thể kim loại, liên kết kim loại; tính chất vật lí và hóa học của kim loại; kim loại trong tự nhiên và các phương pháp tách kim loại (điện phân nóng chảy, nhiệt luyện, thủy luyện, điện phân dung dịch); tái chế kim loại; hợp kim (gang, thép...); sự ăn mòn kim loại và cách chống ăn mòn.

Quy tắc trả lời:
- Trả lời bằng tiếng Việt, ngắn gọn, dễ hiểu, đúng chương trình phổ thông.
- Viết công thức và phương trình bằng ký tự Unicode (H₂SO₄, Fe³⁺, →), không dùng LaTeX.
- Khi giải thích, nêu bản chất trước rồi mới đến ví dụ.
- Nếu học sinh hỏi một câu trắc nghiệm, giải thích cách suy luận rồi đưa đáp án.
- Nếu câu hỏi nằm ngoài môn Hóa, trả lời ngắn và nhẹ nhàng đưa học sinh về nội dung bài học.
- Nếu không chắc chắn, nói rõ là không chắc thay vì đoán.`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

/* ---------- Giới hạn tần suất (trong bộ nhớ) ---------- */
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}

/* ---------- Tiện ích ---------- */
function sendJson(res, status, obj) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 50000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("Nội dung gửi lên quá lớn."));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function cleanMessages(raw) {
  if (!Array.isArray(raw)) return null;
  const msgs = raw
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim(),
    )
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }))
    .slice(-MAX_MESSAGES);

  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return null;
  return msgs;
}

/* ---------- API chat ---------- */
async function handleChat(req, res) {
  if (!API_KEY) {
    return sendJson(res, 500, {
      error: "Máy chủ chưa có ANTHROPIC_API_KEY. Hãy đặt biến môi trường rồi chạy lại.",
    });
  }

  const ip = req.socket.remoteAddress || "unknown";
  if (rateLimited(ip)) {
    return sendJson(res, 429, {
      error: "Bạn hỏi hơi nhanh rồi, đợi khoảng một phút rồi thử lại nhé.",
    });
  }

  let messages;
  try {
    const body = JSON.parse(await readBody(req));
    messages = cleanMessages(body.messages);
  } catch (e) {
    return sendJson(res, 400, { error: "Yêu cầu không hợp lệ." });
  }
  if (!messages) return sendJson(res, 400, { error: "Thiếu nội dung câu hỏi." });

  try {
    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    const data = await apiRes.json();
    if (!apiRes.ok) {
      console.error("Anthropic API error:", apiRes.status, data);
      return sendJson(res, 502, {
        error: "AI đang gặp sự cố, bạn thử lại sau ít phút nhé.",
      });
    }

    const reply = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    sendJson(res, 200, { reply: reply || "Mình chưa có câu trả lời, bạn hỏi lại giúp mình nhé." });
  } catch (err) {
    console.error(err);
    sendJson(res, 502, { error: "Không kết nối được tới AI." });
  }
}

/* ---------- File tĩnh (để mở sách ngay trên máy chủ này) ---------- */
function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (urlPath === "/") urlPath = "/sachdientu.html";

  const filePath = path.join(__dirname, path.normalize(urlPath));
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  // Không phục vụ chính file chứa mã máy chủ
  if (path.basename(filePath) === "chat-server.js") {
    res.writeHead(404);
    return res.end("Not found");
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    });
    res.end(content);
  });
}

/* ---------- Khởi động ---------- */
http
  .createServer((req, res) => {
    const pathname = new URL(req.url, "http://x").pathname;

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      return res.end();
    }

    if (req.method === "POST" && pathname === "/api/chat") return handleChat(req, res);
    if (req.method === "GET") return serveStatic(req, res);

    res.writeHead(405);
    res.end("Method not allowed");
  })
  .listen(PORT, () => {
    console.log(`Sách điện tử: http://localhost:${PORT}/sachdientu.html`);
    if (!API_KEY) console.warn("⚠ Chưa đặt ANTHROPIC_API_KEY – chat sẽ báo lỗi.");
  });
