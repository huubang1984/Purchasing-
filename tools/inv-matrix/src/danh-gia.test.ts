// =============================================================================================
// CẢNH BÁO GIỐNG `parse.test.ts`: KHÔNG ĐẶT NHÃN `[INV-…]` VÀO TÊN `describe`/`it` Ở ĐÂY.
// Nhãn trong tên test LÀ bằng chứng phủ bất biến. Nhãn dùng làm dữ liệu mẫu nằm TRONG CHUỖI.
// =============================================================================================
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MA_DUOC_PHEP_CHUA_PHU,
  PHAM_VI_HEP,
  TRICH_BAN_GIAO,
  assertFullSha,
  ketQua,
  kiemTraCong,
} from "./danh-gia.js";
import { parseInvariants, type Invariant, type TestOutcome } from "./parse.js";

const dat: TestOutcome = { name: "x", status: "passed" };
const do_: TestOutcome = { name: "x", status: "failed" };
const boQua: TestOutcome = { name: "x", status: "skipped" };

function inv(id: string): Invariant {
  return { id, statement: "s", enforcement: "e", testLayer: "T1" };
}

describe("phán xét một hàng ma trận", () => {
  it("không test nào mang nhãn thì là CHƯA PHỦ, và KHÔNG tự nó chặn merge", () => {
    expect(ketQua(undefined)).toEqual({ nhan: "⏳ CHƯA PHỦ", coTest: false, chan: false });
    expect(ketQua([])).toEqual({ nhan: "⏳ CHƯA PHỦ", coTest: false, chan: false });
  });

  it("MỘT test đỏ giữa nhiều test đạt vẫn làm cả hàng ĐỎ và CHẶN", () => {
    expect(ketQua([dat, dat, do_])).toEqual({ nhan: "🔴 ĐANG ĐỎ", coTest: true, chan: true });
  });

  it("toàn bộ bị bỏ qua là BỊ BỎ QUA và CHẶN — một test không chạy không phải bằng chứng", () => {
    expect(ketQua([boQua, boQua])).toEqual({ nhan: "⚠️ BỊ BỎ QUA", coTest: true, chan: true });
  });

  it("một test đạt lẫn giữa các test bị bỏ qua thì hàng ĐẠT", () => {
    expect(ketQua([boQua, dat])).toEqual({ nhan: "✅ ĐẠT", coTest: true, chan: false });
  });

  it("test đỏ THẮNG test bị bỏ qua khi cả hai cùng có mặt", () => {
    expect(ketQua([boQua, do_]).nhan).toBe("🔴 ĐANG ĐỎ");
  });
});

// ---------------------------------------------------------------------------------------------
// T11-H — XUẤT XỨ PHẢI CÓ DẤU HIỆU TÍCH CỰC, KHÔNG PHẢI "KHÔNG THẤY LỖI"
// ---------------------------------------------------------------------------------------------
describe("khẳng định xuất xứ của evidence pack", () => {
  const sha40 = "0123456789abcdef0123456789abcdef01234567";

  it("SHA đủ 40 hex thường được nhận, và khoảng trắng hai đầu bị cắt", () => {
    expect(assertFullSha(`${sha40}\n`)).toBe(sha40);
  });

  it("SHA NGẮN (`git rev-parse --short`) bị TỪ CHỐI — bảy ký tự hex vẫn là hex", () => {
    expect(() => assertFullSha("0123456")).toThrow(/không lấy được SHA hợp lệ/);
    expect(() => assertFullSha("0123456789ab")).toThrow(/không lấy được SHA hợp lệ/);
  });

  it("đầu ra RỖNG hoặc `undefined` bị TỪ CHỐI — đúng hình dạng lỗi của shim `.cmd` trên Windows", () => {
    expect(() => assertFullSha("")).toThrow(/không lấy được SHA hợp lệ/);
    expect(() => assertFullSha(undefined)).toThrow(/không lấy được SHA hợp lệ/);
    expect(() => assertFullSha(null)).toThrow(/không lấy được SHA hợp lệ/);
    expect(() => assertFullSha("   \n ")).toThrow(/không lấy được SHA hợp lệ/);
  });

  it("chuỗi không phải hex, hoặc dài hơn 40, cũng bị TỪ CHỐI", () => {
    expect(() => assertFullSha(`${sha40}8`)).toThrow(/không lấy được SHA hợp lệ/);
    expect(() => assertFullSha(sha40.toUpperCase())).toThrow(/không lấy được SHA hợp lệ/);
    expect(() => assertFullSha("khong-xac-dinh")).toThrow(/không lấy được SHA hợp lệ/);
  });

  it("thông điệp lỗi CHỨA thứ nhận được — chẩn đoán, không phải một lời từ chối câm", () => {
    expect(() => assertFullSha("abc")).toThrow(/"abc"/);
  });
});

