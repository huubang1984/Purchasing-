// [S1.9102 / ADR-9202] Bản khai và dòng lệnh của task khởi tạo tổ chức — hàm thuần, không CSDL.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BanKhaiError, MA_VAI, TRAN_SO_NGUOI, docBanKhai } from "./ban-khai.js";
import { TIEN_TO_BI_MAT, ThamSoError, docThamSo } from "./index.js";

const ORG = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const nguoi = (email: string, vai: unknown = ["BUYER"], hoTen = "Nguyễn Văn A") => ({ email, hoTen, vai });
const tao = (ds: unknown[] = [nguoi("a@congty.vn")], toChuc: unknown = { ten: "Công ty CP Thép Việt", slug: "thep-viet" }) =>
  JSON.stringify({ cheDo: "tao", toChuc, nguoi: ds });

describe("[S1.9102] docBanKhai — hai chế độ", () => {
  it("tạo: đọc tên, slug, người và vai; bỏ khoảng trắng hai đầu", () => {
    const bk = docBanKhai(tao([nguoi(" a@congty.vn ", ["PROCUREMENT_MANAGER", "TECHNICAL"], "  Trần Thị B ")]), "tao");
    expect(bk).toEqual({
      cheDo: "tao",
      ten: "Công ty CP Thép Việt",
      slug: "thep-viet",
      nguoi: [{ email: "a@congty.vn", hoTen: "Trần Thị B", vai: ["PROCUREMENT_MANAGER", "TECHNICAL"] }],
    });
  });

  it("thêm người: đọc mã tổ chức; một bản khai TẠO chạy ở lệnh them-nguoi (hay ngược lại) ⇒ dừng", () => {
    const them = JSON.stringify({ cheDo: "them-nguoi", toChuc: { id: ORG }, nguoi: [nguoi("b@congty.vn", ["FINANCE"])] });
    expect(docBanKhai(them, "them-nguoi")).toEqual({ cheDo: "them-nguoi", orgId: ORG, nguoi: [{ email: "b@congty.vn", hoTen: "Nguyễn Văn A", vai: ["FINANCE"] }] });
    expect(() => docBanKhai(them, "tao")).toThrow(/"cheDo": "them-nguoi" nhưng lệnh là "tao"/u);
    expect(() => docBanKhai(tao(), "them-nguoi")).toThrow(/"cheDo": "tao" nhưng lệnh là "them-nguoi"/u);
  });

  it("danh mục vai là đúng sáu mã của 005", () => {
    expect([...MA_VAI]).toEqual(["REQUESTER", "BUYER", "TECHNICAL", "PROCUREMENT_MANAGER", "FINANCE", "DIRECTOR"]);
  });

  it.each([
    ["không phải JSON", "{", /không phải JSON/u],
    ["mảng thay đối tượng", "[]", /phải là một đối tượng JSON/u],
    ["trường lạ ở gốc", JSON.stringify({ cheDo: "tao", toChuc: {}, nguoi: [], x: 1 }), /trường lạ "x"/u],
    ["chế độ lạ", JSON.stringify({ cheDo: "xoa", toChuc: {}, nguoi: [] }), /"cheDo" phải là/u],
    ["thiếu toChuc", JSON.stringify({ cheDo: "tao", nguoi: [nguoi("a@x.vn")] }), /thiếu "toChuc"/u],
    ["không người nào", tao([]), /"nguoi" phải là mảng khác rỗng/u],
    ["slug có chữ hoa", tao(undefined, { ten: "A", slug: "Thep-Viet" }), /"slug" chỉ gồm/u],
    ["slug có dấu", tao(undefined, { ten: "A", slug: "thép-việt" }), /"slug" chỉ gồm/u],
    ["slug gạch nối ở đầu", tao(undefined, { ten: "A", slug: "-thep" }), /"slug" chỉ gồm/u],
    ["slug hai ký tự", tao(undefined, { ten: "A", slug: "ab" }), /"slug" chỉ gồm/u],
    ["tên rỗng", tao(undefined, { ten: "  ", slug: "thep-viet" }), /thiếu trường "ten"/u],
    ["tên quá dài", tao(undefined, { ten: "x".repeat(201), slug: "thep-viet" }), /"ten" dài quá 200/u],
    ["trường lạ trong toChuc", tao(undefined, { ten: "A", slug: "thep-viet", id: ORG }), /toChuc: trường lạ "id"/u],
    ["email hai địa chỉ", tao([nguoi("a@x.vn,b@x.vn")]), /người thứ 1: "email" không phải/u],
    ["email không @", tao([nguoi("congty.vn")]), /người thứ 1: "email" không phải/u],
    ["email có khoảng trắng", tao([nguoi("a b@x.vn")]), /người thứ 1: "email" không phải/u],
    ["vai lạ", tao([nguoi("a@x.vn", ["ADMIN"])]), /người thứ 1: vai lạ/u],
    ["vai rỗng", tao([nguoi("a@x.vn", [])]), /người thứ 1: "vai" phải là mảng khác rỗng/u],
    ["vai lặp", tao([nguoi("a@x.vn", ["BUYER", "BUYER"])]), /người thứ 1: vai BUYER khai hai lần/u],
    ["trường lạ ở người", tao([{ ...nguoi("a@x.vn"), matKhau: "x" }]), /người thứ 1: trường lạ "matKhau"/u],
    ["trùng email khác hoa thường", tao([nguoi("a@x.vn"), nguoi("A@X.vn")]), /người thứ 2: trùng email với người thứ 1/u],
    // [lượt soi] Chữ hoa ngoài ASCII: bản so ASCII để cặp này rơi xuống CSDL với thông điệp sai "email đã có trong tổ chức".
    ["trùng email khác hoa thường ngoài ASCII", tao([nguoi("ĐẠI@x.vn"), nguoi("đại@x.vn")]), /người thứ 2: trùng email với người thứ 1/u],
    // [lượt soi] Ký tự điều khiển và định dạng: `/auth/link` từ chối chúng, nên người ấy không bao giờ xin được link.
    ["email có ký tự điều khiển", tao([nguoi("a\u0001b@x.vn")]), /người thứ 1: "email" không phải/u],
    ["email có zero-width", tao([nguoi("ab\u200B@x.vn")]), /người thứ 1: "email" không phải/u],
    ["email có ký tự đảo chiều", tao([nguoi("\u202Eab@x.vn")]), /người thứ 1: "email" không phải/u],
  ])("%s ⇒ BanKhaiError", (_ten, json, mau) => {
    expect(() => docBanKhai(json, "tao")).toThrow(BanKhaiError);
    expect(() => docBanKhai(json, "tao")).toThrow(mau);
  });

  it("thêm người: mã tổ chức không phải UUIDv4 chữ thường, hay kèm tên/slug ⇒ BanKhaiError", () => {
    const them = (toChuc: unknown) => JSON.stringify({ cheDo: "them-nguoi", toChuc, nguoi: [nguoi("a@x.vn")] });
    expect(() => docBanKhai(them({ id: "123" }), "them-nguoi")).toThrow(/UUIDv4/u);
    expect(() => docBanKhai(them({ id: ORG.toUpperCase() }), "them-nguoi")).toThrow(/UUIDv4/u);
    expect(() => docBanKhai(them({ id: ORG, slug: "thep-viet" }), "them-nguoi")).toThrow(/toChuc: trường lạ "slug"/u);
  });

  it("[lượt soi] trần là 50 người: một lần chạy giữ khoá chuỗi sổ của tổ chức tới COMMIT, và 200 người × 3 vai đo được 3,7 s — quá trần 2 s của mọi lần ghi sổ khác", () => {
    expect(TRAN_SO_NGUOI).toBe(50);
  });

  it(`quá ${String(TRAN_SO_NGUOI)} người trong một lần chạy ⇒ dừng`, () => {
    const ds = Array.from({ length: TRAN_SO_NGUOI + 1 }, (_x, i) => nguoi(`n${String(i)}@congty.vn`));
    expect(() => docBanKhai(tao(ds), "tao")).toThrow(`quá ${String(TRAN_SO_NGUOI)} người`);
    expect(docBanKhai(tao(ds.slice(0, TRAN_SO_NGUOI)), "tao").nguoi).toHaveLength(TRAN_SO_NGUOI);
  });

  it("[lượt soi] tên khoá lạ chỉ in khi trông như tên trường — một email gõ nhầm vào chỗ khoá, hay khoá mang xuống dòng, không in", () => {
    const moTa = (json: string) => {
      try {
        docBanKhai(json, "tao");
      } catch (e) {
        return (e as Error).message;
      }
      return "";
    };
    const emailLamKhoa = moTa(JSON.stringify({ cheDo: "tao", toChuc: { ten: "A", slug: "thep-viet" }, nguoi: [nguoi("a@x.vn")], "giam.doc@khach.vn": 1 }));
    expect(emailLamKhoa).toMatch(/trường lạ \(tên không in được\)/u);
    expect(emailLamKhoa).not.toContain("giam.doc");
    const xuongDong = moTa(JSON.stringify({ cheDo: "tao", toChuc: { ten: "A", slug: "thep-viet" }, nguoi: [{ ...nguoi("a@x.vn"), "x\n[khoi-tao] OK": 1 }] }));
    expect(xuongDong).toMatch(/người thứ 1: trường lạ \(tên không in được\)/u);
    expect(xuongDong).not.toContain("\n");
  });

  it("thông điệp lỗi KHÔNG mang email hay họ tên của bản khai — nó đi thẳng vào CloudWatch Logs", () => {
    const bimat = "giam.doc.rieng@khach-hang-that.vn";
    const ten = "Họ Tên Rất Riêng";
    for (const json of [
      tao([nguoi(bimat, ["ADMIN"], ten)]),
      tao([nguoi(bimat, ["BUYER"], ten), nguoi(bimat.toUpperCase(), ["BUYER"], ten)]),
      tao([nguoi(`${bimat},x@y.vn`, ["BUYER"], ten)]),
      tao([nguoi(bimat, ["BUYER"], "x".repeat(201))]),
    ]) {
      let thongDiep = "";
      try {
        docBanKhai(json, "tao");
      } catch (e) {
        thongDiep = (e as Error).message;
      }
      expect(thongDiep).not.toBe("");
      expect(thongDiep.toLowerCase()).not.toContain("giam.doc.rieng");
      expect(thongDiep).not.toContain(ten);
    }
    // [lượt soi] JSON HỎNG: thông điệp của `JSON.parse` (V8) trích một MẢNH của chính đầu vào — `…"email": giam.doc.r"… is not
    // valid JSON` — cắt giữa chừng, nên phép "không chứa cả email" ở trên không bắt được. Nhánh ấy phải ra ĐÚNG câu cố định.
    // Hai hình dạng: email không có ngoặc kép, và bản khai bị cắt cụt.
    for (const json of [`{"cheDo":"tao","nguoi":[{"email": ${bimat}, "hoTen": "${ten}"}]}`, tao([nguoi(bimat, ["BUYER"], ten)]).slice(0, -12)]) {
      expect(() => docBanKhai(json, "tao")).toThrow(new BanKhaiError("bản khai không phải JSON hợp lệ"));
    }
  });
});

