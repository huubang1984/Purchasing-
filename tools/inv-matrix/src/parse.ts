// =============================================================================================
// BỘ ĐỌC SỔ ĐĂNG KÝ BẤT BIẾN VÀ BỘ GOM ĐỘ PHỦ
//
// File này là phần THUẦN của bộ sinh evidence pack: không I/O, không `process.exit`, nên mọi
// bảo đảm của nó kiểm thử đột biến được. Phần vỏ I/O nằm ở `index.ts`.
//
// BA QUY ƯỚC VỀ REGEX Ở ĐÂY LÀ RÀNG BUỘC AN NINH, KHÔNG PHẢI LỰA CHỌN PHONG CÁCH:
//
// (1) `NHAN_PHU_DO_DUOC` — nhãn ĐƯỢC TÍNH LÀ ĐỘ PHỦ — CỐ Ý HẸP: đúng `[INV-<chữ><số>]`, không
//     hậu tố. Nới nó để nhận `[INV-E3(3)]` sẽ đổ chín test hàm thuần vào hàng E3 và làm E3
//     trông như "đã phủ" — trong khi E3 có NĂM vế và vế *giới hạn tần suất* không có một dòng
//     mã nào trong toàn S0. Đó đúng là thứ QT2 cấm: nới một bảo đảm để mua một con số đẹp.
//     Các nhãn `[T9-J]`, `[T10-*]`, `[QT3]`, `[CẤM LOG]`, `[C1-KHE-HỞ]`, `[NỢ ADR-006]` cũng
//     nằm ngoài, và cũng cố ý — chúng khẳng định NGOẠI LỆ hoặc quy ước, không khẳng định bất biến.
//
// (2) `NHAN_BAT_KY` — bộ ĐIỂM DANH — CỐ Ý RỘNG, và nó KHÔNG BAO GIỜ nuôi độ phủ. Nó tồn tại để
//     một nhãn `[INV-…]` không rơi vào hàng nào PHẢI ỒN ÀO thay vì bị bỏ qua trong im lặng.
//     Đo được tại HEAD 36fb138 — tức TRƯỚC commit này: bốn test mang `[INV-M5]`. `M` không thuộc
//     dải `[A-H]` và `M5` không có trong sổ đăng ký, nên bộ sinh theo bản phác của brief sẽ ÂM
//     THẦM bỏ qua chúng. "Nhãn sai che một bất biến" là đúng lớp khiếm khuyết Task 9 đã phải trả
//     giá để phát hiện. Bốn nhãn đó đã được sửa về `[INV-F1]` trong CÙNG commit này (lý do và
//     phép đo ở đầu `packages/audit/src/tenant-guard.int.test.ts`), nên hôm nay hàm
//     `findUnregisteredLabels` trả về mảng RỖNG trên repo — nó là lớp canh cho lần sau, không
//     phải một mô tả trạng thái hiện tại.
//
// (3) `HANG_BAT_BIEN` — bộ đọc sổ — ĐÒI `**ID**` IN ĐẬM. Một hàng lệch khuôn sẽ BIẾN MẤT khỏi
//     ma trận trong im lặng, tức fail-OPEN ở đúng nơi không được phép fail-open. Vì vậy
//     `parseInvariants` KHÔNG chỉ đọc: nó ĐẾM ĐỘC LẬP bằng một quy tắc khác (`demHangUngVien`)
//     rồi NÉM nếu hai con số lệch.
// =============================================================================================

export interface Invariant {
  readonly id: string;
  readonly statement: string;
  readonly enforcement: string;
  readonly testLayer: string;
}

export interface TestOutcome {
  readonly name: string;
  readonly status: "passed" | "failed" | "skipped";
}

/** Một lần xuất hiện của nhãn `[INV-…]` trong tên một test đã CHẠY THẬT. */
export interface LabelUse {
  /** Mã gốc, đã bỏ hậu tố vế: `[INV-E3(3)]` -> `"E3"`. */
  readonly base: string;
  /** Hậu tố vế nếu có: `[INV-E3(3)]` -> `"3"`; `[INV-E3]` -> `null`. */
  readonly clause: string | null;
  readonly testName: string;
  readonly status: "passed" | "failed" | "skipped";
}

