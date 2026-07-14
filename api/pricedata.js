// 전체 가격데이터(price_history) 클라우드 저장/조회 (Vercel Blob)
//   GET  /api/pricedata           → 최신 데이터 메타 {url, updatedAt, size, configured, env}
//   (저장은 /api/putdata, 읽기는 /api/getdata 사용)
// 필요 설정:
//   - Vercel 프로젝트 Storage에서 Blob 연결 → BLOB_READ_WRITE_TOKEN 자동 주입
//   - 업로드 권한용 환경변수 DATA_ADMIN_KEY (관리자 비밀번호) 직접 추가

let blobMod = null;
function load() {
  if (!blobMod) blobMod = require("@vercel/blob");
}

module.exports = async function handler(req, res) {
  try {
    load();
  } catch (e) {
    res.status(200).json({ url: null, configured: false, error: "@vercel/blob 미설치" });
    return;
  }
  const hasToken = !!process.env.BLOB_READ_WRITE_TOKEN;
  // 진단용(값이 아니라 '설정 여부'만): 앱에서 연결 상태를 바로 확인
  const envStatus = { hasBlob: hasToken, hasAdmin: !!process.env.DATA_ADMIN_KEY, hasApi: !!process.env.ANTHROPIC_API_KEY };

  if (req.method === "GET") {
    // GET은 데이터 위치(URL)를 노출하므로 직원 인증으로 보호(외부 유출 차단)
    if (process.env.APP_ACCESS_KEY && (req.headers["x-app-key"] || "") !== process.env.APP_ACCESS_KEY) { res.status(401).json({ error: "접근 권한이 없습니다." }); return; }
    if (!hasToken) { res.status(200).json({ url: null, configured: false, env: envStatus }); return; }
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
      const lr = await blobMod.list({ prefix: "data/learn_examples" });
      const best = pickNewest(ph.blobs);
      const rawBest = pickNewest(rw.blobs);
      const learnBest = pickNewest(lr.blobs);
      res.status(200).json({
        url: best ? best.url : null,
        updatedAt: best ? best.uploadedAt : null,
        size: best ? best.size : 0,
        rawUrl: rawBest ? rawBest.url : null,
        learnUrl: learnBest ? learnBest.url : null,
        configured: true,
        env: envStatus,
      });
    } catch (e) {
      res.status(200).json({ url: null, configured: true, error: String(e && e.message || e) });
    }
    return;
  }

  // 업로드는 /api/putdata(서버 저장)로 이관됨. 구 클라이언트 핸드셰이크는 제거.
  res.status(405).json({ error: "허용되지 않은 메서드입니다. (업로드는 /api/putdata 사용)" });
};
