// ===============================================================================================
// [S1.104 / S2.2 / ADR-050 ⑴] BẢNG CA NỬA XU — HÀM THUẦN ĐỐI CHIẾU VỚI `round(x, 2)` CHẠY THẬT
//
// ADR-050 ⑴ đòi luật làm tròn được **ghim ở CẢ hai tầng bằng một phép đo**, và nói rõ đây là
// *điều kiện của S2.2, không phải một lượt kiểm tuỳ ý*. Tệp này là phép đo ấy.
//
// **Vì sao nó phải chạy Postgres thật chứ không đọc tài liệu:** câu hỏi *"`round(numeric, 2)` làm
// tròn thế nào ở ca hoà"* có BA câu trả lời khả dĩ mà mọi ngôn ngữ đều có ai đó chọn — nửa-lên,
// nửa-ra-xa-0, nửa-về-chẵn (banker's). Ba luật ấy chỉ khác nhau ở đúng ca hoà, và hai trong ba
// chỉ khác nhau ở SỐ ÂM. Một bảng ca không mang cả ba trục thì nó ghim một luật mà không biết là
// luật nào.
//
// **Bài học vừa trả giá ở S1.103 (khoản 208, mũi đột biến ⑶):** một fixture không phân biệt được
// thì nửa được đo không phải nửa ta tưởng. Ở đó là hai phiên của cùng một người; ở đây là một
// bảng ca toàn số không âm. Nên `CA` dưới đây mang ca âm, và mang chúng ở ĐÚNG điểm hoà.
// ===============================================================================================

import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { SO_LE_HE_SO, SO_LE_TIEN, docSo, lamTron, vietSo } from "./chi-phi-hieu-dung.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

let db: TestDatabase;

/**
 * Một ca là một cặp `(giaTri, heSo)` — đúng hai thứ hàm thuần nhân với nhau.
 *
 * `giaTri` ở `numeric(18,2)`, `heSo` ở `numeric(18,4)`, nên tích ở tỉ lệ `10^6` và ba chữ số
 * thừa là chỗ luật làm tròn nói.
 */
interface Ca {
  readonly ten: string;
  readonly giaTri: string;
  readonly heSo: string;
}

/**
 * Ba trục, và mỗi trục có lý do:
 *
 *   ⑴ **hoà đúng nửa xu, DƯƠNG** — tách nửa-ra-xa-0 khỏi nửa-về-chẵn (banker's);
 *   ⑵ **hoà đúng nửa xu, ÂM** — tách nửa-ra-xa-0 khỏi nửa-LÊN. Không có trục này thì bảng ca
 *      không phân biệt được hai luật, và §2.3⑸ nói *nửa-ra-xa-0* chứ không phải *nửa-lên*;
 *   ⑶ **sát hai bên điểm hoà** — chứng minh điểm hoà là một ĐIỂM chứ không phải một khoảng.
 */
const CA: readonly Ca[] = [
  { ten: "hoà nửa xu, dương, lẻ→chẵn", giaTri: "0.01", heSo: "0.5000" },
  { ten: "hoà nửa xu, dương, chẵn→lẻ", giaTri: "0.02", heSo: "0.7500" },
  { ten: "hoà nửa xu, dương, về 0.02", giaTri: "0.03", heSo: "0.5000" },
  { ten: "hoà nửa xu, ÂM, lẻ→chẵn", giaTri: "-0.01", heSo: "0.5000" },
  { ten: "hoà nửa xu, ÂM, chẵn→lẻ", giaTri: "-0.02", heSo: "0.7500" },
  { ten: "hoà nửa xu, ÂM, hệ số âm", giaTri: "0.01", heSo: "-0.5000" },
  { ten: "sát DƯỚI điểm hoà", giaTri: "0.01", heSo: "0.4999" },
  { ten: "sát TRÊN điểm hoà", giaTri: "0.01", heSo: "0.5001" },
  { ten: "sát dưới, ÂM", giaTri: "-0.01", heSo: "0.4999" },
  { ten: "sát trên, ÂM", giaTri: "-0.01", heSo: "0.5001" },
  { ten: "không", giaTri: "0.00", heSo: "1.0000" },
  { ten: "hệ số đơn vị", giaTri: "1234.56", heSo: "1.0000" },
  { ten: "hệ số bốn chữ số", giaTri: "1234.56", heSo: "1.2345" },
  { ten: "khoản GIẢM TRỪ bốn chữ số", giaTri: "-1234.56", heSo: "1.2345" },
  { ten: "hệ số 0 — thành phần bị vô hiệu", giaTri: "9999.99", heSo: "0.0000" },
  { ten: "lớn, sát miền numeric(18,2)", giaTri: "9999999999.99", heSo: "1.0001" },
  { ten: "lớn và âm", giaTri: "-9999999999.99", heSo: "1.0001" },
  // Đúng hai ca của khoản 218: tích sinh chữ số thứ ba, và nó ≥ 5.
  { ten: "khoản 218 — lượng 1.2345 × 2", giaTri: "2.00", heSo: "1.2345" },
  { ten: "khoản 218 — dư 99", giaTri: "0.01", heSo: "0.9999" },
];

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
}, 180000);

