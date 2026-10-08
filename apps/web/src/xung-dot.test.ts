// ==============================================================================================
// [S1.283 / S3.4b · K9] PHÉP ĐO CHO KHỐI KHAI BÁO XUNG ĐỘT LỢI ÍCH — PHẦN THUẦN VÀ LỜI KHAI BỘ ID
//
// Hành vi trên DOM (khối hiện ở tổ chức đã bật, bấm khai gửi gì, câu chỉ dẫn K9 ở nút bị chặn) đo ở `phuc-vu.test.ts`, trên hai trang
// thật chạy trong `node:vm`. Tệp này đo:
//   ⑴ khung của khối từ lời đọc của máy chủ — mỗi câu trả của chốt (`coi_chot_hanh_dong`) một trạng thái, `CO_XUNG_DOT` thắng mọi
//      bậc, tổ chức chưa bật ẩn;
//   ⑵ thân lời khai — `supplierId` chỉ đi với `CO_XUNG_DOT`, ghi chú rỗng bỏ trường, trần byte của CHECK `114`;
//   ⑶ danh sách nhà cung cấp lấy từ thứ trang đã đọc được (bảng lời mời, bảng so sánh) — mỗi nhà cung cấp một dòng;
//   ⑷ câu chỉ dẫn K9 BỔ SUNG câu của máy chủ, không nhắc lại nó;
//   ⑸ hai tệp HTML khai ĐỦ bộ id mà module gắn vào, đúng trạng thái ẩn lúc tải — DOM giả của `phuc-vu.test.ts` dựng phần tử thiếu
//      theo yêu cầu, nên một nút VẮNG trong HTML vẫn "bấm" được ở đó (khuôn `dang-nhap.test.ts`).
// ==============================================================================================

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ID_AN_KHAI_BAO,
  ID_KHAI_BAO,
  TRAN_GHI_CHU_BYTE,
  chiDanK9,
  docKhaiBaoCuaToi,
  khungKhaiBao,
  loiGhiChuKhai,
  nhaCungCapTuLoiMoi,
  gopNhaCungCap,
  nhaCungCapTuSoSanh,
  nhaCungCapTuXepHang,
  thanKhaiBao,
  type KhaiBaoCuaToiMan,
} from "./xung-dot.js";

const BAM = "a".repeat(64);
const BAM_CU = "b".repeat(64);
const khai = (trangThai: string, danhSachBam = BAM, supplierId: string | null = null) => ({
  trangThai,
  supplierId,
  ghiChu: null,
  danhSachBam,
  luc: "2026-10-08T01:00:00Z",
});
const loiDoc = (k: Partial<KhaiBaoCuaToiMan>): KhaiBaoCuaToiMan => ({
  khaiBao: [],
  danhSachBamHienTai: BAM,
  bacDoiKhai: true,
  chot: "K9_CHUA_KHAI_XUNG_DOT",
  toChucDaBat: true,
  ...k,
});
const ten = (id: string): string | null => (id === "n-1" ? "Công ty Thép" : null);

