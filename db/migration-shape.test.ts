import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ============================================================================================
// [S7b-T3] TÍNH NGUYÊN TỬ CỦA MỘT BẢNG CÓ RLS — CƯỠNG CHẾ TĨNH, KHÔNG CẦN DATABASE
//
// Bộ chạy migration chạy MỖI FILE trong MỘT transaction riêng (packages/db/src/migrate.ts).
// Nên nếu CREATE TABLE ở file N còn ENABLE/FORCE ROW LEVEL SECURITY ở file N+1, một lần
// migrate() hỏng giữa hai file để lại production với bảng có org_id mà KHÔNG có RLS.
//
// Vì sao phép kiểm này KHÔNG THAY THẾ được bằng db/rls-coverage.int.test.ts, và ngược lại:
// test kia đọc TRẠNG THÁI CUỐI sau khi toàn bộ migration đã chạy xong, nên một lược đồ chia
// đôi qua hai file vẫn cho ra trạng thái cuối hoàn hảo và test kia vẫn xanh. Thứ nguy hiểm ở
// đây không phải trạng thái cuối mà là CỬA SỔ ở giữa — và cửa sổ đó chỉ nhìn thấy được khi
// đọc từng file riêng. Hai test canh hai thứ khác nhau; cần cả hai.
//
// [vòng fix 1 — I5] Lớp này từng HỎNG IM LẶNG với ba dạng cú pháp hoàn toàn hợp lệ. Đo được
// trên chính bản trước (dựng file giả rồi chạy lại đúng bốn test):
//   CREATE TABLE "bids" (... org_id ...)   -> 4/4 test XANH dù không ENABLE, không FORCE,
//                                             không POLICY, không GRANT. Lớp tĩnh là lớp DUY
//                                             NHẤT nhìn thấy cửa sổ giữa hai transaction.
//   CREATE TABLE public.bids (...)         -> bắt tên bảng thành "public", đỏ với thông báo
//                                             sai lệch (fail-closed nhưng gây mất thì giờ).
//   CREATE TABLE bao_gia_a PARTITION OF ...-> thân không khai cột nào nên không bị coi là bảng
//                                             tenant (xem CR2 bên dưới).
// Cả ba nay có test đối kháng riêng ở cuối file, chạy trên FILE GIẢ để không phải làm bẩn
// migration thật.
// ============================================================================================

const THU_MUC = fileURLToPath(new URL("./migrations", import.meta.url));

/**
 * Giống danh sách trong db/rls-coverage.int.test.ts và VI_TU_BANG_TENANT của
 * db/migrations/hardening.always.sql: bảng gốc của cây tenant, id LÀ tổ chức.
 * [vòng fix 1 — M1] Có test đồng bộ ba nơi ở db/rls-coverage.int.test.ts.
 */
const BANG_GOC_TENANT = ["organizations"];

/**
 * Một định danh SQL: hoặc `"có dấu nháy kép"`, hoặc trần. Cho phép cả `$` trong tên trần
 * (PostgreSQL cho phép từ ký tự thứ hai).
 */
const DINH_DANH = String.raw`(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)`;
/** Tên bảng có thể mang schema: `public.bids`, `"public"."bids"`, `bids`. */
const TEN_CO_SCHEMA = String.raw`(?:${DINH_DANH}\s*\.\s*)?(${DINH_DANH})`;

/** Bỏ dấu nháy kép và hạ thường tên trần, đúng quy tắc gấp chữ của PostgreSQL. */
function chuanHoaTen(pTho: string): string {
  const ten = pTho.trim();
  return ten.startsWith('"') ? ten.slice(1, -1) : ten.toLowerCase();
}