afterAll(async () => {
  await db?.stop();
});

describe("[S1.104 / S2.2] luật làm tròn ghim ở CẢ hai tầng", { timeout: 120000 }, () => {
  it("[INV-J2] hàm thuần cho ĐÚNG `pg_catalog.round(giaTri * heSo, 2)` ở mọi ca — một lượt đi về", async () => {
    const cho = CA.map((_, i) => `($${String(i * 2 + 1)}::pg_catalog.numeric, $${String(i * 2 + 2)}::pg_catalog.numeric)`);
    const thamSo = CA.flatMap((c) => [c.giaTri, c.heSo]);
    const { rows } = await db.pool.query<{ i: string; pg: string }>(
      `SELECT (t.i - 1)::pg_catalog.text AS i,
              pg_catalog.round(t.g OPERATOR(pg_catalog.*) t.h, 2)::pg_catalog.text AS pg
         FROM (SELECT pg_catalog.row_number() OVER () AS i, v.g, v.h
                 FROM (VALUES ${cho.join(", ")}) AS v(g, h)) AS t
        ORDER BY t.i`,
      thamSo,
    );
    expect(rows, "tiền đề: Postgres trả đúng một hàng cho mỗi ca").toHaveLength(CA.length);

    const thuan = CA.map((c) => {
      const g = docSo(c.giaTri, SO_LE_TIEN);
      const h = docSo(c.heSo, SO_LE_HE_SO);
      expect([g, h].filter((x) => x === null), `ca "${c.ten}" phải đọc được`).toEqual([]);
      return vietSo(lamTron((g ?? 0n) * (h ?? 0n), SO_LE_TIEN + SO_LE_HE_SO, SO_LE_TIEN), SO_LE_TIEN);
    });
    const cuaPg = rows.map((r) => r.pg);

    // So CẢ BẢNG một lần: một khẳng định cho từng ca thì ca đầu đỏ che mọi ca sau, và thứ đáng
    // đọc nhất của bảng này là CHỖ NÀO lệch chứ không phải có lệch hay không.
    expect(
      CA.map((c, i) => `${c.ten}: ${thuan[i] ?? "?"}`),
      "mỗi dòng là `tên ca: giá trị`, nên một dòng đỏ tự nói ca nào hỏng",
    ).toEqual(CA.map((c, i) => `${c.ten}: ${cuaPg[i] ?? "?"}`));
  });

  it("và bảng ca này PHÂN BIỆT ĐƯỢC ba luật — không thì nó ghim một luật mà không biết luật nào", async () => {
    // Ca hoà âm: nửa-ra-xa-0 cho -0.01, nửa-LÊN cho 0.00. Nếu Postgres trả 0.00 thì §2.3⑸ đang
    // gọi tên sai luật, và mọi thứ dựng trên nó phải đọc lại.
    const { rows: am } = await db.pool.query<{ v: string }>(
      "SELECT pg_catalog.round((-0.01)::pg_catalog.numeric OPERATOR(pg_catalog.*) 0.5::pg_catalog.numeric, 2)::pg_catalog.text AS v",
    );
    expect(am[0]?.v, "nửa-ra-xa-0, KHÔNG phải nửa-lên: -0.005 → -0.01").toBe("-0.01");

    // Ca hoà dương về số LẺ: nửa-ra-xa-0 cho 0.01, nửa-về-chẵn (banker's) cho 0.00.
    const { rows: chan } = await db.pool.query<{ v: string }>(
      "SELECT pg_catalog.round(0.01::pg_catalog.numeric OPERATOR(pg_catalog.*) 0.5::pg_catalog.numeric, 2)::pg_catalog.text AS v",
    );
    expect(chan[0]?.v, "nửa-ra-xa-0, KHÔNG phải banker's: 0.005 → 0.01").toBe("0.01");
  });

  it("[INV-J2] CẮT CỤT thì bảng này ĐỎ — đối chứng âm, và nó là khoản 218 ở dạng phép đo", () => {
    const catCut = (g: bigint, h: bigint): bigint => (g * h) / 10n ** BigInt(SO_LE_HE_SO);
    const lech = CA.filter((c) => {
      const g = docSo(c.giaTri, SO_LE_TIEN) ?? 0n;
      const h = docSo(c.heSo, SO_LE_HE_SO) ?? 0n;
      return catCut(g, h) !== lamTron(g * h, SO_LE_TIEN + SO_LE_HE_SO, SO_LE_TIEN);
    });
    expect(
      lech.map((c) => c.ten),
      "nếu tập này RỖNG thì bảng ca không phân biệt được cắt cụt với làm tròn, và nó vô dụng",
    ).not.toEqual([]);
  });
});
