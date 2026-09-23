/*
  CLOUDFLARE WORKER – cầu nối giữa sách điện tử và Gemini (Google).

  Dán toàn bộ file này vào Cloudflare Workers, sau đó thêm 2 biến ở mục Settings → Variables and Secrets:
    GEMINI_API_KEY   (loại Secret)  : key lấy từ Google AI Studio
    ALLOWED_ORIGIN   (loại Text)    : địa chỉ trang sách của bạn, ví dụ https://tenban.github.io
                                      (bỏ trống = cho mọi trang gọi, chỉ nên dùng khi thử nghiệm)
  Tuỳ chọn:
    GEMINI_MODEL     (loại Text)    : ép dùng một model cụ thể, ví dụ gemini-2.5-flash
*/

// Worker sẽ thử lần lượt các model này; model nào không dùng được thì chuyển sang model kế tiếp.
const DEFAULT_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];

const MAX_MESSAGES = 12; // số tin nhắn gần nhất gửi lên AI
const MAX_CHARS = 2000; // độ dài tối đa mỗi tin nhắn
const RATE_LIMIT = 15; // số câu hỏi tối đa / phút / người (giới hạn tương đối)

const SYSTEM_PROMPT = `Bạn là trợ lý học tập trong cuốn sách điện tử Hóa học lớp 12, chương "Đại cương về kim loại".
Nội dung sách gồm: cấu tạo nguyên tử và tinh thể kim loại, liên kết kim loại; tính chất vật lí và hóa học của kim loại; kim loại trong tự nhiên và các phương pháp tách kim loại (điện phân nóng chảy, nhiệt luyện, thủy luyện, điện phân dung dịch); tái chế kim loại; hợp kim (gang, thép...); sự ăn mòn kim loại và cách chống ăn mòn.

Quy tắc trả lời:
- Trả lời bằng tiếng Việt, ngắn gọn, dễ hiểu, đúng chương trình phổ thông.
- Viết công thức và phương trình bằng ký tự Unicode (H₂SO₄, Fe³⁺, →), không dùng LaTeX.
- Khi giải thích, nêu bản chất trước rồi mới đến ví dụ.
- Nếu học sinh hỏi một câu trắc nghiệm, giải thích cách suy luận rồi đưa đáp án.
- Nếu câu hỏi nằm ngoài môn Hóa, trả lời ngắn và nhẹ nhàng đưa học sinh về nội dung bài học.
- Nếu không chắc chắn, nói rõ là không chắc thay vì đoán.`;

/* ---------- Tiện ích ---------- */
const hits = new Map(); // chỉ mang tính tương đối vì Worker có thể chạy ở nhiều nơi
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT;
}

function corsHeaders(request, env) {
  // ALLOWED_ORIGIN có thể chứa nhiều địa chỉ, ngăn cách bằng dấu phẩy
  const allowedList = (env.ALLOWED_ORIGIN || "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = request.headers.get("Origin") || "";
  const allowOrigin = allowedList.includes("*")
    ? "*"
    : allowedList.includes(origin)
      ? origin
      : allowedList[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(request, env, status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(request, env) },
  });
}

// Lọc dữ liệu người dùng gửi lên rồi đổi sang định dạng của Gemini
function toGeminiContents(raw) {
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

  return msgs.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

async function askGemini(model, contents, apiKey) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        generationConfig: { maxOutputTokens: 2048 },
      }),
    },
  );
}


const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Gọi Gemini; nếu model báo quá tải (503) thì đợi một chút và thử lại 1 lần
async function askWithRetry(model, contents, apiKey) {
  let res = await askGemini(model, contents, apiKey);
  if (res.status === 503) {
    await sleep(800);
    res = await askGemini(model, contents, apiKey);
  }
  return res;
}

