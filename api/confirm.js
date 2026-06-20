// api/confirm.js — 토스 결제 승인 후, 로그인한 사용자의 구독을 Supabase에 저장합니다.

var PRICE = 2900; // index.html 의 PRICE 와 같아야 함
var SUPABASE_URL = process.env.SUPABASE_URL;
var SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

async function getUserId(accessToken) {
  if (!accessToken) return null;
  try {
    var r = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { "apikey": SERVICE_ROLE, "Authorization": "Bearer " + accessToken }
    });
    if (!r.ok) return null;
    var u = await r.json();
    return u && u.id ? u.id : null;
  } catch (e) { return null; }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  var body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  var paymentKey = body.paymentKey, orderId = body.orderId, amount = Number(body.amount), accessToken = body.accessToken;
  if (!paymentKey || !orderId || !amount) { res.status(400).json({ error: "필수 값 누락" }); return; }
  if (amount !== PRICE) { res.status(400).json({ error: "결제 금액이 올바르지 않습니다." }); return; }

  var secret = process.env.TOSS_SECRET_KEY;
  if (!secret || !SUPABASE_URL || !SERVICE_ROLE) { res.status(500).json({ error: "서버 설정 누락(환경변수 확인)" }); return; }

  var userId = await getUserId(accessToken);
  if (!userId) { res.status(401).json({ error: "로그인이 필요합니다." }); return; }

  var auth = Buffer.from(secret + ":").toString("base64");
  try {
    var r = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: { "Authorization": "Basic " + auth, "Content-Type": "application/json" },
      body: JSON.stringify({ paymentKey: paymentKey, orderId: orderId, amount: amount })
    });
    var data = await r.json();
    if (!r.ok || data.status !== "DONE") { res.status(400).json({ error: (data && data.message) ? data.message : "결제 승인 실패" }); return; }

    var exp = Date.now() + 30 * 24 * 60 * 60 * 1000;
    var up = await fetch(SUPABASE_URL + "/rest/v1/subscriptions", {
      method: "POST",
      headers: {
        "apikey": SERVICE_ROLE,
        "Authorization": "Bearer " + SERVICE_ROLE,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
      },
      body: JSON.stringify({ user_id: userId, expires_at: new Date(exp).toISOString(), updated_at: new Date().toISOString() })
    });
    if (!up.ok) { var t = await up.text(); res.status(500).json({ error: "구독 저장 실패: " + t }); return; }

    res.status(200).json({ ok: true, expiresAt: exp });
  } catch (e) {
    res.status(500).json({ error: "결제 처리 중 오류" });
  }
};
