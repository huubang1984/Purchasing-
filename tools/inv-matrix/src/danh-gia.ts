// =============================================================================================
// PHẦN PHÁN XÉT CỦA BỘ SINH — CẤU HÌNH ĐƯỢC GHIM, KHÔNG PHẢI BẢO ĐẢM ĐƯỢC NỚI (QT2)
//
// Brief của Task 11 đề nghị đặt `continue-on-error: true` cho job `evidence` vì ma trận còn đỏ
// tới hết S1. Lý do chính đáng, NHƯNG nó là fail-open và IM LẶNG: một job xanh-nhưng-thực-ra-đỏ.
// Trả lời QT1 cho thiết kế đó — *ai nhìn thấy nó đỏ, bằng cách nào, trong bao lâu?* — cho ra
// **không ai, không bằng cách nào, không bao giờ**: `continue-on-error` không sinh ra chú thích
// nào trên PR, và không một lượt review nào bắt buộc phải mở log của một job đã xanh.
//
// Cách làm ở đây đảo chiều: GHIM DANH SÁCH các mã được phép chưa phủ ở cuối S0, mỗi mã một lý
// do đọc được, rồi cho job ĐỎ THẬT khi một mã NGOÀI danh sách chưa phủ. Trả lời QT1 lúc này:
// người mở PR nhìn thấy, ngay trên cổng CI bắt buộc, trong một lượt chạy.
//
// Danh sách này là RÀNH BUỘC HAI CHIỀU, và chiều thứ hai mới là chiều quan trọng: một mã trong
// danh sách mà ĐÃ ĐƯỢC PHỦ cũng làm bộ sinh ĐỎ, kèm lời nhắc gỡ nó ra. Nhờ vậy danh sách chỉ
// co lại, không bao giờ nở ra trong im lặng — nếu thiếu chiều đó thì nó lại đúng là một
// `continue-on-error` viết dài hơn.
// =============================================================================================

import type { Invariant, TestOutcome } from "./parse.js";

export type NhanKetQua = "✅ ĐẠT" | "🔴 ĐANG ĐỎ" | "⚠️ BỊ BỎ QUA" | "⏳ CHƯA PHỦ";

export interface KetQuaHang {
  readonly nhan: NhanKetQua;
  /** Có ít nhất một test mang nhãn của mã này. KHÔNG đồng nghĩa với "đạt". */
  readonly coTest: boolean;
  /** Trạng thái này chặn merge. */
  readonly chan: boolean;
}

/**
 * MÃ ĐƯỢC PHÉP CHƯA PHỦ Ở CUỐI S0 — 23 mã, mỗi mã một lý do.
 *
 * Ba nguồn của lý do, không được lẫn lộn: (a) chủ ngữ của bất biến chưa tồn tại trong mã sản
 * phẩm; (b) một task trước đã CỐ Ý BỎ thẻ kèm phép đo; (c) lớp cưỡng chế chưa được viết.
 * Trạng thái ĐÚNG của một hàng trống là "chưa phủ, có lý do" — nguy hiểm không nằm ở chỗ nó
 * trống, mà đến khi ai đó LẤP NÓ BẰNG NHÃN THAY VÌ BẰNG LỚP.
 */
