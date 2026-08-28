import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PERMISSIONS, SEPARATION_OF_DUTIES_CHAIN, type Permission } from "./permissions.js";

// ============================================================================================
// §R3 — NĂM BẢN CỦA MỘT BẤT BIẾN PHẢI KHỚP NHAU
//
// Bất biến D3 ("chuỗi tạo RFQ -> chọn nhà cung cấp -> mở thầu -> award -> duyệt không nằm trọn
// trong tay một người") sống trong NĂM bản, mỗi bản phục vụ một lớp khác nhau:
//   1. packages/identity/src/permissions.ts — SEPARATION_OF_DUTIES_CHAIN (tầng ứng dụng đọc);
//   2. db/migrations/005_identity.sql, thân `kiem_tra_phan_tach_nhiem_vu()` — cưỡng chế ở mức
//      NGƯỜI DÙNG vào thời điểm GHI (`user_roles` là bảng app_api ghi được);
//   3. db/migrations/005_identity.sql, thân `kiem_tra_ma_tran_quyen()` — cưỡng chế ở mức VAI TRÒ
//      vào thời điểm GHI (kể cả câu seed của chính file đó cũng đi qua phép kiểm này);
//   4./5. db/migrations/hardening.always.sql — THAN_PHAN_TACH và THAN_MA_TRAN, bản CƯỠNG CHẾ của
//      hai thân trên, được áp lại ở MỌI lần migrate().
//
// Các lớp chỉ nói về CÙNG MỘT bất biến khi các danh sách khớp nhau. Một bản trôi đi là kiểu hỏng
// mà KHÔNG test hành vi nào bắt được: mỗi lớp vẫn "hoạt động", chỉ là chúng canh những thứ khác
// nhau — đúng khuôn §R3 đã dùng cho thân `app_current_org_id()` và `noi_chuoi_kiem_toan()`.
// Nguy hiểm hơn: nếu bản (4)/(5) lệch khỏi (2)/(3), hardening GHI ĐÈ hàm của migration ở mọi
// lần deploy, và bản thật sự đang chạy KHÔNG phải bản người đọc thấy trong migration.
//
// File này chạy KHÔNG CẦN database: nó đọc văn bản .sql. Đó là chủ ý — một phép kiểm chỉ chạy
// khi có Docker là một phép kiểm hay bị bỏ qua.
// ============================================================================================

const THU_MUC = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
const SQL_005 = readFileSync(`${THU_MUC}/005_identity.sql`, "utf8");
const SQL_HARDENING = readFileSync(`${THU_MUC}/hardening.always.sql`, "utf8");

/** Cắt phần nằm giữa cặp thẻ dollar-quote `$<ten>$` thứ n và n+1. */
function catTheDollar(pNoiDung: string, pThe: string, pLanThu = 0): string {
  const mau = `$${pThe}$`;
  const cacViTri: number[] = [];
  for (let i = pNoiDung.indexOf(mau); i !== -1; i = pNoiDung.indexOf(mau, i + 1)) {
    cacViTri.push(i);
  }
  const mo = cacViTri[pLanThu * 2];
  const dong = cacViTri[pLanThu * 2 + 1];
  if (mo === undefined || dong === undefined) {
    throw new Error(`Không tìm thấy cặp thẻ ${mau} thứ ${String(pLanThu)}`);
  }
  return pNoiDung.slice(mo + mau.length, dong);
}

/** Mọi chuỗi ký tự đơn nháy trong một đoạn SQL, theo đúng thứ tự xuất hiện. */
function cacChuoi(pSql: string): string[] {
  return [...pSql.matchAll(/'([^']*)'/g)].map((m) => m[1]!);
}

/** Cắt phần `VALUES ... ;` của một câu INSERT vào bảng cho trước. */
function catValues(pSql: string, pBang: string): string {
  const bieuThuc = new RegExp(String.raw`INSERT\s+INTO\s+${pBang}\s*\([^)]*\)\s*VALUES([\s\S]*?);`, "i");
  const khop = bieuThuc.exec(pSql);
  if (khop === null) throw new Error(`Không tìm thấy INSERT INTO ${pBang}`);
  return khop[1]!;
}