/** Escape để nhúng an toàn vào biểu thức chính quy. */
function neo(pTen: string): string {
  return pTen.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Khuôn regex khớp MỘT tên bảng cụ thể ở mọi cách viết: trần, có nháy kép, có schema.
 * Không có nó thì `CREATE TABLE "bids"` và `ALTER TABLE bids ...` không nhận ra nhau.
 */
function mauTenBang(pTen: string): string {
  const e = neo(pTen);
  return String.raw`(?:${DINH_DANH}\s*\.\s*)?(?:"${e}"|${e})`;
}

/**
 * Bỏ chú thích trước khi so khớp. Không có bước này, chính các đoạn bình luận giải thích khuôn
 * RLS ở đầu 002 sẽ được đọc như câu lệnh thật và làm mọi phép kiểm dưới đây xanh giả.
 *
 * [vòng fix 1 — I5] Nay bỏ CẢ chú thích khối `/* … *\/`, không chỉ `--`. Giới hạn đã biết và
 * cố ý: hàm này không phân tích chuỗi ký tự, nên một dấu `--` nằm TRONG một chuỗi SQL cũng bị
 * cắt. Hướng sai đó là fail-CLOSED (cắt bớt văn bản chỉ làm phép kiểm khắt khe hơn, không làm
 * nó bỏ sót một CREATE TABLE), nên chấp nhận thay vì viết một bộ phân tích SQL.
 */
function boChuThich(pNoiDung: string): string {
  return pNoiDung.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "");
}

/** Cắt phần thân trong ngoặc của CREATE TABLE, đếm ngoặc cân bằng từ dấu "(" đầu tiên. */
function catThanBang(pSql: string, pViTriBatDau: number): string {
  const mo = pSql.indexOf("(", pViTriBatDau);
  if (mo === -1) return "";
  let sau = 0;
  for (let i = mo; i < pSql.length; i += 1) {
    if (pSql[i] === "(") sau += 1;
    else if (pSql[i] === ")") {
      sau -= 1;
      if (sau === 0) return pSql.slice(mo + 1, i);
    }
  }
  return "";
}

interface BangTimDuoc {
  tenBang: string;
  tenFile: string;
  chiuRangBuocTenant: boolean;
  /** Tên bảng cha khi đây là `CREATE TABLE … PARTITION OF <cha>`, ngược lại null. */
  chaPhanManh: string | null;
}

function docCacFile(): Map<string, string> {
  const ketQua = new Map<string, string>();
  for (const tenFile of readdirSync(THU_MUC).filter((f) => f.endsWith(".sql")).sort()) {
    ketQua.set(tenFile, readFileSync(`${THU_MUC}/${tenFile}`, "utf8"));
  }
  return ketQua;
}

/**
 * [vòng fix 1 — CR2] Nhận diện cả `CREATE TABLE … PARTITION OF <cha>`. Thân của nó KHÔNG khai
 * cột nào (phân mảnh thừa hưởng toàn bộ cột của cha), nên vòng trước không coi nó là bảng
 * tenant và một lá phân mảnh của bảng báo giá sẽ đi qua lớp tĩnh mà không cần RLS.
 * Đã đo trên PostgreSQL 16.15 vì sao lá PHẢI có RLS của chính nó, kể cả khi cha đã có đủ:
 *   policy trên CHA, lá không bật RLS -> app_api gắn tổ chức A đọc THẲNG lá của tổ chức B
 *   thấy nguyên dữ liệu của B. "Viết đúng khuôn PostgreSQL" vẫn hở vì lá là một bảng gọi được.
 */
function timCacBang(pFile: Map<string, string>): BangTimDuoc[] {
  const tho: (BangTimDuoc & { than: string })[] = [];
  for (const [tenFile, sqlTho] of pFile) {
    const sql = boChuThich(sqlTho);
    const bieuThuc = new RegExp(
      String.raw`CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${TEN_CO_SCHEMA}` +
        String.raw`(\s+PARTITION\s+OF\s+${TEN_CO_SCHEMA})?`,
      "gi",
    );
    for (const khop of sql.matchAll(bieuThuc)) {
      const tenBang = chuanHoaTen(khop[1]!);
      const chaPhanManh = khop[3] === undefined ? null : chuanHoaTen(khop[3]);
      const than = catThanBang(sql, khop.index + khop[0].length);
      tho.push({
        tenBang,
        tenFile,
        chaPhanManh,
        than,
        chiuRangBuocTenant: /\borg_id\b/.test(than) || BANG_GOC_TENANT.includes(tenBang),
      });
    }
  }

  // Lá phân mảnh thừa hưởng ràng buộc tenant của CHA — kể cả khi cha nằm ở file khác.
  const theoTen = new Map(tho.map((b) => [b.tenBang, b]));
  const chiuTenant = (pBang: BangTimDuoc, pDaTham: Set<string>): boolean => {
    if (pBang.chiuRangBuocTenant) return true;
    if (pBang.chaPhanManh === null || pDaTham.has(pBang.tenBang)) return false;
    pDaTham.add(pBang.tenBang);
    const cha = theoTen.get(pBang.chaPhanManh);
    return cha === undefined ? false : chiuTenant(cha, pDaTham);
  };

  return tho.map((b) => ({
    tenBang: b.tenBang,
    tenFile: b.tenFile,
    chaPhanManh: b.chaPhanManh,
    chiuRangBuocTenant: chiuTenant(b, new Set()),
  }));
}

