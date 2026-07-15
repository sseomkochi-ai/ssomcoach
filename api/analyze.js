// api/analyze.js — 글자/캡처 분석 + '다른 느낌 답장' 재추천.
// 로그인 사용자의 구독을 서버에서 확인해 '정밀 분석'을 풀어줍니다.

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

async function isUserPremium(userId) {
  if (!userId || !SUPABASE_URL || !SERVICE_ROLE) return false;
  try {
    var r = await fetch(SUPABASE_URL + "/rest/v1/subscriptions?user_id=eq." + userId + "&select=expires_at", {
      headers: { "apikey": SERVICE_ROLE, "Authorization": "Bearer " + SERVICE_ROLE }
    });
    if (!r.ok) return false;
    var rows = await r.json();
    return !!(rows[0] && new Date(rows[0].expires_at).getTime() > Date.now());
  } catch (e) { return false; }
}

var REPLY_STYLE = "자연스러운 2030 카톡 말투(적당한 ㅋㅋ·이모지 OK). 정직하고 건강한 소통만 — 조종·기만·무례 금지.";

var SCORE_RULES =
`- 호감도(썸 온도) 점수는 0~100 사이 정수. 답장 속도·길이·질문 여부·이모지·먼저 연락 여부 등 대화 근거로 매겨.
- 이건 재미로 보는 엔터테인먼트야. 단정적 사실이 아니라 가볍고 센스 있게.
- temperature: 점수에 맞는 짧은 라벨 + 이모지.
- verdict: 한 줄 총평. 친근하고 위트있게.
- signals: 대화에서 읽히는 신호 2~3개. 아주 짧게. 긍정·주의 섞어서.
- replies: 보낼 답장 3개. 각각 짧은 라벨 + 한 줄 팁. ` + REPLY_STYLE;

var STD_SHAPE = `{"score":75,"temperature":"라벨","verdict":"한 줄 총평","signals":["신호1","신호2"],"replies":[{"label":"","message":"","tip":""},{"label":"","message":"","tip":""},{"label":"","message":"","tip":""}]}`;
var PREM_SHAPE = `{"score":75,"temperature":"라벨","verdict":"한 줄 총평","signals":["신호1","신호2"],"personality":"상대 성향","strategy":"다음 단계 전략","caution":"주의할 점","replies":[{"label":"","message":"","tip":""},{"label":"","message":"","tip":""},{"label":"","message":"","tip":""}]}`;
var REGEN_SHAPE = `{"replies":[{"label":"","message":"","tip":""},{"label":"","message":"","tip":""},{"label":"","message":"","tip":""}]}`;

async function callClaude(model, userContent, maxTokens) {
  var r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: model, max_tokens: maxTokens, messages: [{ role: "user", content: userContent }] })
  });
  return r.json();
}

