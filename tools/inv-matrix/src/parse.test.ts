// =============================================================================================
// CẢNH BÁO CHO NGƯỜI SỬA FILE NÀY: KHÔNG ĐƯỢC ĐẶT NHÃN `[INV-…]` VÀO TÊN `describe`/`it`.
//
// Bộ sinh gom độ phủ từ `fullName` của báo cáo vitest, tức từ TÊN test — không từ nội dung
// file. Một nhãn đặt trong tên test ở ĐÂY sẽ được tính là bằng chứng phủ một bất biến nghiệp
// vụ, do một test của chính bộ sinh. Nhãn dùng làm dữ liệu mẫu nằm TRONG CHUỖI, và chỉ ở đó.
// =============================================================================================
import { describe, expect, it } from "vitest";
import {
  collectCoverage,
  collectLabelUses,
  countAssertions,
  demHangUngVien,
  findUnregisteredLabels,
  parseInvariants,
} from "./parse.js";

const TEST_PLAN_MAU = [
  "### Nhóm A — Bí mật giá",
  "",
  "| ID | Bất biến | Cưỡng chế | Tầng test |",
  "|---|---|---|---|",
  "| **A1** | Không endpoint nào trả về giá trước khi mở thầu | Kiến trúc | T2, T5 |",
  "| **A4** | Không trường phái sinh nào rò rỉ giá | **Bộ quét rò rỉ** | **T2** |",
  "",
  "### Nhóm G — Vòng đời khóa",
  "",
  "| ID | Bất biến | Cưỡng chế | Tầng test |",
  "|---|---|---|---|",
  "| **G1** | Khóa riêng không rời runtime có kiểm soát | IAM + quyền cột DB | **T0**, T3 |",
  "",
  // Hàng nhóm H là BẮT BUỘC trong mẫu này, không phải cho đủ bộ. Không có nó, sổ đăng ký mẫu
  // nằm trọn trong dải A–G và một mũi đột biến thu hẹp `[A-H]` xuống `[A-G]` — tức bộ đọc BỎ SÓT
  // cả mười ba hàng rào — SỐNG SÓT toàn bộ file test này. Đo được ở harness Task 11.
  "### Nhóm H — Hàng rào",
  "",
  "| ID | Bất biến | Cưỡng chế | Tầng test |",
  "|---|---|---|---|",
  "| **H1** | `git reset --hard` bị chặn với mã thoát 2 | Hook `git-safety` | T1 |",
].join("\n");

function baoCao(
  assertions: ReadonlyArray<{ fullName: string; status: string }>,
  file = "/repo/x.test.ts",
): string {
  return JSON.stringify({ testResults: [{ name: file, assertionResults: assertions }] });
}

const BAO_CAO_MAU = JSON.stringify({
  testResults: [
    {
      name: "/repo/tests/architecture/boundaries.test.ts",
      assertionResults: [
        { fullName: "ranh giới kiến trúc > [INV-G1] chặn module ngoài unseal-worker", status: "passed" },
        { fullName: "ranh giới kiến trúc > mã nguồn hiện tại không vi phạm", status: "passed" },
      ],
    },
    {
      name: "/repo/packages/api/leak.test.ts",
      assertionResults: [
        { fullName: "quét rò rỉ > [INV-A1] không endpoint nào trả giá", status: "failed" },
      ],
    },
  ],
});