export const MA_DUOC_PHEP_CHUA_PHU: ReadonlyMap<string, string> = new Map([
  // --- Nhóm A: toàn bộ bí mật giá. Chủ ngữ là RFQ + phong bì niêm phong, thuộc S1. ---
  ["A1", "S1 — không có endpoint nào, và không có trường giá nào, trong 001–007."],
  ["A2", "S1 — mã hoá phía trình duyệt (ADR-007) chưa có; `packages/crypto-keys/src/roundtrip.test.ts:31` tự ghi lý do KHÔNG gắn thẻ."],
  ["A3", "S1 — bảng bid chưa tồn tại."],
  ["A4", "S1 — bộ quét rò rỉ đòi OpenAPI và endpoint, cả hai chưa có."],
  ["A5", "S1 — chưa có nhà cung cấp, lời mời, hay ID báo giá."],
  ["A6", "S1 — chưa có báo giá để đếm."],

  // --- Nhóm B: hai mã đòi luồng nộp thầu; B5 đòi job định kỳ. ---
  ["B1", "S1 — bảng `vendor_bid_versions` chưa tồn tại."],
  ["B2", "S1 — biên nhận nộp thầu đòi RFQ, ciphertext báo giá và chữ ký hệ thống; không thứ nào có ở S0."],
  ["B5", "S1/S6 — job kiểm tra ciphertext định kỳ chưa tồn tại."],

  // --- Nhóm C: thời gian. C2/D4 do Task 10 CỐ Ý bỏ thẻ, kèm phép đo. ---
  ["C1", "S1 — `deadline_at` và đường nộp thầu chưa tồn tại."],
  ["C2", "S1 — Task 10 CỐ Ý bỏ thẻ `[INV-C2]`: chủ ngữ (RFQ, `deadline_at`, báo giá muộn) chưa có trong 001–007, nên test 'kind lạ chuyển sang FAILED chứ không treo' đo một tính chất THẬT của runner nhưng không đo C2."],
  ["C3", "S1 — chưa có trạng thái RFQ nào để gác."],
  ["C4", "S1 — chưa có deadline để rút ngắn hay gia hạn."],
  ["C5", "S1 — khoá theo RFQ chưa tồn tại (xem G2)."],

  // --- Nhóm D: hai mã còn lại. ---
  ["D2", "S1 — ngưỡng RFQ và luồng phê duyệt kép chưa tồn tại."],
  ["D4", "S1 — Task 10 CỐ Ý bỏ thẻ `[INV-D4]`: D4 đòi cảnh báo *tức thì*, còn outbox là POLL và độ trễ của nó bị chặn dưới bởi `pollIntervalMs`; đường đúng là `NOTIFY`/`LISTEN` hoặc một đường đồng bộ."],

  // --- Nhóm E: magic link và OTP. E3 là mã DUY NHẤT của nhóm có lớp ở S0. ---
  ["E1", "S1 — chưa có magic link; `sessions` chưa có đường đời trong mã sản phẩm."],
  ["E2", "S1 — chưa có phiên báo giá để gác bằng OTP."],
  ["E4", "S1 — chưa có MST hay mã RFQ trong lược đồ."],
  ["E5", "S1 — chưa có link chuyển tiếp hay danh tính người được mời."],
  ["E6", "S1 — chưa có URL nào; Referrer-Policy thuộc tầng HTTP chưa dựng."],

  // --- Nhóm G: hai mã trống, hai lý do KHÁC NHAU. ---
  ["G2", "S1 — khoá THEO RFQ đòi RFQ. `packages/crypto-keys/src/roundtrip.test.ts:47` tự ghi ra rằng nó CỐ Ý không gắn `[INV-G2]` vì lý do ấy. Trước vòng fix 1 của Task 9, năm test mang nhãn này thật ra đo quy tắc biên giới depcruise — nay là `[INV-H11]`. Cái S0 có là bọc khoá theo TỔ CHỨC có phiên bản, thứ nuôi G1/G3."],
  ["G4", "CHƯA CÓ LỚP, không phải chưa có nhãn — `grep audit` trên `packages/crypto-keys/src/*.ts` trừ test = 0 hit. Hạ tầng ghi (`004_audit_chain_functions.sql`, nhóm B3) đã có; không một thao tác khoá nào GỌI nó."],
]);

/**
 * PHẠM VI THẬT HẸP HƠN MỆNH ĐỀ — cho những mã ĐÃ PHỦ mà bảo đảm đo được KHÔNG rộng bằng câu
 * chữ ở sổ đăng ký. Đây là phần dễ bị bỏ nhất của một evidence pack, và là phần một kiểm toán
 * viên hỏi tới thứ hai: một ô ✅ cạnh một mệnh đề rộng LÀ một phát biểu rộng hơn thứ được đo.
 */