/** Lấy danh sách mã trong `unnest(ARRAY[...])` của một thân hàm plpgsql. */
function chuoiTrongThan(pThan: string, pNhan: string): string[] {
  const khop = /unnest\(ARRAY\[([\s\S]*?)\]\)/.exec(pThan);
  if (khop === null) throw new Error(`Không tìm thấy unnest(ARRAY[...]) trong ${pNhan}`);
  return cacChuoi(khop[1]!);
}

/** Cắt thân của một hằng `<TEN> constant text := $<the>$ ... $<the>$;` trong hardening. */
function catHangThan(pTen: string, pThe: string): string {
  const bieuThuc = new RegExp(
    String.raw`${pTen} constant text := \$${pThe}\$([\s\S]*?)\$${pThe}\$;`,
  );
  const khop = bieuThuc.exec(SQL_HARDENING);
  if (khop === null) throw new Error(`Không tìm thấy hằng ${pTen} trong hardening.always.sql`);
  return khop[1]!;
}

const gapKhoangTrang = (s: string): string => s.replace(/\s+/g, " ").trim();

describe("§R3 — các bản của chuỗi phân tách nhiệm vụ (D3)", () => {
  // BỐN thân hàm mang danh sách này: hai trong 005 (mức người dùng, mức vai trò) và hai bản
  // cưỡng chế tương ứng trong hardening.always.sql. Cộng bản TypeScript là NĂM.
  const banTrong005NguoiDung = catTheDollar(SQL_005, "tpt");
  const banTrong005VaiTro = catTheDollar(SQL_005, "tmt");
  const banHardeningNguoiDung = catHangThan("THAN_PHAN_TACH", "tpt");
  const banHardeningVaiTro = catHangThan("THAN_MA_TRAN", "tmt");

  it("[INV-D3] chuỗi khớp NGUYÊN VĂN ở cả năm bản", () => {
    const cacBan: [string, string[]][] = [
      ["005 · mức người dùng", chuoiTrongThan(banTrong005NguoiDung, "005 $tpt$")],
      ["005 · mức vai trò", chuoiTrongThan(banTrong005VaiTro, "005 $tmt$")],
      ["hardening · THAN_PHAN_TACH", chuoiTrongThan(banHardeningNguoiDung, "THAN_PHAN_TACH")],
      ["hardening · THAN_MA_TRAN", chuoiTrongThan(banHardeningVaiTro, "THAN_MA_TRAN")],
    ];
    for (const [nhan, danhSach] of cacBan) {
      expect(danhSach.length, `${nhan}: chống rỗng ruột, chuỗi phải có 5 bước`).toBe(5);
      expect([...SEPARATION_OF_DUTIES_CHAIN], nhan).toEqual(danhSach);
    }
  });

  it("[INV-D3] mọi mã trong chuỗi là một mã quyền CÓ THẬT của PERMISSIONS", () => {
    const hopLe = new Set<string>(Object.values(PERMISSIONS));
    for (const ma of SEPARATION_OF_DUTIES_CHAIN) expect(hopLe).toContain(ma);
  });

  it("thân hai trigger trong 005 khớp bản cưỡng chế tương ứng trong hardening", () => {
    // Cùng khuôn mà (D1b) dùng cho `noi_chuoi_kiem_toan()`: hai bản phải khớp SAU khi chuẩn hoá
    // khoảng trắng, vì chính hậu điều kiện của hardening so `prosrc` theo cách đó. Nếu hai bản
    // trôi khỏi nhau, hardening GHI ĐÈ hàm của 005 ở mọi lần deploy mà không ai biết.
    expect(gapKhoangTrang(banTrong005NguoiDung)).toBe(gapKhoangTrang(banHardeningNguoiDung));
    expect(gapKhoangTrang(banTrong005VaiTro)).toBe(gapKhoangTrang(banHardeningVaiTro));
    // Hai thân KHÁC nhau — nếu chúng bằng nhau thì một trong hai mục hardening đang canh nhầm
    // hàm, và cả hai khẳng định trên vẫn xanh.
    expect(gapKhoangTrang(banTrong005NguoiDung)).not.toBe(gapKhoangTrang(banTrong005VaiTro));
  });
});