const HANG_BAT_BIEN = /^\|\s*\*\*([A-H]\d+)\*\*\s*\|(.+?)\|(.+?)\|(.+?)\|\s*$/;

/** HẸP CÓ CHỦ Ý — xem quy ước (1) ở đầu file. Đừng nới. */
const NHAN_PHU_DO_DUOC = /\[INV-([A-H]\d+)\]/g;

/** RỘNG CÓ CHỦ Ý, và KHÔNG BAO GIỜ nuôi độ phủ — xem quy ước (2) ở đầu file. */
const NHAN_BAT_KY = /\[INV-([^\]\s]+)\]/g;

/** `E3(3)` -> base `E3`, clause `3`. Một mã không có hậu tố cho clause `null`. */
const MA_CO_VE = /^([A-Za-z]+\d+)(?:\((.+)\))?$/;

/**
 * Bỏ dấu ** chỉ khi TOÀN BỘ ô in đậm. `[^*]+` là cố ý: một ô kiểu `**X** và **Y**` KHÔNG được
 * rút thành `X** và **Y` — đó là làm hỏng bằng chứng chứ không phải làm sạch nó.
 */
function lamSach(cell: string): string {
  return cell.trim().replace(/^\*\*([^*]+)\*\*$/, "$1").trim();
}

/**
 * ĐẾM ĐỘC LẬP các hàng TRÔNG NHƯ một hàng sổ đăng ký, bằng một quy tắc KHÁC `HANG_BAT_BIEN`:
 * tách ô bằng `split("|")` thay vì regex, và KHÔNG đòi `**` quanh mã. Nhờ vậy một hàng bị mất
 * dấu in đậm vẫn được đếm ở đây trong khi bộ đọc chính bỏ sót nó — chênh lệch là tín hiệu.
 *
 * Bỏ qua nội dung trong khối mã ```: `docs/TEST-PLAN.md` §4 có một khối mẫu chứa hai dòng
 * `| A1 | ... |` và `| A4 | ... |` KHÔNG phải hàng sổ đăng ký (đo được: đếm 49 thay vì 47).
 */
export function demHangUngVien(markdown: string): string[] {
  const ma: string[] = [];
  let trongKhoiMa = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (line.trimStart().startsWith("```")) {
      trongKhoiMa = !trongKhoiMa;
      continue;
    }
    if (trongKhoiMa || !line.startsWith("|")) continue;
    const o = line.split("|");
    // 4 ô nội dung => 6 phần tử: phần rỗng đầu, bốn ô, phần rỗng cuối.
    if (o.length < 6) continue;
    const dau = lamSach(o[1] ?? "");
    if (/^[A-H]\d+$/.test(dau)) ma.push(dau);
  }
  return ma;
}

/**
 * Đọc sổ đăng ký bất biến từ `docs/TEST-PLAN.md`. Tài liệu là nguồn sự thật duy nhất.
 *
 * NÉM khi sổ rỗng, khi có mã TRÙNG, hoặc khi số hàng đọc được LỆCH với phép đếm độc lập —
 * cả ba đều là fail-CLOSED có chủ đích. Một sổ đăng ký đọc thiếu không sinh ra ma trận nhỏ
 * hơn; nó sinh ra một ma trận NÓI DỐI, vì mã bị bỏ sót không hiện ra ở đâu cả.
 */
export function parseInvariants(markdown: string): Invariant[] {
  const invariants: Invariant[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = HANG_BAT_BIEN.exec(line);
    if (!match) continue;
    invariants.push({
      id: match[1]!,
      statement: lamSach(match[2]!),
      enforcement: lamSach(match[3]!),
      testLayer: lamSach(match[4]!),
    });
  }

  if (invariants.length === 0) {
    throw new Error("Sổ đăng ký rỗng: không đọc được hàng bất biến nào — kiểm tra định dạng bảng.");
  }

  const trung = invariants
    .map((i) => i.id)
    .filter((id, i, all) => all.indexOf(id) !== i);
  if (trung.length > 0) {
    throw new Error(`Sổ đăng ký có mã TRÙNG: ${[...new Set(trung)].join(", ")}`);
  }

  const ungVien = demHangUngVien(markdown);
  if (ungVien.length !== invariants.length) {
    const doc = new Set(invariants.map((i) => i.id));
    const soT = ungVien.filter((id) => !doc.has(id));
    throw new Error(
      `Sổ đăng ký lệch khuôn: đếm độc lập thấy ${ungVien.length} hàng, bộ đọc chỉ lấy được ` +
        `${invariants.length}. Hàng biến mất trong im lặng là fail-OPEN.` +
        (soT.length > 0 ? ` Mã không đọc được: ${[...new Set(soT)].join(", ")}.` : ""),
    );
  }

  return invariants;
}