export const PHAM_VI_HEP: ReadonlyMap<string, string> = new Map([
  ["D1", "Phép **kiểm** độ tươi (`assertFreshMfa`) đã có và đã được đo, nhưng TOÀN BỘ đường đời của `sessions` chưa tồn tại trong mã sản phẩm: không hàm nào phát token, tra token, hay đặt `mfa_verified_at`. D1 là một phép kiểm ĐÚNG chưa có ai gọi."],
  ["D5", "Được cưỡng chế cho đường đi **qua `requirePermission`**. Một lần từ chối ở tầng CSDL (RLS/GRANT) không sinh bản ghi nào, và một lần thử MFA thất bại **cố ý** không ghi sổ (ADR-008)."],
  ["E3", "Sổ đăng ký định nghĩa E3 bằng **năm** vế. Vế *giới hạn tần suất* **không có một dòng mã nào** trong toàn S0. Bốn vế còn lại có lớp và có mốc chết. Trần loạt đầu của vế *giới hạn số lần thử* là độ đồng thời của kẻ tấn công, không phải hằng số cấu hình."],
  ["F1", "RLS + FORCE phủ mọi bảng tenant, `outbox_jobs` gồm cả. Hàng rào `assertTenantBound` ở tầng ứng dụng là lớp thứ hai và nó tự làm mù mình bằng DANH SÁCH TÊN ở hai chỗ đã đo: `NOBYPASSRLS` chỉ ghim đúng bốn tên role, và hàm plpgsql ngoài danh sách không được ghim."],
  ["G1", "Cưỡng chế bằng quy tắc CẠNH của dependency-cruiser cộng danh sách trắng barrel. Bốn gói (`audit`, `tenancy`, `db`, `test-support`) CHƯA có danh sách trắng barrel, nên một symbol mọc ra ở mặt tiền của chúng không được canh bởi lớp nào."],
]);

/**
 * TRÍCH NGUYÊN VĂN hai phát biểu bàn giao đã chốt ở Task 6 (`progress.md`, mục *PHAT BIEU BAN
 * GIAO CHO TASK 8+ VA CHO BAN DOI CHIEU BAT BIEN (Task 11)* và mục tương ứng cho Task 6).
 * Chúng đã được hiệu chuẩn qua hai vòng fix — CHÉP LẠI NGUYÊN BYTE, không diễn đạt lại.
 * Giữ nguyên chính tả không dấu của sổ tay tiến trình: đó là bằng chứng, không phải văn bản.
 */
