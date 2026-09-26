import { describe, expect, it } from "vitest";
import { BANNER, dungBaoCaoJson, dungBaoCaoMarkdown, tongHop, type KetQuaChay } from "./bao-cao.js";
import type { KetQuaKichBan } from "./chay-kich-ban.js";

const LO = "chuoi-khong-duoc-lot-vao-bao-cao-mot-hai-ba";

function kichBan(ghiDe: Partial<KetQuaKichBan> = {}): KetQuaKichBan {
  return {
    ma: "SX-01",
    toChuc: "[GIẢ LẬP] Công ty A",
    ten: "Gói thử",
    minhHoa: ["một điều"],
    dungO: "AWARD_APPROVED",
    dat: true,
    loi: null,
    rfqId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    trangThaiGoi: "AWARDED",
    trangThaiTraoThau: "APPROVED",
    buoc: [
      { t: 10, loai: "LAM", ai: "A", viec: "tạo gói", mongDoi: "201", thucTe: "201", dat: true },
      { t: 20, loai: "CHAN", ai: "B", viec: "tự duyệt | có ống", mongDoi: "từ chối 422", thucTe: "422 D2", dat: true, batBien: "D2", vaoSo: false },
      { t: 30, loai: "KIEM", ai: "bộ giả lập", viec: "bảng so sánh", mongDoi: "khớp", thucTe: "4/4", dat: true },
    ],
    soLieu: {
      nganSach: "360000000.00",
      soLoiMoi: 4,
      soPhienBanNop: 4,
      soBienNhanDaKiem: 4,
      soBienNhanHopLe: 4,
      giaTrungThau: "338645000.00",
      nhaCungCapTrungThau: "[GL] NCC 1",
      boBangChungOk: true,
      thoiGianMs: 12_345,
    },
    demo: null,
    ...ghiDe,
  };
}

function ketQua(kb: readonly KetQuaKichBan[]): KetQuaChay {
  return {
    batDau: "2026-09-26T10:00:00.000Z",
    ketThuc: "2026-09-26T10:10:00.000Z",
    cheDo: "nhanh",
    phienBanMa: "abc1234",
    toChuc: [
      {
        ma: "SX",
        ten: "[GIẢ LẬP] Công ty A",
        nganh: "Sản xuất",
        orgId: "11111111-1111-4111-8111-111111111111",
        soNguoi: 7,
        soNhaCungCap: 6,
        nguongKep: "500000000.00",
        soKiemToan: [
          { action: "RFQ_CREATED", n: 5 },
          { action: "PERMISSION_DENIED", n: 3 },
        ],
        chuanBi: [{ viec: "gieo tổ chức", dat: true, thucTe: "ok" }],
      },
    ],
    kichBan: kb,
    coLap: [{ viec: "đọc chéo", mongDoi: "404", thucTe: "404", dat: true }],
    boQua: ["SX-06"],
  };
}

describe("báo cáo pilot giả lập", () => {
  it("⑴ dòng đầu là nhãn GIẢ LẬP, và mục giới hạn luôn có mặt", () => {
    const md = dungBaoCaoMarkdown(ketQua([kichBan()]));
    expect(md.split("\n")[0]).toBe(BANNER);
    expect(md).toContain("KHÔNG PHẢI PILOT");
    expect(md).toContain("## 7. Điều báo cáo này KHÔNG chứng minh");
    expect(md).toContain("không phải** một phép đo North Star");
    expect(dungBaoCaoJson(ketQua([kichBan()]))).toContain("GIA LAP");
  });

  it("⑵ token của lời mời để lại KHÔNG vào báo cáo Markdown lẫn JSON", () => {
    const kb = kichBan({
      dungO: "OPEN",
      trangThaiGoi: "OPEN",
      demo: {
        buocTiep: ["mở link"],
        loiMoiConLai: [{ ncc: "S4", tenNcc: "[GL] NCC 4", lienHe: "Người 4", soDienThoai: "0912340004", token: LO }],
      },
    });
    const md = dungBaoCaoMarkdown(ketQua([kb]));
    const js = dungBaoCaoJson(ketQua([kb]));
    expect(md).not.toContain(LO);
    expect(js).not.toContain(LO);
    expect(md).toContain("[GL] NCC 4");
    expect(md).toContain("lien-ket");
  });

  it("tổng hợp đếm đúng và chỉ cộng giá trị của trao thầu ĐÃ DUYỆT", () => {
    const th = tongHop(ketQua([kichBan(), kichBan({ ma: "XD-04", trangThaiTraoThau: "PROPOSED", dungO: "AWARD_PROPOSED" })]));
    expect(th.soKichBan).toBe(2);
    expect(th.soDat).toBe(2);
    expect(th.soChan).toBe(2);
    expect(th.soChanDat).toBe(2);
    expect(th.giaTriTraoThau).toBe("338645000.00");
    expect(th.nganSachTraoThau).toBe("360000000.00");
  });

  it("một kịch bản KHÔNG ĐẠT làm đổi dòng kết luận và hiện lý do", () => {
    const md = dungBaoCaoMarkdown(ketQua([kichBan({ dat: false, loi: "KIỂM SOÁT KHÔNG BẬT — thử" })]));
    expect(md).toContain("CÓ kịch bản hoặc phép kiểm KHÔNG ĐẠT");
    expect(md).toContain("KIỂM SOÁT KHÔNG BẬT — thử");
  });

  it("lần từ chối KHÔNG vào sổ được nói ra, không bị gộp vào 'chặn đúng'", () => {
    const md = dungBaoCaoMarkdown(ketQua([kichBan()]));
    expect(md).toContain("| Trong đó: lần từ chối để lại hàng sổ kiểm toán | 0/1");
    expect(md).toMatch(/\| D2 \| chặn đúng \| \*\*không\*\* \|/u);
  });

  it("ô bảng không vỡ vì ký tự `|` trong nội dung", () => {
    const md = dungBaoCaoMarkdown(ketQua([kichBan()]));
    expect(md).toContain("tự duyệt \\| có ống");
  });
});
