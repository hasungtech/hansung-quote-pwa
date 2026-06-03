// 전체 가격데이터(price_history) 클라우드 저장/조회 (Vercel Blob)
//   GET  /api/pricedata           → 최신 데이터 blob {url, updatedAt, size, configured}
//   POST /api/pricedata           → @vercel/blob/client upload() 핸드셰이크(관리자 인증 후 토큰 발급)
// 필요 설정:
//   - Vercel 프로젝트 Storage에서 Blob 연결 → BLOB_READ_WRITE_TOKEN 자동 주입
//   - 업로드 권한용 환경변수 DATA_ADMIN_KEY (관리자 비밀번호) 직접 추가

let blobMod = null, clientMod = null;
function load() {
  if (!blobMod) blobMod = require("@vercel/blob");
  if (!clientMod) clientMod = require("@vercel/blob/client");
}

module.exports = async function handler(req, res) {
  try {
    load();
  } catch (e) {
    res.status(200).json({ url: null, configured: false, error: "@vercel/blob 미설치" });
    return;
  }
  const hasToken = !!process.env.BLOB_READ_WRITE_TOKEN;

  if (req.method === "GET") {
    if (!hasToken) { res.status(200).json({ url: null, configured: false }); return; }
    try {
      const pickNewest = (blobs) => {
        let best = null;
        for (const b of blobs) {
          if (!best || new Date(b.uploadedAt) > new Date(best.uploadedAt)) best = b;
        }
        return best;
      };
      const ph = await blobMod.list({ prefix: "data/price_history" });
      const rw = await blobMod.list({ prefix: "data/raw_rows" });
      const best = pickNewest(ph.blobs);
      const rawBest = pickNewest(rw.blobs);
      res.status(200).json({
        url: best ? best.url : null,
        updatedAt: best ? best.uploadedAt : null,
        size: best ? best.size : 0,
        rawUrl: rawBest ? rawBest.url : null,
        configured: true,
      });
    } catch (e) {
      res.status(200).json({ url: null, configured: true, error: String(e && e.message || e) });
    }
    return;
  }

  if (req.method === "POST") {
    if (!hasToken) {
      res.status(503).json({ error: "Vercel Blob이 연결되지 않았습니다. 프로젝트 Storage에서 Blob을 만들어 연결한 뒤 Redeploy 하세요." });
      return;
    }
    try {
      const body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
      const json = await clientMod.handleUpload({
        body,
        request: req,
        onBeforeGenerateToken: async (pathname, clientPayload) => {
          const need = process.env.DATA_ADMIN_KEY || "";
          if (!need) throw new Error("서버에 DATA_ADMIN_KEY(관리자 비밀번호)가 설정되지 않았습니다.");
          if (String(clientPayload || "") !== need) throw new Error("관리자 비밀번호가 올바르지 않습니다.");
          return {
            allowedContentTypes: ["application/json", "application/octet-stream", "text/plain"],
            addRandomSuffix: false,
            allowOverwrite: true,
            maximumSizeInBytes: 80 * 1024 * 1024,
          };
        },
        onUploadCompleted: async () => {},
      });
      res.status(200).json(json);
    } catch (e) {
      res.status(400).json({ error: String(e && e.message || e) });
    }
    return;
  }

  res.status(405).json({ error: "허용되지 않은 메서드입니다." });
};