export const TRICH_BAN_GIAO: ReadonlyArray<{ ma: string; trich: string }> = [
  {
    ma: "B3",
    trich: `B3 BAO DAM: voi so cua mot to chuc MA PHIEN HIEN TAI DOC DUOC, verifyAuditChain() phat hien moi thao tac
  XOA, CHEN, CAT DUOI, va moi thao tac SUA tren cac truong di vao bam. Tien anh v2 phu DU 13 COT DU LIEU
  cong prev_hash (vao bam dang byte) va hash (dau ra) — KHONG con cot nao cua bang so nam ngoai phep bam.
  \`checked\` la SO HANG DOC DUOC DUOI RLS, khong phai so hang ton tai.
TRUOC app_api/app_unseal/injection: manh — nhung CONG VIEC DO TRIGGER VA REVOKE THEO COT CUA B4 LAM,
  khong phai chuoi hash.
TRUOC CHU SO HUU BANG KHONG-SUPERUSER: chuoi KHONG CO NEO NGOAI chung minh VE CO BAN LA KHONG GI CA.
  Do duoc: 11 cot du lieu bi sua theo kieu "tinh lai duoi" cho ok:true tu chuoi; CHI NEO NGOAI bat duoc.
  Chuoi tu no chi bat KE TAN CONG LUOI.
NEU VA CHI NEU co ExternalAnchor giu o noi role deploy KHONG GHI DUOC: chuoi con phat hien so bi
  THAY THE / DUNG LAI / LAM RONG — CHO TIEN TO TOI LAN XUAT CUOI.
MOT CHUOI HASH "HOP LE" CHUNG MINH GI CHO KIEM TOAN VIEN: rang cac hang HIEN DANG DOC DUOC, TINH TOI LAN
  XUAT NEO CUOI, LA DUNG NHUNG HANG DA TON TAI O THOI DIEM DO — VA CHI KHI kem mot ExternalAnchor xuat xu
  ngoai vung ghi cua role deploy. KHONG CO NEO, NO CHUNG MINH KHONG GI CA truoc mot chu so huu bang.
NO KHONG CHUNG MINH: (1) "moi su kien da xay ra deu co mat" — lop phong thu la DANH SACH TRANG TRIGGER
  trong hardening, KHONG phai chuoi; (2) moi thu SAU lan xuat neo cuoi — NHIP NEO CHINH LA CUA SO GIA MAO;
  (3) \`source\` cua ExternalAnchor la NHAN XUAT XU DO NGUOI GOI VIET, khong xac thuc, khong the xac thuc o S0.
  Lop KIEU chi mua duoc MOT dieu: duong tat "tu duc neo tu chinh so dang kiem" KHONG CON VIET DUOC MOT
  CACH TINH CO. O THI CHAY KHONG CO LOP NAO CHAN; (4) ARTEFACT NEO NGOAI HIEN KHONG TON TAI — CO CHE da co,
  ARTEFACT thi chua; audit_events, audit_chain_anchors VA schema_migrations DEU CUNG VUNG TIN CAY nen
  KHONG CAI NAO trong ba duoc dung lam goc tin cay; (5) TINH TOAN VEN CUA LUOC DO — (D5) la PHAT HIEN,
  KHONG NGAN CHAN; giua luc mot cot bi doi ten va lan migrate() ke, ben ghi TU CHON DUOC seq/prev_hash/hash.`,
  },
  {
    ma: "B4",
    trich: `B4 BAO DAM: truoc app_api/app_unseal bi chiem, role dang nhap ung dung, SQL injection, va thanh vien
  pg_write_all_data — HANG DA NAM TRONG public.audit_events KHONG BI SUA, KHONG BI XOA, KHONG BI CAT DUOI.
  Lop A (trigger ENABLE ALWAYS) rang buoc ca chu so huu bang lan superuser TREN DUONG DML TRUC TIEP;
  lop B (ACL) la lop DUY NHAT con dung khi mot trigger bi tat; lop C dua trang thai ve dung hoac
  GAY ON AO o lan migrate() ke.
VONG 2 THEM DUNG BA THU, KHONG HON:
  (i) mot loi o BUOC 0/1/1b khong con giet luot sua => 004_*.sql LUON TOI DICH, tuc duong thoat QT1
      "va bang mot migration moi" nay la TINH CHAT cua CA LUOT SUA;
  (ii) viec lop C GO mot trigger/rule khoi so kiem toan khong con im lang => mac dinh-DONG tro thanh
      mot RANG BUOC BAN GIAO DOC DUOC thay vi mot cai bay;
  (iii) moi thong bao chan deploy nay NEU DUNG BANG NAO, O SCHEMA NAO.
B4 KHONG BAO DAM: "moi su kien da xay ra deu co mat trong bang", va "day van la cai so cu".
  Ba duong do duoc o 5ae8040, TAT CA deu MIGRATE OK va KHONG MOT WARNING NAO, deu trong tay
  CHU SO HUU BANG KHONG-SUPERUSER (tuc chinh role deploy):
    RENAME + CREATE TABLE (LIKE ... INCLUDING ALL) + dung lai RLS/policy/GRANT + DROP ban cu -> 4 hang -> 0
    SET SCHEMA -> sua -> tra ve -> 4 hang -> 2
    DROP ca hai + DELETE FROM schema_migrations WHERE version LIKE '003%' -> 003 chay lai, so RONG
  => GIOI HAN CAU TRUC, khong dong duoc o tang nay (can event trigger cap cum, doi SUPERUSER,
     hoac mot NEO NGOAI DATABASE).`,
  },
];

/**
 * XUẤT XỨ CỦA BẰNG CHỨNG: đòi một DẤU HIỆU TÍCH CỰC — đúng **40** ký tự hex thường — thay vì
 * hỏi "có lỗi không". Ném, không trả về `"khong-xac-dinh"`: một evidence pack ghi SHA rỗng là
 * một evidence pack KHÔNG CÓ XUẤT XỨ, tệ hơn là không có evidence pack.
 *
 * Vì sao hàm này THUẦN và nằm ở đây thay vì nằm trong `commitSha()` của `index.ts`: ràng buộc
 * (11) áp vào chính mã sản phẩm chỉ có giá trị khi nó ĐO ĐƯỢC. Đo được ở harness Task 11 —
 * khi phép kiểm còn nằm trong vỏ I/O, mũi nới `{40}` thành `{7,40}` SỐNG SÓT: `git rev-parse
 * --short` cho SHA bảy ký tự, vẫn là hex, vẫn khác rỗng, và không oracle nào phân biệt được.
 * Con số 40 không phải trang trí: `--short` KHÔNG tất định (Git nới độ dài khi kho lớn lên),
 * nên một xuất xứ ngắn là một xuất xứ có thể đổi hình dạng giữa hai lượt chạy.
 */