// Chỉ dùng để ghi log: xem key của bạn đang dùng được những model nào
async function logAvailableModels(apiKey) {
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
      headers: { "x-goog-api-key": apiKey },
    });
    const data = await res.json();
    const names = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => m.name.replace("models/", ""))
      .filter((n) => n.startsWith("gemini"));
    console.error("Model dùng được với key này:", names.join(", ") || JSON.stringify(data).slice(0, 300));
  } catch (e) {
    console.error("Không liệt kê được model:", String(e));
  }
}

/* ---------- Xử lý yêu cầu ---------- */
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    if (request.method !== "POST") {
      return json(request, env, 200, { ok: true, message: "Máy chủ chat đang chạy." });
    }
    if (!env.GEMINI_API_KEY) {
      return json(request, env, 500, {
        error: "Worker chưa có GEMINI_API_KEY. Hãy thêm Secret này trong phần Settings.",
      });
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (rateLimited(ip)) {
      return json(request, env, 429, {
        error: "Bạn hỏi hơi nhanh rồi. Vui lòng đợi khoảng 1 phút rồi hỏi tiếp nhé.",
        code: "rate",
        retryAfter: 60,
      });
    }

    let contents;
    try {
      const body = await request.json();
      contents = toGeminiContents(body.messages);
    } catch (e) {
      return json(request, env, 400, { error: "Yêu cầu không hợp lệ." });
    }
    if (!contents) return json(request, env, 400, { error: "Thiếu nội dung câu hỏi." });

    const models = env.GEMINI_MODEL ? [env.GEMINI_MODEL] : DEFAULT_MODELS;
    let lastStatus = 0;

    for (const model of models) {
      try {
        const res = await askWithRetry(model, contents, env.GEMINI_API_KEY);
        lastStatus = res.status;

        // 404 = model không tồn tại, 429 = hết lượt, 403 = không được dùng,
        // 500/502/503/504 = model đang quá tải → thử model kế tiếp
        if ([404, 429, 403, 500, 502, 503, 504].includes(res.status)) {
          const detail = (await res.text()).slice(0, 200);
          console.error(`Model ${model} lỗi ${res.status}: ${detail}`);
          continue;
        }

        const data = await res.json();
        if (!res.ok) {
          console.error("Gemini error", res.status, JSON.stringify(data));
          return json(request, env, 502, { error: "AI đang gặp sự cố, bạn thử lại sau ít phút nhé." });
        }

        const parts = data.candidates?.[0]?.content?.parts || [];
        const reply = parts
          .filter((p) => typeof p.text === "string" && !p.thought)
          .map((p) => p.text)
          .join("")
          .trim();

        return json(request, env, 200, {
          reply: reply || "Mình chưa trả lời được câu này, bạn thử hỏi theo cách khác nhé.",
        });
      } catch (err) {
        console.error(`Model ${model} bị lỗi kết nối:`, String(err));
        lastStatus = 0;
      }
    }

    // Tất cả model đều thất bại → ghi log danh sách model dùng được để dễ chỉnh
    await logAvailableModels(env.GEMINI_API_KEY);

    // ✏️ Bạn có thể sửa các câu nhắc nhở dưới đây
    if (lastStatus === 429) {
      return json(request, env, 429, {
        error:
          "AI đang hết lượt trả lời tạm thời. Vui lòng đợi khoảng 1 phút rồi hỏi tiếp nhé. Nếu vẫn chưa được, lượt miễn phí hôm nay có thể đã dùng hết, bạn quay lại vào ngày mai nha.",
        code: "quota",
        retryAfter: 60,
      });
    }
    if (lastStatus === 503) {
      return json(request, env, 503, {
        error: "Hiện có nhiều bạn đang hỏi AI cùng lúc. Vui lòng đợi khoảng 30 giây rồi hỏi tiếp nhé.",
        code: "busy",
        retryAfter: 30,
      });
    }
    return json(request, env, 502, { error: "Không kết nối được tới AI. Bạn thử lại sau nhé." });
  },
};
