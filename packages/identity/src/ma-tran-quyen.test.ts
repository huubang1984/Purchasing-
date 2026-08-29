import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CHAIN_COVERING_ROLE_PAIRS,
  PERMISSIONS,
  SEPARATION_OF_DUTIES_CHAIN,
  type Permission,
} from "./permissions.js";

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

  it("[INV-D3] chuỗi khớp NGUYÊN VĂN ở cả sáu bản", () => {
    // [vòng fix 1 — C1] Bản THỨ SÁU: hằng CHUOI_D3 của hardening.always.sql, thứ mục (E3) dùng
    // để phán xét DỮ LIỆU ma trận quyền ở thời điểm deploy. Nó không nằm trong thân hàm nào nên
    // hai hàm cắt ở trên không với tới — phải cắt riêng, và phải cắt CHÍNH nó chứ không phải
    // một chuỗi na ná ở chỗ khác trong cùng file.
    const khopChuoiD3 = /CHUOI_D3 constant text :=\s*\$q\$([\s\S]*?)\$q\$;/.exec(SQL_HARDENING);
    if (khopChuoiD3 === null) {
      throw new Error("Không tìm thấy hằng CHUOI_D3 trong hardening.always.sql");
    }

    const cacBan: [string, string[]][] = [
      ["005 · mức người dùng", chuoiTrongThan(banTrong005NguoiDung, "005 $tpt$")],
      ["005 · mức vai trò", chuoiTrongThan(banTrong005VaiTro, "005 $tmt$")],
      ["hardening · THAN_PHAN_TACH", chuoiTrongThan(banHardeningNguoiDung, "THAN_PHAN_TACH")],
      ["hardening · THAN_MA_TRAN", chuoiTrongThan(banHardeningVaiTro, "THAN_MA_TRAN")],
      ["hardening · CHUOI_D3 (mục E3)", cacChuoi(khopChuoiD3[1]!)],
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
        // [vòng fix 1 — I2] CHỈ ĐÚNG LỚP BẮT. Bản trước viết "(E2) cũng chặn việc này ở THỜI
        // ĐIỂM DEPLOY". SAI: chính commit của Task 8 đã ĐỔI TẦNG mục (E2) thành một trigger,
        // và ở thời điểm deploy nó chỉ cưỡng chế SỰ TỒN TẠI và THÂN của hàm/trigger — nó KHÔNG
        // ĐỌC MỘT HÀNG NÀO. Đo được: `role_permissions` chứa một vai trò ôm trọn chuỗi ->
        // `migrate()` KHÔNG NÉM -> sau migrate vẫn còn nguyên.
        "Ở tầng CSDL, thứ chặn việc này là TRIGGER `role_permissions_ma_tran_quyen` vào thời " +
        "điểm GHI (không phải lúc deploy, và không với hàng đã nằm sẵn); mục (E3) của " +
        "hardening.always.sql phán xét dữ liệu lúc deploy nhưng chỉ phát WARNING. Test này bắt " +
        "sớm hơn cả hai, không cần Docker, và chỉ thấy ma trận VIẾT TRONG migration.",
    ).toEqual([]);
  });

  // ==========================================================================================
  // [vòng fix 1 — C1] TRỤC THỨ HAI CỦA D3: TẬP CẶP VAI TRÒ PHỦ TRỌN CHUỖI, ĐƯỢC GHIM
  //
  // Tập quyền HỢP của một người đổi theo HAI biến: (a) các hàng `user_roles` của người đó,
  // (b) ĐỊNH NGHĨA của các vai trò đó trong `role_permissions`. Hai trigger của 005 canh (a) và
  // canh "một vai trò TỰ MÌNH ôm trọn chuỗi" — trục (b) KHÔNG có lớp nào ở tầng CSDL, và không
  // đóng được bằng một trigger thứ ba (FAIL-OPEN đo được dưới FORCE RLS; xem khối "[vòng fix
  // 1 — C1]" ở 005_identity.sql §(3)).
  //
  // Đây là lớp TĨNH thay thế. Nó GHIM (QT2) thay vì NỚI: quy tắc phổ quát "không cặp nào được
  // phủ trọn chuỗi" KHÔNG THOẢ ĐƯỢC — ma trận mục 25 hôm nay đã có ba cặp phủ trọn, và
  // PROCUREMENT_MANAGER+DIRECTOR là ĐÚNG ca mà trigger mức người dùng sinh ra để chặn. Cái đáng
  // canh là tập ấy LỚN LÊN: một cặp mới nghĩa là những người ĐANG giữ sẵn cặp đó vừa lặng lẽ
  // nắm trọn chuỗi mà không trigger nào bắn.
  //
  // GIỚI HẠN, nói ra thay vì hứa suông: đây là quy tắc về CẶP. Hôm nay nó chặt bằng quy tắc về
  // tổ hợp bất kỳ (đo: không có bộ ba tối tiểu nào — mọi tổ hợp phủ trọn đều CHỨA một trong ba
  // cặp), nhưng một ma trận tương lai có bộ ba tối tiểu sẽ đi lọt lớp này.
  // ==========================================================================================
  /** Mọi cặp (a <= b) mà HỢP quyền của hai vai trò phủ trọn chuỗi. a === b = phủ ĐƠN LẺ. */
  function capPhuChuoi(pMaTran: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
    const ten = [...pMaTran.keys()].sort();
    const kq: string[][] = [];
    for (let i = 0; i < ten.length; i += 1) {
      for (let j = i; j < ten.length; j += 1) {
        const hop = new Set([...(pMaTran.get(ten[i]!) ?? []), ...(pMaTran.get(ten[j]!) ?? [])]);
        if (SEPARATION_OF_DUTIES_CHAIN.every((ma) => hop.has(ma))) kq.push([ten[i]!, ten[j]!]);
      }
    }
    return kq;
  }

  it("[INV-D3] tập CẶP vai trò phủ trọn chuỗi đúng bằng mốc đã GHIM", () => {
    const doDuoc = capPhuChuoi(maTran).map((c) => c.join("+")).sort();
    const daGhim = CHAIN_COVERING_ROLE_PAIRS.map((c) => [...c].sort().join("+")).sort();

    expect(daGhim.length, "chống rỗng ruột: mốc ghim phải có ít nhất một cặp").toBeGreaterThan(0);
    expect(
      doDuoc,
      "Tập cặp vai trò phủ TRỌN chuỗi D3 đã đổi so với mốc ghim. Một cặp MỚI nghĩa là những " +
        "người đang giữ sẵn cả hai vai trò trong cặp đó VỪA NẮM TRỌN chuỗi tạo RFQ -> chọn nhà " +
        "cung cấp -> mở thầu -> award -> duyệt, mà KHÔNG trigger nào bắn (trigger mức vai trò " +
        "chỉ hỏi về vai trò vừa ghi; trigger mức người dùng chỉ bắn khi ghi vào user_roles). " +
        "Nếu thay đổi này là CÓ CHỦ Ý: cập nhật CHAIN_COVERING_ROLE_PAIRS (permissions.ts) VÀ " +
        "CAP_PHU_CHUOI (hardening.always.sql), rồi RÀ những người đang giữ tổ hợp mới đó.",
    ).toEqual(daGhim);
  });

  it("[INV-D3] mốc ghim của TypeScript và của hardening.always.sql khớp nhau", () => {
    // Bản thứ hai của mốc ghim sống trong SQL để mục (E3) dùng được ở thời điểm deploy. Hai bản
    // trôi khỏi nhau nghĩa là hai lớp nói về hai bất biến khác nhau — đúng khuôn §R3.
    const khop = /CAP_PHU_CHUOI constant text :=\s*\$q\$([\s\S]*?)\$q\$;/.exec(SQL_HARDENING);
    if (khop === null) throw new Error("Không tìm thấy hằng CAP_PHU_CHUOI trong hardening");
    const banSql = [...khop[1]!.matchAll(/\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)]
      .map(([, a, b]) => [a!, b!].sort().join("+"))
      .sort();
    const banTs = CHAIN_COVERING_ROLE_PAIRS.map((c) => [...c].sort().join("+")).sort();
    expect(banSql.length, "chống rỗng ruột: cắt được ít nhất một cặp từ SQL").toBeGreaterThan(0);
    expect(banSql).toEqual(banTs);
  });

  it("phép kiểm CẶP KHÔNG rỗng ruột — hai khai thác đã đo phải bị bắt", () => {
    // Fixture cũng phải chịu đột biến. Hai ca dưới đây là ĐÚNG hai mũi mà hai reviewer độc lập
    // đo được trên CSDL thật; nếu `capPhuChuoi` viết sai (vd. `some` thay `every`) thì khẳng
    // định ở test trên vẫn có thể xanh trong khi lớp này không bắt được gì.
    const goc = new Map([...maTran].map(([k, v]) => [k, new Set(v)] as const));

    // [FO2] thêm rfq.unseal cho FINANCE -> BUYER+FINANCE thành 5/5.
    const fo2 = new Map([...goc].map(([k, v]) => [k, new Set(v)] as const));
    fo2.get("FINANCE")!.add(PERMISSIONS.RFQ_UNSEAL);
    expect(capPhuChuoi(fo2).map((c) => c.join("+"))).toContain("BUYER+FINANCE");

    // [MR] thêm rfq.create + rfq.invite cho TECHNICAL -> TECHNICAL+DIRECTOR thành 5/5.
    const mr = new Map([...goc].map(([k, v]) => [k, new Set(v)] as const));
    mr.get("TECHNICAL")!.add(PERMISSIONS.RFQ_CREATE);
    mr.get("TECHNICAL")!.add(PERMISSIONS.RFQ_INVITE);
    expect(capPhuChuoi(mr).map((c) => c.join("+"))).toContain("DIRECTOR+TECHNICAL");

    // Và một vai trò ĐƠN LẺ ôm trọn chuỗi phải hiện ra dưới dạng cặp (X, X) — đó là ca "vi phạm
    // NẰM SẴN" mà trigger của (E2) không bao giờ bắn tới.
    const donLe = new Map([...goc].map(([k, v]) => [k, new Set(v)] as const));
    for (const ma of SEPARATION_OF_DUTIES_CHAIN) donLe.get("TECHNICAL")!.add(ma);
    expect(capPhuChuoi(donLe).map((c) => c.join("+"))).toContain("TECHNICAL+TECHNICAL");
  });

  it("[INV-D3] CHỈ 005 được ghi vào role_permissions — mọi migration khác làm mốc ghim mù", () => {
    // [QT1 — bất biến ở phạm vi TỆP đòi quét TOÀN BỘ thư mục, không chỉ file vừa thêm]. Mốc
    // ghim ở trên đọc DUY NHẤT văn bản của 005. Một migration `006_...sql` chèn thêm quyền cho
    // một vai trò sẽ đổi ma trận THẬT mà không đổi thứ mốc ghim nhìn thấy — đúng khe hở [MR]/
    // [FO2], chỉ khác là đi qua đường "sửa bằng một migration đánh số MỚI" mà 005 tuyên bố là
    // an toàn. Test này biến việc đó thành một lần ĐỎ Ở CI, buộc tác giả tính lại mốc ghim.
    const thuMuc = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
    const viPham: string[] = [];
    for (const ten of readdirSync(thuMuc).filter((f) => f.endsWith(".sql")).sort()) {
      if (ten === "005_identity.sql") continue;
      const noiDung = readFileSync(`${thuMuc}/${ten}`, "utf8");
      // Chỉ soi câu GHI (INSERT/UPDATE/DELETE/COPY/TRUNCATE) nhắm vào bảng, không soi mọi lần
      // NHẮC TỚI tên bảng: hardening.always.sql đọc `role_permissions` ở hàng chục chỗ và đó là
      // việc hợp lệ của nó.
      const cauGhi =
        /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|COPY|TRUNCATE(?:\s+TABLE)?)\s+(?:public\.)?role_permissions\b/i;
      if (cauGhi.test(noiDung)) viPham.push(ten);
    }
    expect(
      viPham,
      "Một migration ngoài 005 ghi vào `role_permissions`. Mốc ghim CHAIN_COVERING_ROLE_PAIRS " +
        "chỉ đọc văn bản 005 nên nó KHÔNG thấy thay đổi này — tính lại tập cặp phủ trọn chuỗi " +
        "trên ma trận SAU khi áp file đó, cập nhật cả hai bản mốc ghim, và rà những người đang " +
        "giữ tổ hợp mới. Sau đó mở rộng chính test này để nó đọc được file mới.",
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
