// 비공개 Blob 데이터 읽기 프록시 — 저장은 gzip 상태로 되어 있고, 그 바이트를 그대로 돌려준다(용량↓).
//   GET /api/getdata?f=price_history|raw_rows|learn
// 직원 인증(APP_ACCESS_KEY) 설정 시 보호. 응답은 gzip 바이트(클라이언트가 해제).

let blobMod = null;
function load() { if (!blobMod) blobMod = require("@vercel/blob"); }
const MAP = { price_history: "data/price_history", raw_rows: "data/raw_rows", learn: "data/learn_examples" };

module.exports = async function handler(req, res) {
  try { load(); } catch (e) { res.status(500).json({ error: "@vercel/blob 미설치" }); return; }
  if (process.env.APP_ACCESS_KEY && (req.headers["x-app-key"] || "") !== process.env.APP_ACCESS_KEY) { res.status(401).json({ error: "접근 권한이 없습니다." }); return; }
  if (!process.env.BLOB_READ_WRITE_TOKEN) { res.status(503).json({ error: "Vercel Blob 미연결" }); return; }
  const f = String((req.query && req.query.f) || "");
  const prefix = MAP[f];
  if (!prefix) { res.status(400).json({ error: "잘못된 요청" }); return; }
  try {
    const { blobs } = await blobMod.list({ prefix: prefix, limit: 1000 });
    let best = null;
    for (const b of blobs) { if (!best || new Date(b.uploadedAt) > new Date(best.uploadedAt)) best = b; }
    if (!best) { res.status(404).json({ error: "저장된 데이터 없음" }); return; }
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    const candidates = [best.downloadUrl, best.url].filter(Boolean);
    let r = null;
    for (const u of candidates) {
      r = await fetch(u, { headers: { Authorization: "Bearer " + token } });
      if (r.ok) break;
    }
    if (!r || !r.ok) { res.status(502).json({ error: "blob 다운로드 실패(HTTP " + (r ? r.status : "?") + ")" }); return; }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("content-type", "application/octet-stream");
    res.setHeader("cache-control", "no-store");
    res.status(200).send(buf);
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
