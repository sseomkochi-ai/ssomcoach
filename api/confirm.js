// GitHub 저장소의 api/confirm.js 위치에 둡니다.
// 토스 결제를 시크릿 키로 최종 승인하고, 성공하면 30일 이용권 토큰을 발급합니다.

var crypto = require("crypto");

// 가격: index.html 의 PRICE 와 반드시 같은 숫자여야 합니다.
var PRICE = 2900;

function signToken(payloadObj, secret) {
  var payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
  var sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return payload + "." + sig;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  var body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  var paymentKey = body.paymentKey;
  var orderId = body.orderId;
  var amount = Number(body.amount);

  if (!paymentKey || !orderId || !amount) { res.status(400).json({ error: "필수 값 누락" }); return; }
  if (amount !== PRICE) { res.status(400).json({ error: "결제 금액이 올바르지 않습니다." }); return; }

  var secret = process.env.TOSS_SECRET_KEY;
  var tokenSecret = process.env.TOKEN_SECRET;
  if (!secret || !tokenSecret) { res.status(500).json({ error: "서버 설정 누락(환경변수 확인)" }); return; }

  var auth = Buffer.from(secret + ":").toString("base64");

  try {
    var r = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: { "Authorization": "Basic " + auth, "Content-Type": "application/json" },
      body: JSON.stringify({ paymentKey: paymentKey, orderId: orderId, amount: amount })
    });
    var data = await r.json();

    if (!r.ok || data.status !== "DONE") {
      res.status(400).json({ error: (data && data.message) ? data.message : "결제 승인 실패" });
      return;
    }

    var exp = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30일
    var token = signToken({ exp: exp, orderId: orderId }, tokenSecret);
    res.status(200).json({ ok: true, token: token, expiresAt: exp });
  } catch (e) {
    res.status(500).json({ error: "결제 처리 중 오류" });
  }
};
