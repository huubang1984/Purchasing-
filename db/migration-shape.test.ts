import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HAM_CANH_CHI_GHI_THEM, HAM_KHONG_PHAI_CANH } from "./danh-sach-ham-canh.js";
import { docHangHardening } from "./hardening-hang.js";

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

/**
 * [S1.15 / sổ nợ 57] NGOẠI LỆ ĐẶT CHỖ, khoá theo (file, bảng, policy) — ba trục, không một tên file.
 *
 * Quy tắc bên dưới có một lý do viết sẵn trong chính thông điệp của nó: *"tách hai việc qua hai
 * file để lộ cửa sổ không có RLS giữa hai transaction"*. Cửa sổ ấy là cửa sổ mà bảng KHÔNG ĐƯỢC
 * CHE. Miễn trừ sẵn có (`AS RESTRICTIVE`) suy từ đúng tính chất ấy: policy hạn chế chỉ SIẾT.
 *
 * `044` là ca thứ hai không mở cửa sổ ấy, và nó KHÔNG suy được từ một tính chất viết ra được:
 * `otp_rate_limits` ra đời ở `010` CÙNG policy cách ly của nó, nên bảng chưa từng có một khoảnh
 * khắc trần; policy của `044` là policy THỨ HAI, `FOR DELETE`, và nó NỚI chứ không siết. Nới thì
 * đáng bị soi kỹ hơn chứ không đáng được miễn trừ theo lớp — nên chỗ này là một DÒNG CÓ TÊN chứ
 * không phải một vế điều kiện mới trong quy tắc. Nới quy tắc ra để chứa ca này sẽ pre-approve mọi
 * policy PERMISSIVE tương lai trên mọi bảng đã có policy; đó là hình dạng của lỗ, không phải cửa.
 *
 * Lớp có thẩm quyền vẫn là danh sách trắng hình dạng (`hardening.always.sql` +
 * `db/rls-coverage.int.test.ts`), nơi cùng policy này phải có một dòng khoá SÁU cột.
 */
const NGOAI_LE_LAC_CHO: readonly {
  readonly tenFile: string;
  readonly tenBang: string;
  readonly tenPolicy: string;
  readonly lyDo: string;
}[] = [
  {
    tenFile: "044_don_bucket_otp.sql",
    tenBang: "otp_rate_limits",
    tenPolicy: "otp_rate_limits_don_cua_so_cu",
    lyDo:
      "bảng ra đời ở 010 CÙNG policy cách ly của nó — không có cửa sổ trần nào; đây là policy " +
      "THỨ HAI, FOR DELETE, chỉ có hiệu lực trên kết nối CHƯA gắn tổ chức và chỉ trên cửa sổ đã " +
      "quá 30 phút (sổ nợ 57 — bộ dọn không hỏi được 'tổ chức nào')",
  },
  {
    tenFile: "052_worker_liet_ke_to_chuc.sql",
    tenBang: "organizations",
    tenPolicy: "organizations_liet_ke_worker",
    lyDo:
      "[S1.82 / khoản 116 / ADR-040] bảng ra đời ở 002 CÙNG policy cách ly của nó — không có " +
      "cửa sổ trần nào; đây là policy THỨ HAI, FOR SELECT, và chủ thể của nó là ĐÚNG MỘT vai " +
      "NOLOGIN NOINHERIT (`app_liet_ke_to_chuc`) sinh ra để sở hữu ~~ĐÚNG MỘT hàm SECURITY " +
      "DEFINER~~ [S1.248] hàm SECURITY DEFINER liệt kê tổ chức — của 052, và từ " +
      "101_api_to_chuc_co_viec hàm hẹp thứ hai, cùng vai, thân cả hai đều ghim. " +
      "Đo (§S1.82 cảnh ❹): `app_unseal` đọc THẲNG `organizations` vẫn thấy 0 hàng, " +
      "nên dòng này không nới bán kính của bất kỳ vai ứng dụng nào. Nó NỚI chứ không siết, và " +
      "nới thì đáng bị soi kỹ hơn chứ không đáng một vế điều kiện mới trong quy tắc — cùng " +
      "cách xử lý đã dùng cho 044",
  },
  {
    tenFile: "101_api_to_chuc_co_viec.sql",
    tenBang: "outbox_jobs",
    tenPolicy: "outbox_jobs_liet_ke_viec_api",
    lyDo:
      "[S1.248 / khoản 277 / ADR-040 tiểu mục] bảng ra đời ở 007 CÙNG policy cách ly của nó — không " +
      "có cửa sổ trần nào; đây là policy PERMISSIVE thứ hai, FOR SELECT, chủ thể là ĐÚNG vai NOLOGIN " +
      "NOINHERIT `app_liet_ke_to_chuc` (chủ hai hàm SECURITY DEFINER liệt kê, thân đều ghim ở " +
      "hardening), và hàng hẹp bằng vị từ `status = 'PENDING'` — không USING (true). Đo (§S1.248): " +
      "`app_api` đọc THẲNG `outbox_jobs` khi chưa gắn tổ chức vẫn thấy 0 hàng, nên dòng này không nới " +
      "bán kính của vai ứng dụng nào. NỚI chứ không siết — cùng cách xử lý đã dùng cho 044 và 052",
  },
];

