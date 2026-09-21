// ===============================================================================================
// [INV-H19] [S1.100 / khoản 211] LƯỢT TỰ CHỮA CỦA HARDENING CÀI LẠI **ĐÚNG** BẢN ĐÃ GHIM
//
// `tests/architecture/hardening-co-ly-do.test.ts` đã khoá được ba chỗ ghim của mỗi trigger có ĐỦ
// ba, và hai chỗ VĂN BẢN (⑴ điều kiện sửa, ⑶ vị từ phán xét) giống nhau từng byte. Thứ nó KHÔNG
// đo được là chỗ ghim ⑵ — câu `CREATE TRIGGER` sẽ CHẠY — vì ⑵ viết bằng chính tả nguồn
// (`NEW.`, `OPERATOR(pg_catalog.=)`, `IN (…)`) còn ⑴/⑶ viết bằng đầu ra `pg_get_triggerdef`
// (`new.`, `=`, `= ANY (ARRAY[…])`). So hai chính tả ấy bằng biểu thức chính quy là dựng một bộ
// chuẩn hoá SQL viết tay — thứ sẽ hẹp hơn PostgreSQL ở đúng ngày nó cần rộng.
//
// Nên phép đo này dùng **chính PostgreSQL làm bộ chuẩn hoá**: xoá mọi trigger được ghim, gọi lại
// `migrate()` để lượt tự chữa cài lại chúng, rồi đọc `pg_get_triggerdef` của bản vừa cài và so
// với văn bản đã ghim. Nếu ⑵ lệch ⑴/⑶ — dù chỉ một mệnh đề `WHEN` — bản cài lại KHÔNG khớp và
// test này đỏ.
//
// **VÌ SAO NÓ LÀ KHOẢN 211 chứ không phải một phép đo trang trí.** Ba lối quên không đối xứng:
// quên ⑶ thì đỏ mọi lần; quên ⑴ thì dựng lại trigger mỗi lần `migrate()`. Quên ⑵ là lối DUY
// NHẤT vừa im lặng vừa hại nặng: sau một migration đúng, trigger trong cụm khớp ⑴ nên điều kiện
// sửa SAI, câu sửa không chạy, và bản ⑵ cũ nằm đó như mã chết. Tới ngày trigger trôi — ai đó
// `ALTER`, một lần phục hồi sai, một script vận hành — điều kiện sửa mới đúng, ⑵ cài bản CŨ, và
// vì `packages/db/src/migrate.ts` cố ý tách phán xét sang transaction RIÊNG thì bản yếu **đã
// commit** rồi phán xét mới đỏ. Test này làm cho ngày ấy xảy ra ngay hôm nay, trong một cụm dùng
// một lần.
//
// **CHỖ THU HẸP, nói ra:** chủ thể là mọi trigger có văn bản ghim mở đầu bằng `CREATE TRIGGER`.
// Một `CREATE CONSTRAINT TRIGGER` (ví dụ `vendor_bid_versions_phai_co_bien_nhan`) được
// `pg_get_triggerdef` in ra với tiền tố khác nên nó KHÔNG thuộc tập này — số đo dưới đây nói rõ
// tập ấy lớn bao nhiêu, và một con số tụt xuống là tín hiệu chứ không phải một lượt xanh rẻ.
// ===============================================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));
const HARDENING = readFileSync(
  fileURLToPath(new URL("./migrations/hardening.always.sql", import.meta.url)),
  "utf8",
).replace(/\r\n/gu, "\n");

/** Sàn chống MÙ: tập trigger được ghim hiện là 71. Một con số tụt xuống nghĩa là bộ đọc hỏng. */
const SAN_SO_TRIGGER = 60;

/** ⑴ + ⑶ — văn bản `pg_get_triggerdef` đã ghim, theo tên trigger. */
function docGhim(): ReadonlyMap<string, string> {
  const ra = new Map<string, string>();
  for (const m of HARDENING.matchAll(/\$def\$(CREATE TRIGGER ([A-Za-z_0-9]+)[\s\S]*?)\$def\$/gu)) {
    ra.set(m[2]!, m[1]!);
  }
  return ra;
}

interface HangTrigger {
  readonly ten: string;
  readonly def: string;
  readonly bat: string;
  readonly cauXoa: string;
}

let db: TestDatabase;
const GHIM = docGhim();

