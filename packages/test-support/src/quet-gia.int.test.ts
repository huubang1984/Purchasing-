// ==============================================================================================
// [S1.251 / S4.4b] ĐỐI CHỨNG DƯƠNG CỦA BỘ QUÉT GIÁ — nó THẤY kim ở cả bốn loại quan hệ, kể cả đối tượng dựng lúc chạy
//
// Bốn bộ quét giá (kịch bản 41 hai bản, `unseal-worker.int`, `luot-danh-gia.int`) khẳng định tập quan hệ chứa giá bằng `toEqual`
// vét cạn; một bộ quét MÙ với view hay materialized view vẫn cho đúng tập ấy. Ca này dựng mỗi loại một quan hệ chứa kim — bảng,
// bảng cha phân mảnh, view, materialized view — cộng một bảng KHÔNG chứa kim, rồi đòi bộ quét kể đúng bốn cái đầu. Gỡ một chữ
// khỏi `RELKIND_QUET_GIA` thì ca đỏ (đột biến ở biên bản §S1.251).
// ==============================================================================================
import { describe, expect, it } from "vitest";
import { startPostgres } from "./postgres.js";
import { RELKIND_QUET_GIA, quetGiaMoiQuanHe } from "./quet-gia.js";

const KIM = "4321987.65";

describe("[INV-L6] [S1.251 / S4.4b] bộ quét giá trên mọi quan hệ", { timeout: 120_000 }, () => {
  it("thấy kim ở bảng, bảng cha phân mảnh, view và materialized view dựng lúc chạy — không ở bảng không chứa nó", async () => {
    const db = await startPostgres();
    try {
      await db.pool.query("CREATE TABLE public.qg_bang (payload jsonb)");
      await db.pool.query("INSERT INTO public.qg_bang VALUES ($1::jsonb)", [JSON.stringify({ lines: [{ lineNo: 1, unitPrice: KIM }] })]);
      await db.pool.query("CREATE TABLE public.qg_sach (ghi_chu text)");
      await db.pool.query("INSERT INTO public.qg_sach VALUES ('khong co gia')");
      await db.pool.query("CREATE TABLE public.qg_phan_manh (k int, v text) PARTITION BY RANGE (k)");
      await db.pool.query("CREATE TABLE public.qg_phan_manh_1 PARTITION OF public.qg_phan_manh FOR VALUES FROM (0) TO (10)");
      await db.pool.query("INSERT INTO public.qg_phan_manh VALUES (1, $1)", [KIM]);
      await db.pool.query("CREATE VIEW public.qg_view AS SELECT payload -> 'lines' AS dong FROM public.qg_bang");
      await db.pool.query("CREATE MATERIALIZED VIEW public.qg_matview AS SELECT payload FROM public.qg_bang");

      const kq = await quetGiaMoiQuanHe(db.pool, KIM);
      expect(kq.dinh).toEqual(["qg_bang", "qg_matview", "qg_phan_manh", "qg_phan_manh_1", "qg_view"]);
      expect(kq.soQuanHe).toBe(6);
      expect([...RELKIND_QUET_GIA].sort()).toEqual(["m", "p", "r", "v"]);

      // Materialized view CHƯA NẠP: câu quét ném — đỏ, không lặng lẽ bỏ qua một quan hệ.
      await db.pool.query("CREATE MATERIALIZED VIEW public.qg_chua_nap AS SELECT payload FROM public.qg_bang WITH NO DATA");
      await expect(quetGiaMoiQuanHe(db.pool, KIM)).rejects.toThrow(/has not been populated/u);
      await expect(quetGiaMoiQuanHe(db.pool, "12345")).rejects.toThrow(/kim quá ngắn/u);
    } finally {
      await db.stop();
    }
  });
});