describe("[S1.9102 / lượt soi] regex EMAIL là regex của bộ gửi SES cộng `\\p{C}` — hai bản chép không trôi xa nhau", () => {
  it("đọc CHỮ của hai tệp: ban-khai.ts = gui-ses.ts với `\\p{C}` thêm vào từng lớp ký tự", () => {
    // Bản khai nhận một địa chỉ mà bộ gửi SES từ chối ⇒ người ấy được tạo mà không bao giờ nhận được link. Chép regex (không nhập:
    // công cụ không phụ thuộc `apps/api`) nên phải ghim bằng chữ — nới một bên mà không nới bên kia thì đỏ ở đây.
    const lay = (duong: string): string | undefined =>
      /^const EMAIL = (\/.+\/u);$/mu.exec(readFileSync(new URL(`../../../${duong}`, import.meta.url), "utf8"))?.[1];
    const ses = lay("apps/api/src/adapters/gui-ses.ts");
    expect(ses, "không đọc được regex EMAIL của gui-ses.ts").toBeDefined();
    expect(lay("tools/khoi-tao-to-chuc/src/ban-khai.ts")).toBe(ses!.replaceAll('"]', '"\\p{C}]'));
  });
});

describe("[S1.9102] docThamSo — một lệnh, đúng một nguồn bản khai", () => {
  it("tệp hay bí mật dưới tiền tố; lệnh là tao hoặc them-nguoi", () => {
    expect(docThamSo(["tao", "--ban-khai-tep", "/tmp/bk.json"])).toEqual({ lenh: "tao", nguon: { loai: "tep", duong: "/tmp/bk.json" } });
    expect(docThamSo(["them-nguoi", "--ban-khai-secret", `${TIEN_TO_BI_MAT}thep-viet`])).toEqual({
      lenh: "them-nguoi",
      nguon: { loai: "secret", ten: `${TIEN_TO_BI_MAT}thep-viet` },
    });
  });

  it.each([
    [[], /lệnh phải là/u],
    [["xoa", "--ban-khai-tep", "x"], /lệnh phải là/u],
    [["tao"], /thiếu nguồn bản khai/u],
    [["tao", "--ban-khai-tep"], /cần một giá trị/u],
    [["tao", "--ban-khai-tep", "--ban-khai-secret"], /cần một giá trị/u],
    [["tao", "--ban-khai-tep", "a", "--ban-khai-secret", `${TIEN_TO_BI_MAT}x`], /chỉ nhận MỘT nguồn/u],
    [["tao", "--org", "x"], /tham số lạ/u],
    // Task role đọc được cả nhánh tp/khoi-tao/*, kể cả URL CSDL của chính nó: công cụ chỉ đọc bản khai.
    [["tao", "--ban-khai-secret", "tp/khoi-tao/database-url"], /dưới "tp\/khoi-tao\/ban-khai\/"/u],
    [["tao", "--ban-khai-secret", "tp/api/otp-peppers"], /dưới "tp\/khoi-tao\/ban-khai\/"/u],
    [["tao", "--ban-khai-secret", TIEN_TO_BI_MAT], /dưới "tp\/khoi-tao\/ban-khai\/"/u],
    [["tao", "--ban-khai-secret", `${TIEN_TO_BI_MAT}a b`], /dưới "tp\/khoi-tao\/ban-khai\/"/u],
  ])("%j ⇒ ThamSoError", (ds, mau) => {
    expect(() => docThamSo(ds)).toThrow(ThamSoError);
    expect(() => docThamSo(ds)).toThrow(mau);
  });
});
