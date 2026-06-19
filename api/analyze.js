// GitHub 저장소의 api/analyze.js 위치에 둡니다.
// 글자(convo) 또는 카톡 캡처 이미지(image)를 받아 호감도 분석 + 답장 추천을 합니다.

var RULES = `[분석 규칙]
- 호감도(썸 온도) 점수는 0~100 사이 정수. 답장 속도·길이·질문 여부·이모지·먼저 연락 여부 등 대화 근거로 매겨.
- 이건 재미로 보는 엔터테인먼트야. 단정적 사실이 아니라 가볍고 센스 있게.
- temperature: 점수에 맞는 짧은 라벨 + 이모지. (예: "🔥 그린라이트, 직진각", "🌤 호감 상승 중", "🌡 아직은 미지근", "🧊 시그널이 약해요")
- verdict: 한 줄 총평. 친근하고 위트있게.
- signals: 대화에서 읽히는 신호 2~3개. 아주 짧게. 긍정·주의 섞어서.
- replies: 원하는 분위기로 보낼 답장 3개. 각각 짧은 라벨 + 한 줄 팁. 자연스러운 2030 카톡 말투(적당한 ㅋㅋ·이모지 OK). 정직하고 건강한 소통만 — 상대 조종·기만·무례 금지.

반드시 아래 JSON 형식으로만 답해. 설명·마크다운·백틱 절대 금지.
{"score":75,"temperature":"라벨","verdict":"한 줄 총평","signals":["신호1","신호2"],"replies":[{"label":"","message":"","tip":""},{"label":"","message":"","tip":""},{"label":"","message":"","tip":""}]}`;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  var body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  var relationship = body.relationship || "";
  var convo = body.convo || "";
  var tone = body.tone || "자연스럽게";
  var memo = body.memo || "";
  var image = body.image || null;            // base64 (data: 접두어 없음)
  var mediaType = body.mediaType || "image/jpeg";

  var hasImage = !!image;
  if (!hasImage && !convo.trim()) { res.status(400).json({ error: "대화 내용이 필요해요." }); return; }

  var model, userContent;

  if (hasImage) {
    model = "claude-sonnet-4-6"; // 이미지(캡처) 읽기는 비전 모델
    var imgPrompt =
`너는 한국 20~30대 연애 코치이자 "썸 온도 분석가"야. 첨부된 카카오톡 대화 캡처 이미지를 읽고, (1) 상대의 호감도를 재미있게 분석하고 (2) 다음에 보낼 답장을 추천해줘.

[상황]
- 상대와 나의 관계: ${relationship}
- 원하는 답장 분위기: ${tone}
- 추가 메모: ${memo.trim() ? memo : "없음"}

[이미지 읽기]
- 보통 오른쪽 말풍선이 '나', 왼쪽이 '상대'야. 누가 보낸 메시지인지 구분해서 대화 흐름을 파악해.
- 글자가 잘 안 보이면 무리하게 추측하지 말고 보이는 만큼만 활용해.

${RULES}`;
    userContent = [
      { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
      { type: "text", text: imgPrompt }
    ];
  } else {
    model = "claude-haiku-4-5-20251001"; // 글자 입력은 저렴한 모델
    userContent =
`너는 한국 20~30대 연애 코치이자 "썸 온도 분석가"야. 사용자가 썸/연애 상대와 주고받은 카톡 대화를 보고, (1) 상대의 호감도를 재미있게 분석하고 (2) 다음에 보낼 답장을 추천해줘.

[상황]
- 상대와 나의 관계: ${relationship}
- 주고받은 대화:
${convo}
- 원하는 답장 분위기: ${tone}
- 추가 메모: ${memo.trim() ? memo : "없음"}

${RULES}`;
  }

  try {
    var r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({ model: model, max_tokens: 1000, messages: [{ role: "user", content: userContent }] })
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