describe("§R3 — danh mục quyền", () => {
  it("PERMISSIONS khớp NGUYÊN VĂN bảng `permissions` trong 005", () => {
    // `cacChuoi` lấy CẢ mã lẫn mô tả, nên chỉ giữ phần tử ở vị trí chẵn (cột `code`).
    const maTrongSql = cacChuoi(catValues(SQL_005, "permissions")).filter((_v, i) => i % 2 === 0);
    expect(maTrongSql.length, "chống rỗng ruột").toBeGreaterThan(0);
    expect([...maTrongSql].sort()).toEqual([...Object.values(PERMISSIONS)].sort());
  });
});

describe("[INV-D3] ma trận quyền trong 005 thoả phân tách nhiệm vụ", () => {
  /** (vai trò -> tập mã quyền), đọc THẲNG từ văn bản migration. */
  const maTran = (() => {
    const cap = [...catValues(SQL_005, "role_permissions").matchAll(/\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)];
    const ketQua = new Map<string, Set<string>>();
    for (const [, vaiTro, quyen] of cap) {
      const tap = ketQua.get(vaiTro!) ?? new Set<string>();
      tap.add(quyen!);
      ketQua.set(vaiTro!, tap);
    }
    return ketQua;
  })();

  it("chống rỗng ruột: ma trận đọc được và có đủ sáu vai trò", () => {
    expect([...maTran.keys()].sort()).toEqual([
      "BUYER",
      "DIRECTOR",
      "FINANCE",
      "PROCUREMENT_MANAGER",
      "REQUESTER",
      "TECHNICAL",
    ]);
  });

  it("mọi vai trò trong role_permissions đều có trong bảng `roles`", () => {
    const maVaiTro = new Set(
      cacChuoi(catValues(SQL_005, "roles")).filter((_v, i) => i % 2 === 0),
    );
    for (const vaiTro of maTran.keys()) expect(maVaiTro).toContain(vaiTro);
  });

  it("mọi mã quyền trong role_permissions đều là mã có thật", () => {
    const hopLe = new Set<string>(Object.values(PERMISSIONS));
    for (const [vaiTro, tap] of maTran) {
      for (const ma of tap) expect(hopLe, `vai trò ${vaiTro}`).toContain(ma);
    }
  });

  it("[INV-D3] KHÔNG vai trò nào ôm trọn chuỗi năm bước", () => {
    const omTron = [...maTran.entries()]
      .filter(([, tap]) => SEPARATION_OF_DUTIES_CHAIN.every((ma) => tap.has(ma)))
      .map(([vaiTro]) => vaiTro);
    expect(
      omTron,
      "Một vai trò ôm trọn chuỗi nghĩa là một người mang vai trò đó nắm trọn quy trình. " +
        "hardening.always.sql mục (E2) cũng chặn việc này ở thời điểm deploy; test này bắt nó " +
        "sớm hơn, không cần Docker.",
    ).toEqual([]);
  });

  it("phép kiểm D3 KHÔNG rỗng ruột — một ma trận cố tình sai phải bị bắt", () => {
    // Fixture cũng phải chịu đột biến: nếu vế lọc trên viết sai (vd. `some` thay `every`), test
    // trước vẫn xanh. Ca đối chứng này chứng minh nó THẬT SỰ bắt được.
    const xau = new Map<string, Set<string>>([
      ["SIEU_VAI", new Set<string>(SEPARATION_OF_DUTIES_CHAIN as readonly Permission[])],
      ["VO_HAI", new Set<string>([PERMISSIONS.RFQ_CREATE])],
    ]);
    const omTron = [...xau.entries()]
      .filter(([, tap]) => SEPARATION_OF_DUTIES_CHAIN.every((ma) => tap.has(ma)))
      .map(([vaiTro]) => vaiTro);
    expect(omTron).toEqual(["SIEU_VAI"]);
  });
});