async function docTrongCum(): Promise<ReadonlyMap<string, HangTrigger>> {
  const { rows } = await db.pool.query<HangTrigger>(
    "SELECT t.tgname AS ten, pg_catalog.pg_get_triggerdef(t.oid) AS def, t.tgenabled::text AS bat, " +
      "       pg_catalog.format('DROP TRIGGER %I ON %I.%I', t.tgname, n.nspname, c.relname) AS \"cauXoa\" " +
      "  FROM pg_catalog.pg_trigger t " +
      "  JOIN pg_catalog.pg_class c ON c.oid OPERATOR(pg_catalog.=) t.tgrelid " +
      "  JOIN pg_catalog.pg_namespace n ON n.oid OPERATOR(pg_catalog.=) c.relnamespace " +
      " WHERE NOT t.tgisinternal AND t.tgname OPERATOR(pg_catalog.=) ANY ($1::pg_catalog.text[])",
    [[...GHIM.keys()]],
  );
  return new Map(rows.map((h) => [h.ten, h]));
}

/** Mọi chỗ lệch giữa cụm và văn bản đã ghim, gọi tên — không chỉ một `toBe` mù. */
async function lechSoVoiGhim(): Promise<readonly string[]> {
  const trongCum = await docTrongCum();
  const loi: string[] = [];
  for (const [ten, def] of [...GHIM].sort(([a], [b]) => a.localeCompare(b))) {
    const h = trongCum.get(ten);
    if (h === undefined) {
      loi.push(`${ten}: KHÔNG CÓ trong cụm`);
      continue;
    }
    if (h.bat !== "A") loi.push(`${ten}: tgenabled = ${h.bat}, phải là 'A' (ENABLE ALWAYS — khuôn 043)`);
    if (h.def !== def) loi.push(`${ten}: bản trong cụm KHÁC văn bản đã ghim\n    cụm : ${h.def}\n    ghim: ${def}`);
  }
  return loi;
}

beforeAll(async () => {
  db = await startPostgres();
  await migrate(db.pool, MIGRATIONS_DIR);
}, 180000);

afterAll(async () => {
  await db?.stop();
});

describe("[INV-H19] [S1.100 / khoản 211] lượt tự chữa cài lại đúng bản đã ghim", { timeout: 180000 }, () => {
  it("[INV-H19] số đo của chủ thể: tập trigger được ghim không tụt xuống dưới sàn", () => {
    expect(GHIM.size, "số trigger có văn bản ghim `CREATE TRIGGER`").toBeGreaterThanOrEqual(SAN_SO_TRIGGER);
  });

  it("[INV-H19] ĐỐI CHỨNG: bản mà MIGRATION dựng đã khớp văn bản ghim ở ⑴/⑶", async () => {
    expect(await lechSoVoiGhim()).toEqual([]);
  });

  it("[INV-H19] xoá SẠCH mọi trigger được ghim rồi `migrate()` lại: cài lại ĐÚNG bản ấy, và ENABLE ALWAYS", async () => {
    const truoc = await docTrongCum();
    expect(truoc.size, "phải tìm thấy đủ trigger trong cụm trước khi xoá").toBe(GHIM.size);
    for (const h of truoc.values()) await db.pool.query(h.cauXoa);

    const conLai = await docTrongCum();
    expect(conLai.size, "sau lượt xoá thì KHÔNG còn trigger nào — nếu còn, câu xoá đã không chạy").toBe(0);

    await migrate(db.pool, MIGRATIONS_DIR);
    expect(await lechSoVoiGhim()).toEqual([]);
  });

  it("[INV-H19] một trigger TRÔI sang bản yếu hơn (mất mệnh đề `WHEN`) được chữa lại đúng bản ghim", async () => {
    // Chủ thể: trigger nhân chứng break-glass của `055`. Bản yếu = bỏ mệnh đề `WHEN`, tức nó fire
    // ở MỌI lần chèn — đúng hình dạng mà một lần "phục hồi từ trí nhớ" tạo ra.
    const ten = "unseal_requests_kiem_nhan_chung";
    expect(GHIM.has(ten), "trigger chủ thể phải nằm trong tập được ghim").toBe(true);
    await db.pool.query(`DROP TRIGGER ${ten} ON public.unseal_requests`);
    await db.pool.query(
      `CREATE TRIGGER ${ten} BEFORE INSERT ON public.unseal_requests FOR EACH ROW ` +
        "EXECUTE FUNCTION public.kiem_danh_tinh_theo_phien(" +
        "'break_glass_witness_user_id', 'break_glass_witness_session_id')",
    );
    const troi = (await docTrongCum()).get(ten);
    expect(troi?.def, "đột biến phải THẬT SỰ đổi bản trong cụm").not.toBe(GHIM.get(ten));

    await migrate(db.pool, MIGRATIONS_DIR);
    expect(await lechSoVoiGhim()).toEqual([]);
  });
});