/**
 * Năm thứ phải nằm cùng file với CREATE TABLE của một bảng tenant.
 *
 * [vòng fix 1 — CR2] LÁ PHÂN MẢNH chỉ bị đòi ENABLE + FORCE, KHÔNG bị đòi POLICY và GRANT.
 * Lý do đo được, không phải khoan dung: đường đọc thật của ứng dụng đi QUA BẢNG CHA, nơi policy
 * và GRANT đã có. Đòi lá phải có policy riêng là đòi một thứ mà khuôn PostgreSQL không sinh ra,
 * và chính nó là triệu chứng thứ ba của I3 (một lược đồ ĐÚNG làm hardening gãy MỌI LẦN).
 * Còn ENABLE + FORCE thì lá THẬT SỰ cần: không có nó, đọc thẳng lá bỏ qua RLS (đã đo).
 */
function kiemTraNguyenTu(pFile: Map<string, string>): string[] {
  const thieu: string[] = [];
  for (const bang of timCacBang(pFile)) {
    if (!bang.chiuRangBuocTenant) continue;
    const sql = boChuThich(pFile.get(bang.tenFile)!);
    const ten = mauTenBang(bang.tenBang);

    const canCo: [string, RegExp][] = [
      ["ENABLE ROW LEVEL SECURITY", new RegExp(`ALTER\\s+TABLE\\s+${ten}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, "i")],
      ["FORCE ROW LEVEL SECURITY", new RegExp(`ALTER\\s+TABLE\\s+${ten}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`, "i")],
    ];
    if (bang.chaPhanManh === null) {
      canCo.push(
        ["CREATE POLICY", new RegExp(`CREATE\\s+POLICY\\s+${DINH_DANH}\\s+ON\\s+${ten}(?![A-Za-z0-9_$"])`, "i")],
        ["GRANT", new RegExp(`GRANT\\s[^;]*\\sON\\s+(?:TABLE\\s+)?${ten}(?![A-Za-z0-9_$"])[^;]*;`, "is")],
      );
    }

    for (const [nhan, bieuThuc] of canCo) {
      if (!bieuThuc.test(sql)) {
        thieu.push(`${bang.tenFile} tạo bảng "${bang.tenBang}" nhưng thiếu ${nhan} trong CÙNG file`);
      }
    }
  }
  return thieu;
}

/** Không file nào được bật RLS hay tạo/sửa policy cho bảng do file KHÁC tạo ra. */
function kiemTraLacCho(pFile: Map<string, string>): string[] {
  const fileTaoBang = new Map(timCacBang(pFile).map((b) => [b.tenBang, b.tenFile]));
  const lacCho: string[] = [];

  const cacCauLenh: [string, RegExp][] = [
    [
      "ALTER TABLE ... ROW LEVEL SECURITY",
      new RegExp(
        String.raw`ALTER\s+TABLE\s+${TEN_CO_SCHEMA}\s+(?:ENABLE|FORCE|DISABLE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY`,
        "gi",
      ),
    ],
    // [vòng fix 1 — M6] ALTER POLICY cũng bị soi. Vòng trước chỉ nhìn CREATE POLICY, nên một
    // "ALTER POLICY ... USING (true)" viết thẳng trong file migration đi qua lớp tĩnh im lặng.
    [
      "CREATE/ALTER POLICY",
      new RegExp(
        String.raw`(?:CREATE|ALTER)\s+POLICY\s+${DINH_DANH}\s+ON\s+${TEN_CO_SCHEMA}`,
        "gi",
      ),
    ],
  ];

  for (const [tenFile, sqlTho] of pFile) {
    const sql = boChuThich(sqlTho);
    for (const [nhan, bieuThuc] of cacCauLenh) {
      for (const khop of sql.matchAll(bieuThuc)) {
        const tenBang = chuanHoaTen(khop[1]!);
        const fileGoc = fileTaoBang.get(tenBang);
        if (fileGoc === undefined) {
          lacCho.push(`${tenFile}: "${nhan}" trên bảng "${tenBang}" không được file nào tạo`);
        } else if (fileGoc !== tenFile) {
          lacCho.push(
            `${tenFile}: "${nhan}" trên bảng "${tenBang}" — bảng đó được tạo ở ${fileGoc}. ` +
              "Tách hai việc qua hai file để lộ cửa sổ không có RLS giữa hai transaction.",
          );
        }
      }
    }
  }
  return lacCho;
}

/**
 * [S11-T3] Lớp tĩnh của các dạng bị cấm. KHÁC bản catalog ở chỗ nó đọc VĂN BẢN SQL chứ không
 * đọc cây phân tích đã deparse, nên nó KHÔNG thể là danh sách trắng — nó là một lưới bắt sớm,
 * best-effort, chạy được không cần Docker. Lớp có thẩm quyền là danh sách trắng hình dạng ở
 * db/migrations/hardening.always.sql + db/rls-coverage.int.test.ts.
 * [vòng fix 1 — I6] Phát biểu này cố ý hẹp hơn bản trước ("ba dạng bị cấm"): nó bắt được ba
 * CÁCH VIẾT, và bốn payload viết lại tương đương ngữ nghĩa đã chứng minh cách viết ≠ dạng.
 */
function kiemTraFailOpen(pFile: Map<string, string>): string[] {
  const viPham: string[] = [];
  for (const [tenFile, sqlTho] of pFile) {
    const sql = boChuThich(sqlTho);
    const bieuThuc = new RegExp(
      String.raw`(CREATE|ALTER)\s+POLICY\s+(${DINH_DANH})\s+ON\s+${TEN_CO_SCHEMA}([\s\S]*?);`,
      "gi",
    );
    for (const khop of sql.matchAll(bieuThuc)) {
      const ten = chuanHoaTen(khop[2]!);
      const than = khop[4]!;
      if (/app_current_org_id\s*\(\s*\)\s+IS\s+NULL/i.test(than)) {
        viPham.push(`${tenFile}: policy "${ten}" dùng "app_current_org_id() IS NULL" — fail-open`);
      }
      if (/\bcoalesce\s*\(/i.test(than)) {
        viPham.push(`${tenFile}: policy "${ten}" dùng coalesce() trong biểu thức policy`);
      }
      // [vòng fix 1 — I4] Chỉ đòi WITH CHECK với policy CÓ hàng mới. PostgreSQL TỪ CHỐI cú
      // pháp đó trên SELECT/DELETE ("WITH CHECK cannot be applied to SELECT or DELETE"), nên
      // bản trước đòi một thứ KHÔNG VIẾT RA ĐƯỢC: nó báo đỏ một policy FOR SELECT hoàn toàn
      // hợp lệ, mà chính §5.3 của báo cáo lại nêu "policy tách theo lệnh" là ca nguy hiểm cần
      // canh. Lớp catalog làm đúng từ đầu (polcmd IN ('*','a','w')); lớp này nay khớp theo.
      const chiDoc = /\bFOR\s+(SELECT|DELETE)\b/i.test(than);
      if (!chiDoc && !/\bWITH\s+CHECK\b/i.test(than)) {
        viPham.push(`${tenFile}: policy "${ten}" không viết WITH CHECK tường minh`);
      }
      if (/\bWITH\s+CHECK\s*\(\s*true\s*\)/i.test(than)) {
        viPham.push(`${tenFile}: policy "${ten}" có WITH CHECK (true) — không kiểm gì cả`);
      }
      if (/\bUSING\s*\(\s*true\s*\)/i.test(than)) {
        viPham.push(`${tenFile}: policy "${ten}" có USING (true) — không chặn gì cả`);
      }
    }
  }
  return viPham;
}

describe("hình dạng file migration", () => {
  const cacFile = docCacFile();
  const cacBang = timCacBang(cacFile);

  it("có ít nhất một bảng chịu ràng buộc tenant để kiểm — không rỗng ruột", () => {
    // [Task 8] `user_roles` là bảng DUY NHẤT của 005 có org_id. `permissions`, `roles` và
    // `role_permissions` là DANH MỤC TOÀN CỤC — không org_id, không phải bảng gốc của cây
    // tenant, nên chúng không thuộc CẢ HAI loại mà hạ tầng Task 3–6 phân biệt, và cả lớp tĩnh
    // này lẫn hardening.always.sql đều KHÔNG đụng tới chúng. Đó là hành vi ĐÚNG, không phải một
    // lỗ: một bảng danh mục toàn cục không mang dữ liệu của tổ chức nào để mà cách ly. Vì thế
    // KHÔNG có dòng nào được thêm vào NGOAI_LE_HINH_DANG (danh sách đó vẫn RỖNG ở S0) — xem
    // db/migrations/005_identity.sql khối "LỆCH KHỎI BRIEF (1/3)".
    // [Task 9] Hai bảng mới của 006 — `sessions` và `mfa_credentials` — đều có org_id, nên cả
    // hai phải lọt vào danh sách này VÀ phải đi qua hình dạng CHUẨN của mục (B) trong
    // hardening.always.sql. Hệ quả cố ý: `NGOAI_LE_HINH_DANG` VẪN RỖNG sau Task 9 (policy của
    // chúng là `(org_id = app_current_org_id())` nguyên văn, đúng dòng `co_org_id` của danh
    // sách trắng). Nếu một task sau phải thêm dòng đầu tiên vào cửa đó, đấy là một quyết định
    // an ninh có review bắt buộc, không phải một dòng lặng lẽ.
    // [Task 10] `outbox_jobs` của 007 cũng có org_id, nên nó chịu ĐÚNG cùng bộ ràng buộc — và
    // hệ quả vẫn giữ nguyên: `NGOAI_LE_HINH_DANG` VẪN RỖNG sau Task 10. Chi tiết đáng ghi vì
    // brief mời gọi hướng ngược lại: một runner "vượt RLS" sẽ đòi hoặc một policy hình dạng
    // khác (tức một dòng đầu tiên trong cửa ngoại lệ), hoặc một role có BYPASSRLS. 007 không
    // làm cái nào — nó chạy runner TRONG ngữ cảnh tenant. Xem "LỆCH KHỎI BRIEF (4/9)" ở
    // db/migrations/007_outbox.sql.
    // [S1.1] Hai bảng mới của 008 — `suppliers` và `supplier_contacts` — đều có org_id, nên cả
    // hai chịu ĐÚNG cùng bộ ràng buộc và đi qua hình dạng CHUẨN của mục (B) trong
    // hardening.always.sql. Hệ quả cố ý, giữ nguyên qua Task 8/9/10 và nay qua S1.1:
    // `NGOAI_LE_HINH_DANG` VẪN RỖNG. Policy của chúng là `(org_id = app_current_org_id())`
    // nguyên văn, đúng dòng `co_org_id` của danh sách trắng — không một bậc tự do nào được mở.
    // [ADR-017 / 014] Hai bang moi — `org_procurement_policies` va `rfq_budgets` — deu co
    // org_id, nen ca hai chiu DUNG cung bo rang buoc. He qua co y, giu nguyen qua Task 8/9/10,
    // S1.1 va nay qua ADR-017: `NGOAI_LE_HINH_DANG` VAN RONG. Khong mot bac tu do nao duoc mo.
    // [S1.4 / 017] `rfq_key_material` cung co org_id nen no chiu DUNG cung bo rang buoc, va
    // policy cua no la `(org_id = app_current_org_id())` nguyen van. Bang nay dang chu y vi mot
    // ly do KHAC: no la bang dau tien co mot cot ma `app_api` GHI DUOC nhung KHONG DOC DUOC
    // (`wrapped_private_key`). Hinh dang RLS khong noi gi ve dieu do — quyen theo COT noi, va
    // lop do no la db/rls-coverage.int.test.ts. Hai lop canh hai thu khac nhau.
    expect(cacBang.filter((b) => b.chiuRangBuocTenant).map((b) => b.tenBang).sort()).toEqual([
      "audit_chain_anchors",
      "audit_events",
      "bid_receipts",
      "guest_sessions",
      "invitation_otp_challenges",
      "mfa_credentials",
      "org_procurement_policies",
      "organizations",
      "otp_rate_limits",
      "outbox_jobs",
      "rfq_approvals",
      "rfq_budgets",
      "rfq_invitation_tokens",
      "rfq_invitations",
      "rfq_items",
      "rfq_key_material",
      "rfq_packages",
      "rfq_unsealed_bids",
      "sessions",
      "supplier_contacts",
      "suppliers",
      "unseal_approvals",
      "unseal_requests",
      "user_roles",
      "users",
      "vendor_bid_versions",
      "vendor_bids",
    ]);
  });

  it("[INV-F1] CREATE TABLE (kể cả PARTITION OF và tên có schema/nháy kép), ENABLE/FORCE RLS, POLICY và GRANT của một bảng nằm cùng MỘT file", () => {
    expect(
      kiemTraNguyenTu(cacFile),
      "Một bảng chịu ràng buộc tenant phải mang trọn CREATE TABLE + ENABLE + FORCE + POLICY + " +
        "GRANT trong cùng một file, vì mỗi file là một transaction (S7b-T3).",
    ).toEqual([]);
  });

  it("[INV-F1] không file nào bật RLS hay tạo/sửa policy cho bảng do file KHÁC tạo ra", () => {
    expect(kiemTraLacCho(cacFile)).toEqual([]);
  });

  it("[INV-F1] không file migration nào chứa cách viết policy fail-open bị cấm", () => {
    expect(kiemTraFailOpen(cacFile)).toEqual([]);
  });
});

// ============================================================================================
// TEST ĐỐI KHÁNG — chạy trên FILE GIẢ để không phải làm bẩn migration thật.
// Mỗi ca dưới đây ĐI LỌT (hoặc báo sai) trên bản trước vòng fix này; đó là lý do chúng tồn tại.
// ============================================================================================
describe("lớp tĩnh không mù với các cách viết hợp lệ", () => {
  it("[I5] CREATE TABLE với định danh có dấu nháy kép vẫn bị đòi đủ RLS + POLICY + GRANT", () => {
    const chiTao = new Map([['9x.sql', 'CREATE TABLE "bids" (id int, org_id uuid NOT NULL);']]);
    expect(kiemTraNguyenTu(chiTao).length).toBe(4);

    const daDu = new Map([
      [
        "9x.sql",
        'CREATE TABLE "bids" (id int, org_id uuid NOT NULL);\n' +
          'ALTER TABLE "bids" ENABLE ROW LEVEL SECURITY;\n' +
          'ALTER TABLE "bids" FORCE ROW LEVEL SECURITY;\n' +
          'CREATE POLICY bids_tenant ON "bids" USING (org_id = app_current_org_id()) ' +
          "WITH CHECK (org_id = app_current_org_id());\n" +
          'GRANT SELECT ON "bids" TO app_api;',
      ],
    ]);
    expect(kiemTraNguyenTu(daDu)).toEqual([]);
    expect(kiemTraLacCho(daDu)).toEqual([]);
  });

  it("[I5] tên bảng có schema không bị đọc nhầm thành tên schema", () => {
    const cacFile = new Map([
      [
        "9y.sql",
        "CREATE TABLE public.bids (id int, org_id uuid NOT NULL);\n" +
          "ALTER TABLE public.bids ENABLE ROW LEVEL SECURITY;\n" +
          "ALTER TABLE public.bids FORCE ROW LEVEL SECURITY;\n" +
          "CREATE POLICY bids_tenant ON public.bids USING (org_id = app_current_org_id()) " +
          "WITH CHECK (org_id = app_current_org_id());\n" +
          "GRANT SELECT ON public.bids TO app_api;",
      ],
    ]);
    expect(timCacBang(cacFile).map((b) => b.tenBang)).toEqual(["bids"]);
    expect(kiemTraNguyenTu(cacFile)).toEqual([]);
    expect(kiemTraLacCho(cacFile)).toEqual([]);
  });

  it("[I5] chú thích khối /* */ bị bỏ, không bị đọc như câu lệnh thật", () => {
    const cacFile = new Map([
      ["9z.sql", "/* CREATE TABLE ma_gia (org_id uuid); */ CREATE TABLE that (id int);"],
    ]);
    expect(timCacBang(cacFile).map((b) => b.tenBang)).toEqual(["that"]);
  });

  it("[CR2] lá PARTITION OF của bảng tenant bị đòi ENABLE + FORCE, không bị đòi POLICY/GRANT", () => {
    const thieu = new Map([
      [
        "9p.sql",
        "CREATE TABLE bao_gia (id int, org_id uuid NOT NULL) PARTITION BY LIST (org_id);\n" +
          "ALTER TABLE bao_gia ENABLE ROW LEVEL SECURITY;\n" +
          "ALTER TABLE bao_gia FORCE ROW LEVEL SECURITY;\n" +
          "CREATE POLICY bg ON bao_gia USING (org_id = app_current_org_id()) " +
          "WITH CHECK (org_id = app_current_org_id());\n" +
          "GRANT SELECT ON bao_gia TO app_api;\n" +
          "CREATE TABLE bao_gia_a PARTITION OF bao_gia FOR VALUES IN ('x');",
      ],
    ]);
    // Lá thừa hưởng ràng buộc tenant của cha, và thiếu ĐÚNG hai thứ: ENABLE và FORCE.
    expect(timCacBang(thieu).map((b) => [b.tenBang, b.chiuRangBuocTenant])).toEqual([
      ["bao_gia", true],
      ["bao_gia_a", true],
    ]);
    expect(kiemTraNguyenTu(thieu)).toEqual([
      '9p.sql tạo bảng "bao_gia_a" nhưng thiếu ENABLE ROW LEVEL SECURITY trong CÙNG file',
      '9p.sql tạo bảng "bao_gia_a" nhưng thiếu FORCE ROW LEVEL SECURITY trong CÙNG file',
    ]);

    const daDu = new Map([
      [
        "9p.sql",
        thieu.get("9p.sql")! +
          "\nALTER TABLE bao_gia_a ENABLE ROW LEVEL SECURITY;" +
          "\nALTER TABLE bao_gia_a FORCE ROW LEVEL SECURITY;",
      ],
    ]);
    expect(kiemTraNguyenTu(daDu)).toEqual([]);
  });

  it("[I4] policy FOR SELECT hợp lệ KHÔNG bị đòi WITH CHECK — PostgreSQL từ chối cú pháp đó", () => {
    const cacFile = new Map([
      [
        "9q.sql",
        "CREATE POLICY bids_unseal_read ON bids FOR SELECT " +
          "USING (org_id = app_current_org_id());",
      ],
    ]);
    expect(kiemTraFailOpen(cacFile)).toEqual([]);

    // Nhưng policy CÓ hàng mới thì vẫn phải viết WITH CHECK.
    const thieu = new Map([
      ["9q.sql", "CREATE POLICY p ON bids FOR INSERT USING (org_id = app_current_org_id());"],
    ]);
    expect(kiemTraFailOpen(thieu)).toEqual([
      '9q.sql: policy "p" không viết WITH CHECK tường minh',
    ]);
  });

  it("[M6] ALTER POLICY trong file migration cũng bị soi, không chỉ CREATE POLICY", () => {
    const cacFile = new Map([
      ["9r.sql", "ALTER POLICY users_tenant_isolation ON users USING (true);"],
    ]);
    expect(kiemTraFailOpen(cacFile)).toEqual([
      '9r.sql: policy "users_tenant_isolation" không viết WITH CHECK tường minh',
      '9r.sql: policy "users_tenant_isolation" có USING (true) — không chặn gì cả',
    ]);
    // Và nó cũng phải bị bắt khi nằm ở file KHÁC file tạo bảng.
    expect(kiemTraLacCho(cacFile)).toEqual([
      '9r.sql: "CREATE/ALTER POLICY" trên bảng "users" không được file nào tạo',
    ]);
  });
});
