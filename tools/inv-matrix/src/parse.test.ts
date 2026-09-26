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
  //
  // [S1.115 / khoản 229] **Hàng nhóm J dưới đây có mặt vì ĐÚNG lập luận ấy, không vì cho đủ bộ.**
  // Dải nay là `[A-HJ]`; nếu mẫu chỉ có A–H thì một mũi thu ngược về `[A-H]` — tức bộ đọc bỏ sót
  // trọn nhóm đánh giá — sống sót cả tệp này. Chữ `J` không liền sau `H` trong bảng chữ cái, nên
  // một dải viết nhầm thành `[A-I]` hay `[A-J]` cũng phải bị bắt: `[A-J]` nhận `I`, một chữ KHÔNG
  // có nhóm nào — và ca *nhãn ngoài dải* ở dưới là chỗ điều đó được đo.
  //
  // [S1.9101 / S3.0] **Hàng nhóm K cũng vì đúng lập luận ấy — và nó có mặt TRƯỚC khi sổ thật có hàng
  // K nào.** Dải nay là `[A-HJK]` (spec S3 §9, S3.0). `docs/TEST-PLAN.md` chưa có hàng K: K1 vào sổ
  // ở S3.1, sau khi được đo. Nên trên sổ thật, một mũi thu ngược về `[A-HJ]` không đổi một ô nào của
  // ma trận, và chỉ hàng mẫu dưới đây cho mũi ấy chỗ để chết. Không có nó, K1 sẽ gặp lại đúng
  // chuyện của J4 ở khoản 229: đủ phép đo mà không có ô.
  "### Nhóm H — Hàng rào",
  "",
  "| ID | Bất biến | Cưỡng chế | Tầng test |",
  "|---|---|---|---|",
  "| **H1** | `git reset --hard` bị chặn với mã thoát 2 | Hook `git-safety` | T1 |",
  "",
  "### Nhóm J — Đánh giá, BAFO, Award",
  "",
  "| ID | Bất biến | Cưỡng chế | Tầng test |",
  "|---|---|---|---|",
  "| **J1** | Chỉ khoản đơn vị TIỀN đi vào `effective_cost` | Hàm thuần + trigger | T1, T3 |",
  "",
  "### Nhóm K — Kiểm soát mua sắm",
  "",
  "| ID | Bất biến | Cưỡng chế | Tầng test |",
  "|---|---|---|---|",
  "| **K1** | Gói rời `DRAFT` mang khoá ngoại tới đúng hàng bậc của ước lượng | Khoá ngoại hợp thành + trigger | T3 |",
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
    expect(invariants.map((i) => i.id)).toEqual(["A1", "A4", "G1", "H1", "J1", "K1"]);
    expect(invariants[0]?.statement).toBe("Không endpoint nào trả về giá trước khi mở thầu");
    expect(invariants[2]?.enforcement).toBe("IAM + quyền cột DB");
    expect(invariants[2]?.testLayer, "cột tầng test cũng phải đi vào bằng chứng").toBe("**T0**, T3");
  });

  it("dải [A-HJK] là RÀNG BUỘC: hàng nhóm H phải đọc được y như hàng nghiệp vụ", () => {
    const invariants = parseInvariants(TEST_PLAN_MAU);
    const h1 = invariants.find((i) => i.id === "H1");
    expect(h1, "bộ đọc BỎ SÓT nhóm H — mười ba hàng rào biến mất khỏi ma trận").toBeDefined();
    expect(h1?.statement).toBe("`git reset --hard` bị chặn với mã thoát 2");
    expect(h1?.enforcement).toBe("Hook `git-safety`");
  });

  it("[S1.115 / khoản 229] dải [A-HJ]: hàng nhóm J cũng phải đọc được — và đây là mũi giết một lần thu dải", () => {
    // Ca này ĐỎ nếu ai đó thu dải về `[A-H]`. Nó là bản sao có chủ ý của ca ngay trên, vì thứ
    // nó canh cũng là một bản sao có chủ ý: hai nhóm nằm NGOÀI dải A–G, và mỗi nhóm cần một
    // hàng trong mẫu thì mũi đột biến của nó mới có chỗ để chết.
    const invariants = parseInvariants(TEST_PLAN_MAU);
    const j1 = invariants.find((i) => i.id === "J1");
    expect(j1, "bộ đọc BỎ SÓT nhóm J — trọn lớp đánh giá biến mất khỏi ma trận").toBeDefined();
    expect(j1?.statement).toBe("Chỉ khoản đơn vị TIỀN đi vào `effective_cost`");
    expect(j1?.enforcement).toBe("Hàm thuần + trigger");
  });

  it("[S1.9101 / S3.0] dải [A-HJK]: hàng nhóm K đọc được TRƯỚC khi K1 vào sổ — mũi giết một lần thu dải về [A-HJ]", () => {
    // Ca này ĐỎ nếu ai đó thu dải về `[A-HJ]` ở bộ đọc chính. Thu ở bộ đếm độc lập thì hai con số
    // lệch và `parseInvariants` NÉM — cũng đỏ, ở mọi ca dùng mẫu.
    const invariants = parseInvariants(TEST_PLAN_MAU);
    const k1 = invariants.find((i) => i.id === "K1");
    expect(k1, "bộ đọc BỎ SÓT nhóm K — K1 sẽ vào sổ mà không có ô").toBeDefined();
    expect(k1?.statement).toBe("Gói rời `DRAFT` mang khoá ngoại tới đúng hàng bậc của ước lượng");
    expect(k1?.enforcement).toBe("Khoá ngoại hợp thành + trigger");
    // Biên trên: không nhóm nào mang chữ `L`. Một dải nới quá tay thành `[A-HJ-L]` sẽ đọc một hàng
    // `L1` bịa thành bất biến thật — cùng lớp với ca chữ `I` ngay dưới. Hàng `A1` giữ bộ đọc khỏi
    // ném vì *sổ rỗng*, để ca xanh vì đúng lý do nó đo.
    const md = [
      "| ID | Bất biến | Cưỡng chế | Tầng test |",
      "|---|---|---|---|",
      "| **A1** | một bất biến THẬT | Kiến trúc | T1 |",
      "| **L1** | một nhóm KHÔNG tồn tại | không có | T1 |",
    ].join("\n");
    expect(parseInvariants(md).map((i) => i.id), "dải nới quá tay: `L` đi lọt vào ma trận").toEqual(["A1"]);
    expect(demHangUngVien(md), "phép đếm độc lập cũng KHÔNG được thấy `L1`").toEqual(["A1"]);
  });

  it("[S1.115 / khoản 229] chữ `I` KHÔNG có nhóm nào — một dải viết nhầm `[A-J]` phải bị bắt", () => {
    // `[A-HJ]` và `[A-J]` chỉ khác nhau ở đúng một chữ: `I`. Không nhóm bất biến nào mang chữ ấy,
    // nên một dải nới quá tay sẽ đọc một hàng `I1` bịa thành một bất biến thật — và ca này là chỗ
    // điều đó chết.
    const md = [
      "| ID | Bất biến | Cưỡng chế | Tầng test |",
      "|---|---|---|---|",
      "| **A1** | một bất biến THẬT | Kiến trúc | T1 |",
      "| **I1** | một nhóm KHÔNG tồn tại | không có | T1 |",
    ].join("\n");
    // Hàng `A1` có mặt để bộ đọc KHÔNG ném vì *sổ rỗng* — nếu nó ném, ca này xanh vì một lý do
    // khác hẳn thứ nó đo. Đó là đúng lớp lỗi mà bảng ca nửa xu đã đặt tên: một fixture không
    // phân biệt được thì nửa được đo không phải nửa ta tưởng.
    expect(
      parseInvariants(md).map((i) => i.id),
      "dải nới quá tay: `I` đi lọt vào ma trận",
    ).toEqual(["A1"]);
    expect(demHangUngVien(md), "phép đếm độc lập cũng KHÔNG được thấy `I1`").toEqual(["A1"]);
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
// E3 có NĂM vế; ~~vế *giới hạn tần suất* không có một dòng mã nào trong toàn S0~~ **[S1.21]
// vế ấy nay có lớp, và quy ước dưới đây KHÔNG phụ thuộc vào điều đó** — nó nói rằng một nhãn
// VẾ không chứng minh một mệnh đề đủ vế, đúng cả khi mọi vế đã có lớp. Nới regex độ
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

  it("[S1.9101 / S3.0] nhãn TRẦN của nhóm J và K được TÍNH — mũi thu dải của bộ gom độ phủ phải chết", () => {
    // Bộ đọc sổ và bộ gom độ phủ giữ HAI regex riêng. Nới một mà quên một thì K1 có hàng trong sổ
    // mà test mang `[INV-K1]` không bao giờ đổ vào ô ấy. Sổ thật chưa có hàng K nên chỉ ca này thấy.
    const coverage = collectCoverage(
      baoCao([
        { fullName: "trao thầu > [INV-J1] chỉ khoản TIỀN", status: "passed" },
        { fullName: "bậc giá trị > [INV-K1] gói rời DRAFT mang đúng bậc", status: "passed" },
      ]),
    );
    expect([...coverage.keys()].sort()).toEqual(["J1", "K1"]);
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
    expect(demHangUngVien(md)).toEqual(["A1", "A4", "G1", "H1", "J1", "K1"]);
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
    expect(demHangUngVien(md)).toEqual(["A1", "A4", "G1", "H1", "J1", "K1"]);
    expect(parseInvariants(md).map((i) => i.id)).toEqual(["A1", "A4", "G1", "H1", "J1", "K1"]);
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