describe("phân tích ma trận bất biến", () => {
  it("đọc được toàn bộ bất biến từ TEST-PLAN", () => {
    const invariants = parseInvariants(TEST_PLAN_MAU);
    expect(invariants.map((i) => i.id)).toEqual(["A1", "A4", "G1", "H1"]);
    expect(invariants[0]?.statement).toBe("Không endpoint nào trả về giá trước khi mở thầu");
    expect(invariants[2]?.enforcement).toBe("IAM + quyền cột DB");
    expect(invariants[2]?.testLayer, "cột tầng test cũng phải đi vào bằng chứng").toBe("**T0**, T3");
  });

  it("dải [A-H] là RÀNG BUỘC: hàng nhóm H phải đọc được y như hàng nghiệp vụ", () => {
    const invariants = parseInvariants(TEST_PLAN_MAU);
    const h1 = invariants.find((i) => i.id === "H1");
    expect(h1, "bộ đọc BỎ SÓT nhóm H — mười ba hàng rào biến mất khỏi ma trận").toBeDefined();
    expect(h1?.statement).toBe("`git reset --hard` bị chặn với mã thoát 2");
    expect(h1?.enforcement).toBe("Hook `git-safety`");
  });

  it("bỏ dấu ** khi đọc cột cưỡng chế in đậm", () => {
    const invariants = parseInvariants(TEST_PLAN_MAU);
    expect(invariants[1]?.enforcement).toBe("Bộ quét rò rỉ");
  });

  it("KHÔNG bóc ** của một ô có HAI cụm in đậm — làm sạch không được làm hỏng bằng chứng", () => {
    const md = [
      "| ID | Bất biến | Cưỡng chế | Tầng test |",
      "|---|---|---|---|",
      "| **A1** | **Lớp A** và **lớp B** | Kiến trúc | T2 |",
    ].join("\n");
    expect(parseInvariants(md)[0]?.statement).toBe("**Lớp A** và **lớp B**");
  });

  it("gom được test theo mã bất biến", () => {
    const coverage = collectCoverage(BAO_CAO_MAU);
    expect(coverage.get("G1")).toHaveLength(1);
    expect(coverage.get("A1")?.[0]?.status).toBe("failed");
    expect(coverage.has("A4")).toBe(false);
  });

  it("một test gắn nhiều mã bất biến được tính cho tất cả", () => {
    const coverage = collectCoverage(baoCao([{ fullName: "[INV-A1] và [INV-A4] cùng lúc", status: "passed" }]));
    expect(coverage.get("A1")).toHaveLength(1);
    expect(coverage.get("A4")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// T11-D — NHÃN CÓ HẬU TỐ VẾ KHÔNG ĐƯỢC TÍNH LÀ ĐỘ PHỦ
//
// E3 có NĂM vế và vế *giới hạn tần suất* không có một dòng mã nào trong toàn S0. Nới regex độ
// phủ để nhận `(n)` sẽ đổ các test hàm thuần vào hàng E3. Hai khẳng định dưới đây là mốc chết
// của quy ước đó: một cho ca "chỉ có nhãn vế" (E3 phải VẮNG khỏi bảng độ phủ), một cho ca hỗn
// hợp (chỉ nhãn TRẦN được đếm).
// ---------------------------------------------------------------------------------------------
describe("ranh giới của nhãn được tính là độ phủ", () => {
  it("nhãn có hậu tố vế KHÔNG tạo ra hàng độ phủ nào", () => {
    const coverage = collectCoverage(
      baoCao([
        { fullName: "OTP > [INV-E3(1)] số lần thử", status: "passed" },
        { fullName: "OTP > [INV-E3(3)] hết hạn", status: "passed" },
        { fullName: "OTP > [INV-E3(n)] tính chất chung", status: "passed" },
      ]),
    );
    expect(coverage.has("E3"), "nhãn vế bị tính là độ phủ của E3 — regex đã bị NỚI").toBe(false);
    expect(coverage.size).toBe(0);
  });

  it("trong một lô hỗn hợp, chỉ nhãn TRẦN được đếm", () => {
    const coverage = collectCoverage(
      baoCao([
        { fullName: "OTP > [INV-E3(4)] dùng một lần", status: "passed" },
        { fullName: "OTP > [INV-E3] so sánh chống tấn công thời gian", status: "passed" },
      ]),
    );
    expect(coverage.get("E3")).toHaveLength(1);
  });

  it("nhãn quy ước ngoài họ INV không bao giờ đi vào độ phủ", () => {
    const coverage = collectCoverage(
      baoCao([
        { fullName: "[T9-J] ngoại lệ của D5", status: "passed" },
        { fullName: "[T10-E4] CẤM LOG", status: "passed" },
        { fullName: "[QT3] ba trục", status: "passed" },
      ]),
    );
    expect(coverage.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// T11-E — NHÃN KHÔNG RƠI VÀO HÀNG NÀO PHẢI ỒN ÀO
// ---------------------------------------------------------------------------------------------
describe("điểm danh nhãn và đối chiếu với sổ đăng ký", () => {
  it("điểm danh thấy được cả nhãn ngoài dải [A-H] mà bảng độ phủ bỏ qua", () => {
    const report = baoCao([{ fullName: "hàng rào tenant > [INV-M5] không vượt được tổ chức", status: "passed" }]);
    expect(collectCoverage(report).size, "M5 KHÔNG được rơi vào bảng độ phủ").toBe(0);
    const uses = collectLabelUses(report);
    expect(uses).toHaveLength(1);
    expect(uses[0]?.base).toBe("M5");
    expect(uses[0]?.clause).toBeNull();
  });

  it("tách được mã gốc và hậu tố vế khi điểm danh", () => {
    const uses = collectLabelUses(baoCao([{ fullName: "[INV-E3(3)] hết hạn", status: "passed" }]));
    expect(uses[0]?.base).toBe("E3");
    expect(uses[0]?.clause).toBe("3");
  });

  it("báo ra đúng những nhãn có mã gốc KHÔNG nằm trong sổ đăng ký", () => {
    const uses = collectLabelUses(
      baoCao([
        { fullName: "[INV-M5] a", status: "passed" },
        { fullName: "[INV-E3(3)] b", status: "passed" },
        { fullName: "[INV-A1] c", status: "passed" },
        { fullName: "[INV-Z9] d", status: "passed" },
      ]),
    );
    expect(findUnregisteredLabels(uses, ["A1", "A4", "E3"]).map((u) => u.base).sort()).toEqual(["M5", "Z9"]);
  });

  it("nhãn vế của một mã CÓ trong sổ đăng ký thì hợp lệ — nó chỉ không được TÍNH", () => {
    const uses = collectLabelUses(baoCao([{ fullName: "[INV-E3(3)] b", status: "passed" }]));
    expect(findUnregisteredLabels(uses, ["E3"])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// T11-F — MỘT HÀNG SỔ ĐĂNG KÝ KHÔNG ĐƯỢC BIẾN MẤT TRONG IM LẶNG
// ---------------------------------------------------------------------------------------------
describe("sổ đăng ký lệch khuôn phải NÉM chứ không được đọc thiếu", () => {
  it("hàng mất dấu ** làm bộ đọc NÉM, kèm tên mã bị bỏ sót", () => {
    const md = TEST_PLAN_MAU.replace("| **A4** |", "| A4 |");
    expect(() => parseInvariants(md)).toThrow(/lệch khuôn.*A4/s);
  });

  it("phép đếm độc lập vẫn thấy hàng mà bộ đọc chính bỏ sót", () => {
    const md = TEST_PLAN_MAU.replace("| **A4** |", "| A4 |");
    expect(demHangUngVien(md)).toEqual(["A1", "A4", "G1", "H1"]);
  });

  it("bảng mẫu trong khối mã ``` KHÔNG bị đếm nhầm thành hàng sổ đăng ký", () => {
    const md = [
      TEST_PLAN_MAU,
      "",
      "```text",
      "| A1  | ... | Kiến trúc | 4 test | PASS | a1b2c3 | ... |",
      "| A4  | ... | Máy quét  | 1 test | PASS | a1b2c3 | ... |",
      "```",
    ].join("\n");
    expect(demHangUngVien(md)).toEqual(["A1", "A4", "G1", "H1"]);
    expect(parseInvariants(md).map((i) => i.id)).toEqual(["A1", "A4", "G1", "H1"]);
  });

  it("sổ đăng ký rỗng NÉM chứ không trả về mảng rỗng", () => {
    expect(() => parseInvariants("# không có bảng nào")).toThrow(/Sổ đăng ký rỗng/);
  });

  it("mã trùng trong sổ đăng ký NÉM — hai hàng cùng mã làm ma trận mơ hồ", () => {
    const md = TEST_PLAN_MAU + "\n| **A1** | phát biểu thứ hai | Kiến trúc | T2 |";
    expect(() => parseInvariants(md)).toThrow(/mã TRÙNG: A1/);
  });
});

// ---------------------------------------------------------------------------------------------
// T11-H / RÀNG BUỘC (11) ÁP VÀO MÃ SẢN PHẨM — DẤU HIỆU TÍCH CỰC RẰNG BỘ TEST ĐÃ CHẠY
// ---------------------------------------------------------------------------------------------
describe("dấu hiệu tích cực rằng báo cáo có nội dung", () => {
  it("đếm được tổng số khẳng định qua nhiều file", () => {
    const report = JSON.stringify({
      testResults: [
        { name: "a", assertionResults: [{ fullName: "x", status: "passed" }] },
        { name: "b", assertionResults: [{ fullName: "y", status: "passed" }, { fullName: "z", status: "failed" }] },
      ],
    });
    expect(countAssertions(report)).toBe(3);
  });

  it("báo cáo hợp lệ nhưng RỖNG cho ra số 0, phân biệt được với một lượt chạy thật", () => {
    expect(countAssertions(JSON.stringify({ testResults: [] }))).toBe(0);
    expect(countAssertions(JSON.stringify({}))).toBe(0);
  });

  it("trạng thái lạ được quy về skipped chứ không được lặng lẽ thành passed", () => {
    const coverage = collectCoverage(baoCao([{ fullName: "[INV-A1] x", status: "todo" }]));
    expect(coverage.get("A1")?.[0]?.status).toBe("skipped");
  });
});