describe("[S1.283 / S3.4b · K9] khung của khối khai báo từ lời đọc của máy chủ", () => {
  it("tổ chức chưa bật, hay thân lạ ⇒ ẩn; chưa khai ⇒ CAN_KHAI, nút không xung đột hiện", () => {
    expect(khungKhaiBao(loiDoc({ toChucDaBat: false, chot: null, bacDoiKhai: false }), ten).loai).toBe("AN");
    expect(khungKhaiBao(null, ten).loai).toBe("AN");
    const k = khungKhaiBao(loiDoc({}), ten);
    expect([k.loai, k.choKhaiKhong]).toEqual(["CAN_KHAI", true]);
    expect(k.tomTat).toMatch(/bậc đòi khai báo/u);
  });

  it("đã khai mang băm hiện tại ⇒ QUA, nút ẩn; băm cũ ⇒ LOI_THOI, nút hiện; lịch sử nói danh sách đã đổi hay chưa", () => {
    const qua = khungKhaiBao(loiDoc({ chot: null, khaiBao: [khai("KHONG_XUNG_DOT")] }), ten);
    expect([qua.loai, qua.choKhaiKhong]).toEqual(["QUA", false]);
    expect(qua.lichSu[0]).toMatch(/danh sách chưa đổi/u);
    const cu = khungKhaiBao(loiDoc({ chot: "K9_KHAI_BAO_LOI_THOI", khaiBao: [khai("KHONG_XUNG_DOT", BAM_CU)] }), ten);
    expect([cu.loai, cu.choKhaiKhong]).toEqual(["LOI_THOI", true]);
    expect(cu.lichSu[0]).toMatch(/danh sách đã đổi từ đó/u);
    for (const d of [...qua.lichSu, ...cu.lichSu]) expect(d, "giờ cho người đọc, không chuỗi ISO").not.toMatch(/T\d\d:\d\d:\d\dZ/u);
  });

  it("bậc không đòi khai ⇒ KHONG_DOI — vẫn mời khai «có xung đột»; nút không xung đột hiện khi chưa có lời khai hiệu lực", () => {
    const k = khungKhaiBao(loiDoc({ chot: null, bacDoiKhai: false }), ten);
    expect([k.loai, k.choKhaiKhong]).toEqual(["KHONG_DOI", true]);
    expect(k.tomTat).toMatch(/có xung đột/u);
    expect(khungKhaiBao(loiDoc({ chot: null, bacDoiKhai: false, khaiBao: [khai("KHONG_XUNG_DOT")] }), ten).choKhaiKhong).toBe(false);
  });

  it("đã khai CÓ xung đột ⇒ CO_XUNG_DOT ở MỌI bậc, gọi tên nhà cung cấp khi trang biết, nút không xung đột ẩn", () => {
    for (const bacDoiKhai of [true, false]) {
      const k = khungKhaiBao(loiDoc({ bacDoiKhai, chot: "K9_CO_XUNG_DOT", khaiBao: [khai("KHONG_XUNG_DOT"), khai("CO_XUNG_DOT", BAM, "n-1")] }), ten);
      expect([k.loai, k.choKhaiKhong]).toEqual(["CO_XUNG_DOT", false]);
      expect(k.tomTat).toMatch(/Công ty Thép/u);
      expect(k.tomTat).toMatch(/vĩnh viễn/u);
    }
    expect(khungKhaiBao(loiDoc({ chot: "K9_CO_XUNG_DOT", khaiBao: [khai("CO_XUNG_DOT", BAM, "n-9")] }), ten).tomTat).toMatch(/một nhà cung cấp của gói/u);
  });

  it("đọc thân `{ khaiBao: … }` của route; thiếu `toChucDaBat` hay `bacDoiKhai` ⇒ null (thân cũ không hiện khối)", () => {
    const than = { khaiBao: { rfqId: "r-1", khaiBao: [khai("KHONG_XUNG_DOT")], danhSachBamHienTai: BAM, bacDoiKhai: true, chot: null, toChucDaBat: true } };
    expect(docKhaiBaoCuaToi(than)?.khaiBao).toHaveLength(1);
    expect(docKhaiBaoCuaToi({ khaiBao: { khaiBao: [], bacDoiKhai: true, chot: null } })).toBeNull();
    expect(docKhaiBaoCuaToi({ khaiBao: { khaiBao: [{}], bacDoiKhai: true, chot: null, toChucDaBat: true } })).toBeNull();
    expect(docKhaiBaoCuaToi(null)).toBeNull();
  });
});

