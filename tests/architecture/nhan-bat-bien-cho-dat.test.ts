// ==============================================================================================
// [INV-H22] MỘT NHÃN `[INV-XX]` PHẢI ĐƯỢC ĐẶT Ở MỘT CHỖ ĐÃ KHAI — TOÀN KHO
//
// ----------------------------------------------------------------------------------------------
// KHIẾM KHUYẾT, NÓI THẲNG (khoản nợ 12)
// ----------------------------------------------------------------------------------------------
// `evidence/INV-matrix.md` gom độ phủ bằng nhãn `[INV-XX]` trong TÊN TEST. Một nhãn sai vì thế
// không phải chuyện vệ sinh: nó ghi một dòng *"passed"* vào hàng của một bất biến và làm một lỗ
// trống TRÔNG NHƯ ĐÃ VÁ. Task 9 đã trả giá đúng ở đó — bốn test biên giới mang `[INV-G3]` trong
// khi G3 nói về xoay master key; sửa nhãn xong thì hàng G2 về 0 test, tức nó **lẽ ra đã trống từ
// đầu** và cái nhãn sai đã che điều đó.
//
// Trước tệp này, kho có HAI lớp và **không lớp nào xét CHỖ ĐẶT**:
//
//   • `packages/outbox/src/nhan-bat-bien.test.ts` — một DANH SÁCH CẤM (C2, D4, B3) và phạm vi
//     tự khai *"chỉ canh `packages/outbox/src/`"*. Nó mạnh hơn tệp này ở chỗ nó mang một PHÉP ĐO
//     (ba mã ấy KHÔNG đo được ở gói đó), nhưng nó không nói gì về phần còn lại của kho.
//   • `tools/inv-matrix/src/parse.ts` → `findUnregisteredLabels` — bắt nhãn trỏ tới mã **không
//     tồn tại**. Một nhãn ĐÚNG CÚ PHÁP gắn SAI CHỖ đi qua nó sạch sẽ.
//
// ----------------------------------------------------------------------------------------------
// VÌ SAO KHÔNG DÙNG SỔ ĐĂNG KÝ LÀM NGUỒN KHAI — MỘT PHÉP ĐO, KHÔNG PHẢI MỘT SỞ THÍCH
// ----------------------------------------------------------------------------------------------
// Đường hiển nhiên: `docs/TEST-PLAN.md` đã có cột *nơi cưỡng chế*, dùng nó làm nguồn khai chỗ
// đặt. **Đo ngày 2026-09-09, trước khi viết tệp này:**
//
//   mã `H`   : 13 cặp (mã, tệp) — sổ đăng ký nêu tên tệp cho **7**
//   mã `A–G` : 101 cặp          — sổ đăng ký nêu tên tệp cho **0**
//
// (Hai con số ấy đo trên tập cặp lấy từ dòng `it(`; tập ĐẦY ĐỦ, kể cả `describe(`, là 137
// cặp — xem `DONG_KHAI_TEST`. Tỷ lệ thì không đổi chiều.)
//
// Cột ấy là VĂN XUÔI cho các hàng nghiệp vụ (*"Kiến trúc: không có khóa giải mã trong `api`"*),
// không phải một con trỏ. Dùng nó làm nguồn khai sẽ đỏ 101 lần ở lượt chạy đầu **mà không có
// khiếm khuyết nào** — đúng cái bẫy khoản nợ 61 đã đo được ở `Handoff.md`. Nên nguồn khai phải
// là một SỔ KHAI riêng, và nó nằm ngay dưới đây.
//
// ----------------------------------------------------------------------------------------------
// TÍNH CHẤT NÀY BẢO ĐẢM GÌ — VÀ, QUAN TRỌNG HƠN, KHÔNG BẢO ĐẢM GÌ
// ----------------------------------------------------------------------------------------------
// **Bảo đảm:** không cặp (mã, tệp) nào ra đời, biến mất hay đổi chỗ trong IM LẶNG. Gắn
// `[INV-B2]` vào một tệp chưa khai ⇒ ĐỎ, và cách duy nhất làm nó xanh là **viết thêm một dòng
// vào sổ khai** — tức một quyết định nhìn thấy được trong diff, đúng khuôn `MIEN_TRU` của
// ADR-027 và `MIEN_TRAN_NGUOI_GOI` của ADR-029 ⑹.
//
// **KHÔNG bảo đảm:** rằng một cặp đã khai là ĐÚNG. Sổ khai dưới đây được SINH RA từ trạng thái
// đo được của kho tại `bebeb41`, rồi đóng băng. Nó **không** kiểm toán 137 cặp có sẵn — nó chặn
// cặp thứ 138 đi vào lặng lẽ. Nói cách khác: nó là lớp cho LẦN SAU, không phải một phán xét về
// hôm nay. Vế *"test này có thật sự đo bất biến ấy không"* là một PHÁN XÉT và không cơ giới hoá
// được; nó vẫn là việc của mắt người, y như vế tương ứng của `[INV-H20]`.
//
// Một phép soi bằng mắt đã chạy trên bốn cặp trông đáng ngờ nhất — `tests/architecture/
// barrel-exports.test.ts` nhận `B2`, `D1`, `D5`, `E3` — và **cả bốn đứng vững**: một test mặt
// tiền export LÀ lớp cưỡng chế thật cho các bất biến ấy (`verifyReceipt` nhận đúng ba thứ;
// `UNSEAL_CLAUSES` có đúng bốn vế; `hasPermission` và `verifyTotpCode` KHÔNG ra cửa công khai).
// Ghi lại để không ai đọc con số 137 như một danh sách chưa soi.
// ==============================================================================================

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const GOC = fileURLToPath(new URL("../../", import.meta.url));

