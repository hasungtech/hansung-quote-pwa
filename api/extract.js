// 도면(이미지/PDF) → 견적 품목 추출 (Anthropic Claude 비전)
// 클라이언트가 base64 파일을 보내면 Claude가 견적 품목 줄을 추출해 텍스트로 반환한다.
// 필요한 환경변수: ANTHROPIC_API_KEY (Vercel 프로젝트 설정에서 추가)
//   선택: CLAUDE_MODEL (기본 claude-opus-4-8; 비용 절감 시 claude-sonnet-4-6 등으로 교체)

const AnthropicModule = require("@anthropic-ai/sdk");
const Anthropic = AnthropicModule.default || AnthropicModule;

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";

const SYSTEM =
  "당신은 한성테크(산업용 실링: 오일씰·오링·패킹·백업링·웨어링 등)의 견적 보조 OCR입니다. " +
  "업로드 이미지는 ▲제품 도면뿐 아니라 ▲고객사가 보낸 '견적의뢰서/발주서' 팩스 인쇄물(표 형태로 여러 품목), " +
  "▲스캔 품질이 낮거나 기울어진 문서, ▲손글씨/도장/배경 잡음이 있는 문서일 수 있습니다. " +
  "이 모든 경우에서 견적 품목을 최대한 많이, 정확히 찾아내세요.\n\n" +
  "각 품목을 한 줄씩, 아래 '표준 줄 형식'으로만 출력하세요(앱 파서가 이 형식을 읽습니다).\n" +
  "- 품명(있으면 맨 앞): OIL SEAL / U-PACKING / DUST SEAL / BACK UP RING / WEAR RING / O-RING 등\n" +
  "- 타입(있으면): TC TCN TCV SC SB TB VF VH DSI SKY VA VS 중 하나\n" +
  "- 치수: 내경x외경x높이 형태로 'x'로 연결(예: 50x65x9). 오링 단면표기는 내경x굵기(예: 50x3.5). 소수점은 점(.)\n" +
  "- 규격 코드(있으면): P50, AS568-150, AN374, G145, S50 등\n" +
  "- 재질(있으면): NBR, FKM, EPDM, SILICON, PU, PTFE, HNBR, FFKM, CR 중 표준명\n" +
  "- 수량(있으면): 숫자+개 (예: 30개)\n\n" +
  "규칙(매우 중요):\n" +
  "- 표/리스트면 각 행을 한 품목으로 보고 모두 추출(머리글·합계·금액·단가 행은 제외).\n" +
  "- 다양한 구분자(x X * × · / 공백 -)와 지름기호(Ø,φ,파이)·단위(mm)를 치수로 정규화: '50*65*9','Ø50x65x9','50-65-9' → 50x65x9.\n" +
  "- 재질 동의어를 표준명으로: 바이톤/비톤/불소→FKM, 실리콘→SILICON, 우레탄→PU, 테프론→PTFE, 니트릴→NBR.\n" +
  "- 읽을 수 없거나 불확실한 항목은 비워두세요(추측 금지). 비면 앱이 사용자에게 보완을 요청합니다.\n" +
  "- 설명·머리말·표·마크다운 없이 '품목 줄'만 출력. 품목이 없으면 빈 줄.\n" +
  '- 예시: "OIL SEAL TC 50x65x9 NBR 30개", "U-PACKING 200x225x16 1개", "P50 NBR 100개", "O-RING 50x3.5 FKM 20개"';

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST만 허용됩니다." });
    return;
  }
  if (process.env.APP_ACCESS_KEY && (req.headers["x-app-key"] || "") !== process.env.APP_ACCESS_KEY) { res.status(401).json({ error: "접근 권한이 없습니다. 설정에서 직원 접근 비밀번호를 입력하세요." }); return; }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다. Vercel 프로젝트의 환경변수에 추가해 주세요.",
    });
    return;
  }
  try {
    const body =
      req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const files = Array.isArray(body.files) ? body.files : [];
    if (files.length === 0) {
      res.status(400).json({ error: "이미지가 없습니다." });
      return;
    }
    const content = [];
    files.slice(0, 5).forEach(function (f) {
      if (!f || !f.data) return;
      if (f.type === "pdf") {
        content.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: f.data },
        });
      } else {
        content.push({
          type: "image",
          source: { type: "base64", media_type: f.media_type || "image/png", data: f.data },
        });
      }
    });
    content.push({ type: "text", text: "이 도면/문서에서 견적 품목을 추출해 형식에 맞게 출력하세요." });

    const client = new Anthropic({ apiKey: apiKey });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      // 안정적인 시스템 프롬프트는 캐싱(짧으면 자동으로 캐시 미적용)
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: content }],
    });

    const textBlock = (msg.content || []).find(function (b) {
      return b.type === "text";
    });
    const text = textBlock ? String(textBlock.text || "").trim() : "";
    res.status(200).json({ text: text });
  } catch (e) {
    const m = e && e.message ? e.message : String(e);
    res.status(502).json({ error: "도면 인식 실패: " + m });
  }
};