/** Không file nào được bật RLS hay tạo/sửa policy cho bảng do file KHÁC tạo ra. */
function kiemTraLacCho(pFile: Map<string, string>): string[] {
  const fileTaoBang = new Map(timCacBang(pFile).map((b) => [b.tenBang, b.tenFile]));
  const lacCho: string[] = [];

  const cacCauLenh: { nhan: string; bieuThuc: RegExp; iBang: number; iPolicy: number }[] = [
    {
      nhan: "ALTER TABLE ... ROW LEVEL SECURITY",
      bieuThuc: new RegExp(
        String.raw`ALTER\s+TABLE\s+${TEN_CO_SCHEMA}\s+(?:ENABLE|FORCE|DISABLE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY`,
        "gi",
      ),
      iBang: 1,
      iPolicy: 0,
    },
    // [vòng fix 1 — M6] ALTER POLICY cũng bị soi. Vòng trước chỉ nhìn CREATE POLICY, nên một
    // "ALTER POLICY ... USING (true)" viết thẳng trong file migration đi qua lớp tĩnh im lặng.
    {
      nhan: "CREATE/ALTER POLICY",
      // [S1.15] TÊN POLICY nay được BẮT, không bỏ qua: `NGOAI_LE_LAC_CHO` khoá theo nó, và một
      // ngoại lệ cấp cho `otp_rate_limits_don_cua_so_cu` không được phủ cho policy cách ly.
      bieuThuc: new RegExp(
        String.raw`(?:CREATE|ALTER)\s+POLICY\s+(${DINH_DANH})\s+ON\s+${TEN_CO_SCHEMA}`,
        "gi",
      ),
      iBang: 2,
      iPolicy: 1,
    },
  ];

  for (const [tenFile, sqlTho] of pFile) {
    const sql = boChuThich(sqlTho);
    for (const { nhan, bieuThuc, iBang, iPolicy } of cacCauLenh) {
      for (const khop of sql.matchAll(bieuThuc)) {
        const tenBang = chuanHoaTen(khop[iBang]!);
        const tenPolicy = iPolicy === 0 ? "" : chuanHoaTen(khop[iPolicy]!);
        // [khoản nợ 29] MIỄN TRỪ CÓ ĐIỀU KIỆN, và điều kiện là một tính chất chứ không một tên
        // file: một `CREATE POLICY ... AS RESTRICTIVE` trên bảng do file khác tạo KHÔNG mở được
        // cửa sổ mà quy tắc này canh.
        //
        // Lý do của quy tắc, nguyên văn ở thông điệp bên dưới, là *"tách hai việc qua hai file
        // để lộ cửa sổ không có RLS giữa hai transaction"*. Cửa sổ ấy chỉ tồn tại với policy
        // CHO PHÉP: bảng ra đời ở file A mà policy cô lập tổ chức nằm ở file B thì giữa hai lần
        // chạy, bảng không có gì che. Policy HẠN CHẾ được AND vào các policy sẵn có, nên vắng
        // mặt nó bảng vẫn được che nguyên như trước — nó chỉ SIẾT, không bao giờ NỚI.
        //
        // `ALTER POLICY` KHÔNG được miễn trừ dù mang `RESTRICTIVE`: sửa một policy đang có thì
        // nới được, và đó đúng là lỗ mà vòng fix 1 (M6) đã bịt.
        const duoiKhop = sql.slice(
          (khop.index ?? 0) + khop[0].length,
          (khop.index ?? 0) + khop[0].length + 40,
        );
        if (/^\s*CREATE\b/iu.test(khop[0]) && /^\s*AS\s+RESTRICTIVE\b/iu.test(duoiKhop)) {
          continue;
        }
        // [S1.15 / review H7-5] Cửa chỉ mở cho `CREATE`. Khoá (file, bảng, policy) KHÔNG mang LỆNH,
        // nên nếu không có vế này thì một `ALTER POLICY otp_rate_limits_don_cua_so_cu … USING (true)`
        // viết ngay trong `044` cũng được cùng dòng ngoại lệ tha — đúng lớp lỗ mà vòng fix 3 đã đo
        // được ở `NGOAI_LE_HINH_DANG` (mở cho FOR SELECT TO app_unseal rồi ALTER sang app_api vẫn
        // lọt). Và nó khớp với miễn trừ RESTRICTIVE ngay dưới: `ALTER POLICY` KHÔNG bao giờ được tha,
        // vì sửa một policy đang có thì NỚI được.
        if (
          /^\s*CREATE\b/iu.test(khop[0]) &&
          NGOAI_LE_LAC_CHO.some(
            (n) => n.tenFile === tenFile && n.tenBang === tenBang && n.tenPolicy === tenPolicy,
          )
        ) {
          continue;
        }
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
/**
 * [S1.82 / khoản 116 / ADR-040] Ngoại lệ ĐẦU TIÊN của quy tắc `USING (true)`, và nó là một TIỀN
 * LỆ chứ không phải một bản vá.
 *
 * Quy tắc gốc đúng ở chỗ nó đọc `USING (true)` như *"policy này không chặn gì"*. Với MỘT policy
 * `TO PUBLIC` thì đó đúng là fail-open. Nhưng vị từ không phải chủ thể duy nhất của một policy:
 * `TO <vai>` cũng hẹp, và hai vế ấy nhân với nhau. Một policy `FOR SELECT TO <một vai NOLOGIN
 * không ai đăng nhập được, có đúng một GRANT cột>` là HẸP dù vị từ là `true` — và viết một vị từ
 * giả cho có (`id IS NOT NULL`) chỉ để lách lớp này là đúng thứ chính khối chú thích của
 * `kiemTraFailOpen` gọi là *"cách viết ≠ dạng"*.
 *
 * Nên cửa là một DÒNG CÓ TÊN, cùng khuôn `NGOAI_LE_LAC_CHO`, và mỗi dòng phải nói được vì sao
 * CHỦ THỂ hẹp thay cho vị từ.
 *
 * Lớp có thẩm quyền vẫn là `NGOAI_LE_HINH_DANG` ở `hardening.always.sql` — nơi cùng policy này
 * phải có một dòng khoá SÁU cột, trong đó có cả `vai_tro`. Lớp ở đây chỉ là lưới bắt sớm.
 *
 * [S1.244 / khoản 171 ⑴] Mỗi dòng khai thêm LỆNH và VAI ĐÍCH DANH của chủ thể hẹp ấy — lý do nói "FOR SELECT TO
 * app_liet_ke_to_chuc", nên phép kiểm đọc đúng hai thứ đó, không đọc "có một chữ TO".
 */
interface NgoaiLeUsingTrue {
  readonly tenFile: string;
  readonly tenPolicy: string;
  /** Lệnh của policy, viết TƯỜNG MINH `FOR <lệnh>` — không viết FOR là ALL (PostgreSQL). Chỉ SELECT: vị từ `true` ở lệnh GHI là mở ghi. */
  readonly lenh: "SELECT";
  /** Danh sách `TO` của policy, ĐÚNG tập này (tên như PostgreSQL gấp: trần hạ thường, nháy kép giữ nguyên). */
  readonly vai: readonly string[];
  readonly lyDo: string;
}

const NGOAI_LE_USING_TRUE: readonly NgoaiLeUsingTrue[] = [
  {
    tenFile: "052_worker_liet_ke_to_chuc.sql",
    tenPolicy: "organizations_liet_ke_worker",
    lenh: "SELECT",
    vai: ["app_liet_ke_to_chuc"],
    lyDo:
      "chủ thể hẹp thay cho vị từ: `FOR SELECT TO app_liet_ke_to_chuc` — một vai NOLOGIN " +
      "NOINHERIT không tiến trình nào đăng nhập được, có ĐÚNG `SELECT (id)` trên ĐÚNG bảng này " +
      "và sở hữu ~~ĐÚNG một hàm SECURITY DEFINER~~ [S1.248] hàm SECURITY DEFINER liệt kê tổ chức " +
      "(từ 101_api_to_chuc_co_viec thêm hàm hẹp thứ hai, cùng vai). Vị từ hẹp hơn không tồn tại: mục đích của " +
      "policy là *mọi* id tổ chức. Đo (§S1.82 cảnh ❹): `app_unseal` đọc THẲNG `organizations` " +
      "vẫn thấy 0 hàng, nên dòng này không mở bán kính của bất kỳ vai ứng dụng nào",
  },
];

function laNgoaiLeUsingTrue(pTenFile: string, pTenPolicy: string): boolean {
  return NGOAI_LE_USING_TRUE.some(
    (n) => n.tenFile === pTenFile && chuanHoaTen(n.tenPolicy) === pTenPolicy,
  );
}

/**
 * [S1.244 / khoản 171 ⑴] Vai ĐÍCH DANH được làm chủ thể của một ngoại lệ `USING (true)` — danh sách có tên, không phải "mọi tên
 * khác `PUBLIC`". Mỗi tên là một vai NOLOGIN mà không tiến trình nào đăng nhập mang nó làm current_user; thêm một tên là một quyết
 * định an ninh có review, cùng hạng một dòng `NGOAI_LE_USING_TRUE`. Không vai ứng dụng nào (`app_api`, `app_unseal`, `app_neo`,
 * `app_khoi_tao` — chúng phục vụ yêu cầu) và không vai giả (`PUBLIC`, `CURRENT_USER`, `CURRENT_ROLE`, `SESSION_USER`).
 */
const VAI_DUOC_MIEN_USING_TRUE: ReadonlySet<string> = new Set([
  // [S1.82 / khoản 116, S1.212 / khoản 164] NOLOGIN NOINHERIT, chủ của ĐÚNG một hàm SECURITY DEFINER (`outbox_danh_sach_to_chuc()`),
  // có ĐÚNG `SELECT (id)` trên `organizations`; thuộc tính vai ghim ở hàng `thuộc tính role app_liet_ke_to_chuc` của hardening.
  "app_liet_ke_to_chuc",
]);

/** Tên vai trong mệnh đề `TO` như PostgreSQL hiểu: vai giả viết HOA, tên trần hạ thường, tên trong nháy kép giữ nguyên. */
function tenVaiTrongTo(pTho: string): string {
  const ten = pTho.trim();
  if (/^(PUBLIC|CURRENT_USER|CURRENT_ROLE|SESSION_USER)$/iu.test(ten)) return ten.toUpperCase();
  return chuanHoaTen(ten);
}

/**
 * [S1.244 / khoản 171 ⑴] LỆNH và CHỦ THỂ của một câu `CREATE POLICY` — phần thân sau `ON <bảng>`, trước `USING`/`WITH CHECK`
 * (đã bỏ chú thích). Không viết `FOR` là `ALL`, không viết `TO` là `PUBLIC` — đúng mặc định của PostgreSQL. Cú pháp lạ ⇒ NÉM.
 */
function docChuThePolicy(pThan: string): {
  readonly lenh: string;
  readonly vietFor: boolean;
  readonly vai: readonly string[];
  readonly vietTo: boolean;
} {
  const dau = pThan.split(/\bUSING\b|\bWITH\s+CHECK\b/iu)[0]!;
  const m = new RegExp(
    String.raw`^\s*(?:AS\s+(?:PERMISSIVE|RESTRICTIVE)\s+)?(?:FOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\s*)?(?:\bTO\s+(${DINH_DANH}(?:\s*,\s*${DINH_DANH})*)\s*)?$`,
    "iu",
  ).exec(dau);
  if (m === null) throw new Error(`thân CREATE POLICY ngoài văn phạm đọc được: ${JSON.stringify(dau.trim().slice(0, 80))}`);
  const vai = m[2] === undefined ? ["PUBLIC"] : [...m[2].matchAll(new RegExp(DINH_DANH, "gu"))].map((x) => tenVaiTrongTo(x[0]));
  return { lenh: (m[1] ?? "ALL").toUpperCase(), vietFor: m[1] !== undefined, vai: [...new Set(vai)].sort(), vietTo: m[2] !== undefined };
}

/**
 * [S1.244 / khoản 171 ⑴] Meta-test của cửa `USING (true)` thành hàm thuần (đo được trên văn bản mẫu). Danh sách vi phạm —
 * rỗng là xanh. Mỗi dòng khai phải ứng với câu `CREATE POLICY` của tệp; LỆNH viết tường minh bằng lệnh khai; danh sách `TO`
 * BẰNG tập vai khai; mỗi vai khai có tên trong `VAI_DUOC_MIEN_USING_TRUE`; không câu `ALTER POLICY` cùng tên trong tệp.
 */
function kiemTraNgoaiLeUsingTrue(pFile: Map<string, string>, pNgoaiLe: readonly NgoaiLeUsingTrue[]): string[] {
  const viPham: string[] = [];
  for (const n of pNgoaiLe) {
    const p = `${n.tenFile}: ngoại lệ USING (true) "${n.tenPolicy}"`;
    const sqlTho = pFile.get(n.tenFile);
    const sql = sqlTho === undefined ? "" : boChuThich(sqlTho);
    const tenPolicy = mauTenBang(chuanHoaTen(n.tenPolicy));
    const khop = new RegExp(String.raw`CREATE\s+POLICY\s+${tenPolicy}\s+ON\s+${TEN_CO_SCHEMA}([\s\S]*?);`, "i").exec(sql);
    if (khop === null) {
      viPham.push(`${p} không ứng với câu CREATE POLICY nào của tệp`);
      continue;
    }
    // ~~Vế CHỊU LỰC của mọi dòng trong danh sách này: chủ thể phải hẹp bằng `TO <vai>`. Một ngoại lệ cho một policy `TO PUBLIC`
    // sẽ đúng là fail-open, và nó phải ĐỎ ở đây.~~ [S1.244 / khoản 171 ⑴] Biểu thức của vế ấy là `TO` cộng một tên BẤT KỲ khác
    // `PUBLIC`, và nó không đọc LỆNH. Chủ thể hẹp là LỆNH × VAI ĐÍCH DANH — cả hai phải là đúng thứ dòng khai nói.
    const ct = docChuThePolicy(khop[2] ?? "");
    if (ct.lenh !== n.lenh) viPham.push(`${p} — policy là FOR ${ct.lenh}${ct.vietFor ? "" : " (không viết FOR)"}, dòng khai là FOR ${n.lenh}`);
    const khai = [...new Set(n.vai.map(tenVaiTrongTo))].sort();
    if (ct.vai.join(",") !== khai.join(",")) {
      viPham.push(`${p} — policy TO ${ct.vai.join(", ")}${ct.vietTo ? "" : " (không viết TO)"}, dòng khai TO ${khai.join(", ")}`);
    }
    for (const v of khai) if (!VAI_DUOC_MIEN_USING_TRUE.has(v)) viPham.push(`${p} — vai ${v} không có tên trong VAI_DUOC_MIEN_USING_TRUE`);
    const soAlter = [...sql.matchAll(new RegExp(String.raw`ALTER\s+POLICY\s+${tenPolicy}\s+ON\b`, "gi"))].length;
    if (soAlter > 0) {
      viPham.push(`${p} — ${soAlter} câu ALTER POLICY cùng tên trong tệp: chủ thể sau tệp không còn là chủ thể của câu CREATE`);
    }
  }
  return viPham;
}

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
      if (/\bUSING\s*\(\s*true\s*\)/i.test(than) && !laNgoaiLeUsingTrue(tenFile, ten)) {
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
    // [S1.105 / 057] Hai bang moi — `rfq_evaluations` va `rfq_evaluation_lines` — deu co org_id,
    // nen ca hai chiu DUNG cung bo rang buoc, va `NGOAI_LE_HINH_DANG` VAN RONG sau S2.3: policy
    // cua chung la `(org_id = app_current_org_id())` nguyen van. `rfq_evaluation_lines` dang chu y
    // vi mot ly do khac: FK hop thanh cua no tro vao `rfq_unsealed_bids (org_id, bid_version_id)`
    // chu khong vao `(org_id, id)` — bang ay KHONG co UNIQUE theo `id`, va tro vao cap kia MANH
    // HON: no buoc moi hang xep hang phai tro toi mot bao gia DA MO.
    expect(cacBang.filter((b) => b.chiuRangBuocTenant).map((b) => b.tenBang).sort()).toEqual([
      "audit_chain_anchors",
      "audit_events",
      "bid_receipts",
      // [S1.197 / S4.2a / `083_hang_chuan`] Bốn bảng hàng chuẩn — khuôn `uom_aliases`: tenant, FORCE RLS, policy khách đóng hẳn.
      "canonical_item_versions",
      "canonical_items",
      // [S1.203 / S3.6b1 / migration tín hiệu] Tín hiệu chia nhỏ và lần ghi nhận — chỉ-ghi-thêm, khoá ngoại hợp thành
      // `(org_id, rfq_id)` và `(org_id, signal_id)`, policy khách ĐÓNG HẲN.
      "governance_signal_acks",
      "governance_signals",
      "guest_sessions",
      "invitation_otp_challenges",
      "item_aliases",
      "item_uom_conversions",
      "mfa_credentials",
      // [S1.12 / 040] yêu cầu đặt lại TOTP — bảng tenant thứ 29.
      "mfa_reset_requests",
      // [ADR-062 / 063] Cặp khoá của tổ chức — chỉ-ghi-thêm bằng quyền, policy khách ĐÓNG HẲN.
      "org_key_pairs",
      // [S1.156 / S3.1a] Chữ ký thứ hai của phiên bản chính sách — chỉ-ghi-thêm, khoá ngoại hợp thành
      // `(org_id, policy_id)` tới `org_procurement_policies`, policy khách ĐÓNG HẲN.
      "org_policy_signatures",
      "org_procurement_policies",
      "organizations",
      "otp_rate_limits",
      "outbox_jobs",
      // [S1.256 / S4.5b / `103_benchmark_gia`] Kết quả và đầu vào benchmark — chỉ-ghi-thêm bằng quyền, khoá ngoại hợp thành tới lượt
      // chấm (cùng giao dịch), policy khách ĐÓNG HẲN.
      "price_benchmark_inputs",
      "price_benchmark_results",
      // [S1.201 / S3.6a / migration nhóm hàng] Nhóm hàng và lần đổi trạng thái — chỉ-ghi-thêm, khoá ngoại hợp thành
      // `(org_id, category_id)`, policy khách ĐÓNG HẲN.
      "procurement_categories",
      "procurement_category_changes",
      "rfq_approvals",
      // [S1.110 / S2.6 / 061] Hai bảng CHỈ-GHI-THÊM của trao thầu. Cả hai mang `org_id` nên
      // chúng chịu ĐÚNG cùng bộ ràng buộc tenant; `rfq_award_approvals` còn có khoá ngoại hợp
      // thành `(org_id, award_id)` tới `rfq_awards`, tức một chữ ký không trỏ sang tổ chức
      // khác được kể cả khi RLS bị tắt. Policy khách của CẢ HAI là vị từ ĐÓNG HẲN.
      "rfq_award_approvals",
      "rfq_awards",
      // [S1.108 / 059] Vòng BAFO cũng có org_id nên nó chịu ĐÚNG cùng bộ ràng buộc, và
      // `NGOAI_LE_HINH_DANG` VẪN RỖNG sau S2.5. Bảng này đáng chú ý vì policy khách của nó là
      // vị từ ĐÓNG HẲN chứ không vị từ hẹp theo `app.guest_rfq_id` như `rfq_packages` —
      // `027 §6` đặt mặc định là TỪ CHỐI, và nới nó là một quyết định của S1.109.
      "rfq_bafo_rounds",
      "rfq_budgets",
      "rfq_evaluation_lines",
      "rfq_evaluations",
      "rfq_invitation_tokens",
      "rfq_invitations",
      // [S1.204 / S4.3a / `089_anh_xa_hang_muc`] Gợi ý và ánh xạ hạng mục — khuôn nền L1, policy khách ĐÓNG HẲN.
      "rfq_item_goi_y",
      "rfq_item_mappings",
      "rfq_items",
      "rfq_key_material",
      "rfq_packages",
      // [S1.198 / khoản 257] Sổ trả về — chỉ-ghi-thêm bằng quyền, khoá ngoại hợp thành tới `rfq_packages`, policy khách ĐÓNG HẲN.
      "rfq_tra_ve",
      "rfq_unsealed_bids",
      "sessions",
      "supplier_contacts",
      // [S1.196 / S3.3a / migration xác minh] Xác minh nhà cung cấp (K8a) — chỉ-ghi-thêm, khoá ngoại hợp thành `(org_id, supplier_id)` tới
      // `suppliers`, policy khách ĐÓNG HẲN.
      "supplier_verifications",
      "suppliers",
      "unseal_approvals",
      // [S1.129 / khoản 233 / 064] Lịch sử điều phối mở thầu — chỉ-ghi-thêm bằng quyền, khoá
      // ngoại hợp thành tới `unseal_requests` và `rfq_packages`, policy khách ĐÓNG HẲN.
      "unseal_dispatch_history",
      "unseal_requests",
      // [S1.192 / S4.1 / `079_don_vi_do`] Bí danh đơn vị của tổ chức — bảng dữ liệu nền đầu tiên (L1): chỉ-ghi-thêm có hàng
      // rút, `seq`/`ghi_luc` do trigger đặt, policy khách ĐÓNG HẲN. Hai danh mục `uom_units`, `uom_aliases_chung` không `org_id`.
      "uom_aliases",
      // [S1.10.4 / 029] token đăng nhập người mua — bảng tenant thứ 28.
      "user_login_tokens",
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

  // [S1.15 / sổ nợ 57] Meta-test của cửa vừa mở. Cùng khuôn "không có ngoại lệ chết" đã dùng cho
  // NGOAI_LE_HINH_DANG: một dòng trỏ tới file/bảng/policy không còn tồn tại là rác IM LẶNG, và rác
  // im lặng trong một danh sách ngoại lệ là chỗ mà lần nới tiếp theo trốn vào.
  it("[S1.15] mỗi ngoại lệ đặt chỗ ứng với một CREATE POLICY CÓ THẬT, và có lý do", () => {
    const chet = NGOAI_LE_LAC_CHO.filter((n) => {
      const sql = cacFile.get(n.tenFile);
      if (sql === undefined) return true;
      const re = new RegExp(
        String.raw`CREATE\s+POLICY\s+${n.tenPolicy}\s+ON\s+${TEN_CO_SCHEMA}`,
        "i",
      );
      const khop = re.exec(boChuThich(sql));
      return khop === null || chuanHoaTen(khop[1]!) !== n.tenBang;
    });
    expect(chet, "ngoại lệ đặt chỗ không ứng với policy nào đang tồn tại").toEqual([]);
    for (const n of NGOAI_LE_LAC_CHO) {
      expect(n.lyDo.length, `ngoại lệ ${n.tenPolicy} phải có lý do`).toBeGreaterThan(40);
    }
  });

  it("[INV-F1] không file migration nào chứa cách viết policy fail-open bị cấm", () => {
    expect(kiemTraFailOpen(cacFile)).toEqual([]);
  });

  // [S1.82 / khoản 116] Meta-test của cửa `USING (true)` vừa mở, cùng khuôn meta-test của
  // `NGOAI_LE_LAC_CHO` ngay trên: một dòng trỏ tới policy không còn tồn tại là rác IM LẶNG, và
  // rác im lặng trong danh sách ngoại lệ là chỗ mà lần nới tiếp theo trốn vào.
  // [S1.244 / khoản 171 ⑴] ~~bộ lọc `chet` viết tại chỗ~~ nay là `kiemTraNgoaiLeUsingTrue` — cùng hàm chạy trên văn bản mẫu
  // ở khối `[S1.244 / khoản 171 ⑴]` cuối tệp.
  it("[S1.82] mỗi ngoại lệ `USING (true)` ứng với một policy CÓ THẬT, có `TO <vai>`, và có lý do", () => {
    expect(
      kiemTraNgoaiLeUsingTrue(cacFile, NGOAI_LE_USING_TRUE),
      "ngoại lệ USING (true) không ứng với policy nào đang tồn tại, hoặc policy ấy không hẹp " +
        "chủ thể bằng `TO <vai>` — khi ấy nó fail-open thật và ngoại lệ không đứng được",
    ).toEqual([]);
    for (const n of NGOAI_LE_USING_TRUE) {
      expect(n.lyDo.length, `ngoại lệ ${n.tenPolicy} phải có lý do`).toBeGreaterThan(40);
    }
  });

  // [S1.15 / review H7-5] Cửa `NGOAI_LE_LAC_CHO` mở cho ĐÚNG một câu `CREATE POLICY`. Đo thẳng vế
  // ấy trên file GIẢ thay vì chờ ngày ai đó viết `ALTER POLICY` trong `044`: dòng ngoại lệ có thật
  // (cùng file, cùng bảng, cùng policy) nhưng lệnh là `ALTER` ⇒ vẫn phải bị bắt.
  it("[H7-5] ngoại lệ đặt chỗ KHÔNG tha một `ALTER POLICY` trên cùng (file, bảng, policy)", () => {
    const gia = new Map([
      ["010_invitations.sql", "CREATE TABLE otp_rate_limits (org_id uuid NOT NULL);"],
      [
        "044_don_bucket_otp.sql",
        "ALTER POLICY otp_rate_limits_don_cua_so_cu ON otp_rate_limits USING (true);",
      ],
    ]);
    expect(kiemTraLacCho(gia)).toEqual([
      '044_don_bucket_otp.sql: "CREATE/ALTER POLICY" trên bảng "otp_rate_limits" — bảng đó được ' +
        "tạo ở 010_invitations.sql. Tách hai việc qua hai file để lộ cửa sổ không có RLS giữa hai " +
        "transaction.",
    ]);
    // Đối chứng dương: cùng ba trục ấy với `CREATE` thì cửa mở — nếu không, khẳng định trên xanh
    // vì cửa hỏng hẳn chứ không vì cửa hẹp đúng chỗ.
    const giaCreate = new Map([
      ["010_invitations.sql", "CREATE TABLE otp_rate_limits (org_id uuid NOT NULL);"],
      [
        "044_don_bucket_otp.sql",
        "CREATE POLICY otp_rate_limits_don_cua_so_cu ON otp_rate_limits FOR DELETE TO app_api USING (window_start < now());",
      ],
    ]);
    expect(kiemTraLacCho(giaCreate)).toEqual([]);
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

  // ==========================================================================================
  // [khoản nợ 29] MIỄN TRỪ CHO POLICY `AS RESTRICTIVE` — BA CA, VÀ HAI TRONG SỐ ĐÓ LÀ CA CHẶN
  // ==========================================================================================
  // Miễn trừ nào cũng là một lỗ tiềm năng, nên nó được đo theo cả hai chiều: nó PHẢI cho đúng
  // thứ nó nói là cho, và PHẢI KHÔNG cho ba thứ ở cạnh nó.
  it("[khoản nợ 29] CREATE POLICY ... AS RESTRICTIVE ở file khác ĐƯỢC PHÉP", () => {
    const cacFile = new Map([
      [
        "9s.sql",
        "CREATE TABLE bids (id int, org_id uuid NOT NULL);\n" +
          "ALTER TABLE bids ENABLE ROW LEVEL SECURITY;\n" +
          "ALTER TABLE bids FORCE ROW LEVEL SECURITY;\n" +
          "CREATE POLICY bids_tenant ON bids USING (org_id = app_current_org_id()) " +
          "WITH CHECK (org_id = app_current_org_id());\n" +
          "GRANT SELECT ON bids TO app_api;",
      ],
      [
        "9t.sql",
        "CREATE POLICY bids_khach ON bids AS RESTRICTIVE " +
          "USING (app_current_guest_session_id() IS NULL) " +
          "WITH CHECK (app_current_guest_session_id() IS NULL);",
      ],
    ]);
    expect(kiemTraLacCho(cacFile)).toEqual([]);
  });

  it("[khoản nợ 29] nhưng CREATE POLICY thường ở file khác VẪN bị chặn — miễn trừ không tràn", () => {
    // Đây là vế làm cho miễn trừ trên không phải một lần mở cửa: bỏ đúng hai chữ
    // `AS RESTRICTIVE` là quay lại bị chặn.
    const cacFile = new Map([
      [
        "9s.sql",
        "CREATE TABLE bids (id int, org_id uuid NOT NULL);\n" +
          "ALTER TABLE bids ENABLE ROW LEVEL SECURITY;\n" +
          "ALTER TABLE bids FORCE ROW LEVEL SECURITY;\n" +
          "CREATE POLICY bids_tenant ON bids USING (org_id = app_current_org_id()) " +
          "WITH CHECK (org_id = app_current_org_id());\n" +
          "GRANT SELECT ON bids TO app_api;",
      ],
      ["9t.sql", "CREATE POLICY bids_them ON bids USING (true) WITH CHECK (true);"],
    ]);
    expect(kiemTraLacCho(cacFile)).toEqual([
      '9t.sql: "CREATE/ALTER POLICY" trên bảng "bids" — bảng đó được tạo ở 9s.sql. ' +
        "Tách hai việc qua hai file để lộ cửa sổ không có RLS giữa hai transaction.",
    ]);
  });

  it("[khoản nợ 29] ALTER POLICY ... AS RESTRICTIVE KHÔNG được miễn trừ", () => {
    // `CREATE ... AS RESTRICTIVE` chỉ SIẾT được. `ALTER` thì sửa một policy đang có, tức nới
    // được — và đó đúng là lỗ mà vòng fix 1 (M6) đã bịt. Miễn trừ không được đi theo hai chữ
    // `RESTRICTIVE` một mình.
    const cacFile = new Map([
      [
        "9s.sql",
        "CREATE TABLE bids (id int, org_id uuid NOT NULL);\n" +
          "ALTER TABLE bids ENABLE ROW LEVEL SECURITY;\n" +
          "ALTER TABLE bids FORCE ROW LEVEL SECURITY;\n" +
          "CREATE POLICY bids_tenant ON bids USING (org_id = app_current_org_id()) " +
          "WITH CHECK (org_id = app_current_org_id());\n" +
          "GRANT SELECT ON bids TO app_api;",
      ],
      ["9t.sql", "ALTER POLICY bids_tenant ON bids AS RESTRICTIVE USING (true);"],
    ]);
    expect(kiemTraLacCho(cacFile)).toEqual([
      '9t.sql: "CREATE/ALTER POLICY" trên bảng "bids" — bảng đó được tạo ở 9s.sql. ' +
        "Tách hai việc qua hai file để lộ cửa sổ không có RLS giữa hai transaction.",
    ]);
  });
});

// ============================================================================================
// [S1.57 / khoản nợ 100 — lượt soi 49 NHẸ-1] MIGRATION CỦA KHO KHÔNG VIẾT THẲNG MỘT CÂU ĐỔI VAI
//
// migrate() so `current_user` cuối mỗi tệp với vai đã mở vòng đánh số, trong chính giao dịch của tệp
// (packages/db/src/migrate.ts): tệp kết thúc dưới vai khác bị ROLLBACK và từ chối. Phép so ấy chỉ thấy
// TRẠNG THÁI CUỐI tệp — tệp đổi vai, chạy backfill, rồi tự RESET ROLE thì đi qua, trong khi lượt phán xét
// của hardening soi vai đăng nhập chứ không soi vai mà backfill đã chạy dưới nó (ranh giới ghim ở
// packages/db/src/migrate.int.test.ts). Lớp này THU HẸP ca ấy cho migration của kho, trước khi commit: không
// tệp nào mà migrate() coi là migration đánh số (mọi `.sql` không mang hậu tố `.always.sql` — cùng phép lọc với
// `fileDanhSo`) được chứa CÁCH VIẾT THẲNG của một câu đổi vai: SET [SESSION|LOCAL] ROLE (kể cả `"role"`), SET …
// SESSION AUTHORIZATION, RESET ROLE / SESSION AUTHORIZATION, hay set_config với tên 'role' / 'session_authorization'
// viết thẳng trong '…', E'…', U&'…' hay $$…$$ (`role` là một GUC: set_config đổi vai y như SET ROLE). Chuỗi ký tự và
// thân dollar-quote VẪN được quét — `EXECUTE 'SET ROLE …'` trong khối DO chạy ngay trong migration; chỉ chú thích
// NGOÀI chuỗi bị bỏ, bằng một bộ tách biết chuỗi (lượt soi 50 NHẸ-5 ⑴: bản đầu dùng `boChuThich`, và `SELECT '--';
// SET ROLE x;` làm nó cắt mất câu sau — chiều FAIL-OPEN, ngược với lời khai "cùng hướng fail-closed" của bản đầu).
// Đo trước khi viết: mọi chữ "SET ROLE" trong db/migrations nằm trong chú thích.
// RANH GIỚI, nói ra: đây là bộ dò CÁCH VIẾT, không phải bộ phân tích SQL — tên ghép lúc chạy (`'ro' || 'le'`,
// `format()`, EXECUTE một chuỗi dựng), escape Unicode trong `U&'…'`, và hàm SECURITY DEFINER của vai khác mà tệp gọi
// (ranh giới ⑸ của S1.56) đều lọt; chúng còn lại phép so vai cuối tệp của migrate(). Chiều đỏ oan đã biết: một cột
// tên `role` trong `UPDATE … SET role = …` (hôm nay không có). Cố ý không có danh sách miễn: cần chạy một tệp dưới vai
// khác thì chạy migrate() dưới vai ấy.
// ============================================================================================
const RE_DOI_VAI =
  /\b(?:RE)?SET\s+(?:(?:SESSION|LOCAL)\s+)?(?:"role"|ROLE\b|SESSION\s+AUTHORIZATION\b)|\bset_config\s*\(\s*(?:[Ee]|[Uu]&)?(?:'\s*(?:role|session_authorization)\s*'|\$[A-Za-z_0-9]*\$\s*(?:role|session_authorization)\s*\$[A-Za-z_0-9]*\$)/giu;

/**
 * Bỏ chú thích NGOÀI chuỗi, giữ nguyên chuỗi '…' (E'…' có escape gạch chéo ngược), định danh "…" và thân dollar-quote.
 * Chú thích khối lồng được như PostgreSQL. `$1` là tham số chứ không phải dollar-quote.
 */
function boChuThichNgoaiChuoi(pSql: string): string {
  let ra = "";
  let i = 0;
  while (i < pSql.length) {
    const c = pSql[i]!;
    const ke = pSql[i + 1];
    if (c === "-" && ke === "-") {
      const j = pSql.indexOf("\n", i);
      i = j < 0 ? pSql.length : j;
      ra += " ";
      continue;
    }
    if (c === "/" && ke === "*") {
      let sau = 1;
      i += 2;
      while (i < pSql.length && sau > 0) {
        if (pSql[i] === "/" && pSql[i + 1] === "*") {
          sau += 1;
          i += 2;
        } else if (pSql[i] === "*" && pSql[i + 1] === "/") {
          sau -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      ra += " ";
      continue;
    }
    if (c === "'" || c === '"') {
      const escapeGachCheo = c === "'" && /[Ee]/u.test(pSql[i - 1] ?? "") && !/[A-Za-z0-9_]/u.test(pSql[i - 2] ?? "");
      let j = i + 1;
      while (j < pSql.length) {
        if (escapeGachCheo && pSql[j] === "\\") {
          j += 2;
          continue;
        }
        if (pSql[j] === c) {
          if (pSql[j + 1] === c) {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      ra += pSql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "$" && !/[A-Za-z0-9_]/u.test(pSql[i - 1] ?? "")) {
      const the = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u.exec(pSql.slice(i))?.[0];
      if (the !== undefined) {
        const k = pSql.indexOf(the, i + the.length);
        const cuoi = k < 0 ? pSql.length : k + the.length;
        ra += pSql.slice(i, cuoi);
        i = cuoi;
        continue;
      }
    }
    ra += c;
    i += 1;
  }
  return ra;
}

/** Mọi cách viết thẳng của một câu đổi vai trong văn bản một tệp migration, sau khi bỏ chú thích ngoài chuỗi. */
function timDoiVai(pNoiDung: string): string[] {
  return [...boChuThichNgoaiChuoi(pNoiDung).matchAll(RE_DOI_VAI)].map((m) => m[0].replace(/\s+/gu, " "));
}

describe("[S1.57 / khoản nợ 100] migration của kho không viết thẳng một câu đổi vai", () => {
  it("[INV-F1] mọi tệp migration đánh số (mọi `.sql` không phải `.always.sql`): không cách viết đổi vai nào ngoài chú thích", () => {
    const viPham: string[] = [];
    const cacTep = [...docCacFile()].filter(([tenFile]) => !tenFile.endsWith(".always.sql"));
    expect(cacTep.length, "phép quét không rỗng ruột").toBeGreaterThanOrEqual(48);
    for (const [tenFile, noiDung] of cacTep) {
      for (const cau of timDoiVai(noiDung)) viPham.push(`${tenFile}: ${cau}`);
    }
    expect(viPham).toEqual([]);
  });

  it("bộ dò thấy mười bảy cách viết đổi vai — kể cả trong chuỗi EXECUTE của khối DO và sau một chuỗi mang '--' hay '/*' — đối chứng trên văn bản giả", () => {
    const cacCau = [
      "SET ROLE x",
      "SET LOCAL ROLE x",
      "set session role x",
      "SET role TO x",
      'SET "role" TO x',
      'SET LOCAL "ROLE" = x',
      "SET SESSION AUTHORIZATION x",
      "RESET ROLE",
      "reset session authorization",
      "SELECT set_config('role', 'x', false)",
      "SELECT pg_catalog.set_config( 'session_authorization', 'x', true)",
      "SELECT set_config(E'role', 'x', true)",
      "SELECT set_config(U&'role', 'x', true)",
      "SELECT set_config($$role$$, 'x', true)",
      "DO $d$ BEGIN EXECUTE 'SET ROLE x'; END $d$",
      "SELECT '--'; SET ROLE x",
      "SELECT '/*'; RESET ROLE",
    ];
    for (const cau of cacCau) expect(timDoiVai(cau), cau).toHaveLength(1);
  });

  it("không đỏ oan: chữ trong chú thích (kể cả chú thích khối lồng), câu SET/RESET khác, set_config của GUC khác", () => {
    expect(timDoiVai("-- SET ROLE app_api\n/* ngoài /* SET LOCAL ROLE x */ vẫn là chú thích RESET ROLE */ SELECT 1; -- RESET ROLE")).toEqual([]);
    expect(
      timDoiVai("CREATE ROLE x; ALTER ROLE x NOLOGIN; GRANT x TO y; SET search_path = public; RESET search_path; SELECT set_config('app.org_id', '', true);"),
    ).toEqual([]);
  });

  it("RANH GIỚI ghim: tên ghép lúc chạy thì bộ dò KHÔNG thấy — phần ấy còn lại phép so vai cuối tệp của migrate()", () => {
    expect(timDoiVai("SELECT set_config('ro' || 'le', 'x', true); DO $d$ BEGIN EXECUTE format('SET %s x', 'ROLE'); END $d$")).toEqual([]);
  });
});

// ============================================================================================
// [S1.232 / khoản 221] BỐN VẾ TĨNH CỦA MỘT BẢNG TENANT MỚI — QUYẾT ĐỊNH ĐƯỢC TỪ VĂN BẢN, KHÔNG CẦN CSDL
//
// Đo ở S1.105 trên chính `057`: một bảng tenant mới mang trigger bỏ sót policy `_khach` và cấp
// `GRANT INSERT` mức BẢNG, và `pnpm t0` + `pnpm test` XANH TRỌN — năm cổng đỏ đều ở `test:int`
// (138 s cho năm tệp). Bốn trong bảy lời khai mà bảng ấy đòi quyết định được từ VĂN BẢN migration:
//   ⑴ migration số lớn hơn `027` mà `CREATE TABLE` có `org_id` thì phải `CREATE POLICY <bảng>_khach …
//      AS RESTRICTIVE` trong CÙNG tệp — `027` lấp MỘT LẦN cho lược đồ của ngày ấy, hardening chỉ PHÁN
//      XÉT chứ không DỰNG; `rls-coverage` [S1.48] đếm từ catalog "RESTRICTIVE = MỘT cho MỖI bảng tenant".
//   ⑵ không migration nào cấp `INSERT` mà cấp được cột `id` trên bảng tenant: `GRANT INSERT`/`ALL` mức
//      BẢNG, `GRANT INSERT (… id …)` theo cột, hay `ALTER DEFAULT PRIVILEGES … GRANT INSERT ON TABLES`
//      (cấp trước cho bảng chưa có tên) — cấp `id` biến `<bảng>_pkey` thành oracle xuyên tổ chức mà
//      ADR-013 từ chối. Bảng gốc `organizations` được miễn vế cột: `id` của nó LÀ tổ chức và vai khởi
//      tạo (`075`) phải đặt nó.
//   ⑶ tên bảng tenant phải có trong `BANG_TENANT_KHAI` của `hardening.always.sql`, dòng khai trỏ đúng
//      tệp đã `CREATE TABLE`, và không dòng khai nào thiu — bản tĩnh của phép so `[INV-F1] HAI BẢN KHỚP`
//      ở `rls-coverage`, đọc qua `docHangHardening` (chỉ ĐỌC hardening).
//   ⑷ mỗi hàm `CREATE FUNCTION … RETURNS trigger` gắn vào INSERT/UPDATE/DELETE phải có tên trong
//      `HAM_CANH_CHI_GHI_THEM` hoặc `HAM_KHONG_PHAI_CANH` (`db/danh-sach-ham-canh.ts` — cùng nguồn với
//      tổng điều tra của `hardening-suy-tu-tinh-chat.int.test.ts`). Tập rộng ở đó là bit 4/8/16 của
//      `tgtype`, nên một hàm CHỈ gắn `TRUNCATE` (`rfq_items_cam_truncate`, 011) nằm ngoài cả hai danh
//      sách ở đó và ở đây; một hàm không `CREATE TRIGGER` nào gắn thì VẪN phải khai (fail-closed).
// Vế thứ năm — nhân chứng hành vi của khoản 74 — KHÔNG quyết định được từ văn bản và ở lại `test:int`.
// Lớp này là lưới bắt sớm đọc CÁCH VIẾT (cùng ranh giới với `kiemTraFailOpen`); lớp có thẩm quyền vẫn
// là hardening + `rls-coverage` + tổng điều tra. Mỗi vế có một lượt đỏ thật trên văn bản mẫu bên dưới.
// ============================================================================================

/** Số của một migration đánh số (`027_…` → 27, `95NN_…` → số tạm bốn chữ số); `null` cho `.always.sql` hay tên lạ. */
function soMigration(pTenFile: string): number | null {
  if (pTenFile.endsWith(".always.sql")) return null;
  const m = /^(\d{3,4})_/u.exec(pTenFile);
  return m === null ? null : Number(m[1]);
}

const laMigrationDanhSo = (pTenFile: string): boolean => soMigration(pTenFile) !== null;

/** Tách theo dấu phẩy NGOÀI ngoặc: `INSERT (a, b), UPDATE (c)` → hai phần tử, không bốn. */
function tachTheoPhayNgoaiNgoac(pVan: string): string[] {
  const ra: string[] = [];
  let sau = 0;
  let hienTai = "";
  for (const c of pVan) {
    if (c === "(") sau += 1;
    else if (c === ")") sau -= 1;
    if (c === "," && sau === 0) {
      ra.push(hienTai.trim());
      hienTai = "";
    } else {
      hienTai += c;
    }
  }
  if (hienTai.trim() !== "") ra.push(hienTai.trim());
  return ra;
}

/** ⑴ Bảng tenant sinh sau `027` (không phải lá phân mảnh) phải có `CREATE POLICY <bảng>_khach … AS RESTRICTIVE` cùng tệp. */
function kiemPolicyKhach(pFile: Map<string, string>): { viPham: string[]; daXet: number } {
  const viPham: string[] = [];
  let daXet = 0;
  for (const bang of timCacBang(pFile)) {
    const so = soMigration(bang.tenFile);
    if (!bang.chiuRangBuocTenant || bang.chaPhanManh !== null || so === null || so <= 27) continue;
    daXet += 1;
    const sql = boChuThich(pFile.get(bang.tenFile)!);
    const tenPolicy = `${bang.tenBang}_khach`;
    const re = new RegExp(
      String.raw`CREATE\s+POLICY\s+(?:"${neo(tenPolicy)}"|${neo(tenPolicy)})\s+ON\s+${mauTenBang(bang.tenBang)}(?![A-Za-z0-9_$"])\s+AS\s+RESTRICTIVE\b`,
      "iu",
    );
    if (!re.test(sql)) {
      viPham.push(
        `${bang.tenFile} tạo bảng tenant "${bang.tenBang}" (sau 027) nhưng không có CREATE POLICY ${tenPolicy} ON ${bang.tenBang} AS RESTRICTIVE ` +
          "trong CÙNG tệp — 027 chỉ lấp một lần cho lược đồ của ngày ấy; hardening phán xét chứ không dựng.",
      );
    }
  }
  return { viPham, daXet };
}

/** ⑵ Không `GRANT` nào cấp được cột `id` của một bảng tenant qua INSERT: mức BẢNG (`INSERT`, `ALL`) hay theo cột có `id`. */
function kiemGrantInsertCapId(pFile: Map<string, string>): { viPham: string[]; daXet: number } {
  const bangTenant = new Set(timCacBang(pFile).filter((b) => b.chiuRangBuocTenant).map((b) => b.tenBang));
  const viPham: string[] = [];
  let daXet = 0;
  const reTen = new RegExp(`^${TEN_CO_SCHEMA}$`, "u");
  for (const [tenFile, sqlTho] of pFile) {
    if (!laMigrationDanhSo(tenFile)) continue;
    const sql = boChuThich(sqlTho);
    // Đường vòng qua phép đọc `GRANT`: quyền MẶC ĐỊNH cho bảng sinh sau (`001` giải thích vì sao kho không dùng nó; hôm nay chỉ
    // xuất hiện trong chú thích). Cấm hẳn cho mọi câu cấp INSERT/ALL ON TABLES — không xét bảng nào, vì nó áp cho bảng CHƯA có tên.
    for (const khop of sql.matchAll(/\bALTER\s+DEFAULT\s+PRIVILEGES\b[^;]*?\bGRANT\s+([^;]+?)\s+ON\s+TABLES\b[^;]*;/giu)) {
      if (tachTheoPhayNgoaiNgoac(khop[1]!).some((q) => /^(?:INSERT|ALL(?:\s+PRIVILEGES)?)$/iu.test(q))) {
        viPham.push(`${tenFile}: ALTER DEFAULT PRIVILEGES … GRANT INSERT/ALL ON TABLES — cấp trước cho mọi bảng sinh sau, kể cả bảng tenant, mức BẢNG.`);
      }
    }
    // `[^;]` giữ phép đọc trong MỘT câu: `GRANT vai TO vai;` (không `ON`) không được nuốt sang câu GRANT kế.
    for (const khop of sql.matchAll(/\bGRANT\s+([^;]+?)\s+ON\s+(?:TABLE\s+)?([^;]+?)\s+TO\s+[^;]*;/giu)) {
      const dich = khop[2]!.trim();
      if (
        /^(?:SEQUENCE|FUNCTION|PROCEDURE|ROUTINE|SCHEMA|DATABASE|TYPE|DOMAIN|LANGUAGE|TABLESPACE|FOREIGN|LARGE|PARAMETER|ALL\s+(?:SEQUENCES|FUNCTIONS|PROCEDURES|ROUTINES))\b/iu.test(dich)
      ) {
        continue;
      }
      const quyen = tachTheoPhayNgoaiNgoac(khop[1]!);
      const mucBang = quyen.filter((q) => /^(?:INSERT|ALL(?:\s+PRIVILEGES)?)$/iu.test(q));
      const cotId = quyen
        .filter((q) => /^INSERT\s*\(/iu.test(q))
        .flatMap((q) => tachTheoPhayNgoaiNgoac(q.replace(/^INSERT\s*\(/iu, "").replace(/\)\s*$/u, "")))
        .map(chuanHoaTen)
        .filter((c) => c === "id");
      const toanSchema = /^ALL\s+TABLES\b/iu.test(dich);
      const cacBang = toanSchema
        ? ["<ALL TABLES IN SCHEMA>"]
        : tachTheoPhayNgoaiNgoac(dich).map((t) => {
            const m = reTen.exec(t);
            return chuanHoaTen(m === null ? t : m[1]!);
          });
      for (const bang of cacBang) {
        if (!toanSchema && !bangTenant.has(bang)) continue;
        daXet += 1;
        if (mucBang.length > 0) {
          viPham.push(
            `${tenFile}: GRANT ${mucBang.join(", ")} ON ${bang} — quyền INSERT mức BẢNG cấp cả \`id\`, biến ${bang}_pkey thành oracle ` +
              "xuyên tổ chức (ADR-013). Cấp theo CỘT, không có `id` (khuôn 002).",
          );
        }
        if (cotId.length > 0 && !BANG_GOC_TENANT.includes(bang)) {
          viPham.push(`${tenFile}: GRANT INSERT (… id …) ON ${bang} — cột \`id\` của bảng tenant không được cấp INSERT (ADR-013).`);
        }
      }
    }
  }
  return { viPham, daXet };
}

interface HangKhaiTenant {
  readonly nsp: string;
  readonly ten: string;
  readonly mig: string;
}

/** Hàng của `BANG_TENANT_KHAI` — cùng bộ đọc với `rls-coverage` (`\d{3,4}`: số tạm `95NN` bốn chữ số). */
function docBangTenantKhai(pHardeningSql: string): HangKhaiTenant[] {
  return [...docHangHardening(pHardeningSql, "BANG_TENANT_KHAI").matchAll(/\('(\w+)', '(\w+)', '(\d{3,4}_\w+)'\)/gu)].map(
    (m) => ({ nsp: m[1]!, ten: m[2]!, mig: m[3]! }),
  );
}

/** ⑶ Hai chiều: mọi bảng tenant của migration đánh số có dòng khai trỏ đúng tệp; mọi dòng khai ứng với một bảng có thật. */
function kiemKhaiBangTenant(pFile: Map<string, string>, pKhai: readonly HangKhaiTenant[]): string[] {
  const viPham: string[] = [];
  const bang = timCacBang(pFile).filter((b) => b.chiuRangBuocTenant && laMigrationDanhSo(b.tenFile));
  const khaiTheoTen = new Map(pKhai.map((h) => [h.ten, h] as const));
  for (const b of bang) {
    const h = khaiTheoTen.get(b.tenBang);
    if (h === undefined) {
      viPham.push(`${b.tenFile}: bảng tenant "${b.tenBang}" chưa có trong BANG_TENANT_KHAI của hardening.always.sql (ADR-037).`);
    } else if (h.nsp !== "public" || `${h.mig}.sql` !== b.tenFile) {
      viPham.push(`BANG_TENANT_KHAI khai ('${h.nsp}', '${h.ten}', '${h.mig}') nhưng CREATE TABLE của bảng ấy ở ${b.tenFile}.`);
    }
  }
  const daTao = new Set(bang.map((b) => b.tenBang));
  for (const h of pKhai) {
    if (!daTao.has(h.ten)) {
      viPham.push(`BANG_TENANT_KHAI khai '${h.ten}' (${h.mig}) mà không migration đánh số nào CREATE TABLE bảng tenant ấy — dòng khai thiu.`);
    }
  }
  return viPham;
}

const SU_KIEN_TAP_RONG: readonly string[] = ["INSERT", "UPDATE", "DELETE"];

/** `lược_đồ.tên` của một hàm/trigger đọc từ văn bản; không lược đồ thì `public`, đúng cách tổng điều tra định danh. */
function tenDayDu(pSchema: string | undefined, pTen: string): string {
  return `${pSchema === undefined ? "public" : chuanHoaTen(pSchema)}.${chuanHoaTen(pTen)}`;
}

/** ⑷ Mỗi hàm `RETURNS trigger` trong migration đánh số phải nằm trong một trong hai danh sách khai — trừ hàm CHỈ gắn `TRUNCATE`. */
function kiemHamTriggerDaKhai(
  pFile: Map<string, string>,
  pCanh: readonly string[],
  pKhong: readonly string[],
): { viPham: string[]; daXet: number } {
  const ham = new Map<string, string[]>();
  const suKien = new Map<string, Set<string>>();
  const reHam = new RegExp(
    String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:(${DINH_DANH})\s*\.\s*)?(${DINH_DANH})\s*\([^)]*\)\s*RETURNS\s+(?:pg_catalog\s*\.\s*)?trigger\b`,
    "giu",
  );
  const reTrigger = new RegExp(
    String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+${DINH_DANH}\s+(?:BEFORE|AFTER|INSTEAD\s+OF)\s+([^;]+?)\s+ON\s+[^;]+?EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(?:(${DINH_DANH})\s*\.\s*)?(${DINH_DANH})\s*\(`,
    "giu",
  );
  for (const [tenFile, sqlTho] of pFile) {
    if (!laMigrationDanhSo(tenFile)) continue;
    const sql = boChuThich(sqlTho);
    for (const m of sql.matchAll(reHam)) {
      const ten = tenDayDu(m[1], m[2]!);
      ham.set(ten, [...(ham.get(ten) ?? []), tenFile]);
    }
    for (const m of sql.matchAll(reTrigger)) {
      const ten = tenDayDu(m[2], m[3]!);
      const tap = suKien.get(ten) ?? new Set<string>();
      for (const ve of m[1]!.split(/\s+OR\s+/iu)) tap.add(ve.trim().split(/\s+/u)[0]!.toUpperCase());
      suKien.set(ten, tap);
    }
  }
  const daKhai = new Set([...pCanh.map((h) => `public.${h}`), ...pKhong]);
  const viPham: string[] = [];
  for (const [ten, tep] of ham) {
    const gan = suKien.get(ten);
    const chiTruncate = gan !== undefined && gan.size > 0 && [...gan].every((e) => !SU_KIEN_TAP_RONG.includes(e));
    if (chiTruncate || daKhai.has(ten)) continue;
    viPham.push(
      `${[...new Set(tep)].join(", ")}: hàm trigger ${ten} ` +
        (gan === undefined ? "không CREATE TRIGGER nào gắn (hàm chết, hay gắn bằng SQL động) và " : `gắn ${[...gan].join("/")} mà `) +
        "không có tên trong HAM_CANH_CHI_GHI_THEM hay HAM_KHONG_PHAI_CANH (db/danh-sach-ham-canh.ts). Khai nó vào ĐÚNG MỘT danh " +
        "sách — tổng điều tra ở hardening-suy-tu-tinh-chat.int.test.ts sẽ phán xét lời khai ấy.",
    );
  }
  return { viPham, daXet: ham.size };
}

describe("[S1.232 / khoản 221] bốn vế tĩnh của một bảng tenant mới — đỏ ở T1, không đợi test:int", () => {
  const cacFile = docCacFile();
  const HARDENING = cacFile.get("hardening.always.sql");
  if (HARDENING === undefined) throw new Error("không đọc được db/migrations/hardening.always.sql");

  it("[INV-F1] ⑴ mọi bảng tenant sinh sau 027 có CREATE POLICY <bảng>_khach … AS RESTRICTIVE trong cùng tệp", () => {
    const { viPham, daXet } = kiemPolicyKhach(cacFile);
    expect(daXet, "chống rỗng ruột: phải thấy các bảng tenant sinh sau 027").toBeGreaterThanOrEqual(15);
    expect(viPham).toEqual([]);
  });

  it("[INV-F1] ⑵ không GRANT nào cấp được cột `id` của bảng tenant qua INSERT — mức bảng, ALL, hay theo cột", () => {
    const { viPham, daXet } = kiemGrantInsertCapId(cacFile);
    expect(daXet, "chống rỗng ruột: phải thấy các câu GRANT trên bảng tenant").toBeGreaterThanOrEqual(100);
    expect(viPham).toEqual([]);
  });

  it("[INV-F1] ⑶ tên bảng tenant có trong BANG_TENANT_KHAI, dòng khai trỏ đúng tệp CREATE TABLE, không dòng khai thiu", () => {
    const khai = docBangTenantKhai(HARDENING);
    expect(khai.length, "bản khai đang rỗng — bộ đọc mù").toBeGreaterThanOrEqual(40);
    expect(kiemKhaiBangTenant(cacFile, khai)).toEqual([]);
  });

  it("[INV-F1] ⑷ mọi hàm RETURNS trigger gắn INSERT/UPDATE/DELETE có tên trong HAM_CANH_CHI_GHI_THEM hoặc HAM_KHONG_PHAI_CANH", () => {
    const { viPham, daXet } = kiemHamTriggerDaKhai(cacFile, HAM_CANH_CHI_GHI_THEM, HAM_KHONG_PHAI_CANH);
    expect(daXet, "chống rỗng ruột: phải thấy các hàm trigger của kho").toBeGreaterThanOrEqual(70);
    expect(viPham).toEqual([]);
  });

  // Bốn lượt đỏ thật trên văn bản mẫu — mỗi vế một đột biến nhỏ nhất, kèm đối chứng xanh để chắc cửa hẹp đúng chỗ.
  const BANG_DU = (pSo: string, pKhach: string): [string, string] => [
    `${pSo}_bang_moi.sql`,
    "CREATE TABLE bang_moi (id uuid PRIMARY KEY, org_id uuid NOT NULL);\n" +
      "ALTER TABLE bang_moi ENABLE ROW LEVEL SECURITY;\nALTER TABLE bang_moi FORCE ROW LEVEL SECURITY;\n" +
      "CREATE POLICY bang_moi_tenant ON bang_moi USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());\n" +
      pKhach +
      "GRANT SELECT, INSERT (org_id) ON bang_moi TO app_api;",
  ];
  const KHACH = "CREATE POLICY bang_moi_khach ON bang_moi AS RESTRICTIVE USING (app_current_guest_session_id() IS NULL) WITH CHECK (app_current_guest_session_id() IS NULL);\n";

  it("⑴ đỏ: bảng tenant ở migration sau 027 thiếu policy _khach; policy _khach PERMISSIVE cũng đỏ; trước 027 không đòi; có đủ thì xanh", () => {
    expect(kiemPolicyKhach(new Map([BANG_DU("091", "")])).viPham).toEqual([
      '091_bang_moi.sql tạo bảng tenant "bang_moi" (sau 027) nhưng không có CREATE POLICY bang_moi_khach ON bang_moi AS RESTRICTIVE ' +
        "trong CÙNG tệp — 027 chỉ lấp một lần cho lược đồ của ngày ấy; hardening phán xét chứ không dựng.",
    ]);
    expect(kiemPolicyKhach(new Map([BANG_DU("091", KHACH.replace(" AS RESTRICTIVE", ""))])).viPham).toHaveLength(1);
    expect(kiemPolicyKhach(new Map([BANG_DU("012", "")]))).toEqual({ viPham: [], daXet: 0 });
    expect(kiemPolicyKhach(new Map([BANG_DU("091", KHACH)]))).toEqual({ viPham: [], daXet: 1 });
    // Số tạm bốn chữ số của `pnpm cap-so` (ADR-090) cũng là "sau 027".
    expect(kiemPolicyKhach(new Map([BANG_DU("9591", "")])).viPham).toHaveLength(1);
  });

  it("⑵ đỏ: GRANT INSERT mức bảng, GRANT ALL, GRANT INSERT (id, …) theo cột, và ALL TABLES IN SCHEMA; theo cột không có id thì xanh; organizations được miễn vế cột", () => {
    const [tenFile, sql] = BANG_DU("091", KHACH);
    const thay = (pGrant: string): string[] => kiemGrantInsertCapId(new Map([[tenFile, sql.replace("GRANT SELECT, INSERT (org_id) ON bang_moi TO app_api;", pGrant)]])).viPham;
    expect(thay("GRANT SELECT, INSERT ON bang_moi TO app_api;")).toEqual([
      "091_bang_moi.sql: GRANT INSERT ON bang_moi — quyền INSERT mức BẢNG cấp cả `id`, biến bang_moi_pkey thành oracle xuyên tổ chức (ADR-013). Cấp theo CỘT, không có `id` (khuôn 002).",
    ]);
    expect(thay("GRANT ALL PRIVILEGES ON TABLE public.bang_moi TO app_api;")).toHaveLength(1);
    expect(thay("GRANT INSERT (org_id, id) ON bang_moi TO app_api;")).toEqual([
      "091_bang_moi.sql: GRANT INSERT (… id …) ON bang_moi — cột `id` của bảng tenant không được cấp INSERT (ADR-013).",
    ]);
    expect(thay("GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO app_api;")).toHaveLength(1);
    expect(thay("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT ON TABLES TO app_api;")).toEqual([
      "091_bang_moi.sql: ALTER DEFAULT PRIVILEGES … GRANT INSERT/ALL ON TABLES — cấp trước cho mọi bảng sinh sau, kể cả bảng tenant, mức BẢNG.",
    ]);
    expect(thay("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_api;")).toEqual([]);
    // Xanh: theo cột không có `id`; INSERT mức bảng trên bảng KHÔNG tenant; `GRANT vai TO vai` không bị nuốt sang câu sau.
    expect(thay("GRANT INSERT (org_id), UPDATE (org_id) ON bang_moi TO app_api;")).toEqual([]);
    expect(thay("CREATE TABLE danh_muc (id int); GRANT INSERT ON danh_muc TO app_api;")).toEqual([]);
    expect(thay("GRANT app_api TO app_unseal; GRANT SELECT ON bang_moi TO app_api;")).toEqual([]);
    expect(
      kiemGrantInsertCapId(new Map([["091_goc.sql", "CREATE TABLE organizations (id uuid PRIMARY KEY); GRANT INSERT (id, name) ON organizations TO app_khoi_tao;"]])).viPham,
    ).toEqual([]);
  });

  it("⑶ đỏ: bảng tenant chưa khai; dòng khai trỏ sai tệp; dòng khai thiu — khai đúng thì xanh", () => {
    const tep = new Map([BANG_DU("091", KHACH)]);
    expect(kiemKhaiBangTenant(tep, [])).toEqual([
      '091_bang_moi.sql: bảng tenant "bang_moi" chưa có trong BANG_TENANT_KHAI của hardening.always.sql (ADR-037).',
    ]);
    expect(kiemKhaiBangTenant(tep, [{ nsp: "public", ten: "bang_moi", mig: "090_khac" }])).toEqual([
      "BANG_TENANT_KHAI khai ('public', 'bang_moi', '090_khac') nhưng CREATE TABLE của bảng ấy ở 091_bang_moi.sql.",
    ]);
    expect(
      kiemKhaiBangTenant(tep, [
        { nsp: "public", ten: "bang_moi", mig: "091_bang_moi" },
        { nsp: "public", ten: "bang_cu", mig: "050_bang_cu" },
      ]),
    ).toEqual(["BANG_TENANT_KHAI khai 'bang_cu' (050_bang_cu) mà không migration đánh số nào CREATE TABLE bảng tenant ấy — dòng khai thiu."]);
    expect(kiemKhaiBangTenant(tep, [{ nsp: "public", ten: "bang_moi", mig: "091_bang_moi" }])).toEqual([]);
    // Bộ đọc hàng khai: đúng khuôn của hardening, kể cả số bốn chữ số như số tạm `95NN` (fixture dùng số ngoài dải tạm:
    // `pnpm cap-so --kiem` đọc `95NN_…` là số tạm chưa cấp).
    expect(
      docBangTenantKhai(
        "\n  BANG_TENANT_KHAI constant text :=\n    $q$(VALUES\n         ('public', 'a', '002_a'),\n         ('public', 'b', '1234_b')\n       ) AS bt(nspname, relname, mig)$q$;\n",
      ),
    ).toEqual([
      { nsp: "public", ten: "a", mig: "002_a" },
      { nsp: "public", ten: "b", mig: "1234_b" },
    ]);
  });

  it("⑷ đỏ: hàm RETURNS trigger gắn INSERT mà không ở danh sách nào; không gắn gì cũng đỏ; chỉ gắn TRUNCATE thì miễn; đã khai thì xanh", () => {
    const HAM = "CREATE OR REPLACE FUNCTION public.ham_moi() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$;\n";
    const GAN = (pSuKien: string): string => `CREATE TRIGGER t BEFORE ${pSuKien} ON bang_moi FOR EACH ROW EXECUTE FUNCTION ham_moi();\n`;
    const kiem = (pSql: string, pKhong: readonly string[] = []): string[] => kiemHamTriggerDaKhai(new Map([["091_x.sql", pSql]]), ["chan_sua_xoa"], pKhong).viPham;
    expect(kiem(HAM + GAN("INSERT OR UPDATE OF ghi_chu"))).toEqual([
      "091_x.sql: hàm trigger public.ham_moi gắn INSERT/UPDATE mà không có tên trong HAM_CANH_CHI_GHI_THEM hay HAM_KHONG_PHAI_CANH " +
        "(db/danh-sach-ham-canh.ts). Khai nó vào ĐÚNG MỘT danh sách — tổng điều tra ở hardening-suy-tu-tinh-chat.int.test.ts sẽ phán xét lời khai ấy.",
    ]);
    expect(kiem(HAM)).toHaveLength(1);
    expect(kiem(HAM + GAN("TRUNCATE"))).toEqual([]);
    expect(kiem(HAM + GAN("INSERT"), ["public.ham_moi"])).toEqual([]);
    // Danh sách canh khai KHÔNG lược đồ; tổng điều tra định danh `public.<tên>` — hai cách viết phải gặp nhau ở đây.
    expect(kiem(HAM.replace("ham_moi", "chan_sua_xoa") + GAN("UPDATE OR DELETE").replace("ham_moi", "chan_sua_xoa"))).toEqual([]);
    // Hàm thường (không RETURNS trigger) không bị đòi; `.always.sql` không bị đọc.
    expect(kiem("CREATE FUNCTION f() RETURNS void LANGUAGE sql AS $f$ SELECT 1 $f$;")).toEqual([]);
    expect(kiemHamTriggerDaKhai(new Map([["hardening.always.sql", HAM]]), [], []).viPham).toEqual([]);
  });
});

// ============================================================================================
// [S1.244 / khoản 171 ⑴] META-TEST CỦA CỬA `USING (true)` ĐỌC LỆNH VÀ VAI ĐÍCH DANH — VĂN BẢN MẪU
//
// Bản S1.82 tự gọi vế `TO <vai>` là vế CHỊU LỰC, nhưng biểu thức của nó là `TO` cộng một tên BẤT KỲ khác `PUBLIC` — `TO app_api`
// đi qua sạch — và không đọc LỆNH, nên `FOR ALL TO app_api USING (true)` cũng qua (thân khoản 171, §S1.83). Lý do của dòng
// ngoại lệ nói "FOR SELECT TO app_liet_ke_to_chuc": phép kiểm nay đọc đúng hai thứ ấy — lệnh viết tường minh bằng lệnh khai,
// danh sách `TO` bằng đúng tập vai khai, mỗi vai khai có tên trong danh sách vai được phép — và policy không bị `ALTER` lại
// trong chính tệp (chủ thể sau tệp phải là chủ thể của câu `CREATE`).
// ============================================================================================
describe("[S1.244 / khoản 171 ⑴] meta-test của cửa USING (true) đọc LỆNH và VAI ĐÍCH DANH — văn bản mẫu", () => {
  const TEP = "052_worker_liet_ke_to_chuc.sql";
  const DONG: NgoaiLeUsingTrue = {
    tenFile: TEP,
    tenPolicy: "organizations_liet_ke_worker",
    lenh: "SELECT",
    vai: ["app_liet_ke_to_chuc"],
    lyDo: "dòng mẫu — lý do không phải thứ đang đo ở khối này",
  };
  const kiem = (pSql: string, pDong: NgoaiLeUsingTrue = DONG): string[] => kiemTraNgoaiLeUsingTrue(new Map([[TEP, pSql]]), [pDong]);
  const cau = (pChuThe: string): string =>
    `CREATE POLICY organizations_liet_ke_worker ON public.organizations ${pChuThe} USING (true);`;
  const P = `${TEP}: ngoại lệ USING (true) "organizations_liet_ke_worker"`;

  it("đối chứng: đúng lệnh, đúng vai — kể cả vai viết trong nháy kép, chú thích giữa các vế, xuống dòng — thì xanh", () => {
    expect(kiem(cau("FOR SELECT TO app_liet_ke_to_chuc"))).toEqual([]);
    expect(kiem(cau('FOR SELECT\n  TO "app_liet_ke_to_chuc" -- chú thích\n'))).toEqual([]);
    expect(kiem(cau("AS PERMISSIVE FOR SELECT TO app_liet_ke_to_chuc"))).toEqual([]);
  });

  it("LỆNH: FOR ALL ⇒ đỏ; không viết FOR (PostgreSQL hiểu là ALL) ⇒ đỏ; FOR DELETE ⇒ đỏ", () => {
    expect(kiem(cau("FOR ALL TO app_liet_ke_to_chuc"))).toEqual([`${P} — policy là FOR ALL, dòng khai là FOR SELECT`]);
    expect(kiem(cau("TO app_liet_ke_to_chuc"))).toEqual([`${P} — policy là FOR ALL (không viết FOR), dòng khai là FOR SELECT`]);
    expect(kiem(cau("FOR DELETE TO app_liet_ke_to_chuc"))).toEqual([`${P} — policy là FOR DELETE, dòng khai là FOR SELECT`]);
  });

  it("VAI ĐÍCH DANH: TO app_api ⇒ đỏ (bản S1.82 xanh); thừa một vai ⇒ đỏ; TO PUBLIC hay không viết TO ⇒ đỏ; thân khoản 171 — FOR ALL TO app_api — đỏ ở CẢ HAI vế", () => {
    expect(kiem(cau("FOR SELECT TO app_api"))).toEqual([`${P} — policy TO app_api, dòng khai TO app_liet_ke_to_chuc`]);
    expect(kiem(cau("FOR SELECT TO app_liet_ke_to_chuc, app_api"))).toEqual([
      `${P} — policy TO app_api, app_liet_ke_to_chuc, dòng khai TO app_liet_ke_to_chuc`,
    ]);
    expect(kiem(cau("FOR SELECT TO PUBLIC"))).toEqual([`${P} — policy TO PUBLIC, dòng khai TO app_liet_ke_to_chuc`]);
    expect(kiem(cau("FOR SELECT"))).toEqual([`${P} — policy TO PUBLIC (không viết TO), dòng khai TO app_liet_ke_to_chuc`]);
    expect(kiem(cau("FOR ALL TO app_api"))).toEqual([
      `${P} — policy là FOR ALL, dòng khai là FOR SELECT`,
      `${P} — policy TO app_api, dòng khai TO app_liet_ke_to_chuc`,
    ]);
  });

  it("dòng khai mang một vai KHÔNG có tên trong VAI_DUOC_MIEN_USING_TRUE ⇒ đỏ dù policy khớp dòng khai — vai ứng dụng không bao giờ là chủ thể hẹp", () => {
    expect(kiem(cau("FOR SELECT TO app_api"), { ...DONG, vai: ["app_api"] })).toEqual([
      `${P} — vai app_api không có tên trong VAI_DUOC_MIEN_USING_TRUE`,
    ]);
    expect(kiem(cau("FOR SELECT TO PUBLIC"), { ...DONG, vai: ["PUBLIC"] })).toEqual([
      `${P} — vai PUBLIC không có tên trong VAI_DUOC_MIEN_USING_TRUE`,
    ]);
  });

  it("ALTER POLICY cùng tên trong tệp ⇒ đỏ (chủ thể sau tệp không còn là chủ thể của câu CREATE); không có câu CREATE ⇒ đỏ", () => {
    expect(
      kiem(cau("FOR SELECT TO app_liet_ke_to_chuc") + "\nALTER POLICY organizations_liet_ke_worker ON public.organizations TO app_api;"),
    ).toEqual([`${P} — 1 câu ALTER POLICY cùng tên trong tệp: chủ thể sau tệp không còn là chủ thể của câu CREATE`]);
    expect(kiem("SELECT 1;")).toEqual([`${P} không ứng với câu CREATE POLICY nào của tệp`]);
  });
});

// ============================================================================================
// [S1.244 / khoản 171 ⑵] MIỄN TRỪ MỤC (C) VÀ HAI HÀNG GHIM THAY CHỖ NÓ ĐỨNG CÙNG MỘT ĐIỀU KIỆN
//
// Hàm SECURITY DEFINER khai ở `NGOAI_LE_DOC_VONG` được mục (C) miễn vì hai hàng ghim canh nó thay phép cấm — «định nghĩa hàm
// <chữ ký> …» (thân + chủ hàm) và «EXECUTE trên <chữ ký> …» (ACL). Hardening nay miễn CÙNG điều kiện với hai hàng ấy: migration
// khai sinh (cột `mig`) có trong `schema_migrations`. Điều kiện của miễn trừ đọc cột `mig`; tiền điều kiện của hai hàng ghim là
// một literal — hai bản chép của một điều kiện. Vế này giữ chúng trùng nhau: một hàng ghim neo migration khác (gõ nhầm tên tệp,
// đổi tên tệp) thì IM MÃI trong khi miễn trừ đứng — đúng hình dạng khoản 171 — và đỏ ở đây. Hàm khai mà thiếu hàng ghim cũng đỏ.
// ============================================================================================

/** Tiền điều kiện chuẩn của một hàng ghim thay chỗ: migration khai sinh đã áp — nguyên văn khuôn của hardening. */
const tienDeHangGhim = (pMig: string): string =>
  `to_regclass('public.schema_migrations') IS NOT NULL AND EXISTS (SELECT 1 FROM public.schema_migrations WHERE version = '${pMig}.sql')`;

/** Vi phạm của cặp (dòng khai hàm ở NGOAI_LE_DOC_VONG ↔ hai hàng ghim thay chỗ) trên văn bản hardening — rỗng là xanh. */
function kiemHangGhimThayCho(pHardening: string): { readonly viPham: string[]; readonly soHam: number } {
  const viPham: string[] = [];
  const khoi = docHangHardening(pHardening, "NGOAI_LE_DOC_VONG");
  let soHam = 0;
  for (const [, loai, nsp, ten, mig] of khoi.matchAll(/\('([^']*)', '([^']*)', '([^']*)', '([^']*)', '(?:[^']|'')*'\)/gu)) {
    if (loai !== "ham") continue;
    soHam += 1;
    for (const nhan of [`định nghĩa hàm ${ten!}`, `EXECUTE trên ${ten!}`]) {
      const re = new RegExp(String.raw`\n {4}ARRAY\[\n {6}\$q\$${neo(nhan)}[^$]*\$q\$,\n {6}\$q\$([^$]*)\$q\$,`, "gu");
      const khop = [...pHardening.matchAll(re)];
      if (khop.length !== 1) {
        viPham.push(`${nsp!}.${ten!}: cần đúng một hàng ghim «${nhan} …» thay chỗ miễn trừ mục (C) — thấy ${khop.length}`);
      } else if (khop[0]![1] !== tienDeHangGhim(mig!)) {
        viPham.push(`${nsp!}.${ten!}: hàng ghim «${nhan} …» có tiền điều kiện khác dòng khai (migration ${mig!}): ${khop[0]![1]!}`);
      }
    }
  }
  return { viPham, soHam };
}

describe("[S1.244 / khoản 171 ⑵] miễn trừ mục (C) và hai hàng ghim thay chỗ nó đứng cùng một điều kiện", () => {
  const HARDENING = docCacFile().get("hardening.always.sql");
  if (HARDENING === undefined) throw new Error("không đọc được db/migrations/hardening.always.sql");

  it("hardening thật: mỗi hàm khai ở NGOAI_LE_DOC_VONG có đúng hai hàng ghim thay chỗ, tiền điều kiện neo ĐÚNG migration của dòng khai", () => {
    const { viPham, soHam } = kiemHangGhimThayCho(HARDENING);
    // Sàn, không số đúng: một hàm khai mới (khoản 277, lô B5) phải mang hai hàng ghim thay chỗ như `052` — vế dưới đòi thế.
    expect(soHam, "chống rỗng ruột: hôm nay một hàm khai (ADR-040)").toBeGreaterThanOrEqual(1);
    expect(viPham).toEqual([]);
  });

  it("văn bản mẫu: hàng ghim neo migration khác (gõ nhầm) ⇒ đỏ nêu tiền điều kiện; thiếu hàng ghim ACL ⇒ đỏ", () => {
    const tienDe = tienDeHangGhim("052_worker_liet_ke_to_chuc");
    expect(HARDENING.split(tienDe).length - 1, "dàn cảnh: hai hàng ghim mang đúng tiền điều kiện này").toBe(2);
    const goNham = HARDENING.replace(tienDe, tienDeHangGhim("052_worker_liet_ke_to_chuc_cu"));
    expect(kiemHangGhimThayCho(goNham).viPham).toEqual([
      "public.outbox_danh_sach_to_chuc(): hàng ghim «định nghĩa hàm outbox_danh_sach_to_chuc() …» có tiền điều kiện khác dòng khai " +
        `(migration 052_worker_liet_ke_to_chuc): ${tienDeHangGhim("052_worker_liet_ke_to_chuc_cu")}`,
    ]);
    const thieuAcl = HARDENING.replace("$q$EXECUTE trên outbox_danh_sach_to_chuc():", "$q$EXECUTE-trên outbox_danh_sach_to_chuc():");
    expect(kiemHangGhimThayCho(thieuAcl).viPham).toEqual([
      "public.outbox_danh_sach_to_chuc(): cần đúng một hàng ghim «EXECUTE trên outbox_danh_sach_to_chuc() …» thay chỗ miễn trừ mục (C) — thấy 0",
    ]);
  });
});