// ---------------------------------------------------------------------------------------------
// T11-I — DANH SÁCH GHIM THAY CHO `continue-on-error`. RÀNG BUỘC HAI CHIỀU.
// ---------------------------------------------------------------------------------------------
describe("cổng evidence: ghim cấu hình thay vì nới bảo đảm", () => {
  const soDangKy = [inv("A1"), inv("B3"), inv("G2")];

  it("mọi mã đều phủ và danh sách rỗng thì cổng XANH", () => {
    const van = kiemTraCong(
      soDangKy,
      new Map([["A1", [dat]], ["B3", [dat]], ["G2", [dat]]]),
      new Map(),
      new Map(),
    );
    expect(van).toEqual([]);
  });

  it("mã CHƯA PHỦ mà KHÔNG trong danh sách được phép thì CHẶN, và thông điệp cấm gắn nhãn bừa", () => {
    const van = kiemTraCong(
      soDangKy,
      new Map([["A1", [dat]], ["B3", [dat]]]),
      new Map(),
      new Map(),
    );
    expect(van).toHaveLength(1);
    expect(van[0]).toContain("G2");
    expect(van[0], "thông điệp phải cảnh báo đúng lớp lỗi 'lấp bằng nhãn'").toContain(
      "Đừng gắn nhãn lên một test đo thứ khác",
    );
  });

  it("mã CHƯA PHỦ mà CÓ trong danh sách được phép thì KHÔNG chặn", () => {
    const van = kiemTraCong(
      soDangKy,
      new Map([["A1", [dat]], ["B3", [dat]]]),
      new Map([["G2", "S1 — khoá theo RFQ đòi RFQ"]]),
      new Map(),
    );
    expect(van).toEqual([]);
  });

  it("CHIỀU NGƯỢC: mã ĐÃ PHỦ mà vẫn nằm trong danh sách thì CHẶN — danh sách chỉ được co lại", () => {
    const van = kiemTraCong(
      soDangKy,
      new Map([["A1", [dat]], ["B3", [dat]], ["G2", [dat]]]),
      new Map([["G2", "S1 — khoá theo RFQ đòi RFQ"]]),
      new Map(),
    );
    expect(van).toHaveLength(1);
    expect(van[0]).toContain("GỠ nó khỏi MA_DUOC_PHEP_CHUA_PHU");
  });

  it("mã ĐANG ĐỎ vẫn CHẶN kể cả khi nó nằm trong danh sách được phép chưa phủ", () => {
    const van = kiemTraCong(
      soDangKy,
      new Map([["A1", [dat]], ["B3", [dat]], ["G2", [do_]]]),
      new Map([["G2", "S1"]]),
      new Map(),
    );
    expect(van).toHaveLength(1);
    expect(van[0]).toContain("ĐANG ĐỎ");
  });

  it("mã BỊ BỎ QUA cũng CHẶN — một test không chạy không mua được ô ✅", () => {
    const van = kiemTraCong(
      soDangKy,
      new Map([["A1", [dat]], ["B3", [dat]], ["G2", [boQua]]]),
      new Map(),
      new Map(),
    );
    expect(van).toHaveLength(1);
    expect(van[0]).toContain("BỊ BỎ QUA");
  });

  it("danh sách được phép nhắc một mã KHÔNG có trong sổ đăng ký thì CHẶN", () => {
    const van = kiemTraCong(
      soDangKy,
      new Map([["A1", [dat]], ["B3", [dat]], ["G2", [dat]]]),
      new Map([["Z9", "mã ma"]]),
      new Map(),
    );
    expect(van).toHaveLength(1);
    expect(van[0]).toContain("Z9");
    expect(van[0]).toContain("KHÔNG có trong sổ đăng ký");
  });

  it("ghi chú phạm vi hẹp nhắc một mã KHÔNG có trong sổ đăng ký thì CHẶN", () => {
    const van = kiemTraCong(
      soDangKy,
      new Map([["A1", [dat]], ["B3", [dat]], ["G2", [dat]]]),
      new Map(),
      new Map([["Q1", "ghi chú mồ côi"]]),
    );
    expect(van).toHaveLength(1);
    expect(van[0]).toContain("Q1");
  });
});