export function assertFullSha(raw: unknown): string {
  const sha = typeof raw === "string" ? raw.trim() : "";
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(
      `commitSha(): không lấy được SHA hợp lệ (nhận được ${JSON.stringify(sha)}). ` +
        `Evidence pack không có xuất xứ thì không phải bằng chứng.`,
    );
  }
  return sha;
}

/** Phán xét một hàng từ danh sách kết quả test mang nhãn của nó. */
export function ketQua(outcomes: readonly TestOutcome[] | undefined): KetQuaHang {
  if (outcomes === undefined || outcomes.length === 0) {
    return { nhan: "⏳ CHƯA PHỦ", coTest: false, chan: false };
  }
  if (outcomes.some((o) => o.status === "failed")) {
    return { nhan: "🔴 ĐANG ĐỎ", coTest: true, chan: true };
  }
  if (outcomes.every((o) => o.status === "skipped")) {
    return { nhan: "⚠️ BỊ BỎ QUA", coTest: true, chan: true };
  }
  return { nhan: "✅ ĐẠT", coTest: true, chan: false };
}

/**
 * Mọi lý do chặn merge, tính trên toàn ma trận. Mảng RỖNG nghĩa là cổng xanh.
 * Hàm thuần: không đọc file, không `process.exit` — nên mọi vế của nó kiểm thử đột biến được.
 */
export function kiemTraCong(
  invariants: readonly Invariant[],
  coverage: ReadonlyMap<string, readonly TestOutcome[]>,
  duocPhep: ReadonlyMap<string, string> = MA_DUOC_PHEP_CHUA_PHU,
  phamViHep: ReadonlyMap<string, string> = PHAM_VI_HEP,
): string[] {
  const van: string[] = [];
  const trongSo = new Set(invariants.map((i) => i.id));

  for (const ma of duocPhep.keys()) {
    if (!trongSo.has(ma)) {
      van.push(
        `Danh sách "được phép chưa phủ" nhắc mã \`${ma}\` KHÔNG có trong sổ đăng ký — ` +
          `hoặc mã sai, hoặc một hàng đã biến mất khỏi docs/TEST-PLAN.md.`,
      );
    }
  }
  for (const ma of phamViHep.keys()) {
    if (!trongSo.has(ma)) {
      van.push(`Ghi chú "phạm vi hẹp" nhắc mã \`${ma}\` KHÔNG có trong sổ đăng ký.`);
    }
  }

  for (const inv of invariants) {
    const kq = ketQua(coverage.get(inv.id));
    const trongDs = duocPhep.has(inv.id);

    if (kq.chan) {
      van.push(`\`${inv.id}\` ${kq.nhan}: có test mang nhãn nhưng không có test nào ĐẠT.`);
      continue;
    }
    if (!kq.coTest && !trongDs) {
      van.push(
        `\`${inv.id}\` CHƯA PHỦ và KHÔNG nằm trong danh sách được phép. Viết lớp cưỡng chế và ` +
          `một test mang nhãn \`[INV-${inv.id}]\`, hoặc — nếu đây là một khoảng trống có lý do — ` +
          `ghi lý do đó vào MA_DUOC_PHEP_CHUA_PHU. Đừng gắn nhãn lên một test đo thứ khác.`,
      );
      continue;
    }
    if (kq.coTest && trongDs) {
      van.push(
        `\`${inv.id}\` ĐÃ ĐƯỢC PHỦ nhưng vẫn nằm trong danh sách được phép chưa phủ. ` +
          `GỠ nó khỏi MA_DUOC_PHEP_CHUA_PHU để mã này không bao giờ tụt lại trong im lặng.`,
      );
    }
  }

  return van;
}