/** Cùng regex với bộ sinh (`NHAN_PHU_DO_DUOC` ở `tools/inv-matrix/src/parse.ts`). */
const NHAN = /\[INV-([A-H]\d+)\]/g;

/**
 * Dòng khai báo một test HOẶC một khối `describe` — và vế `describe` là kết quả của một phép đo,
 * không phải một sự cẩn thận thừa.
 *
 * Bộ sinh gom nhãn từ `assertionResults[].fullName` của báo cáo vitest, mà `fullName` là
 * **tên describe NỐI tên it**. Nên một nhãn đặt trên `describe` ĐƯỢC TÍNH LÀ ĐỘ PHỦ y hệt nhãn
 * đặt trên `it`. Bản đầu của tệp này chỉ đọc dòng `it(` — và **đo được 22 cặp (mã, tệp) chỉ tồn
 * tại trên dòng `describe(`**, trong đó có `[INV-H19]`, `[INV-H20]`, `[INV-H21]` và cả chín mã
 * hook `H1`–`H10`. Tức lớp mới suýt ra đời với đúng cái lỗ nó sinh ra để bịt.
 *
 * Cùng phép đo ấy bác một câu của lớp có trước: `packages/outbox/src/nhan-bat-bien.test.ts` tự
 * khai *"nó canh THẺ TRÊN TÊN TEST, đúng thứ bộ sinh gom"* — câu ấy RỘNG HƠN thứ được đo, vì nó
 * chỉ quét `it(`. Kết quả của gói ấy không đổi (outbox không có nhãn nào ở `describe`), nhưng
 * câu khai thì đã được sửa tại chỗ.
 */