// ---------------------------------------------------------------------------------------------
// CẤU HÌNH GHIM PHẢI KHỚP SỔ ĐĂNG KÝ THẬT. Chạy ở tầng đơn vị nên nó đỏ NGAY, không phải đợi
// một lượt `pnpm evidence` dài năm phút. Đây cũng là lớp bắt ca "một hàng biến mất khỏi
// docs/TEST-PLAN.md": mọi mã được ghim đều phải còn tồn tại ở đó.
// ---------------------------------------------------------------------------------------------
describe("cấu hình ghim đối chiếu với docs/TEST-PLAN.md thật", () => {
  // ĐỌC LƯỜI, TRONG THÂN TEST — không phải ở thân `describe`. Lý do đo được ở harness Task 11:
  // `parseInvariants` NÉM khi sổ đăng ký lệch khuôn, và một lần ném ở thân `describe` xảy ra lúc
  // THU THẬP. Vitest xếp nó là "Failed Suites 1" với dòng tổng kết `Tests  N passed` — số test
  // ĐỎ vẫn là 0. Một harness đọc số test đỏ sẽ kết luận "SỐNG SÓT" cho một mũi mà lớp canh ĐÃ
  // bắt được — đúng loại kết quả giả mà dự án này đã ăn năm lần. Gọi trong thân test biến cùng
  // một lần ném thành một test ĐỎ đếm được.
  const soDangKy = (): Invariant[] =>
    parseInvariants(readFileSync(new URL("../../../docs/TEST-PLAN.md", import.meta.url), "utf8"));
  const maCoThat = (): Set<string> => new Set(soDangKy().map((i) => i.id));

  it("sổ đăng ký thật đọc được, và mọi mã đều đúng khuôn nhóm-số", () => {
    const ds = soDangKy();
    expect(ds.length, "chống rỗng ruột: sổ đăng ký phải có hàng").toBeGreaterThan(0);
    expect(ds.filter((i) => !/^[A-H]\d+$/.test(i.id))).toEqual([]);
    expect(ds.filter((i) => i.statement.length === 0)).toEqual([]);
    // Mọi nhóm A–H đều phải CÓ MẶT. Nếu một mũi thu hẹp dải của bộ đọc, nhóm bị cắt biến mất
    // ở đây trước khi kịp biến mất khỏi ma trận.
    expect(
      [..."ABCDEFGH"].filter((g) => !ds.some((i) => i.id.startsWith(g))),
      "một NHÓM bất biến biến mất khỏi sổ đăng ký đọc được",
    ).toEqual([]);
  });

  it("mọi mã trong danh sách được phép chưa phủ đều tồn tại trong sổ đăng ký", () => {
    const co = maCoThat();
    expect([...MA_DUOC_PHEP_CHUA_PHU.keys()].filter((m) => !co.has(m))).toEqual([]);
  });

  it("mọi mã có ghi chú phạm vi hẹp đều tồn tại trong sổ đăng ký", () => {
    const co = maCoThat();
    expect([...PHAM_VI_HEP.keys()].filter((m) => !co.has(m))).toEqual([]);
  });

  it("mọi lý do đều có nội dung — một dòng rỗng là một khoảng trống bị giấu", () => {
    expect([...MA_DUOC_PHEP_CHUA_PHU.entries()].filter(([, ly]) => ly.trim().length < 10)).toEqual([]);
    expect([...PHAM_VI_HEP.entries()].filter(([, ly]) => ly.trim().length < 10)).toEqual([]);
  });

  it("một mã KHÔNG được vừa nằm trong danh sách chưa phủ vừa có ghi chú phạm vi hẹp", () => {
    expect([...MA_DUOC_PHEP_CHUA_PHU.keys()].filter((m) => PHAM_VI_HEP.has(m))).toEqual([]);
  });

  it("hai phát biểu bàn giao trích nguyên văn đều trỏ tới mã có thật và không bị rút gọn", () => {
    const co = maCoThat();
    expect(TRICH_BAN_GIAO.map((t) => t.ma)).toEqual(["B3", "B4"]);
    for (const t of TRICH_BAN_GIAO) {
      expect(co.has(t.ma)).toBe(true);
      expect(t.trich, `trích dẫn ${t.ma} quá ngắn — nghi bị rút gọn`).toContain("KHONG");
      expect(t.trich.length).toBeGreaterThan(800);
    }
  });
});
