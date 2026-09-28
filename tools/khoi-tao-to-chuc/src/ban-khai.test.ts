// [S1.182 / ADR-111] Bản khai và dòng lệnh của task khởi tạo tổ chức — hàm thuần, không CSDL.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BanKhaiError, MA_VAI, TRAN_SO_NGUOI, docBanKhai, kiemKhop, vaiTheoMa } from "./ban-khai.js";
import { TIEN_TO_BI_MAT, ThamSoError, docThamSo } from "./index.js";

const ORG = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const nguoi = (email: string, vai: unknown = ["BUYER"], hoTen = "Nguyễn Văn A") => ({ email, hoTen, vai });
const tao = (ds: unknown[] = [nguoi("a@congty.vn")], toChuc: unknown = { ten: "Công ty CP Thép Việt", slug: "thep-viet" }) =>
  JSON.stringify({ cheDo: "tao", toChuc, nguoi: ds });

describe("[S1.182] docBanKhai — hai chế độ", () => {
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

describe("[S1.182 / lượt soi] regex EMAIL là regex của bộ gửi SES cộng `\\p{C}` — hai bản chép không trôi xa nhau", () => {
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

const PB = "0f1e2d3c-4b5a-4968-8776-655443322110";
const BAM = "ab".repeat(32);
const MA = "9b2d0c1e-8f7a-4b6c-9d5e-3a2b1c0d9e8f";
interface Bo { lenh?: string; ten?: string; pb?: string; bam?: string | null; ma?: string | null; toChuc?: string; soNguoi?: string; vai?: string }
/** Đủ bộ của đường prod: bí mật, phiên bản, băm, mã tổ chức (tao), ba kỳ vọng. `null` = bỏ cờ ấy. */
const bo = (o: Bo = {}): string[] => {
  const lenh = o.lenh ?? "tao";
  const ma = o.ma === undefined ? (lenh === "tao" ? MA : null) : o.ma;
  const bam = o.bam === undefined ? BAM : o.bam;
  return [lenh, "--ban-khai-secret", o.ten ?? `${TIEN_TO_BI_MAT}thep-viet`, "--phien-ban", o.pb ?? PB,
    ...(bam === null ? [] : ["--bam", bam]), ...(ma === null ? [] : ["--ma-to-chuc", ma]),
    "--to-chuc", o.toChuc ?? (lenh === "tao" ? "thep-viet" : ORG), "--so-nguoi", o.soNguoi ?? "1", "--vai", o.vai ?? "BUYER=1"];
};

describe("[S1.182] docThamSo — một lệnh, đúng một nguồn bản khai", () => {
  it("tệp hay bí mật dưới tiền tố; lệnh là tao hoặc them-nguoi", () => {
    expect(docThamSo(["tao", "--ban-khai-tep", "/tmp/bk.json"])).toEqual({
      lenh: "tao",
      nguon: { loai: "tep", duong: "/tmp/bk.json" },
      kyVong: null,
      bam: null,
      maToChuc: null,
    });
    // ~~bí mật chỉ cần tên~~ [S1.9103] bí mật đi cùng phiên bản, băm, ba kỳ vọng; thứ tự cờ tuỳ ý.
    expect(docThamSo(["them-nguoi", "--vai", "BUYER=1,DIRECTOR=2", "--ban-khai-secret", `${TIEN_TO_BI_MAT}thep-viet`, "--to-chuc", ORG,
      "--bam", BAM, "--phien-ban", PB, "--so-nguoi", "2"])).toEqual({
      lenh: "them-nguoi",
      nguon: { loai: "secret", ten: `${TIEN_TO_BI_MAT}thep-viet`, phienBan: PB },
      kyVong: { toChuc: ORG, soNguoi: 2, vai: "BUYER=1,DIRECTOR=2" },
      bam: BAM,
      maToChuc: null,
    });
    expect(docThamSo(bo())).toMatchObject({ lenh: "tao", maToChuc: MA, bam: BAM, kyVong: { toChuc: "thep-viet", soNguoi: 1, vai: "BUYER=1" } });
    expect(docThamSo(["tao", "--ban-khai-tep", "/tmp/bk.json", "--to-chuc", "thep-viet", "--so-nguoi", "50",
      "--vai", "REQUESTER=50,BUYER=50,TECHNICAL=50,PROCUREMENT_MANAGER=50,FINANCE=50,DIRECTOR=50"]).kyVong)
      .toEqual({ toChuc: "thep-viet", soNguoi: 50, vai: "REQUESTER=50,BUYER=50,TECHNICAL=50,PROCUREMENT_MANAGER=50,FINANCE=50,DIRECTOR=50" });
    // Với tệp: băm và mã tổ chức tuỳ chọn — để diễn tập cục bộ đúng lệnh prod.
    expect(docThamSo(["tao", "--ban-khai-tep", "a", "--bam", BAM, "--ma-to-chuc", MA])).toMatchObject({ bam: BAM, maToChuc: MA });
    // VersionId: UUID do SM sinh, hay ClientRequestToken 32–64 ký tự.
    expect(docThamSo(bo({ pb: "a".repeat(32) })).nguon).toMatchObject({ phienBan: "a".repeat(32) });
    expect(docThamSo(bo({ pb: "A-9".repeat(21) + "z" })).nguon).toMatchObject({ phienBan: "A-9".repeat(21) + "z" });
    expect(docThamSo(bo({ soNguoi: "3", vai: "BUYER=1,PROCUREMENT_MANAGER=2" })).kyVong).toMatchObject({ soNguoi: 3 });
  });

  it.each([
    [[], /lệnh phải là/u],
    [["xoa", "--ban-khai-tep", "x"], /lệnh phải là/u],
    [["tao"], /thiếu nguồn bản khai/u],
    [["tao", "--ban-khai-tep"], /cần một giá trị/u],
    [["tao", "--ban-khai-tep", "--ban-khai-secret"], /cần một giá trị/u],
    [["tao", "--ban-khai-tep", "a", "--ban-khai-secret", `${TIEN_TO_BI_MAT}xyz`], /chỉ nhận MỘT nguồn/u],
    [["tao", "--org", "x"], /tham số lạ/u],
    // Task role đọc được cả nhánh tp/khoi-tao/*, kể cả URL CSDL của chính nó: công cụ chỉ đọc bản khai.
    [["tao", "--ban-khai-secret", "tp/khoi-tao/database-url"], /dưới|tp\/khoi-tao\/ban-khai\/<slug>/u],
    [["tao", "--ban-khai-secret", "tp/api/otp-peppers"], /tp\/khoi-tao\/ban-khai\/<slug>/u],
    [["tao", "--ban-khai-secret", TIEN_TO_BI_MAT], /tp\/khoi-tao\/ban-khai\/<slug>/u],
    [["tao", "--ban-khai-secret", `${TIEN_TO_BI_MAT}a b`], /tp\/khoi-tao\/ban-khai\/<slug>/u],
    // [S1.9103 / lượt soi] Tên dạng slug: một tên mang `@`/`.`/`/`/chữ hoa không qua — nó vào CloudTrail và run công khai.
    [bo({ ten: `${TIEN_TO_BI_MAT}nguyen.van.a@khach.vn` }), /<slug>/u],
    [bo({ ten: `${TIEN_TO_BI_MAT}a/b` }), /<slug>/u],
    [bo({ ten: `${TIEN_TO_BI_MAT}Thep-Viet` }), /<slug>/u],
    [bo({ ten: `${TIEN_TO_BI_MAT}ab` }), /<slug>/u],
    // [S1.9103] Đường prod: phiên bản, băm, ba kỳ vọng — và mã tổ chức khi tạo — là bắt buộc.
    [["tao", "--ban-khai-secret", `${TIEN_TO_BI_MAT}xyz`], /cần --phien-ban/u],
    [["tao", "--ban-khai-secret", `${TIEN_TO_BI_MAT}xyz`, "--to-chuc", "thep-viet", "--so-nguoi", "1", "--vai", "BUYER=1"], /cần --phien-ban/u],
    [bo({ bam: null }), /cần --bam/u],
    [["tao", "--ban-khai-secret", `${TIEN_TO_BI_MAT}xyz`, "--phien-ban", PB, "--bam", BAM], /cần ba kỳ vọng/u],
    [bo({ ma: null }), /cần --ma-to-chuc/u],
    [bo({ lenh: "them-nguoi", ma: MA }), /chỉ đi với lệnh tao/u],
    [bo({ ma: MA.toUpperCase() }), /--ma-to-chuc phải là UUIDv4/u],
    [bo({ ma: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" }), /--ma-to-chuc phải là UUIDv4/u],
    [bo({ bam: BAM.toUpperCase() }), /--bam phải là SHA-256/u],
    [bo({ bam: BAM.slice(1) }), /--bam phải là SHA-256/u],
    [bo({ bam: `${BAM}0` }), /--bam phải là SHA-256/u],
    [bo({ pb: "a".repeat(31) }), /VersionId/u],
    [bo({ pb: "a".repeat(65) }), /VersionId/u],
    [bo({ pb: `${"a".repeat(31)}_` }), /VersionId/u],
    [bo({ pb: `${"a".repeat(31)} ` }), /VersionId/u],
    // Mở đầu bằng gạch nối: với `docThamSo` một giá trị `--…` là CỜ — script phải nói cùng một lời (tests/deploy/khoi-tao-sh).
    [bo({ pb: `-${"a".repeat(31)}` }), /VersionId/u],
    [bo({ pb: `--${"a".repeat(30)}` }), /cần một giá trị/u],
    [["tao", "--ban-khai-tep", "a", "--phien-ban", PB], /chỉ đi với --ban-khai-secret/u],
    [["tao", "--ban-khai-tep", "a", "--to-chuc", "thep-viet"], /đi đủ ba/u],
    [["tao", "--ban-khai-tep", "a", "--so-nguoi", "1", "--vai", "BUYER=1"], /đi đủ ba/u],
    [["tao", "--ban-khai-tep", "a", "--ban-khai-tep", "b"], /khai hai lần/u],
    [["tao", "--ban-khai-tep", "a", "--so-nguoi", "1", "--so-nguoi", "1"], /khai hai lần/u],
    // tổ chức: slug khi tạo, UUIDv4 chữ thường khi thêm người — không lẫn.
    // (Một UUID chữ thường LÀ một slug hợp lệ về cú pháp — nên không có ca "UUID ở lệnh tao".)
    [bo({ toChuc: "thep_viet" }), /slug của tổ chức mới/u],
    [bo({ toChuc: "Thep-Viet" }), /slug của tổ chức mới/u],
    [bo({ toChuc: "ab" }), /slug của tổ chức mới/u],
    [bo({ toChuc: "-thep" }), /slug của tổ chức mới/u],
    [bo({ lenh: "them-nguoi", toChuc: "thep-viet" }), /UUIDv4 chữ thường/u],
    [bo({ lenh: "them-nguoi", toChuc: ORG.toUpperCase() }), /UUIDv4 chữ thường/u],
    // số người 1–50.
    [bo({ soNguoi: "0" }), /--so-nguoi/u],
    [bo({ soNguoi: String(TRAN_SO_NGUOI + 1), vai: "BUYER=51" }), /--so-nguoi/u],
    [bo({ soNguoi: "01" }), /--so-nguoi/u],
    [bo({ soNguoi: "1.5" }), /--so-nguoi/u],
    [bo({ soNguoi: "+1" }), /--so-nguoi/u],
    // vai: MA=n theo thứ tự MA_VAI, mỗi mã một lần, 1 ≤ n ≤ số người, tổng ≥ số người.
    [bo({ vai: "BUYER" }), /--vai: "BUYER" không phải MA=n/u],
    [bo({ vai: "KHACH=1" }), /--vai: "KHACH=1"/u],
    [bo({ vai: "buyer=1" }), /--vai: "buyer=1"/u],
    [bo({ vai: "BUYER=0" }), /--vai: "BUYER=0"/u],
    [bo({ vai: "BUYER=01" }), /--vai: "BUYER=01"/u],
    [bo({ vai: "BUYER=1," }), /--vai: ""/u],
    [bo({ vai: ",BUYER=1" }), /--vai: ""/u],
    [bo({ vai: "BUYER=1 " }), /--vai: "BUYER=1 "/u],
    [bo({ soNguoi: "2", vai: "DIRECTOR=1,BUYER=1" }), /thứ tự/u],
    [bo({ soNguoi: "2", vai: "BUYER=1,BUYER=1" }), /thứ tự/u],
    [bo({ vai: "BUYER=2" }), /không vượt --so-nguoi/u],
    [bo({ soNguoi: "3", vai: "BUYER=1,DIRECTOR=1" }), /tổng phải ít nhất bằng --so-nguoi/u],
  ])("%j ⇒ ThamSoError", (ds, mau) => {
    expect(() => docThamSo(ds)).toThrow(ThamSoError);
    expect(() => docThamSo(ds)).toThrow(mau);
  });
});

describe("[S1.9103] kiemKhop — bản khai ở phiên bản đã đọc khớp điều người duyệt thấy", () => {
  const bk = docBanKhai(tao([nguoi("a@congty.vn", ["BUYER"]), nguoi("b@congty.vn", ["PROCUREMENT_MANAGER", "TECHNICAL"])]), "tao");
  const them = docBanKhai(JSON.stringify({ cheDo: "them-nguoi", toChuc: { id: ORG }, nguoi: [nguoi("c@congty.vn")] }), "them-nguoi");

  it("vaiTheoMa: số người mang từng mã, theo thứ tự MA_VAI, bỏ mã không ai mang", () => {
    expect(vaiTheoMa(bk)).toBe("BUYER=1,TECHNICAL=1,PROCUREMENT_MANAGER=1");
    expect(vaiTheoMa(them)).toBe("BUYER=1");
  });

  it("khớp ⇒ không ném; tổ chức là slug khi tạo, mã khi thêm người", () => {
    expect(() => { kiemKhop(bk, { toChuc: "thep-viet", soNguoi: 2, vai: "BUYER=1,TECHNICAL=1,PROCUREMENT_MANAGER=1" }); }).not.toThrow();
    expect(() => { kiemKhop(them, { toChuc: ORG, soNguoi: 1, vai: "BUYER=1" }); }).not.toThrow();
  });

  it.each([
    [{ toChuc: "thep-nam", soNguoi: 2, vai: "BUYER=1,TECHNICAL=1,PROCUREMENT_MANAGER=1" }, 'tổ chức: bản khai "thep-viet", đã duyệt "thep-nam"'],
    [{ toChuc: "thep-viet", soNguoi: 3, vai: "BUYER=1,TECHNICAL=1,PROCUREMENT_MANAGER=1" }, "số người: bản khai 2, đã duyệt 3"],
    // [lượt soi] Cùng tổng cặp người–vai mà đổi mã: một REQUESTER thành DIRECTOR thì tổng không lệch — số theo mã thì lệch.
    [{ toChuc: "thep-viet", soNguoi: 2, vai: "BUYER=1,TECHNICAL=1,DIRECTOR=1" }, 'vai: bản khai "BUYER=1,TECHNICAL=1,PROCUREMENT_MANAGER=1", đã duyệt "BUYER=1,TECHNICAL=1,DIRECTOR=1"'],
    [{ toChuc: "x-y-z", soNguoi: 1, vai: "BUYER=1" }, 'tổ chức: bản khai "thep-viet", đã duyệt "x-y-z"; số người: bản khai 2, đã duyệt 1; vai: bản khai "BUYER=1,TECHNICAL=1,PROCUREMENT_MANAGER=1", đã duyệt "BUYER=1"'],
  ])("lệch %j ⇒ BanKhaiError nêu từng trường lệch", (kv, mau) => {
    expect(() => { kiemKhop(bk, kv); }).toThrow(new BanKhaiError(`bản khai không khớp điều đã duyệt — ${mau}`));
  });

  it("thêm người: mã tổ chức khác ⇒ lệch; thông điệp không mang email hay họ tên", () => {
    const khac = "9b2d0c1e-8f7a-4b6c-9d5e-3a2b1c0d9e8f";
    let loi: unknown;
    try { kiemKhop(them, { toChuc: khac, soNguoi: 1, vai: "BUYER=1" }); } catch (e) { loi = e; }
    expect(loi).toBeInstanceOf(BanKhaiError);
    expect((loi as Error).message).toBe(`bản khai không khớp điều đã duyệt — tổ chức: bản khai "${ORG}", đã duyệt "${khac}"`);
    expect((loi as Error).message).not.toMatch(/c@congty|Nguyễn/u);
  });

  it("[S1.9103] một BOM ở đầu (Notepad, PowerShell 5) không làm hỏng bản khai; hai BOM thì hỏng", () => {
    expect(docBanKhai(`﻿${tao()}`, "tao")).toMatchObject({ slug: "thep-viet" });
    expect(() => docBanKhai(`﻿﻿${tao()}`, "tao")).toThrow(new BanKhaiError("bản khai không phải JSON hợp lệ"));
  });
});