function parseJsonText(data) {
  var text = (data.content || []).filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("\n");
  text = text.replace(/```json/g, "").replace(/```/g, "").trim();
  var s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s !== -1 && e !== -1) text = text.slice(s, e + 1);
  return JSON.parse(text);
}

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
  var partner = (typeof body.partner === "string" ? body.partner : "").trim().slice(0, 30);
  var regen = !!body.regen;
  var avoid = Array.isArray(body.avoid) ? body.avoid.filter(function (a) { return typeof a === "string" && a.trim(); }).slice(0, 9) : [];
  var hasImage = !!image;

  if (!hasImage && !convo.trim()) { res.status(400).json({ error: "대화 내용이 필요해요." }); return; }

  var roleLine = '너는 한국 20~30대 연애 코치이자 "썸 온도 분석가"야.';

  var ctx = "[상황]\n- 상대와 나의 관계: " + relationship + "\n"
    + (hasImage ? "" : "- 주고받은 대화:\n" + convo + "\n")
    + "- 원하는 답장 분위기: " + tone + "\n"
    + "- 추가 메모: " + (memo.trim() ? memo : "없음");

  var imgNote = hasImage
    ? "\n\n[이미지 읽기]\n- 보통 오른쪽 말풍선이 '나', 왼쪽이 '상대'야. 구분해서 흐름을 파악해.\n- 글자가 잘 안 보이면 무리하게 추측하지 말고 보이는 만큼만."
    : "";

  var situationLine = (situation && situation !== "선택 안 함") ? situation : "";

  try {
    // ===== 재추천: 답장 3개만 새로 =====
    if (regen) {
      var regenTask = hasImage
        ? "첨부된 카카오톡 캡처 속 대화를 읽고, 사용자가 이미 받았던 답장 추천과는 '다른 느낌'의 새로운 답장 3개만 다시 추천해줘."
        : "사용자가 이미 답장 추천을 받았고, 이번에는 '다른 느낌'의 새로운 답장 3개만 다시 추천받고 싶어해.";

      var avoidBlock = avoid.length
        ? "\n\n[기존에 추천했던 답장 — 아래와 겹치지 않게]\n" + avoid.map(function (a) { return "- " + a; }).join("\n")
        : "";

      var regenRules = "\n\n[답장 규칙]\n"
        + "- 기존 추천과 문장·표현·접근 방식이 확실히 다른 새로운 답장 3개.\n"
        + "- 원하는 분위기(" + tone + ")를 반영하되, 세 개는 서로 결이 다르게.\n"
        + (situationLine ? "- 사용자의 상황/목표: " + situationLine + ". 이 상황에 맞춰 답장을 조정해.\n" : "")
        + "- 각각 짧은 라벨 + 한 줄 팁. " + REPLY_STYLE;

      var regenPrompt = roleLine + " " + regenTask + "\n\n" + ctx + imgNote + avoidBlock + regenRules
        + "\n\n반드시 아래 JSON 형식으로만 답해. 설명·마크다운·백틱 절대 금지.\n" + REGEN_SHAPE;

      var regenModel = hasImage ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001";
      var regenContent = hasImage
        ? [{ type: "image", source: { type: "base64", media_type: mediaType, data: image } }, { type: "text", text: regenPrompt }]
        : regenPrompt;

      var rData = await callClaude(regenModel, regenContent, 900);
      if (rData.error) { res.status(500).json({ error: rData.error.message || "AI 요청 실패" }); return; }
      res.status(200).json(parseJsonText(rData));
      return;
    }

    // ===== 일반 분석 =====
    var userId = await getUserId(body.accessToken);
    var isPremium = await isUserPremium(userId);

    var taskLine = hasImage
      ? "첨부된 카카오톡 대화 캡처 이미지를 읽고, (1) 상대의 호감도를 재미있게 분석하고 (2) 다음에 보낼 답장을 추천해줘."
      : "사용자가 주고받은 카톡 대화를 보고, (1) 상대의 호감도를 재미있게 분석하고 (2) 다음에 보낼 답장을 추천해줘.";

    var transcriptRule = hasImage
      ? "\n- transcript: 캡처에서 읽은 대화를 짧게 전사해. 각 줄을 '상대:' 또는 '나:'로 시작, 핵심 흐름 위주로 최대 15줄."
      : "";

    var deepRules = "\n\n[정밀 분석 추가]\n"
      + "- 사용자의 상황/목표: " + (situationLine || "특별히 정하지 않음") + ". 이 상황에 맞춰 분석과 답장을 조정해.\n"
      + "- personality: 상대의 카톡 성향·태도를 2~3문장으로.\n"
      + "- strategy: 지금부터 며칠~몇 번의 대화 동안 어떻게 움직이면 좋을지 구체적 전략 2~3문장.\n"
      + "- caution: 이 상황에서 하지 말아야 할 것·주의점 1~2문장.";

    var rules = "[분석 규칙]\n" + SCORE_RULES + transcriptRule + (isPremium ? deepRules : "");
    var shape = isPremium ? PREM_SHAPE : STD_SHAPE;
    if (hasImage) shape = shape.replace('{"score"', '{"transcript":"상대: ...\\n나: ...","score"');

    var prompt = roleLine + " " + taskLine + "\n\n" + ctx + imgNote + "\n\n" + rules
      + "\n\n반드시 아래 JSON 형식으로만 답해. 설명·마크다운·백틱 절대 금지.\n" + shape;

    var model = hasImage ? "claude-sonnet-4-6" : "claude-haiku-4-5-20251001";
    var userContent = hasImage
      ? [{ type: "image", source: { type: "base64", media_type: mediaType, data: image } }, { type: "text", text: prompt }]
      : prompt;

    var data = await callClaude(model, userContent, hasImage ? 1500 : 1200);
    if (data.error) { res.status(500).json({ error: data.error.message || "AI 요청 실패" }); return; }
    var parsed = parseJsonText(data);

    // 프리미엄 사용자의 분석 결과를 히스토리에 저장
    if (isPremium && userId) {
      try {
        var sc = parseInt(parsed.score, 10);
        if (!isNaN(sc)) {
          await fetch(SUPABASE_URL + "/rest/v1/analyses", {
            method: "POST",
            headers: {
              "apikey": SERVICE_ROLE,
              "Authorization": "Bearer " + SERVICE_ROLE,
              "Content-Type": "application/json",
              "Prefer": "return=minimal"
            },
            body: JSON.stringify({
              user_id: userId,
              partner: partner,
              score: Math.max(0, Math.min(100, sc)),
              temperature: String(parsed.temperature || "").slice(0, 80),
              verdict: String(parsed.verdict || "").slice(0, 300)
            })
          });
        }
      } catch (e) { /* 저장 실패해도 분석 결과는 정상 반환 */ }
    }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: "분석 처리 중 오류가 났어요." });
  }
};
