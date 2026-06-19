// GitHub 저장소의 api/verify.js 위치에 둡니다.
// 브라우저에 저장된 이용권 토큰이 유효한지(서명 + 만료) 확인합니다.

var crypto = require("crypto");

function verifyToken(token, secret) {
  if (!token || token.indexOf(".") < 0) return null;
  var parts = token.split(".");
  var payload = parts[0], sig = parts[1];
  var expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (sig !== expected) return null;
  try {
    var obj = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!obj.exp || Date.now() > obj.exp) return null;
    return obj;
  } catch (e) { return null; }
}

module.exports = async function handler(req, res) {
  var body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  var tokenSecret = process.env.TOKEN_SECRET;
  if (!tokenSecret) { res.status(200).json({ premium: false }); return; }

  var obj = verifyToken(body.token, tokenSecret);
  if (obj) { res.status(200).json({ premium: true, expiresAt: obj.exp }); }
  else { res.status(200).json({ premium: false }); }
};
