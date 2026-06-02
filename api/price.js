// AI 가격 분석 (Claude) — 정확한 이력이 없는 품목을 '유사 실거래'를 근거로 단가 추론
// 입력: { items:[{idx, item:{type,category,id,od,h,material,qty}, comparables:[{dim,mat,price,n}]}] }
// 출력: { results:[{idx, price, confidence, reasoning}] }
// 환경변수: ANTHROPIC_API_KEY (필수), CLAUDE_MODEL (선택, 기본 claude-opus-4-8)

const AnthropicModule = require("@anthropic-ai/sdk");
const Anthropic = AnthropicModule.default || AnthropicModule;
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-4-8";

const SYSTEM =
  "당신은 산업용 실링(오일씰·오링·패킹·백업링·웨어링 등) 제조사의 견적 가격 분석가입니다.\n" +
  "각 품목의 단가(원/개)를, 함께 제공되는 '유사 과거 실거래(실제 판매가)'를 근거로 추론하세요.\n\n" +
  "원칙:\n" +
  "- 반드시 제공된 유사 거래 가격의 범위 안에서, 치수 차이를 보간/외삽해 추론하세요. 근거 없이 숫자를 지어내지 마세요.\n" +
  "- 치수가 클수록(부피·둘레가 클수록) 비쌉니다. 같은 타입 내에서 치수로 스케일하세요.\n" +
  "- 재질이 다르면 보정하세요: 대략 FKM(VITON) > SILICON > HNBR > EPDM > NBR 순으로 비쌈.\n" +
  "- 오일씰류는 철심(금속)·스프링·가공비가 포함되므로 단순 고무부피로 계산하지 말고 유사 실거래가에 근거하세요.\n" +
  "- 유사 거래가 빈약하거나 치수 차이가 크면 confidence를 'low'로 낮추세요.\n\n" +
  '출력은 JSON만: {"results":[{"idx":번호,"price":원단위정수,"confidence":"high|medium|low","reasoning":"한국어 한 문장 근거"}]}';

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST만 허용됩니다." }); return; }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { res.status(500).json({ error: "ANTHROPIC_API_KEY 미설정" }); return; }
  try {
    const body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const items = Array.isArray(body.items) ? body.items.slice(0, 80) : [];
    if (items.length === 0) { res.status(400).json({ error: "품목이 없습니다." }); return; }

    const payload = items.map(function (it) {
      const x = it.item || {};
      return {
        idx: it.idx,
        품목: { 타입: x.type || "", 제품군: x.category || "", 내경: x.id, 외경: x.od, 높이: x.h, 재질: x.material || "" },
        유사실거래: (it.comparables || []).map(function (c) {
          return { 규격: c.dim, 재질: c.mat || "", 최근단가: c.price, 거래건수: c.n };
        }),
      };
    });

    const policy = (body.policy && String(body.policy).trim()) ? ("\n\n[회사 추가 가격정책 — 우선 적용]\n" + String(body.policy).trim()) : "";
    const client = new Anthropic({ apiKey: apiKey });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: [{ type: "text", text: SYSTEM + policy, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "다음 품목들의 단가를 유사 실거래 기준으로 추론하세요:\n" + JSON.stringify(payload, null, 0) }],
    });
    const tb = (msg.content || []).find(function (b) { return b.type === "text"; });
    let results = [];
    if (tb) {
      let t = String(tb.text || "");
      const m = t.match(/\{[\s\S]*\}/);
      if (m) { try { results = (JSON.parse(m[0]).results) || []; } catch (e) {} }
    }
    res.status(200).json({ results: results });
  } catch (e) {
    res.status(502).json({ error: "AI 가격분석 실패: " + (e && e.message ? e.message : String(e)) });
  }
};
