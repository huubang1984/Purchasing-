// ==============================================================================================
// [khoản 105] DÒNG KHAI `CHECK_AN_NINH_KHAI` PHẢI TRỎ MIGRATION CUỐI CÙNG ĐỊNH NGHĨA RÀNG BUỘC
//
// Mục phán xét của hardening chỉ hỏi một dòng khai khi migration `mig` của nó đã áp, rồi so định nghĩa NGUYÊN VĂN. Nếu một
// migration SAU đổi ràng buộc ấy mà quên sửa dòng khai, `mig` vẫn đã áp và định nghĩa lệch ⇒ deploy đỏ — ồn ào, tốt. Nhưng nếu
// dòng khai trỏ một migration CŨ hơn lần đổi, một cụm dừng ở giữa hai migration (cụm test chạy một phần, hay một deploy dở)
// bị phán xét theo định nghĩa CHƯA tồn tại. Cổng này đòi: `mig` tồn tại, và không migration đánh số nào SAU nó nhắc tên ràng
// buộc — cùng quy ước ⑸ của `Handoff.md`: hardening và migration nó ghim đi CÙNG một commit.
// ==============================================================================================
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const THU_MUC = fileURLToPath(new URL("../../db/migrations/", import.meta.url));

function docKhai(): { conname: string; mig: string }[] {
  const sql = readFileSync(join(THU_MUC, "hardening.always.sql"), "utf8");
  const dau = sql.indexOf("CHECK_AN_NINH_KHAI constant text :=");
  const cuoi = sql.indexOf(") AS ck(nspname, bang, conname, mig, dinh_nghia)$q$;", dau);
  if (dau < 0 || cuoi < 0) throw new Error("không tìm thấy CHECK_AN_NINH_KHAI");
  return [...sql.slice(dau, cuoi).matchAll(/\('public', '[a-z_]+', '([a-z0-9_]+)', '([0-9]{3}_[a-z0-9_]+)', /gu)].map((m) => ({
    conname: m[1]!,
    mig: m[2]!,
  }));
}

describe("[khoản 105] CHECK_AN_NINH_KHAI trỏ đúng migration", () => {
  const tep = readdirSync(THU_MUC)
    .filter((t) => /^[0-9]{3}_.*\.sql$/u.test(t))
    .sort();
  const khai = docKhai();

  it("bộ đọc không rỗng ruột, và mỗi tên khai đúng một lần", () => {
    expect(khai.length).toBeGreaterThanOrEqual(40);
    expect(new Set(khai.map((k) => k.conname)).size).toBe(khai.length);
  });

  it("mỗi `mig` là một migration có thật, và không migration nào SAU nó nhắc tên ràng buộc", () => {
    const loi: string[] = [];
    for (const { conname, mig } of khai) {
      const viTri = tep.indexOf(`${mig}.sql`);
      if (viTri < 0) {
        loi.push(`${conname}: migration ${mig}.sql không tồn tại`);
        continue;
      }
      const mau = new RegExp(`\\b${conname}\\b`, "u");
      for (const sau of tep.slice(viTri + 1)) {
        if (mau.test(readFileSync(join(THU_MUC, sau), "utf8"))) loi.push(`${conname}: khai ${mig}, nhưng ${sau} nhắc lại nó`);
      }
    }
    expect(loi).toEqual([]);
  });
});