const DONG_KHAI_TEST = /^\s*(?:it|describe)(?:\.each\b|\.skip\b|\.todo\b|\.only\b)?\s*[(<`]/;

/**
 * SỔ KHAI — mã bất biến ⇒ những tệp được phép mang nhãn ấy trên TÊN TEST.
 *
 * Sinh từ phép đo tại `bebeb41` (56 mã, 137 cặp) rồi ĐÓNG BĂNG. Thêm một dòng ở đây là một
 * quyết định; nó phải đi kèm câu trả lời cho *"tệp ấy đo được bất biến này bằng cách nào"*.
 */
const SO_KHAI: Readonly<Record<string, readonly string[]>> = {
  A1: [
    "apps/unseal-worker/src/kich-ban-41-http.int.test.ts",
    "apps/unseal-worker/src/unseal-worker.int.test.ts",
  ],
  A2: [
    "apps/unseal-worker/src/kich-ban-41-http.int.test.ts",
  ],
  A3: [
    "apps/unseal-worker/src/kich-ban-41-http.int.test.ts",
    "packages/bidding/src/bidding.int.test.ts",
  ],
  A4: [
    "apps/unseal-worker/src/kich-ban-41-http.int.test.ts",
    "apps/unseal-worker/src/unseal-worker.int.test.ts",
    "packages/unseal/src/comparison.int.test.ts",
  ],
  A5: [
    "apps/api/src/api.int.test.ts",
    "apps/api/src/guest.int.test.ts",
    "apps/unseal-worker/src/kich-ban-41-http.int.test.ts",
    "tests/adversarial/a5-co-lap-nha-cung-cap.int.test.ts",
  ],
  A6: [
    "apps/unseal-worker/src/kich-ban-41-http.int.test.ts",
    "packages/unseal/src/comparison.int.test.ts",
  ],
  B1: [
    "apps/api/src/guest.int.test.ts",
    "apps/unseal-worker/src/kich-ban-41-http.int.test.ts",
    "packages/bidding/src/bidding.int.test.ts",
  ],
  B2: [
    "apps/api/src/guest.int.test.ts",
    "apps/public-keys/src/public-keys.test.ts",
    "apps/unseal-worker/src/kich-ban-41-http.int.test.ts",
    "packages/bidding/src/bidding.int.test.ts",
    "packages/bidding/src/receipt.test.ts",
    "tests/architecture/barrel-exports.test.ts",
  ],
  B3: [
    "db/audit-append-only.int.test.ts",
    "packages/audit/src/anchor-sign.test.ts",
    "packages/audit/src/anchor-store.test.ts",
    "packages/audit/src/anchor-verify.test.ts",
    "packages/audit/src/chain.int.test.ts",
    "packages/audit/src/tenant-guard.int.test.ts",
    "packages/audit/src/verifier.test.ts",
    "tools/neo-so-kiem-toan/src/cong-cu.int.test.ts",
  ],
  B4: [
    "db/audit-append-only.int.test.ts",
    "packages/audit/src/chain.int.test.ts",
  ],
  B5: [
    "apps/unseal-worker/src/kich-ban-41-http.int.test.ts",
    "tests/adversarial/t5-doi-khang.int.test.ts",
  ],
  C1: [
    "packages/bidding/src/bidding.int.test.ts",
  ],
  C2: [
    "tests/adversarial/t5-doi-khang.int.test.ts",
  ],
  C3: [
    "packages/unseal/src/unseal.int.test.ts",
  ],
  C4: [
    "tests/adversarial/t5-doi-khang.int.test.ts",
  ],
  C5: [
    "packages/sealed-envelope/src/hang-so.test.ts",
    "packages/sealed-envelope/src/key-material.int.test.ts",
  ],
  D1: [
    "apps/unseal-worker/src/kich-ban-41-http.int.test.ts",
    "packages/identity/src/dinh-chi.int.test.ts",
    "packages/identity/src/mfa.int.test.ts",
    "packages/identity/src/rbac.int.test.ts",
    "packages/unseal/src/unseal.int.test.ts",
    "tests/architecture/barrel-exports.test.ts",
  ],
  D2: [
    "apps/unseal-worker/src/kich-ban-41-http.int.test.ts",
    "packages/identity/src/ma-tran-quyen.test.ts",
    "packages/identity/src/rbac.int.test.ts",
    "packages/rfq/src/rfq.int.test.ts",
    "packages/unseal/src/unseal.int.test.ts",
  ],
  D3: [
    "packages/identity/src/ma-tran-quyen.test.ts",
    "packages/identity/src/rbac.int.test.ts",
    "packages/rfq/src/rfq.int.test.ts",
  ],
  D4: [
    "apps/unseal-worker/src/composition.int.test.ts",
    "packages/unseal/src/unseal.int.test.ts",
  ],
  D5: [
    "apps/api/src/api.int.test.ts",
    "apps/api/src/buyer.int.test.ts",
    "packages/identity/src/rbac.int.test.ts",
    "packages/invitation/src/invitation.int.test.ts",
    "packages/rfq/src/rfq.int.test.ts",
    "packages/unseal/src/unseal.int.test.ts",
    "tests/architecture/barrel-exports.test.ts",
  ],
  E1: [
    "apps/api/src/auth.int.test.ts",
    "apps/api/src/guest.int.test.ts",
    "packages/invitation/src/invitation.int.test.ts",
  ],
  E2: [
    "apps/api/src/auth.int.test.ts",
    "apps/api/src/guest.int.test.ts",
    "packages/invitation/src/invitation.int.test.ts",
  ],
  E3: [
    "apps/api/src/auth.int.test.ts",
    "packages/identity/src/mfa.int.test.ts",
    "packages/invitation/src/invitation.int.test.ts",
    "tests/architecture/barrel-exports.test.ts",
  ],
  E4: [
    "tests/adversarial/t5-doi-khang.int.test.ts",
  ],
  E5: [
    "packages/invitation/src/invitation.int.test.ts",
  ],
  E6: [
    "apps/api/src/api.int.test.ts",
    "apps/api/src/auth.int.test.ts",
    "apps/api/src/guest.int.test.ts",
    "apps/api/src/routes.test.ts",
  ],
  F1: [
    "db/migration-shape.test.ts",
    "db/migrations.int.test.ts",
    "db/rls-coverage.int.test.ts",
    "packages/audit/src/chain.int.test.ts",
    "packages/audit/src/tenant-guard.int.test.ts",
    "packages/audit/src/verifier.test.ts",
    "packages/identity/src/mfa.int.test.ts",
    "packages/identity/src/rbac.int.test.ts",
    "packages/invitation/src/invitation.int.test.ts",
    "packages/outbox/src/outbox.int.test.ts",
    "packages/rfq/src/rfq.int.test.ts",
    "packages/sealed-envelope/src/key-material.int.test.ts",
    "packages/supplier/src/suppliers.int.test.ts",
    "packages/tenancy/src/with-tenant.int.test.ts",
  ],
  F2: [
    "packages/tenancy/src/with-tenant.int.test.ts",
  ],
  F3: [
    "packages/crypto-keys/src/roundtrip.test.ts",
  ],
  G1: [
    "apps/unseal-worker/src/unseal-worker.int.test.ts",
    "packages/audit/src/anchor-sign.test.ts",
    "packages/crypto-keys/src/roundtrip.test.ts",
    "packages/sealed-envelope/src/key-material.int.test.ts",
    "tests/architecture/barrel-exports.test.ts",
    "tests/architecture/boundaries.test.ts",
  ],
  G2: [
    "packages/sealed-envelope/src/key-material.int.test.ts",
    "packages/sealed-envelope/src/roundtrip.test.ts",
  ],
  G3: [
    "packages/crypto-keys/src/roundtrip.test.ts",
  ],
  G4: [
    "apps/unseal-worker/src/unseal-worker.int.test.ts",
    "packages/sealed-envelope/src/key-material.int.test.ts",
  ],
  H1: [
    "tests/hooks/git-safety.test.ts",
  ],
  H10: [
    "tests/hooks/git-safety.test.ts",
    "tests/hooks/protect-secrets.test.ts",
  ],
  H11: [
    "tests/architecture/boundaries.test.ts",
  ],
  H12: [
    "tests/architecture/boundaries.test.ts",
  ],
  H13: [
    "tests/architecture/boundaries.test.ts",
  ],
  H14: [
    "db/unique-oracle.int.test.ts",
  ],
  H15: [
    "tests/architecture/barrel-exports.test.ts",
    "tests/architecture/boundaries.test.ts",
  ],
  H16: [
    "tests/architecture/barrel-exports.test.ts",
    "tests/architecture/bien-gioi-goi.test.ts",
    "tests/architecture/boundaries.test.ts",
  ],
  H17: [
    "apps/api/src/api.int.test.ts",
    "apps/api/src/buyer.int.test.ts",
    "apps/api/src/routes.test.ts",
  ],
  H18: [
    "tests/architecture/barrel-exports.test.ts",
  ],
  H19: [
    "db/hardening-suy-tu-tinh-chat.int.test.ts",
  ],
  H2: [
    "tests/hooks/git-safety.test.ts",
  ],
  H20: [
    "tests/architecture/so-no-tu-doi-chieu.test.ts",
  ],
  H21: [
    "tests/architecture/qt3-cu-phap.int.test.ts",
    "tests/architecture/qt3-ghim-schema.test.ts",
    "tests/architecture/qt3-ngu-phap.int.test.ts",
  ],
  H22: [
    "tests/architecture/nhan-bat-bien-cho-dat.test.ts",
  ],
  H3: [
    "tests/hooks/git-safety.test.ts",
  ],
  H4: [
    "tests/hooks/git-safety.test.ts",
  ],
  H5: [
    "tests/hooks/git-safety.test.ts",
  ],
  H6: [
    "tests/hooks/git-safety.test.ts",
  ],
  H7: [
    "tests/hooks/git-safety.test.ts",
  ],
  H8: [
    "tests/hooks/protect-secrets.test.ts",
  ],
  H9: [
    "tests/hooks/protect-secrets.test.ts",
  ],
};

interface CapDo {
  readonly ma: string;
  readonly tep: string;
  readonly dong: string;
}

/**
 * Nguồn là `git ls-files`, KHÔNG phải đĩa — cùng lý do ADR-029 ⑺: một khẳng định về CÁI KHO phải
 * đọc cái kho. Một tệp test chưa `git add` mà đã mang nhãn thì nó cũng chưa vào CI.
 */
function moiTepTest(): readonly string[] {
  return execFileSync("git", ["ls-files", "*.test.ts"], {
    cwd: GOC,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
    .split(/\r?\n/)
    .filter((d) => d !== "")
    .map((d) => d.split("\\").join("/"));
}

export function quetNhan(danhSachTep: readonly string[]): readonly CapDo[] {
  const ra: CapDo[] = [];
  for (const tep of danhSachTep) {
    const noiDung = readFileSync(join(GOC, tep), "utf8");
    for (const dong of noiDung.split("\n")) {
      if (!DONG_KHAI_TEST.test(dong)) continue;
      for (const khop of dong.matchAll(NHAN)) {
        ra.push({ ma: khop[1]!, tep, dong: dong.trim() });
      }
    }
  }
  return ra;
}

/** P1 — mọi cặp ĐO ĐƯỢC phải có trong sổ khai. */
export function viPhamChuaKhai(
  cap: readonly CapDo[],
  so: Readonly<Record<string, readonly string[]>>,
): readonly string[] {
  const loi = new Set<string>();
  for (const c of cap) {
    if (!(so[c.ma] ?? []).includes(c.tep)) {
      loi.add(`[INV-${c.ma}] xuất hiện ở ${c.tep} — cặp này CHƯA CÓ trong sổ khai`);
    }
  }
  return [...loi].sort();
}

/**
 * P2 — mọi cặp ĐÃ KHAI phải còn tìm thấy. Chiều này làm hai việc cùng lúc:
 * ⑴ một dòng khai thiu (tệp đã đổi tên, nhãn đã gỡ) là một lời khai SAI, y như chiều kia;
 * ⑵ nó là ĐỐI CHỨNG DƯƠNG dựng sẵn — bộ quét hỏng, regex sai, hay `git ls-files` trả rỗng đều
 *    làm MỌI cặp khai biến mất, tức đỏ ồn ào thay vì xanh im lặng.
 */
export function viPhamKhaiThiu(
  cap: readonly CapDo[],
  so: Readonly<Record<string, readonly string[]>>,
): readonly string[] {
  const co = new Set(cap.map((c) => `${c.ma}\u0000${c.tep}`));
  const loi: string[] = [];
  for (const [ma, ds] of Object.entries(so)) {
    for (const tep of ds) {
      if (!co.has(`${ma}\u0000${tep}`)) {
        loi.push(`sổ khai kể [INV-${ma}] ở ${tep} — không tìm thấy nhãn ấy ở đó nữa`);
      }
    }
  }
  return loi.sort();
}

// ==============================================================================================

const TEP = moiTepTest();
const CAP = quetNhan(TEP);

describe("[INV-H22] nhãn bất biến phải đặt ở chỗ đã khai", () => {
  it("P1 — mọi cặp (mã, tệp) đo được đều có trong sổ khai", () => {
    expect(viPhamChuaKhai(CAP, SO_KHAI)).toEqual([]);
  });

  it("P2 — mọi cặp đã khai đều còn tìm thấy (dòng khai thiu cũng là lời khai sai)", () => {
    expect(viPhamKhaiThiu(CAP, SO_KHAI)).toEqual([]);
  });

  it("P1 đột biến — gắn một nhãn vào một tệp chưa khai thì ĐỎ", () => {
    const lac = { ma: "B2", tep: "tests/architecture/khong-he-khai.test.ts", dong: 'it("[INV-B2] …"' };
    const loi = viPhamChuaKhai([...CAP, lac], SO_KHAI);
    expect(loi).toEqual([
      "[INV-B2] xuất hiện ở tests/architecture/khong-he-khai.test.ts — cặp này CHƯA CÓ trong sổ khai",
    ]);
  });

  it("P1 đột biến — DỜI một nhãn sang một tệp đã khai cho mã KHÁC thì vẫn ĐỎ", () => {
    // Đây là chiều hỏng thật của khoản nợ 12: nhãn đúng cú pháp, tệp có thật, mã có thật, và
    // tệp ấy ĐANG mang những nhãn khác — chỉ CHỖ ĐẶT là sai. Không lớp nào cũ thấy được.
    // Không dùng `!` trần: khi bộ quét mù, `CAP` rỗng và một `!` sẽ làm test SẬP với
    // *"Cannot read properties of undefined"* thay vì nói ra điều đang sai. Đo được ở mũi đột
    // biến "bộ quét mù" — hỏng ồn ào vẫn phải hỏng THÀNH MỘT CÂU, không thành một stack trace.
    const chu = CAP.find((c) => !(SO_KHAI.C1 ?? []).includes(c.tep));
    if (chu === undefined) throw new Error("bộ quét không tìm được cặp nào để dời — nó đang mù");
    const loi = viPhamChuaKhai([...CAP, { ...chu, ma: "C1" }], SO_KHAI);
    expect(loi).toHaveLength(1);
    expect(loi[0]).toContain("[INV-C1]");
    expect(loi[0]).toContain(chu.tep);
  });

  it("P2 đột biến — bộ quét mù (trả rỗng) thì ĐỎ ở MỌI cặp đã khai, không xanh im lặng", () => {
    const soCap = Object.values(SO_KHAI).reduce((n, ds) => n + ds.length, 0);
    expect(viPhamKhaiThiu([], SO_KHAI)).toHaveLength(soCap);
  });

  it("P2 đột biến — một dòng khai THIU (tệp đã đổi tên) thì ĐỎ", () => {
    const soHong = { ...SO_KHAI, C1: [...(SO_KHAI.C1 ?? []), "packages/rfq/src/da-doi-ten.test.ts"] };
    const loi = viPhamKhaiThiu(CAP, soHong);
    expect(loi).toEqual([
      "sổ khai kể [INV-C1] ở packages/rfq/src/da-doi-ten.test.ts — không tìm thấy nhãn ấy ở đó nữa",
    ]);
  });

  it("bộ quét KHÔNG rỗng ruột — nó đọc được nhãn ở nhiều gói, không chỉ một", () => {
    expect(CAP.length).toBeGreaterThan(0);
    const goc = new Set(CAP.map((c) => c.tep.split("/")[0]));
    // Đo tại `bebeb41`: nhãn nằm rải ở `apps`, `db`, `packages`, `tests`, `tools`. Khẳng định
    // "nhiều hơn một gốc" chứ không ghim con số — ghim số là dựng một lời khai mới để trôi.
    expect(goc.size).toBeGreaterThan(1);
  });
});
