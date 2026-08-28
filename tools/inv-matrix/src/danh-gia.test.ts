// =============================================================================================
// CẢNH BÁO GIỐNG `parse.test.ts`: KHÔNG ĐẶT NHÃN `[INV-…]` VÀO TÊN `describe`/`it` Ở ĐÂY.
// Nhãn trong tên test LÀ bằng chứng phủ bất biến. Nhãn dùng làm dữ liệu mẫu nằm TRONG CHUỖI.
// =============================================================================================
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MA_DUOC_PHEP_CHUA_PHU,
  MA_PHAI_CO_CO_HEP,
  MOC_GHIM,
  PHAM_VI_HEP,
  TRICH_BAN_GIAO,
  assertFullSha,
  demVeMenhDe,
  ketQua,
  kiemTraCong,
  kiemTraMocGhim,
} from "./danh-gia.js";
import { parseInvariants, type Invariant, type TestOutcome } from "./parse.js";

const dat: TestOutcome = { name: "x", status: "passed" };
const do_: TestOutcome = { name: "x", status: "failed" };
const boQua: TestOutcome = { name: "x", status: "skipped" };

function inv(id: string, statement = "s"): Invariant {
  return { id, statement, enforcement: "e", testLayer: "T1" };
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
// VÒNG FIX CUỐI / C2 — MỐC GHIM. Hai mũi ĐO ĐƯỢC đã đi lọt qua `kiemTraCong` phải chết ở đây.
// ---------------------------------------------------------------------------------------------
describe("mốc ghim: 'độ phủ chỉ đi lên' là một PHÉP ĐO, không phải một câu văn", () => {
  const so = [inv("A1"), inv("B3"), inv("F3")];
  const moc = { soPhuToiThieu: 3, coDanhSachToiDa: 0 };
  const phuHet = new Map([["A1", [dat]], ["B3", [dat]], ["F3", [dat]]]);

  it("đúng mốc thì im lặng", () => {
    expect(kiemTraMocGhim(so, phuHet, new Map(), new Map(), moc, new Set())).toEqual([]);
  });

  it("MŨI 1 — XOÁ test của F3 VÀ thêm F3 vào danh sách, cùng một lượt: CHẶN", () => {
    // Đây là mũi đo được của review cuối: `kiemTraCong` cho exit=0 cho đúng tổ hợp này.
    const van = kiemTraMocGhim(
      so,
      new Map([["A1", [dat]], ["B3", [dat]]]),
      new Map([["F3", "một lý do nghe có thẩm quyền"]]),
      new Map(),
      moc,
      new Set(),
    );
    expect(van.some((v) => v.includes("HỒI QUY ĐỘ PHỦ"))).toBe(true);
    expect(
      van.find((v) => v.includes("HỒI QUY ĐỘ PHỦ")),
      "thông điệp phải nói thẳng rằng thêm vào danh sách KHÔNG chữa được",
    ).toContain("KHÔNG");
  });

  it("MŨI 1 sống sót nếu chỉ có `kiemTraCong` — đối chứng cho thấy mốc ghim là lớp DUY NHẤT", () => {
    const van = kiemTraCong(
      so,
      new Map([["A1", [dat]], ["B3", [dat]]]),
      new Map([["F3", "một lý do nghe có thẩm quyền"]]),
      new Map(),
    );
    expect(van, "cổng cũ IM LẶNG cho đúng tổ hợp này — đó là khe hở").toEqual([]);
  });

  it("MŨI 2 — thêm một mã MỚI vào sổ đăng ký VÀ vào danh sách: danh sách NỞ RA, CHẶN", () => {
    const van = kiemTraMocGhim(
      [...so, inv("G9")],
      phuHet,
      new Map([["G9", "S1 — mã mới toanh"]]),
      new Map(),
      moc,
      new Set(),
    );
    expect(van.some((v) => v.includes("NỞ RA"))).toBe(true);
  });

  it("MŨI 2 cũng sống sót nếu chỉ có `kiemTraCong`", () => {
    const van = kiemTraCong(
      [...so, inv("G9")],
      phuHet,
      new Map([["G9", "S1 — mã mới toanh"]]),
      new Map(),
    );
    expect(van).toEqual([]);
  });

  it("ĐỘ PHỦ TĂNG cũng CHẶN — mốc một chiều sẽ tự trôi và mua sẵn chỗ cho một lần tụt", () => {
    const van = kiemTraMocGhim(
      so,
      phuHet,
      new Map(),
      new Map(),
      { soPhuToiThieu: 2, coDanhSachToiDa: 0 },
      new Set(),
    );
    expect(van.some((v) => v.includes("ĐỘ PHỦ TĂNG"))).toBe(true);
    expect(van.join(" ")).toContain("soPhuToiThieu = 3");
  });

  it("danh sách CO LẠI cũng CHẶN — trần không được giữ chỗ trống", () => {
    const van = kiemTraMocGhim(
      so,
      phuHet,
      new Map(),
      new Map(),
      { soPhuToiThieu: 3, coDanhSachToiDa: 1 },
      new Set(),
    );
    expect(van.some((v) => v.includes("CO LẠI"))).toBe(true);
  });

  it("I1 — GỠ một cờ §4 của mã được ghim thì CHẶN", () => {
    const van = kiemTraMocGhim(so, phuHet, new Map(), new Map(), moc, new Set(["B3"]));
    expect(van).toHaveLength(1);
    expect(van[0]).toContain("B3");
    expect(van[0]).toContain("PHAM_VI_HEP");
  });

  it("cờ §4 CÒN thì không chặn", () => {
    const van = kiemTraMocGhim(
      so,
      phuHet,
      new Map(),
      new Map([["B3", "phạm vi hẹp có thật"]]),
      moc,
      new Set(["B3"]),
    );
    expect(van).toEqual([]);
  });

  it("mã được ghim phải-có-cờ mà KHÔNG có trong sổ đăng ký cũng CHẶN", () => {
    const van = kiemTraMocGhim(so, phuHet, new Map(), new Map(), moc, new Set(["Z9"]));
    expect(van).toHaveLength(1);
    expect(van[0]).toContain("KHÔNG có trong sổ đăng ký");
  });
});

describe("mệnh đề HỘI: một test đo MỘT vế cũng thắp ✅ cho CẢ mệnh đề", () => {
  const hoi = "vế một **và** vế hai **và** vế ba **và** vế bốn";
  const moc = { soPhuToiThieu: 1, coDanhSachToiDa: 0 };

  it("đếm vế dẫn xuất từ chính câu chữ của sổ đăng ký", () => {
    expect(demVeMenhDe("một mệnh đề đơn")).toBe(1);
    expect(demVeMenhDe(hoi)).toBe(4);
    // `và` KHÔNG đậm là văn xuôi, không phải phép hội — nới ở đây là nới một bảo đảm.
    expect(demVeMenhDe("A và B")).toBe(1);
  });

  it("mệnh đề HỘI mang ô ✅ mà KHÔNG có ghi chú §4 thì CHẶN", () => {
    const van = kiemTraMocGhim(
      [inv("D1", hoi)],
      new Map([["D1", [dat]]]),
      new Map(),
      new Map(),
      moc,
      new Set(),
    );
    expect(van).toHaveLength(1);
    expect(van[0]).toContain("MỆNH ĐỀ HỘI 4 VẾ");
  });

  it("có ghi chú §4 thì thôi — §4 là chỗ ghi phần chênh", () => {
    const van = kiemTraMocGhim(
      [inv("D1", hoi)],
      new Map([["D1", [dat]]]),
      new Map(),
      new Map([["D1", "vế nào đo, vế nào không"]]),
      moc,
      new Set(),
    );
    expect(van).toEqual([]);
  });

  it("mệnh đề HỘI CHƯA PHỦ thì KHÔNG chặn — một hàng ⏳ không phát biểu gì cả", () => {
    const van = kiemTraMocGhim(
      [inv("D1", hoi)],
      new Map(),
      new Map(),
      new Map(),
      { soPhuToiThieu: 0, coDanhSachToiDa: 0 },
      new Set(),
    );
    expect(van).toEqual([]);
  });

  it("mệnh đề ĐƠN mang ô ✅ mà không có §4 thì KHÔNG chặn", () => {
    const van = kiemTraMocGhim(
      [inv("F3", "một mệnh đề đơn")],
      new Map([["F3", [dat]]]),
      new Map(),
      new Map(),
      moc,
      new Set(),
    );
    expect(van).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// LỚP CANH ĐIỂM NỐI. `kiemTraMocGhim` là hàm THUẦN nên mọi vế của nó kiểm thử đột biến được —
// nhưng một mũi XOÁ LỜI GỌI ở `index.ts` (vỏ I/O, không test đơn vị nào chạm tới) sẽ SỐNG SÓT
// qua toàn bộ các test trên. Đọc thẳng mã nguồn là lớp rẻ nhất đóng đúng mũi đó.
// ---------------------------------------------------------------------------------------------
describe("bộ sinh phải THẬT SỰ gọi cổng mốc ghim", () => {
  it("index.ts gộp kết quả của kiemTraMocGhim vào danh sách vấn đề chặn merge", () => {
    const nguon = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(nguon, "xoá lời gọi này làm cả cổng thứ hai bốc hơi trong im lặng").toMatch(
      /van\.push\(\s*\.\.\.kiemTraMocGhim\(/,
    );
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

  it("trần ghim KHỚP cỡ thật của danh sách được phép chưa phủ", () => {
    expect(MA_DUOC_PHEP_CHUA_PHU.size).toBe(MOC_GHIM.coDanhSachToiDa);
  });

  it("mọi mã bắt buộc phải có cờ §4 đều CÓ cờ, và đều tồn tại trong sổ đăng ký", () => {
    const co = maCoThat();
    expect([...MA_PHAI_CO_CO_HEP].filter((m) => !co.has(m))).toEqual([]);
    expect([...MA_PHAI_CO_CO_HEP].filter((m) => !PHAM_VI_HEP.has(m))).toEqual([]);
  });

  it("MỌI mệnh đề HỘI trong sổ đăng ký thật đều nằm trong danh sách bắt buộc có cờ §4", () => {
    // Chưa phủ thì chưa phát biểu gì, nên chỉ những mã KHÔNG nằm trong danh sách được phép
    // chưa phủ mới bị đòi. Hôm nay đúng một hàng thoả: D1.
    const hoi = soDangKy()
      .filter((i) => demVeMenhDe(i.statement) > 1 && !MA_DUOC_PHEP_CHUA_PHU.has(i.id))
      .map((i) => i.id);
    expect(hoi).toEqual(["D1"]);
    expect(hoi.filter((m) => !MA_PHAI_CO_CO_HEP.has(m))).toEqual([]);
  });

  it("ghi chú §4 của D1 phải nêu ĐÍCH DANH hàng C3 — hai hàng nói về cùng một vế", () => {
    // Khiếm khuyết đã đo: D1 ✅ và C3 ⏳ mâu thuẫn số học, cách nhau tám dòng trong cùng bảng.
    // Nếu ghi chú không trỏ sang C3 thì kiểm toán viên phải tự bắc cầu.
    const d1 = PHAM_VI_HEP.get("D1") ?? "";
    expect(d1).toContain("C3");
    expect(d1, "phải nói rõ phép HỘI chưa được đo, không chỉ nói một khoảng trống").toContain(
      "HỘI",
    );
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