describe("[S1.283 / S3.4b · K9] thân lời khai", () => {
  it("`supplierId` chỉ đi với CO_XUNG_DOT; ghi chú cắt, rỗng thì bỏ trường", () => {
    expect(thanKhaiBao("KHONG_XUNG_DOT", "n-1", "   ")).toEqual({ trangThai: "KHONG_XUNG_DOT" });
    expect(thanKhaiBao("KHONG_XUNG_DOT", null, "  khong quen ai  ")).toEqual({ trangThai: "KHONG_XUNG_DOT", ghiChu: "khong quen ai" });
    expect(thanKhaiBao("CO_XUNG_DOT", "n-1", "")).toEqual({ trangThai: "CO_XUNG_DOT", supplierId: "n-1" });
  });

  it("trần ghi chú đo bằng BYTE UTF-8 sau khi cắt — cùng CHECK `coi_declarations_ghi_chu_check`", () => {
    expect(TRAN_GHI_CHU_BYTE).toBe(2000);
    expect(loiGhiChuKhai(`  ${"a".repeat(2000)}  `)).toBeNull();
    expect(loiGhiChuKhai("a".repeat(2001))).toMatch(/2000 byte/u);
    expect(loiGhiChuKhai("ệ".repeat(667)), "667 ký tự ba byte là 2001 byte").toMatch(/2000 byte/u);
  });

  it("CHECK của `114` khai đúng con số ấy — đọc VĂN BẢN migration, không import (khuôn `dang-nhap.test.ts` ⑶)", () => {
    const sql = readFileSync(new URL("../../../db/migrations/114_khai_bao_xung_dot.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/octet_length\(ghi_chu\) <= 2000\)/u);
  });
});

describe("[S1.283 / S3.4b · K9] danh sách nhà cung cấp — từ thứ trang đã được phép đọc", () => {
  it("bảng lời mời: mỗi nhà cung cấp một dòng; còn sống nếu còn một lời mời chưa thu hồi; dòng thiếu id bỏ", () => {
    const ds = nhaCungCapTuLoiMoi([
      { supplierId: "n-1", supplierName: "Công ty Thép", revokedAt: "2026-10-01T00:00:00Z" },
      { supplierId: "n-1", supplierName: "Công ty Thép", revokedAt: null },
      { supplierId: "n-2", supplierName: "Công ty Xi măng", revokedAt: "2026-10-01T00:00:00Z" },
      { supplierName: "không id" },
    ]);
    expect(ds).toEqual([
      { supplierId: "n-1", ten: "Công ty Thép", conSong: true },
      { supplierId: "n-2", ten: "Công ty Xi măng", conSong: false },
    ]);
    expect(nhaCungCapTuLoiMoi(undefined)).toEqual([]);
  });

  it("bảng so sánh: hai dòng BAFO của một nhà cung cấp là MỘT lựa chọn", () => {
    expect(
      nhaCungCapTuSoSanh([
        { supplierId: "n-1", supplierLegalName: "Công ty Thép" },
        { supplierId: "n-1", supplierLegalName: "Công ty Thép" },
        { supplierId: "n-2", supplierLegalName: "Công ty Xi măng" },
      ]).map((n) => n.supplierId),
    ).toEqual(["n-1", "n-2"]);
    expect(nhaCungCapTuSoSanh(undefined)).toEqual([]);
  });

  it("[lượt đi thử T4] bảng xếp hạng — ở AWARDED bảng so sánh đã đóng; gộp hai nguồn mỗi nhà cung cấp một lần", () => {
    const xh = nhaCungCapTuXepHang([
      { supplierId: "n-2", supplierName: "Công ty Xi măng", rank: 1 },
      { supplierId: "n-1", supplierName: "Công ty Thép", rank: 2 },
      { supplierName: "thiếu mã", rank: 3 },
    ]);
    expect(xh.map((n) => [n.supplierId, n.ten])).toEqual([["n-2", "Công ty Xi măng"], ["n-1", "Công ty Thép"]]);
    const gop = gopNhaCungCap(nhaCungCapTuSoSanh([{ supplierId: "n-1", supplierLegalName: "Công ty Thép" }]), xh);
    expect(gop.map((n) => n.supplierId)).toEqual(["n-1", "n-2"]);
    expect(nhaCungCapTuXepHang(null)).toEqual([]);
  });
});

describe("[S1.283 / S3.4b · K9] câu chỉ dẫn K9 BỔ SUNG câu của máy chủ", () => {
  it("bốn mã có câu; mã khác ⇒ null; câu không nhắc lại câu của `CHOT_VAO_SO`", () => {
    // Câu của máy chủ, đọc VĂN BẢN nguồn — một cạnh `apps/web` → gói máy chủ là cạnh depcruise phải bless.
    const bang = readFileSync(new URL("../../../packages/identity/src/chot-kiem-soat.ts", import.meta.url), "utf8");
    for (const ma of ["K9_CHUA_KHAI_XUNG_DOT", "K9_KHAI_BAO_LOI_THOI", "K9_CO_XUNG_DOT", "K9_CHU_KY_CO_XUNG_DOT"]) {
      const cau = chiDanK9(ma);
      expect(cau, ma).not.toBeNull();
      expect(bang.includes(cau!), `${ma}: câu chỉ dẫn không chép câu của máy chủ`).toBe(false);
    }
    expect(chiDanK9("K9_CHUA_KHAI_XUNG_DOT")).toMatch(/Khai báo xung đột lợi ích/u);
    expect(chiDanK9("K2_THIEU_CANH_TRANH")).toBeNull();
    expect(chiDanK9(undefined)).toBeNull();
  });
});

describe("[S1.283 / S3.4b · K9] hai trang khai ĐỦ bộ id mà khối khai báo gắn vào", () => {
  for (const trang of ["tao-thau", "mo-thau"] as const) {
    it(`${trang}.html: mỗi id của ID_KHAI_BAO đúng một lần; phần tử ẩn lúc tải đúng như khai; ô chọn và nút có xung đột nằm trong kb-co`, () => {
      const html = readFileSync(new URL(`../trang/${trang}.html`, import.meta.url), "utf8");
      for (const id of ID_KHAI_BAO) expect(html.split(`id="${id}"`).length - 1, `${trang}.html: id="${id}"`).toBe(1);
      for (const id of ID_KHAI_BAO) {
        const the = new RegExp(`<\\w+[^>]*\\sid="${id}"[^>]*>`, "u").exec(html)?.[0] ?? "";
        expect(/\shidden(?:\s|>)/u.test(the), `${trang}.html: #${id} ẩn lúc tải?`).toBe((ID_AN_KHAI_BAO as readonly string[]).includes(id));
      }
      const co = html.slice(html.indexOf('id="kb-co"'), html.indexOf('id="kb-khong-ds"'));
      for (const id of ["kb-ncc", "kb-xac-nhan", "nut-kb-co"]) expect(co, `${trang}.html: #${id} trong kb-co`).toContain(`id="${id}"`);
    });
  }
});
