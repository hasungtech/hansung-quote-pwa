// 자유 형식 텍스트 → 견적 품목 추출 (Anthropic Claude)
// 사용자가 어떤 형태로 적든(구분자/순서/한영 혼용/표 붙여넣기 등) 품목을 인식해
// 앱 파서가 읽는 표준 줄 형식으로 정규화해 돌려준다.
// 필요한 환경변수: ANTHROPIC_API_KEY (선택: CLAUDE_MODEL)

const AnthropicModule = require("@anthropic-ai/sdk");
const Anthropic = AnthropicModule.default || AnthropicModule;
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";

const SYSTEM =
  "당신은 한성테크(산업용 실링: 오일씰·오링·패킹·백업링·웨어링 등)의 견적 보조 파서입니다.\n" +
  "사용자가 자유로운 형식으로 적은 텍스트(구분자·순서·띄어쓰기·한영 혼용·엑셀 붙여넣기·표 등 무엇이든)에서 " +
  "견적 품목을 모두 찾아, 아래 '표준 줄 형식'으로만 변환해 출력하세요. 한 품목당 한 줄.\n\n" +
  "표준 줄 형식(있는 정보만, 공백으로 구분):\n" +
  "- 품명(있으면 맨 앞): OIL SEAL / U-PACKING / DUST SEAL / BACK UP RING / WEAR RING / O-RING 등\n" +
  "- 타입(있으면): TC TCN TCV SC SB TB VF VH DSI SKY VA VS 중 하나\n" +
  "- 치수: 내경x외경x높이 형태로 'x'로 연결(예: 50x65x9). 오링 단면표기는 내경x굵기(예: 50x3.5). 소수점은 점(.)\n" +
  "- 규격 코드(있으면): P50, AS568-150, AN374, G145, S50 등(그대로)\n" +
  "- 재질(있으면): NBR, FKM, EPDM, SILICON, PU, PTFE, HNBR, FFKM, CR 중 표준명으로\n" +
  "- 수량(있으면): 숫자+개 (예: 30개)\n\n" +
  "변환 규칙(매우 중요):\n" +
  "- 다양한 구분자를 모두 치수로 인식: x X * × · / 공백 - 등. 예) '50*65*9','50-65-9','50 65 9','Ø50x65' → 50x65x9\n" +
  "- 지름기호(Ø,φ,파이), 단위(mm), 잡음 문자는 제거.\n" +
  "- 재질 동의어를 표준명으로: 바이톤/비톤/불소→FKM, 실리콘→SILICON, 우레탄→PU, 테프론→PTFE, 니트릴→NBR 등.\n" +
  "- 한 줄에 여러 품목이 섞여 있으면 각각 분리해 여러 줄로.\n" +
  "- 수량/단위/주석 등 견적 무관 텍스트는 무시. 추측으로 없는 치수를 지어내지 말 것(불확실하면 비움).\n" +
  "- 표준 줄들 '이외의 설명/머리말/마크다운'은 절대 출력하지 말 것. 인식 품목이 없으면 빈 줄만.\n\n" +
  '예) 입력 "오링 50파이 굵기3.5 바이톤 100ea, TC 50*65*9 니트릴 30" → 출력:\n' +
  "O-RING 50x3.5 FKM 100개\nOIL SEAL TC 50x65x9 NBR 30개";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST만 허용됩니다." }); return; }
  if (process.env.APP_ACCESS_KEY && (req.headers["x-app-key"] || "") !== process.env.APP_ACCESS_KEY) { res.status(401).json({ error: "접근 권한이 없습니다. 설정에서 직원 접근 비밀번호를 입력하세요." }); return; }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { res.status(500).json({ error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다." }); return; }
  try {
    const body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const text = String(body.text || "").slice(0, 12000).trim();
    if (!text) { res.status(400).json({ error: "텍스트가 없습니다." }); return; }
    // 회사가 직접 등록한 예시(few-shot)가 있으면 학습 힌트로 주입
    const examples = Array.isArray(body.examples) ? body.examples.slice(0, 20) : [];
    let exMsg = "";
    if (examples.length) {
      exMsg = "\n\n[회사 등록 예시 — 같은 방식으로 변환]\n" +
        examples.map((e) => "입력: " + String(e.in || "").slice(0, 300) + "\n출력: " + String(e.out || "").slice(0, 300)).join("\n---\n");
    }
    const client = new Anthropic({ apiKey: apiKey });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "다음 텍스트에서 견적 품목을 표준 줄 형식으로 변환하세요:" + exMsg + "\n\n=== 입력 ===\n" + text }],
    });
    const tb = (msg.content || []).find((b) => b.type === "text");
    res.status(200).json({ text: tb ? String(tb.text || "").trim() : "" });
  } catch (e) {
    res.status(502).json({ error: "AI 인식 실패: " + (e && e.message ? e.message : String(e)) });
  }
};
