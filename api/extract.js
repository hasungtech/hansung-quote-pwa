// 도면(이미지/PDF) → 견적 품목 추출 (Anthropic Claude 비전)
// 클라이언트가 base64 파일을 보내면 Claude가 견적 품목 줄을 추출해 텍스트로 반환한다.
// 필요한 환경변수: ANTHROPIC_API_KEY (Vercel 프로젝트 설정에서 추가)
//   선택: CLAUDE_MODEL (기본 claude-opus-4-8; 비용 절감 시 claude-sonnet-4-6 등으로 교체)

const AnthropicModule = require("@anthropic-ai/sdk");
const Anthropic = AnthropicModule.default || AnthropicModule;

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";

const SYSTEM =
  "당신은 한성테크의 견적 보조 도구입니다. 업로드된 산업용 실링(오일씰·오링 등) 도면 또는 문서 이미지에서 " +
  "견적에 필요한 품목 정보를 추출합니다.\n\n" +
  "각 품목을 한 줄씩, 아래 형식의 자연어 텍스트로만 출력하세요(앱의 파서가 이 형식을 인식합니다).\n" +
  "- 타입(있으면): TC TCN TCV SC SB TB VF VH DSI SKY VA VS 중 하나\n" +
  "- 치수(있으면): 내경x외경x높이 (예: 50x65x9). 소수점은 점(.)으로.\n" +
  "- 규격 코드(있으면): P50, AS568-150, AN374, G145 등\n" +
  "- 재질(있으면): NBR, FKM(VITON), EPDM, SILICON 중 하나\n" +
  "- 수량(있으면): 숫자+개 (예: 30개)\n\n" +
  "규칙:\n" +
  "- 도면에서 읽을 수 없거나 불확실한 항목은 비워두세요(추측 금지). 비어 있으면 앱이 사용자에게 보완 입력을 요청합니다.\n" +
  "- 한 도면에 여러 품목이 있으면 각각 한 줄로.\n" +
  "- 설명·머리말·마크다운 없이 품목 줄만 출력하세요.\n" +
  '- 예시: "TC 50x65x9 NBR 30개", "P50 NBR 100개", "AN374 FKM 20개"';

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST만 허용됩니다." });
    return;
  }
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
