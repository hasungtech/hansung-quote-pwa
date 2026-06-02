// 견적 저장/조회 (Vercel Postgres)
// 필요 설정: Vercel 프로젝트에 Postgres 스토리지 연결 → POSTGRES_URL 환경변수 자동 주입
//   POST /api/quotes  { items:[{raw,category,type,code,material,id,od,h,qty,unit_price,basis}] }
//   GET  /api/quotes  → 최근 저장 묶음(batch) 요약 목록

const { sql } = require("@vercel/postgres");

async function ensureTable() {
  await sql`CREATE TABLE IF NOT EXISTS quote_items (
    id BIGSERIAL PRIMARY KEY,
    batch_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    raw TEXT, category TEXT, type TEXT, code TEXT, material TEXT,
    id_mm DOUBLE PRECISION, od_mm DOUBLE PRECISION, h_mm DOUBLE PRECISION,
    qty INTEGER, unit_price DOUBLE PRECISION, basis TEXT
  )`;
}

module.exports = async function handler(req, res) {
  // 일부 Postgres 연동(Neon 등)은 DATABASE_URL만 주입 → @vercel/postgres가 읽는 POSTGRES_URL로 보정
  if (!process.env.POSTGRES_URL && process.env.DATABASE_URL) {
    process.env.POSTGRES_URL = process.env.DATABASE_URL;
  }
  if (!process.env.POSTGRES_URL) {
    res.status(503).json({
      error: "DB가 연결되지 않았습니다. Vercel 프로젝트 → Storage에서 Postgres를 만들어 이 프로젝트에 연결하면 POSTGRES_URL이 자동 설정됩니다(이후 Redeploy).",
    });
    return;
  }
  try {
    await ensureTable();

    if (req.method === "GET") {
      if (req.query && req.query.q) {
        const pat = "%" + String(req.query.q).trim() + "%";
        const { rows } = await sql`
          SELECT raw, qty, unit_price, basis, created_at, material
          FROM quote_items
          WHERE raw ILIKE ${pat} OR code ILIKE ${pat}
          ORDER BY created_at DESC LIMIT 100`;
        res.status(200).json({ items: rows });
        return;
      }
      if (req.query && req.query.batch) {
        const { rows } = await sql`
          SELECT raw, qty, unit_price, basis, material, category, type, code
          FROM quote_items WHERE batch_id=${String(req.query.batch)} ORDER BY id`;
        res.status(200).json({ items: rows });
        return;
      }
      const { rows } = await sql`
        SELECT batch_id,
               MIN(created_at) AS created_at,
               COUNT(*)::int AS n,
               COALESCE(SUM(qty * unit_price), 0) AS total
        FROM quote_items
        GROUP BY batch_id
        ORDER BY MIN(created_at) DESC
        LIMIT 50`;
      res.status(200).json({ batches: rows });
      return;
    }

    if (req.method === "DELETE") {
      if (!req.query || !req.query.batch) {
        res.status(400).json({ error: "batch 파라미터가 필요합니다." });
        return;
      }
      const { rowCount } = await sql`DELETE FROM quote_items WHERE batch_id=${String(req.query.batch)}`;
      res.status(200).json({ ok: true, deleted: rowCount });
      return;
    }

    if (req.method === "POST") {
      const body =
        req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0) {
        res.status(400).json({ error: "저장할 품목이 없습니다." });
        return;
      }
      const batchId = "b" + Date.now() + Math.random().toString(36).slice(2, 7);
      let saved = 0;
      for (const it of items.slice(0, 1000)) {
        await sql`INSERT INTO quote_items
          (batch_id, raw, category, type, code, material, id_mm, od_mm, h_mm, qty, unit_price, basis)
          VALUES (${batchId}, ${it.raw || ""}, ${it.category || ""}, ${it.type || ""},
                  ${it.code || ""}, ${it.material || ""}, ${it.id ?? null}, ${it.od ?? null},
                  ${it.h ?? null}, ${it.qty ?? null}, ${it.unit_price ?? null}, ${it.basis || ""})`;
        saved++;
      }
      res.status(200).json({ ok: true, saved: saved, batch_id: batchId });
      return;
    }

    res.status(405).json({ error: "허용되지 않은 메서드입니다." });
  } catch (e) {
    const m = e && e.message ? e.message : String(e);
    res.status(500).json({ error: "DB 오류: " + m });
  }
};