interface VitestJsonReport {
  testResults?: Array<{
    name?: string;
    assertionResults?: Array<{ fullName?: string; status?: string }>;
  }>;
}

function chuanHoaTrangThai(raw: string | undefined): "passed" | "failed" | "skipped" {
  return raw === "passed" || raw === "failed" ? raw : "skipped";
}

function* moiKhangDinh(
  reportJson: string,
): Generator<{ name: string; status: "passed" | "failed" | "skipped" }> {
  const report = JSON.parse(reportJson) as VitestJsonReport;
  for (const file of report.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      yield { name: assertion.fullName ?? "", status: chuanHoaTrangThai(assertion.status) };
    }
  }
}

/**
 * TỔNG SỐ khẳng định trong báo cáo. Tồn tại để áp DẤU HIỆU TÍCH CỰC vào chính mã sản phẩm:
 * một báo cáo JSON hợp lệ nhưng RỖNG cho ra ma trận "không mã nào được phủ" — một kết quả
 * ĐỎ GIẢ không phân biệt được với thực tế mọi test đều biến mất.
 */
export function countAssertions(reportJson: string): number {
  let n = 0;
  for (const khangDinh of moiKhangDinh(reportJson)) {
    if (typeof khangDinh.status === "string") n += 1;
  }
  return n;
}

/**
 * Gom kết quả test theo mã bất biến, dựa vào nhãn `[INV-XX]` trong tên test.
 * Một test gắn nhiều nhãn được tính cho tất cả các bất biến đó.
 *
 * KHÔNG tính nhãn có hậu tố vế (`[INV-E3(3)]`) — xem quy ước (1) ở đầu file.
 */
export function collectCoverage(reportJson: string): Map<string, TestOutcome[]> {
  const coverage = new Map<string, TestOutcome[]>();
  for (const { name, status } of moiKhangDinh(reportJson)) {
    NHAN_PHU_DO_DUOC.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = NHAN_PHU_DO_DUOC.exec(name)) !== null) {
      const id = match[1]!;
      const list = coverage.get(id) ?? [];
      list.push({ name, status });
      coverage.set(id, list);
    }
  }
  return coverage;
}

/**
 * ĐIỂM DANH mọi nhãn `[INV-…]` xuất hiện trong tên test, kể cả nhãn KHÔNG hợp lệ và nhãn có
 * hậu tố vế. Đây là đầu vào của phép kiểm "nhãn không rơi vào hàng nào", không phải của độ phủ.
 */
export function collectLabelUses(reportJson: string): LabelUse[] {
  const uses: LabelUse[] = [];
  for (const { name, status } of moiKhangDinh(reportJson)) {
    NHAN_BAT_KY.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = NHAN_BAT_KY.exec(name)) !== null) {
      const tho = match[1]!;
      const tach = MA_CO_VE.exec(tho);
      uses.push({
        base: tach?.[1] ?? tho,
        clause: tach?.[2] ?? null,
        testName: name,
        status,
      });
    }
  }
  return uses;
}

/**
 * Nhãn `[INV-…]` mà mã gốc KHÔNG có trong sổ đăng ký. Mỗi mục là một test đang khẳng định
 * một bất biến KHÔNG TỒN TẠI — hoặc mã sai, hoặc sổ đăng ký thiếu. Cả hai đều phải ồn ào.
 */
export function findUnregisteredLabels(
  uses: readonly LabelUse[],
  registryIds: readonly string[],
): LabelUse[] {
  const co = new Set(registryIds);
  return uses.filter((u) => !co.has(u.base));
}
