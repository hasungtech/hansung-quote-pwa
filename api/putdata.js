// 서버 경유 데이터 저장 (Vercel Blob put) — 브라우저 직접 업로드(multipart/완료콜백) 불안정 회피
// 클라이언트가 gzip+base64로 보낸 데이터를 서버에서 풀어 Blob에 저장한다(단일 put, 신뢰성 높음).
//   POST /api/putdata  { key, pathname, dataB64, gz, contentType }
// 필요 설정: BLOB_READ_WRITE_TOKEN(Blob 연결 시 자동), DATA_ADMIN_KEY(관리자 비밀번호)

const zlib = require("zlib");
let blobMod = null;
function load() { if (!blobMod) blobMod = require("@vercel/blob"); }

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST만 허용됩니다." }); return; }
  try { load(); } catch (e) { res.status(500).json({ error: "@vercel/blob 미설치" }); return; }
  if (!process.env.BLOB_READ_WRITE_TOKEN) { res.status(503).json({ error: "Vercel Blob이 연결되지 않았습니다. Storage에서 Blob 연결 후 Redeploy 하세요." }); return; }
  try {
    const body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const need = process.env.DATA_ADMIN_KEY || "";
    if (!need) { res.status(500).json({ error: "서버에 DATA_ADMIN_KEY가 설정되지 않았습니다." }); return; }
    if (String(body.key || "") !== need) { res.status(401).json({ error: "관리자 비밀번호가 서버 값(DATA_ADMIN_KEY)과 다릅니다." }); return; }
    const pathname = String(body.pathname || "");
    if (!/^data\/[A-Za-z0-9._/-]+$/.test(pathname)) { res.status(400).json({ error: "잘못된 저장 경로입니다." }); return; }
    if (!body.dataB64) { res.status(400).json({ error: "저장할 데이터가 없습니다." }); return; }
    let buf = Buffer.from(String(body.dataB64), "base64");
    if (body.gz) buf = zlib.gunzipSync(buf);
    const ctype = body.contentType || "application/json";
    const r = await blobMod.put(pathname, buf, { access: "public", contentType: ctype, addRandomSuffix: false, allowOverwrite: true });
    res.status(200).json({ url: r.url, size: buf.length });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
