// GitHub 저장소의 api/analyze.js 위치에 둡니다.
// 글자/캡처를 받아 분석. 이용권 토큰이 유효하면 '정밀 분석'(성향·전략·주의)까지 제공.

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

var SCORE_RULES =
`- 호감도(썸 온도) 점수는 0~100 사이 정수. 답장 속도·길이·질문 여부·이모지·먼저 연락 여부 등 대화 근거로 매겨.
- 이건 재미로 보는 엔터테인먼트야. 단정적 사실이 아니라 가볍고 센스 있게.
- temperature: 점수에 맞는 짧은 라벨 + 이모지.
- verdict: 한 줄 총평. 친근하고 위트있게.
- signals: 대화에서 읽히는 신호 2~3개. 아주 짧게. 긍정·주의 섞어서.
- replies: 보낼 답장 3개. 각각 짧은 라벨 + 한 줄 팁. 자연스러운 2030 카톡 말투(적당한 ㅋㅋ·이모지 OK). 정직하고 건강한 소통만 — 조종·기만·무례 금지.`;

var STD_SHAPE = `{"score":75,"temperature":"라벨","verdict":"한 줄 총평","signals":["신호1","신호2"],"replies":[{"label":"","message":"","tip":""},{"label":"","message":"","tip":""},{"label":"","message":"","tip":""}]}`;
var PREM_SHAPE = `{"score":75,"temperature":"라벨","verdict":"한 줄 총평","signals":["신호1","신호2"],"personality":"상대 성향","strategy":"다음 단계 전략","caution":"주의할 점","replies":[{"label":"","message":"","tip":""},{"label":"","message":"","tip":""},{"label":"","message":"","tip":""}]}`;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  var body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  var relationship = body.relationship || "";
  var convo = body.convo || "";
  var tone = body.tone || "자연스럽게";
  var memo = body.memo || "";
  var image = body.image || null;
  var mediaType = body.mediaType || "image/jpeg";
  var situation = body.situation || "";
  var hasImage = !!image;

  if (!hasImage && !convo.trim()) { res.status(400).json({ error: "대화 내용이 필요해요." }); return; }

  var isPremium = false;
  try { if (body.token && process.env.TOKEN_SECRET) { isPremium = !!verifyToken(body.token, process.env.TOKEN_SECRET); } } catch (e) {}

  var roleLine = '너는 한국 20~30대 연애 코치이자 "썸 온도 분석가"야.';
  var taskLine = hasImage
    ? "첨부된 카카오톡 대화 캡처 이미지를 읽고, (1) 상대의 호감도를 재미있게 분석하고 (2) 다음에 보낼 답장을 추천해줘."
    : "사용자가 주고받은 카톡 대화를 보고, (1) 상대의 호감도를 재미있게 분석하고 (2) 다음에 보낼 답장을 추천해줘.";

  var ctx = "[상황]\n- 상대와 나의 관계: " + relationship + "\n"
    + (hasImage ? "" : "- 주고받은 대화:\n" + convo + "\n")
    + "- 원하는 답장 분위기: " + tone + "\n"
    + "- 추가 메모: " + (memo.trim() ? memo : "없음");

  var imgNote = hasImage
    ? "\n\n[이미지 읽기]\n- 보통 오른쪽 말풍선이 '나', 왼쪽이 '상대'야. 구분해서 흐름을 파악해.\n- 글자가 잘 안 보이면 무리하게 추측하지 말고 보이는 만큼만."
    : "";

  var deepRules = "\n\n[정밀 분석 추가]\n"
    + "- 사용자의 상황/목표: " + ((situation && situation !== "선택 안 함") ? situation : "특별히 정하지 않음") + ". 이 상황에 맞춰 분석과 답장을 조정해.\n"
    + "- personality: 상대의 카톡 성향·태도를 2~3문장으로.\n"
    + "- strategy: 지금부터 며칠~몇 번의 대화 동안 어떻게 움직이면 좋을지 구체적 전략 2~3문장.\n"
    + "- caution: 이 상황에서 하지 말아야 할 것·주의점 1~2문장.";

  var rules = "[분석 규칙]\n" + SCORE_RULES + (isPremium ? deepRules : "");
  var shape = isPremium ? PREM_SHAPE : STD_SHAPE;

  var prompt = roleLine + " " + taskLine + "\n\n" + ctx + imgNote + "\n\n" + rules
    + "\n\n반드시 아래 JSON 형식으로만 답해. 설명·마크다운·백틱 절대 금지.\n" + shape;

  var model = hasImage ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001";
  var userContent = hasImage
    ? [{ type: "image", source: { type: "base64", media_type: mediaType, data: image } }, { type: "text", text: prompt }]
    : prompt;

  try {
    var r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: model, max_tokens: 1200, messages: [{ role: "user", content: userContent }] })
    });
    var data = await r.json();
    if (data.error) { res.status(500).json({ error: data.error.message || "AI 요청 실패" }); return; }

    var text = (data.content || []).filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("\n");
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();
    var s = text.indexOf("{"), e = text.lastIndexOf("}");
    if (s !== -1 && e !== -1) text = text.slice(s, e + 1);

    var parsed = JSON.parse(text);
    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: "분석 처리 중 오류가 났어요." });
  }
};
