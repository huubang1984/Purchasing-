// ==============================================================================================
// tools/pilot-gia-lap — BỘ CHẠY DUY NHẤT CỦA DANH MỤC KỊCH BẢN
//
// Một kịch bản (`kich-ban.ts`) được chạy như MỘT chuỗi bước HTTP, mỗi bước thuộc một trong ba loại:
//   LAM  — một việc người dùng làm, và mã trạng thái mong đợi là thành công;
//   CHAN — một lần thử SAI có chủ đích, và mã trạng thái mong đợi là một lần TỪ CHỐI;
//   KIEM — một phép so của bộ giả lập trên dữ liệu sản phẩm trả về (bảng so sánh khớp giá đã niêm
//          phong tới từng chữ số, thứ hạng, số thông báo gia hạn, chữ ký biên nhận, bộ bằng chứng).
// Bước nào lệch mong đợi thì kịch bản DỪNG ở đó và mang dấu KHÔNG ĐẠT — một lượt thử sai mà KHÔNG bị
// chặn là phát hiện nặng nhất một lượt giả lập có thể tìm ra, và nó không được trôi qua trong im lặng.
// ==============================================================================================

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sealBid } from "@trustprocure/sealed-envelope";
import { NguoiMua, PhienKhach } from "./dien-vien.js";
import type { DemHanhDong } from "./csdl.js";
import { coQuyen, hoSo, type HoSoToChuc, type NguoiHoSo } from "./ho-so.js";
import type { HopThu } from "./hop-thu.js";
import { tokenTuLink } from "./hop-thu.js";
import { lay, layChuoi, layMang, laySo, type PhanHoi } from "./http.js";
import { canHaiChuKy, giaChao, giaVongMot, xepHang, type BaoGia, type DungO, type KichBan } from "./kich-ban.js";
import { kiemBienNhan, kiemBoBangChung } from "./kiem-doc-lap.js";

export type LoaiBuoc = "LAM" | "CHAN" | "KIEM";

export interface BuocKetQua {
  /** Mili-giây từ đầu kịch bản. */
  readonly t: number;
  readonly loai: LoaiBuoc;
  readonly ai: string;
  readonly viec: string;
  readonly mongDoi: string;
  readonly thucTe: string;
  readonly dat: boolean;
  /** Mã bất biến hay ràng buộc mà lần CHAN đo (D2, J3, A4, …) — chỉ để đọc báo cáo. */
  readonly batBien?: string;
  /**
   * Chỉ cho CHAN: lần từ chối có để lại ít nhất một hàng sổ kiểm toán của tổ chức không — đo bằng
   * số hàng TRƯỚC và SAU lần thử. Đây là phép ĐO, không phải phép kiểm đạt/không đạt: luật ghi sổ
   * từ chối của dự án là CHỌN LỌC (ADR-060), nên "không vào sổ" có thể đúng thiết kế — báo cáo nói ra
   * nó để người đọc đối chiếu với lời khai của từng ràng buộc.
   */
  readonly vaoSo?: boolean;
}

export interface LoiMoiConLai {
  readonly ncc: string;
  readonly tenNcc: string;
  readonly lienHe: string;
  readonly soDienThoai: string;
  /** Token dạng rõ — CHỈ đi vào `trang-thai.json` (0600), không bao giờ vào báo cáo. */
  readonly token: string;
}

export interface KetQuaKichBan {
  readonly ma: string;
  readonly toChuc: string;
  readonly ten: string;
  readonly minhHoa: readonly string[];
  readonly dungO: DungO;
  readonly dat: boolean;
  readonly loi: string | null;
  readonly rfqId: string | null;
  readonly trangThaiGoi: string | null;
  readonly trangThaiTraoThau: string | null;
  readonly buoc: readonly BuocKetQua[];
  readonly soLieu: {
    readonly nganSach: string;
    readonly soLoiMoi: number;
    readonly soPhienBanNop: number;
    readonly soBienNhanDaKiem: number;
    readonly soBienNhanHopLe: number;
    readonly giaTrungThau: string | null;
    readonly nhaCungCapTrungThau: string | null;
    readonly boBangChungOk: boolean | null;
    readonly thoiGianMs: number;
  };
  readonly demo: { readonly buocTiep: readonly string[]; readonly loiMoiConLai: readonly LoiMoiConLai[] } | null;
}

export interface NhaCungCapChay {
  readonly supplierId: string;
  readonly tenPhapLy: string;
  readonly lienHe: ReadonlyMap<string, { readonly contactId: string; readonly email: string; readonly soDienThoai: string; readonly hoTen: string }>;
}

export interface ToChucChay {
  readonly hs: HoSoToChuc;
  readonly orgId: string;
  readonly nguoi: ReadonlyMap<string, NguoiMua>;
  readonly ncc: ReadonlyMap<string, NhaCungCapChay>;
}

export interface BoiCanhChay {
  readonly apiGoc: string;
  readonly webGoc: string;
  readonly hopThu: HopThu;
  readonly maLuot: number;
  readonly khoaBienNhan: ReadonlyMap<string, Uint8Array>;
  readonly thuMucBangChung: string;
  /** Cấp một địa chỉ giả lập mới cho một "thiết bị" mới. */
  diaChiMoi(): string;
  /** Ghi một dòng tiến độ ra stderr. */
  bao(dong: string): void;
  /** Tổng số hàng sổ kiểm toán hiện có của một tổ chức (kết nối đặc quyền, chỉ đọc). */
  demSoKiemToan(orgId: string): Promise<number>;
  /** Số hàng sổ theo từng hành động của một tổ chức (kết nối đặc quyền, chỉ đọc). */
  demSoKiemToanTheoHanhDong(orgId: string): Promise<readonly DemHanhDong[]>;
}

class BuocHong extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuocHong";
  }
}

const HAI_PHUT = 2 * 60_000;

function catNgan(s: string, n = 240): string {
  const mot = s.replace(/\s+/gu, " ").trim();
  return mot.length > n ? `${mot.slice(0, n)}…` : mot;
}

interface LoiMoiChay {
  readonly ncc: string;
  readonly invitationId: string;
  readonly token: string;
  readonly lienHe: { readonly contactId: string; readonly email: string; readonly soDienThoai: string; readonly hoTen: string };
  phien: PhienKhach | null;
}

/**
 * Chỗ nối của kịch bản CHẬM với phần còn lại của lượt chạy: nó báo khi bắt đầu đợi hạn nộp thật, và
 * chỉ đi tiếp sau hạn khi `choDiTiep` xong — để hai phần có ghi sổ của nó không bao giờ chồng lên các
 * kịch bản nhanh cùng tổ chức (xem `index.ts`).
 */
export interface DongBoCham {
  baoDangDoi(): void;
  readonly choDiTiep: Promise<void>;
}

/** Chạy MỘT kịch bản. Không bao giờ ném: mọi lỗi đi vào `KetQuaKichBan.loi`. */
export async function chayKichBan(kb: KichBan, tc: ToChucChay, bc: BoiCanhChay, cheDoCham: boolean, dongBo?: DongBoCham): Promise<KetQuaKichBan> {
  const batDau = Date.now();
  const buoc: BuocKetQua[] = [];
  const hs = hoSo(kb.toChuc);
  let rfqId: string | null = null;
  let trangThaiTraoThau: string | null = null;
  let giaTrungThau: string | null = null;
  let nhaCungCapTrungThau: string | null = null;
  let boBangChungOk: boolean | null = null;
  let soPhienBanNop = 0;
  let soBienNhanDaKiem = 0;
  let soBienNhanHopLe = 0;
  let demo: KetQuaKichBan["demo"] = null;
  const loiMoi = new Map<string, LoiMoiChay>();
  /** Giá có hiệu lực mới nhất của từng nhà cung cấp — thứ bảng so sánh phải khớp. */
  const giaHieuLuc = new Map<string, string>();
  /** Hệ số của phiên bản cuối — để tính giá BAFO. */
  const heSoCuoi = new Map<string, number>();
  /** Giá của MỌI phiên bản đã nộp, theo thứ tự — để biết bao nhiêu bản cũ phải còn niêm phong sau mở thầu. */
  const giaCacBan = new Map<string, string[]>();
  /** Khoá công khai ECDH_P256 của gói, như một nhà cung cấp đã đọc nó lúc gói còn mở. */
  let khoaDaBiet: Uint8Array | null = null;

  const ghi = (b: Omit<BuocKetQua, "t">): void => {
    buoc.push({ t: Date.now() - batDau, ...b });
  };
  const nguoi = (ma: string | undefined): NguoiMua => {
    const n = ma === undefined ? undefined : tc.nguoi.get(ma);
    if (n === undefined) throw new BuocHong(`không có người "${String(ma)}" trong tổ chức ${tc.hs.ma}`);
    return n;
  };
  const tenNcc = (ma: string): string => tc.ncc.get(ma)?.tenPhapLy ?? ma;
  const nccTheoTen = new Map([...tc.ncc.entries()].map(([ma, n]) => [n.tenPhapLy, ma]));

  /** Một việc phải thành công với đúng `mong`. */
  const lam = async (ai: NguoiMua | string, viec: string, goi: () => Promise<PhanHoi>, mong: number): Promise<PhanHoi> => {
    const r = await goi();
    const dat = r.status === mong;
    ghi({ loai: "LAM", ai: typeof ai === "string" ? ai : ai.nhan, viec, mongDoi: String(mong), thucTe: dat ? String(r.status) : `${r.status} ${catNgan(r.text)}`, dat });
    if (!dat) throw new BuocHong(`${viec}: mong ${mong}, nhận ${r.status}`);
    return r;
  };
  const demHanhDong = async (action: string): Promise<number> =>
    (await bc.demSoKiemToanTheoHanhDong(tc.orgId)).find((d) => d.action === action)?.n ?? 0;
  /**
   * Một lần thử sai phải bị TỪ CHỐI bằng một trong `mong`. `batBien` gọi tên LỚP đã chặn theo mã thật:
   * 403 là cổng quyền (vai không giữ mã quyền), 422 là ràng buộc nghiệp vụ (D2, J3, A4, …) — hai lớp
   * khác nhau, và báo cáo không được gán lần chặn của lớp này cho lớp kia. `hanhDongSo`: hành động sổ
   * mà sản phẩm KHAI sẽ ghi cho lần từ chối này — có thì thiếu đúng một hàng ấy là KHÔNG ĐẠT, không
   * còn là một phép đo (một lần soi ở vòng này: SX-06 khai `BID_DEADLINE_DENIED` mà không kiểm nó).
   */
  const chan = async (
    ai: NguoiMua | string,
    viec: string,
    goi: () => Promise<PhanHoi>,
    mong: readonly number[],
    batBien: string | ((status: number) => string),
    hanhDongSo?: string,
  ): Promise<void> => {
    const truoc = await bc.demSoKiemToan(tc.orgId);
    const truocHd = hanhDongSo === undefined ? 0 : await demHanhDong(hanhDongSo);
    const r = await goi();
    const vaoSo = (await bc.demSoKiemToan(tc.orgId)) > truoc;
    const themHd = hanhDongSo === undefined ? 0 : (await demHanhDong(hanhDongSo)) - truocHd;
    const tuChoi = mong.includes(r.status);
    const dat = tuChoi && (hanhDongSo === undefined || themHd === 1);
    const nhan = typeof batBien === "string" ? batBien : batBien(r.status);
    const soKhai = hanhDongSo === undefined ? "" : ` + 1 hàng ${hanhDongSo}`;
    const soThay = hanhDongSo === undefined ? "" : ` · +${themHd} ${hanhDongSo}`;
    ghi({ loai: "CHAN", ai: typeof ai === "string" ? ai : ai.nhan, viec, mongDoi: `từ chối ${mong.join("/")}${soKhai}`, thucTe: `${r.status} ${catNgan(r.text, 160)}${soThay}`, dat, batBien: nhan, vaoSo });
    if (!tuChoi) throw new BuocHong(`KIỂM SOÁT KHÔNG BẬT — ${viec}: mong từ chối ${mong.join("/")}, nhận ${r.status}`);
    if (!dat) throw new BuocHong(`LỜI KHAI SỔ KHÔNG ĐÚNG — ${viec}: mong 1 hàng ${String(hanhDongSo)}, có ${themHd}`);
  };
  const kiem = (viec: string, dat: boolean, thucTe: string, mongDoi = "khớp"): void => {
    ghi({ loai: "KIEM", ai: "bộ giả lập", viec, mongDoi, thucTe, dat });
    if (!dat) throw new BuocHong(`${viec}: ${thucTe}`);
  };
  const docGoi = async (): Promise<string> => {
    const r = await nguoi(kb.vai.tao).http.goi("GET", `/rfqs/${String(rfqId)}`);
    return r.status === 200 ? layChuoi(r.body, "rfq", "status") : `(${r.status})`;
  };

  const aiNcc = (lm: LoiMoiChay): string => `${lm.lienHe.hoTen} — ${tenNcc(lm.ncc)}`;

  /** Mở phiên khách của một lời mời nếu chưa mở: link → OTP qua SMS → phiên. */
  const moPhien = async (lm: LoiMoiChay): Promise<PhienKhach> => {
    if (lm.phien !== null) return lm.phien;
    const p = new PhienKhach(tc.orgId, lm.token, lm.lienHe.soDienThoai, bc.apiGoc, bc.diaChiMoi());
    const t0 = Date.now();
    await p.mo(bc.hopThu);
    ghi({ loai: "LAM", ai: aiNcc(lm), viec: "mở link mời, nhận OTP qua SMS, vào phiên khách", mongDoi: "200", thucTe: `200 (${Date.now() - t0} ms)`, dat: true });
    lm.phien = p;
    return p;
  };

  /**
   * Niêm phong MỘT báo giá hợp lệ bằng khoá công khai của gói, đọc qua `/guest/rfq` như trang
   * `/nop-thau` đọc. `null` khi gói không còn khoá nào chưa thu hồi. Mọi lần thử SAI của danh mục
   * (nộp trễ, nộp ngoài top-N) cũng đi qua đây: một phong bì rác bị từ chối vì HÌNH DẠNG, và lần từ
   * chối ấy không đo được luật mà lần thử muốn đo.
   */
  const niemPhong = async (
    p: PhienKhach,
    heSo: number,
    dungKhoaDaBiet = false,
  ): Promise<{ readonly b64: string; readonly byte: number; readonly tong: string } | null> => {
    const g = await p.http.goi("GET", "/guest/rfq");
    if (g.status !== 200) throw new BuocHong(`GET /guest/rfq ${g.status}`);
    const khoa = layMang(g.body, "publicKeys").find((k) => layChuoi(k, "algorithm") === "ECDH_P256");
    // `dungKhoaDaBiet`: nhà cung cấp GIỮ khoá công khai đã đọc từ trước — đúng thứ một trình duyệt
    // còn mở tab làm được — nên lần thử nộp sau khi gói huỷ không bị chặn "hộ" bởi việc thu hồi khoá.
    const congKhai = khoa !== undefined ? new Uint8Array(Buffer.from(layChuoi(khoa, "publicKey"), "base64")) : dungKhoaDaBiet ? khoaDaBiet : null;
    if (congKhai === null) return null;
    khoaDaBiet = congKhai;
    const gia = giaChao(hs, kb, heSo);
    const phongBi = await sealBid({
      rfqId: String(rfqId),
      algorithm: "ECDH_P256",
      recipientPublicKey: congKhai,
      plaintext: new TextEncoder().encode(JSON.stringify({ totalAmount: gia.totalAmount, currency: "VND", lines: gia.lines })),
    });
    return { b64: Buffer.from(phongBi).toString("base64"), byte: phongBi.byteLength, tong: gia.totalAmount };
  };

  /** Niêm phong và nộp; kiểm biên nhận bằng khoá công khai lấy từ tiến trình công bố khoá. */
  const nop = async (lm: LoiMoiChay, heSo: number, viec: string, mongPhienBan: number | null): Promise<void> => {
    const phien = await moPhien(lm);
    const pb = await niemPhong(phien, heSo);
    if (pb === null) throw new BuocHong("gói thầu không có khoá ECDH_P256 chưa thu hồi");
    const r = await lam(aiNcc(lm), `${viec} (niêm phong ở phía nhà cung cấp, phong bì ${pb.byte} byte)`, () =>
      phien.http.goi("POST", "/guest/bids", { envelope: pb.b64 }), 201);
    soPhienBanNop += 1;
    const phienBan = laySo(r.body, "receipt", "version");
    if (mongPhienBan !== null) kiem(`phiên bản báo giá của ${tenNcc(lm.ncc)}`, phienBan === mongPhienBan, `v${phienBan}`, `v${mongPhienBan}`);
    const hopLe = await kiemBienNhan(bc.khoaBienNhan, layChuoi(r.body, "receipt", "canonicalText"), layChuoi(r.body, "receipt", "signature"));
    soBienNhanDaKiem += 1;
    if (hopLe) soBienNhanHopLe += 1;
    kiem(`biên nhận v${phienBan} của ${tenNcc(lm.ncc)} kiểm bằng khoá công khai`, hopLe, hopLe ? "chữ ký ECDSA P-256 hợp lệ" : "chữ ký KHÔNG hợp lệ", "hợp lệ");
    giaHieuLuc.set(lm.ncc, pb.tong);
    heSoCuoi.set(lm.ncc, heSo);
    giaCacBan.set(lm.ncc, [...(giaCacBan.get(lm.ncc) ?? []), pb.tong]);
  };

  const nopTheoBaoGia = async (bg: BaoGia): Promise<void> => {
    const lm = loiMoi.get(bg.ncc);
    if (lm === undefined) throw new BuocHong(`${bg.ncc} chưa được mời`);
    await nop(lm, bg.heSo, "nộp báo giá niêm phong", 1);
    for (const [i, heSo] of (bg.suaLai ?? []).entries()) await nop(lm, heSo, `sửa giá trước hạn`, i + 2);
  };

  /** Mời một nhà cung cấp; đọc link từ hộp thư. */
  const moiNcc = async (ncc: string, maLienHe: string | undefined): Promise<LoiMoiChay> => {
    const n = tc.ncc.get(ncc);
    if (n === undefined) throw new BuocHong(`không có nhà cung cấp ${ncc}`);
    const lh = maLienHe === undefined ? [...n.lienHe.values()][0] : n.lienHe.get(maLienHe);
    if (lh === undefined) throw new BuocHong(`${ncc} không có liên hệ ${String(maLienHe)}`);
    const nm = nguoi(kb.vai.moi);
    const r = await lam(nm, `mời ${n.tenPhapLy} (người nhận: ${lh.hoTen})`, () =>
      nm.http.goi("POST", `/rfqs/${String(rfqId)}/invitations`, { supplierId: n.supplierId, contactId: lh.contactId, linkChannel: "EMAIL" }), 201);
    const invitationId = layChuoi(r.body, "invitation", "id");
    const tin = await bc.hopThu.cho(`link mời ${invitationId}`, (t) => t.loai === "INVITATION_LINK" && t.invitationId === invitationId);
    if (tin.loai !== "INVITATION_LINK") throw new BuocHong("tin sai loại");
    return { ncc, invitationId, token: tokenTuLink(tin.duongLink, tin.orgId), lienHe: lh, phien: null };
  };

  /** Xin mở thầu, duyệt, (tuỳ) điều phối và đợi worker. Trả về id yêu cầu. */
  const moThau = async (lan: 1 | 2, dung: boolean): Promise<string | null> => {
    const xin = nguoi(kb.vai.xinMo);
    const soChuKy = canHaiChuKy(hs, kb) ? 2 : 1;
    const r = await lam(xin, lan === 1 ? "xin mở thầu" : "xin mở thầu vòng BAFO", () =>
      xin.http.goi("POST", `/rfqs/${String(rfqId)}/unseal`, { reason: kb.lyDoMo ?? "Mở thầu" }), 201);
    const id = layChuoi(r.body, "unsealRequest", "id");
    const xem = await xin.http.goi("GET", `/unseal/${id}`);
    kiem("số chữ ký cần để mở thầu", laySo(xem.body, "unsealRequest", "requiredApprovals") === soChuKy, String(laySo(xem.body, "unsealRequest", "requiredApprovals")), String(soChuKy));
    if (lan === 1 && kb.kiem.tuDuyetMo === true) {
      await chan(xin, "người xin mở thầu tự phê duyệt yêu cầu của mình", () => xin.http.goi("POST", `/unseal/${id}/approve`), [403, 422],
        (st) => (st === 403 ? "quyền rfq.unseal.approve" : "D2/D3"));
    }
    for (const ma of kb.vai.duyetMo ?? []) {
      const d = nguoi(ma);
      await lam(d, "phê duyệt mở thầu", () => d.http.goi("POST", `/unseal/${id}/approve`), 200);
    }
    if (dung) {
      const x = await xin.http.goi("GET", `/unseal/${id}`);
      kiem("yêu cầu mở thầu đang chờ chữ ký còn lại", layChuoi(x.body, "unsealRequest", "status") === "PENDING",
        `${layChuoi(x.body, "unsealRequest", "status")} — ${laySo(x.body, "unsealRequest", "approvalCount")}/${soChuKy} chữ ký`, "PENDING");
      return id;
    }
    const dp = nguoi(kb.vai.dieuPhoi);
    if (await dp.damBaoMfaMoi(bc.hopThu)) ghi({ loai: "LAM", ai: dp.nhan, viec: "đăng nhập lại (TOTP) — điều phối đòi xác thực trong 15 phút", mongDoi: "200", thucTe: "200", dat: true });
    const d = await lam(dp, "điều phối mở thầu qua cổng bốn vế", () => dp.http.goi("POST", `/unseal/${id}/dispatch`), 200);
    const ve = layMang(d.body, "gate", "clauses").map(String).join(" + ");
    kiem("cổng bốn vế cho qua", ve === "PERMISSION + MFA_FRESH + RFQ_CLOSED + POLICY_GATE", ve);
    const dich = lan === 1 ? "UNSEALED" : "BAFO_UNSEALED";
    const han = Date.now() + 90_000;
    let tt = "";
    for (;;) {
      tt = await docGoi();
      if (tt === dich || Date.now() > han) break;
      await new Promise((xong) => setTimeout(xong, 500));
    }
    kiem(`worker giải mã xong (${dich})`, tt === dich, tt, dich);
    return id;
  };

  /** Bảng so sánh phải khớp TỪNG CHỮ SỐ với giá đã niêm phong. */
  const kiemBangSoSanh = async (nhan: string): Promise<void> => {
    const c = nguoi(kb.vai.cham);
    const r = await lam(c, `đọc bảng so sánh (${nhan})`, () => c.http.goi("GET", `/rfqs/${String(rfqId)}/comparison`), 200);
    const dong = layMang(r.body, "comparison", "rows").filter((h) => lay(h, "isLatestForBid") !== false);
    const thay = new Map(dong.map((h) => [nccTheoTen.get(layChuoi(h, "supplierLegalName")) ?? "?", layChuoi(h, "totalAmount")]));
    const lech = [...giaHieuLuc.entries()].filter(([ncc, g]) => thay.get(ncc) !== g).map(([ncc]) => ncc);
    kiem(`bảng so sánh khớp từng chữ số với giá đã niêm phong (${nhan})`, lech.length === 0 && thay.size === giaHieuLuc.size,
      lech.length === 0 && thay.size === giaHieuLuc.size ? `${thay.size}/${giaHieuLuc.size} dòng khớp` : `lệch: ${lech.join(", ")}; thấy ${thay.size} dòng`, `${giaHieuLuc.size}/${giaHieuLuc.size} dòng khớp`);
    const khongDoc = laySo(r.body, "comparison", "aggregates", "unparsed");
    kiem("không phong bì nào không đọc được", khongDoc === 0, String(khongDoc), "0");
    // Mở thầu chỉ giải mã bản CUỐI của mỗi luồng báo giá (`apps/unseal-worker`, `DISTINCT ON (bid_id)`);
    // mọi bản cũ vẫn niêm phong (B1). Một lần đo ở vòng này: bản đầu của phép kiểm này đòi bản cũ HIỆN
    // trong bảng so sánh, và 0/3 — sai giả định của bộ giả lập, không phải lỗi sản phẩm. Chỉ kiểm ở vòng
    // một: bảng sau BAFO cố ý giữ cả hai vòng.
    if (nhan === "vòng một") {
      const tatCa = layMang(r.body, "comparison", "rows");
      const dongCu = tatCa.filter((h) => lay(h, "isLatestForBid") === false).length;
      const soBanCu = [...giaCacBan.values()].reduce((t, ds) => t + ds.length - 1, 0);
      kiem(
        `mở thầu chỉ giải mã bản CUỐI của mỗi luồng báo giá${soBanCu > 0 ? ` — ${soBanCu} bản sửa giá trước đó vẫn niêm phong` : ""}`,
        dongCu === 0 && tatCa.length === giaHieuLuc.size,
        `${tatCa.length} dòng, ${dongCu} dòng của bản cũ`,
        `${giaHieuLuc.size} dòng, 0 dòng của bản cũ`,
      );
    }
  };

  /** Chấm, rồi kiểm hạng 1 là giá thấp nhất. Trả về các hàng xếp hạng. */
  const cham = async (nhan: string): Promise<readonly { readonly ncc: string; readonly bidVersionId: string; readonly rank: number; readonly cost: string }[]> => {
    const c = nguoi(kb.vai.cham);
    await lam(c, `chấm thầu theo tổng chi phí (${nhan})`, () => c.http.goi("POST", `/rfqs/${String(rfqId)}/evaluate`, {}), 201);
    const r = await lam(c, "đọc bảng xếp hạng", () => c.http.goi("GET", `/rfqs/${String(rfqId)}/ranking`), 200);
    const hang = layMang(r.body, "ranking", "rows")
      .filter((h) => typeof lay(h, "rank") === "number")
      .map((h) => ({
        ncc: nccTheoTen.get(layChuoi(h, "supplierName")) ?? "?",
        bidVersionId: layChuoi(h, "bidVersionId"),
        rank: laySo(h, "rank"),
        cost: layChuoi(h, "effectiveCost"),
      }))
      .sort((a, b) => a.rank - b.rank);
    const mong = xepHang(giaHieuLuc);
    kiem(`thứ hạng theo tổng chi phí (${nhan})`, hang.map((h) => h.ncc).join(">") === mong.join(">"), hang.map((h) => h.ncc).join(" > "), mong.join(" > "));
    return hang;
  };

  try {
    // ---- 1. Tạo gói ---------------------------------------------------------------------------
    const tao = nguoi(kb.vai.tao);
    const han = new Date(Date.now() + kb.goi.hanNopPhut * 60_000).toISOString();
    const rt = await lam(tao, `tạo gói "${kb.goi.tieuDe}"`, () => tao.http.goi("POST", "/rfqs", { title: kb.goi.tieuDe, deadlineAt: han }), 201);
    rfqId = layChuoi(rt.body, "rfq", "id");
    for (const [i, d] of kb.goi.hang.entries()) {
      const hh = hs.hangHoa.find((h) => h.ma === d.hang);
      if (hh === undefined) throw new BuocHong(`không có hàng hoá ${d.hang}`);
      await lam(tao, `thêm hạng mục ${i + 1}: ${hh.moTa} × ${d.soLuong.replace(/\.0+$/u, "")} ${hh.donVi}`, () =>
        tao.http.goi("POST", `/rfqs/${String(rfqId)}/items`, { lineNo: i + 1, description: hh.moTa, quantity: d.soLuong, unit: hh.donVi }), 201);
    }
    const ns = await lam(tao, `khai dự toán ${kb.goi.nganSach} VND`, () =>
      tao.http.goi("PUT", `/rfqs/${String(rfqId)}/budget`, { estimatedValue: kb.goi.nganSach, currency: "VND" }), 200);
    const kep = lay(ns.body, "budget", "requiresDualApproval") === true;
    kiem("phân loại phê duyệt theo ngưỡng chính sách", kep === canHaiChuKy(hs, kb), kep ? "cần HAI chữ ký" : "cần MỘT chữ ký", canHaiChuKy(hs, kb) ? "cần HAI chữ ký" : "cần MỘT chữ ký");
    await lam(tao, "nộp gói để duyệt", () => tao.http.goi("POST", `/rfqs/${String(rfqId)}/submit`), 200);
    if (kb.kiem.tuDuyetGoi === true) {
      await chan(tao, "người tạo gói tự phê duyệt gói của mình", () => tao.http.goi("POST", `/rfqs/${String(rfqId)}/approve`), [422], "D2");
    }
    for (const ma of kb.vai.duyetGoi) {
      const d = nguoi(ma);
      await lam(d, "phê duyệt gói trên nội dung hiện tại", () => d.http.goi("POST", `/rfqs/${String(rfqId)}/approve`), 200);
    }
    if (kb.dungO === "PENDING_APPROVAL") {
      const tt = await docGoi();
      kiem("gói đứng ở chờ duyệt", tt === "PENDING_APPROVAL", tt, "PENDING_APPROVAL");
      const conLai = hs.nguoi.find((n) => n.vai === "PROCUREMENT_MANAGER" && n.ma !== kb.vai.tao && !kb.vai.duyetGoi.includes(n.ma));
      demo = {
        buocTiep: [
          `Trước tiên, đăng nhập bằng ${moTaNguoi(tao.hoSo)} (người tạo gói) ở /tao-thau, ${NAP_GOI}, bước 4 bấm "Phê duyệt": sản phẩm từ chối — ${lopTuChoi(tao.hoSo, "rfq.approve", "D2")}.`,
          `Đăng nhập bằng ${moTaNguoi(conLai)}, ${NAP_GOI}, bước 4 bấm "Phê duyệt" — chữ ký thứ hai.`,
          `Đăng nhập bằng ${moTaNguoi(hs.nguoi.find((n) => n.ma === "tp"))}, bước 4 bấm "Mở thầu". Bước 5 chỉ mời được nhà cung cấp TẠO trong cùng phiên trang: ` +
            `tạo một nhà cung cấp mới (mã số thuế chưa dùng), thêm người liên hệ, rồi bấm "Mời nhà cung cấp này".`,
        ],
        loiMoiConLai: [],
      };
      return ketThuc(null);
    }

    // ---- 2. Mở gói, mời ---------------------------------------------------------------------------
    const mo = nguoi(kb.vai.mo);
    await lam(mo, "mở gói — cặp khoá niêm phong của gói ra đời ở máy chủ", () => mo.http.goi("POST", `/rfqs/${String(rfqId)}/open`), 200);
    if (kb.thuHoi !== undefined) {
      const sai = await moiNcc(kb.thuHoi.ncc, kb.thuHoi.lienHeSai);
      const nm = nguoi(kb.vai.moi);
      await lam(nm, `thu hồi lời mời gửi nhầm ${sai.lienHe.hoTen}`, () => nm.http.goi("POST", `/invitations/${sai.invitationId}/revoke`), 200);
      const thu = new PhienKhach(tc.orgId, sai.token, sai.lienHe.soDienThoai, bc.apiGoc, bc.diaChiMoi());
      await chan(`${sai.lienHe.hoTen} — ${tenNcc(sai.ncc)}`, "mở đường link đã bị thu hồi", () => thu.http.goi("POST", "/guest/redeem", { orgId: tc.orgId, token: sai.token }), [401, 403, 404, 410, 422], "E1");
    }
    for (const m of kb.moi) loiMoi.set(m.ncc, await moiNcc(m.ncc, m.lienHe));

    // ---- 3. Nộp báo giá ---------------------------------------------------------------------------
    for (const bg of kb.baoGia) if (bg.sauGiaHan !== true && bg.treHan !== true) await nopTheoBaoGia(bg);
    if (kb.kiem.muTruocMo === true) {
      const n = nguoi(kb.vai.dong ?? kb.vai.mo);
      const r = await n.http.goi("GET", `/rfqs/${String(rfqId)}/bid-count`);
      const lo = lay(r.body, "bidCount", "disclosed");
      kiem("trước khi đóng, SỐ báo giá đã nhận bị giấu với người mua", r.status === 200 && lo === false, r.status === 200 ? `disclosed=${String(lo)}` : String(r.status), "disclosed=false");
    }
    if (kb.giaHan !== undefined) {
      const gh = nguoi(kb.vai.giaHan);
      const cu = new Date((await gh.http.goi("GET", `/rfqs/${String(rfqId)}`).then((x) => layChuoi(x.body, "rfq", "deadlineAt")))).getTime();
      const moi = new Date(cu + kb.giaHan.themPhut * 60_000).toISOString();
      await lam(gh, `gia hạn hạn nộp thêm ${Math.round(kb.giaHan.themPhut / 60 / 24)} ngày — ${kb.giaHan.lyDo}`, () =>
        gh.http.goi("POST", `/rfqs/${String(rfqId)}/extend`, { newDeadlineAt: moi, reason: kb.giaHan?.lyDo }), 200);
      // Đếm theo TỪNG lời mời, không theo số tin: hai tin cho một lời mời và không tin nào cho lời mời
      // khác cũng cho đúng tổng — một lần soi ở vòng này bắt bản đầu chỉ so tổng.
      const ids = new Set([...loiMoi.values()].map((l) => l.invitationId));
      const hanCho = Date.now() + 15_000;
      let tin: readonly string[] = [];
      for (;;) {
        tin = (await bc.hopThu.xem((t) => t.loai === "DEADLINE_NOTICE" && t.orgId === tc.orgId && ids.has(t.invitationId))).map((t) =>
          t.loai === "DEADLINE_NOTICE" ? t.invitationId : "",
        );
        if (new Set(tin).size >= ids.size || Date.now() > hanCho) break;
        await new Promise((xong) => setTimeout(xong, 300));
      }
      const coTin = new Set(tin).size;
      kiem("mỗi nhà cung cấp được mời nhận đúng một thông báo hạn mới", coTin === ids.size && tin.length === ids.size,
        `${coTin}/${ids.size} lời mời có thông báo, ${tin.length} tin`, `${ids.size}/${ids.size} lời mời có thông báo, ${ids.size} tin`);
    }
    for (const bg of kb.baoGia) if (bg.sauGiaHan === true) await nopTheoBaoGia(bg);

    if (kb.dungO === "OPEN") {
      const conLai: LoiMoiConLai[] = [...loiMoi.values()]
        .filter((l) => !kb.baoGia.some((b) => b.ncc === l.ncc))
        .map((l) => ({ ncc: l.ncc, tenNcc: tenNcc(l.ncc), lienHe: l.lienHe.hoTen, soDienThoai: l.lienHe.soDienThoai, token: l.token }));
      demo = {
        buocTiep: [
          "Mở link mời của một nhà cung cấp còn lại (lệnh `lien-ket`) ở /nop-thau, bấm \"Mở lời mời\", rồi \"Gửi mã\"; lấy mã bằng lệnh `otp <số điện thoại>`, bấm \"Xác minh\".",
          "Nhập đơn giá, bấm \"Niêm phong và nộp\": giá được mã hoá TRONG trình duyệt; biên nhận ký số hiện ra.",
          `Đăng nhập bằng ${moTaNguoi(hs.nguoi.find((n) => n.ma === "tp"))} ở /mo-thau: số báo giá vẫn bị giấu cho tới khi đóng.`,
        ],
        loiMoiConLai: conLai,
      };
      return ketThuc(null);
    }

    if (kb.dungO === "CANCELLED") {
      const h = nguoi(kb.vai.huyGoi);
      await lam(h, `huỷ gói — ${kb.lyDoHuyGoi ?? ""}`, () => h.http.goi("POST", `/rfqs/${String(rfqId)}/cancel`, { reason: kb.lyDoHuyGoi }), 200);
      const tt = await docGoi();
      kiem("gói ở trạng thái huỷ", tt === "CANCELLED", tt, "CANCELLED");
      const sau = kb.kiem.nopSauHuy === undefined ? undefined : loiMoi.get(kb.kiem.nopSauHuy);
      if (sau !== undefined) {
        // Hai lớp, ghi riêng từng lớp: ⑴ gói huỷ thì khoá công khai của nó bị thu hồi — trang nộp
        // thầu không còn khoá để niêm phong; ⑵ một nhà cung cấp GIỮ khoá cũ (tab còn mở) niêm phong
        // bản sửa giá hợp lệ và nộp — lần nộp phải bị từ chối vì TRẠNG THÁI gói, không vì hình dạng.
        const p = await moPhien(sau);
        const g = await p.http.goi("GET", "/guest/rfq");
        const conKhoa = g.status === 200 ? layMang(g.body, "publicKeys").length : -1;
        kiem("gói đã huỷ không còn khoá công khai nào cho trang nộp thầu", conKhoa === 0, conKhoa < 0 ? `GET /guest/rfq ${g.status}` : `${conKhoa} khoá`, "0 khoá");
        const pb = await niemPhong(p, Math.round(((heSoCuoi.get(sau.ncc) ?? 1000) * 970) / 1000), true);
        if (pb === null) throw new BuocHong("không có khoá đã biết để thử nộp sau huỷ");
        await chan(aiNcc(sau), "sửa giá bằng phong bì niêm phong hợp lệ (khoá đọc từ trước) sau khi gói bị huỷ", () =>
          p.http.goi("POST", "/guest/bids", { envelope: pb.b64 }), [401, 403, 409, 422], "trạng thái gói");
      }
      return ketThuc(null);
    }

    // ---- 4. Đóng -------------------------------------------------------------------------------
    const dong = nguoi(kb.vai.dong);
    const treHan = kb.baoGia.find((b) => b.treHan === true);
    if (kb.cham === true && cheDoCham) {
      const hanNop = new Date(await dong.http.goi("GET", `/rfqs/${String(rfqId)}`).then((x) => layChuoi(x.body, "rfq", "deadlineAt"))).getTime();
      ghi({ loai: "LAM", ai: "bộ giả lập", viec: `đợi hạn nộp thật trôi qua (${new Date(hanNop).toISOString()})`, mongDoi: "—", thucTe: "đang đợi", dat: true });
      dongBo?.baoDangDoi();
      while (Date.now() < hanNop + 3000) {
        bc.bao(`[${kb.ma}] còn ${Math.ceil((hanNop + 3000 - Date.now()) / 60_000)} phút tới hạn nộp thật`);
        await new Promise((xong) => setTimeout(xong, Math.min(HAI_PHUT, Math.max(1000, hanNop + 3000 - Date.now()))));
      }
      await dongBo?.choDiTiep;
      if (treHan !== undefined) {
        const lm = loiMoi.get(treHan.ncc);
        if (lm === undefined) throw new BuocHong(`${treHan.ncc} chưa được mời`);
        const p = await moPhien(lm);
        const pb = await niemPhong(p, treHan.heSo);
        if (pb === null) throw new BuocHong("gói không còn khoá công khai để thử nộp trễ");
        await chan(aiNcc(lm), "nộp báo giá niêm phong hợp lệ SAU hạn nộp", () => p.http.goi("POST", "/guest/bids", { envelope: pb.b64 }), [422], "C1",
          "BID_DEADLINE_DENIED");
      }
      await lam(dong, "đóng gói sau hạn nộp", () => dong.http.goi("POST", `/rfqs/${String(rfqId)}/close`, { reason: kb.lyDoDong ?? "Đã quá hạn nộp" }), 200);
    } else {
      await lam(dong, `đóng sớm có lý do — ${kb.lyDoDong ?? ""}`, () => dong.http.goi("POST", `/rfqs/${String(rfqId)}/close`, { reason: kb.lyDoDong }), 200);
    }
    const bc2 = await dong.http.goi("GET", `/rfqs/${String(rfqId)}/bid-count`);
    const soNop = new Set(kb.baoGia.filter((b) => b.treHan !== true).map((b) => b.ncc)).size;
    kiem("sau khi đóng, số báo giá được công bố", lay(bc2.body, "bidCount", "disclosed") === true && lay(bc2.body, "bidCount", "count") === soNop,
      `disclosed=${String(lay(bc2.body, "bidCount", "disclosed"))}, count=${String(lay(bc2.body, "bidCount", "count"))}`, `disclosed=true, count=${soNop}`);
    if (kb.kiem.muTruocMo === true) {
      const c = nguoi(kb.vai.cham ?? kb.vai.dong);
      await chan(c, "đọc bảng so sánh khi gói đã đóng nhưng CHƯA mở thầu", () => c.http.goi("GET", `/rfqs/${String(rfqId)}/comparison`), [422], "A4");
    }

    // ---- 5. Mở thầu ----------------------------------------------------------------------------
    if (kb.dungO === "UNSEAL_PENDING") {
      await moThau(1, true);
      const conLai = hs.nguoi.find((n) => n.vai === "DIRECTOR" && !(kb.vai.duyetMo ?? []).includes(n.ma));
      demo = {
        buocTiep: [
          `Trước tiên, đăng nhập bằng ${moTaNguoi(nguoi(kb.vai.xinMo).hoSo)} (người xin mở thầu) ở /mo-thau, ${NAP_GOI}, bước 3 bấm "Phê duyệt": sản phẩm từ chối — ${lopTuChoi(nguoi(kb.vai.xinMo).hoSo, "rfq.unseal.approve", "D2/D3")}.`,
          `Đăng nhập bằng ${moTaNguoi(conLai)}, ${NAP_GOI}, bước 3 bấm "Phê duyệt" — chữ ký thứ hai.`,
          `Đăng nhập lại bằng người xin mở thầu, bước 3 bấm "Điều phối giải mã": worker giải mã; bước 4 bấm "Đọc bảng so sánh" — giá đúng tới từng đồng.`,
        ],
        loiMoiConLai: [],
      };
      return ketThuc(null);
    }
    await moThau(1, false);
    await kiemBangSoSanh("vòng một");
    if (kb.kiem.khongXem !== undefined) {
      const kx = nguoi(kb.kiem.khongXem);
      await chan(kx, "đọc bảng so sánh khi KHÔNG có quyền xem giá", () => kx.http.goi("GET", `/rfqs/${String(rfqId)}/comparison`), [403], "bid.view");
    }
    let hang = await cham("vòng một");

    // ---- 6. BAFO -------------------------------------------------------------------------------
    if (kb.bafo !== undefined) {
      const mb = nguoi(kb.vai.moBafo);
      const hanBafo = new Date(Date.now() + 2 * 24 * 60 * 60_000).toISOString();
      const r = await lam(mb, "mở vòng BAFO — danh sách mời suy từ thứ hạng", () => mb.http.goi("POST", `/rfqs/${String(rfqId)}/bafo`, { deadlineAt: hanBafo }), 201);
      const topN = laySo(r.body, "bafoRound", "topN");
      kiem("top-N của vòng BAFO theo chính sách", topN === hs.bafoTopN, String(topN), String(hs.bafoTopN));
      const top = hang.slice(0, topN);
      for (const [i, h] of top.entries()) {
        const lm = loiMoi.get(h.ncc);
        const heSoGoc = heSoCuoi.get(h.ncc);
        const heSoHang = kb.bafo.heSoTheoHang[i];
        if (lm === undefined || heSoGoc === undefined || heSoHang === undefined) throw new BuocHong(`BAFO thiếu dữ liệu cho ${h.ncc}`);
        await nop(lm, Math.round((heSoGoc * heSoHang) / 1000), `nộp giá BAFO (hạng ${i + 1})`, null);
      }
      const ngoai = hang[topN];
      const lmNgoai = ngoai === undefined ? undefined : loiMoi.get(ngoai.ncc);
      if (lmNgoai !== undefined) {
        const p = await moPhien(lmNgoai);
        const pb = await niemPhong(p, Math.round(((heSoCuoi.get(lmNgoai.ncc) ?? 1000) * 940) / 1000));
        if (pb === null) throw new BuocHong("vòng BAFO không có khoá công khai");
        await chan(aiNcc(lmNgoai), "nhà cung cấp NGOÀI top-N nộp báo giá niêm phong hợp lệ vào vòng BAFO", () =>
          p.http.goi("POST", "/guest/bids", { envelope: pb.b64 }), [422], "BAFO top-N");
      }
      await lam(mb, "đóng vòng BAFO", () => mb.http.goi("POST", `/rfqs/${String(rfqId)}/bafo/close`), 200);
      await moThau(2, false);
      await kiemBangSoSanh("sau BAFO");
      hang = await cham("sau BAFO");
    }

    // ---- 7. Trao thầu --------------------------------------------------------------------------
    const nhat = hang[0];
    if (nhat === undefined) throw new BuocHong("bảng xếp hạng rỗng");
    if (kb.kiem.j3 === true) {
      // Người tạo gói VÀ người điều phối mở thầu — mỗi người giữ `award.recommend` thử một lần.
      const cacNguoi = new Map<string, { readonly n: NguoiMua; readonly vai: string }>();
      for (const [ma, vai] of [[kb.vai.tao, "người tạo gói"], [kb.vai.dieuPhoi, "người điều phối mở thầu"]] as const) {
        const n = nguoi(ma);
        if (coQuyen(n.hoSo.vai, "award.recommend") && !cacNguoi.has(n.email)) cacNguoi.set(n.email, { n, vai });
        else if (cacNguoi.has(n.email)) cacNguoi.set(n.email, { n, vai: `${cacNguoi.get(n.email)?.vai ?? ""} kiêm ${vai}` });
      }
      for (const { n, vai } of cacNguoi.values()) {
        await chan(n, `${vai} tự đề xuất trao thầu`, () =>
          n.http.goi("POST", `/rfqs/${String(rfqId)}/award`, { bidVersionId: nhat.bidVersionId, reason: "Tu de xuat trao thau" }), [422], "J3");
      }
    }
    const dx = nguoi(kb.vai.deXuat);
    const rd = await lam(dx, `đề xuất trao thầu cho ${tenNcc(nhat.ncc)} — ${kb.lyDoDeXuat ?? ""}`, () =>
      dx.http.goi("POST", `/rfqs/${String(rfqId)}/award`, { bidVersionId: nhat.bidVersionId, reason: kb.lyDoDeXuat }), 201);
    let awardId = layChuoi(rd.body, "award", "awardId");
    let nguoiDeXuat = dx;
    let chon = nhat;
    trangThaiTraoThau = "PROPOSED";
    if (kb.huyTraoThau !== undefined) {
      const h = nguoi(kb.vai.huyTraoThau);
      // [S1.261 / khoản 335] Huỷ ĐÚNG đề xuất vừa ghi — route mang `awardId`.
      await lam(h, `huỷ đề xuất trao thầu — ${kb.huyTraoThau.lyDo}`, () =>
        h.http.goi("POST", `/rfqs/${String(rfqId)}/award/${awardId}/cancel`, { reason: kb.huyTraoThau?.lyDo }), 201);
      const tt = await docGoi();
      kiem("huỷ trao thầu đưa gói về đang chấm", tt === "EVALUATING", tt, "EVALUATING");
      const moi = hang[kb.huyTraoThau.hangMoi - 1];
      if (moi === undefined) throw new BuocHong("không có hạng để trao lại");
      const lai = nguoi(kb.vai.deXuatLai);
      const r2 = await lam(lai, `đề xuất trao thầu lại cho hạng ${kb.huyTraoThau.hangMoi}: ${tenNcc(moi.ncc)} — ${kb.huyTraoThau.lyDoDeXuatLai}`, () =>
        lai.http.goi("POST", `/rfqs/${String(rfqId)}/award`, { bidVersionId: moi.bidVersionId, reason: kb.huyTraoThau?.lyDoDeXuatLai }), 201);
      awardId = layChuoi(r2.body, "award", "awardId");
      nguoiDeXuat = lai;
      chon = moi;
    }
    giaTrungThau = chon.cost;
    nhaCungCapTrungThau = tenNcc(chon.ncc);
    // [S1.9101 / S3.6c / K10c] Mọi kịch bản đóng gói SỚM khi đã có báo giá; ở tổ chức đã bật S3 chữ ký trao thầu đòi một người giữ
    // `po.approve` NGOÀI gói (không tạo, không đóng) ghi nhận tín hiệu đóng sớm trước. Tổ chức chưa bật: 422 nghiệp vụ, bỏ qua.
    {
      const nd = hs.nguoi.find((n) => coQuyen(n.vai, "po.approve") && n.ma !== kb.vai.dong && n.ma !== kb.vai.tao);
      if (nd !== undefined) {
        const ai = nguoi(nd.ma);
        const gn = await ai.http.goi("POST", `/rfqs/${String(rfqId)}/award/signals/acknowledge`, { lyDo: `Đã đọc: ${kb.lyDoDong ?? "đóng sớm khi đã đủ báo giá"}`, loai: "EARLY_CLOSE" });
        ghi({ loai: "LAM", ai: moTaNguoi(nd), viec: "ghi nhận tín hiệu đóng sớm trước chữ ký trao thầu (K10c)", mongDoi: "201 (S3) hay 422 (chưa bật S3)",
          thucTe: String(gn.status), dat: gn.status === 201 || gn.status === 422 });
      }
    }
    if (kb.dungO === "AWARD_PROPOSED") {
      const gd = hs.nguoi.find((n) => n.ma === "gd");
      demo = {
        buocTiep: [
          // TRƯỚC lần duyệt thật: trang chặn nút "Phê duyệt" ngay trên trình duyệt khi đề xuất không còn
          // PROPOSED, nên một lần thử SAU sẽ không bao giờ tới sản phẩm (lượt soi tài liệu của vòng này).
          `Trước khi duyệt: đăng nhập bằng ${moTaNguoi(nguoiDeXuat.hoSo)} (người đề xuất) ở /mo-thau, ${NAP_GOI}, bước 7 bấm "Đọc đề xuất" rồi "Phê duyệt" (lần bấm Phê duyệt đầu khi chưa đọc chỉ hiện đề xuất — khoản 321): sản phẩm từ chối — ${lopTuChoi(nguoiDeXuat.hoSo, "po.approve", "J3")}.`,
          `Đăng nhập bằng ${moTaNguoi(gd)}, ${NAP_GOI}, bước 7: bấm "Đọc đề xuất" — nhà cung cấp, chi phí, lý do — rồi bấm "Phê duyệt".`,
          "Bước 8: bấm \"Tải bộ bằng chứng\" (hai tệp) và kiểm bằng `pnpm bang-chung kiem --bo <thư mục>` KHÔNG cần CSDL.",
        ],
        loiMoiConLai: [],
      };
      return ketThuc(null);
    }
    if (kb.kiem.tuDuyetTraoThau === true) {
      // Hai LỚP khác nhau, và danh mục đo cả hai (`kiemDanhMuc`): người đề xuất KHÔNG giữ `po.approve`
      // bị cổng quyền chặn (403); người GIỮ nó đi qua cổng quyền và chỉ trigger J3 vế 1 của `061` chặn.
      const giuQuyen = coQuyen(nguoiDeXuat.hoSo.vai, "po.approve");
      await chan(nguoiDeXuat, `người đề xuất tự duyệt đề xuất trao thầu của mình${giuQuyen ? " (vai CÓ po.approve)" : ""}`, () =>
        nguoiDeXuat.http.goi("POST", `/rfqs/${String(rfqId)}/award/${awardId}/approve`), giuQuyen ? [422] : [403],
        giuQuyen ? "J3 (vế 1)" : "quyền po.approve");
    }
    const dtt = nguoi(kb.vai.duyetTraoThau);
    const ra = await lam(dtt, "duyệt trao thầu", () => dtt.http.goi("POST", `/rfqs/${String(rfqId)}/award/${awardId}/approve`), 201);
    trangThaiTraoThau = layChuoi(ra.body, "award", "status");
    kiem("trao thầu đã duyệt", trangThaiTraoThau === "APPROVED", trangThaiTraoThau, "APPROVED");

    // ---- 8. Bộ bằng chứng ----------------------------------------------------------------------
    const xb = nguoi(kb.vai.xuatBangChung);
    const eb = await lam(xb, "xuất bộ bằng chứng đánh giá", () => xb.http.goi("GET", `/rfqs/${String(rfqId)}/evidence-bundle`), 200);
    const tep = lay(eb.body, "evidenceBundle", "tep");
    if (tep === null || typeof tep !== "object") throw new BuocHong("bộ bằng chứng không có tệp");
    const thuMuc = join(bc.thuMucBangChung, kb.ma);
    await mkdir(thuMuc, { recursive: true, mode: 0o700 });
    for (const [ten, noiDung] of Object.entries(tep as Record<string, unknown>)) {
      if (!/^[A-Za-z0-9._-]+$/u.test(ten) || typeof noiDung !== "string") throw new BuocHong(`tên tệp bằng chứng lạ: ${ten}`);
      await writeFile(join(thuMuc, ten), noiDung, { encoding: "utf8", mode: 0o600 });
    }
    const kq = await kiemBoBangChung(thuMuc);
    boBangChungOk = kq.ok;
    kiem("bộ bằng chứng qua bộ kiểm độc lập, KHÔNG kết nối CSDL", kq.ok, kq.dong === "" ? `mã thoát ${String(kq.maThoat)}` : kq.dong, "ok=true");
    return ketThuc(null);
  } catch (e) {
    const thongDiep = e instanceof Error ? `${e.name}: ${e.message}` : "lỗi không rõ";
    if (!(e instanceof BuocHong)) ghi({ loai: "LAM", ai: "bộ giả lập", viec: "bước tiếp theo", mongDoi: "—", thucTe: catNgan(thongDiep), dat: false });
    return ketThuc(thongDiep);
  }

  async function ketThuc(loi: string | null): Promise<KetQuaKichBan> {
    let trangThaiGoi: string | null = null;
    if (rfqId !== null) {
      try {
        trangThaiGoi = await docGoi();
      } catch {
        trangThaiGoi = null;
      }
    }
    const mongGoi: Record<DungO, string> = {
      PENDING_APPROVAL: "PENDING_APPROVAL",
      OPEN: "OPEN",
      UNSEAL_PENDING: "CLOSED",
      AWARD_PROPOSED: "AWARDED",
      CANCELLED: "CANCELLED",
      AWARD_APPROVED: "AWARDED",
    };
    const dat = loi === null && buoc.every((b) => b.dat) && trangThaiGoi === mongGoi[kb.dungO];
    return {
      ma: kb.ma,
      toChuc: tc.hs.ten,
      ten: kb.ten,
      minhHoa: kb.minhHoa,
      dungO: kb.dungO,
      dat,
      loi: loi ?? (dat ? null : `gói dừng ở ${String(trangThaiGoi)}, mong ${mongGoi[kb.dungO]}`),
      rfqId,
      trangThaiGoi,
      trangThaiTraoThau,
      buoc,
      soLieu: {
        nganSach: kb.goi.nganSach,
        soLoiMoi: loiMoi.size,
        soPhienBanNop,
        soBienNhanDaKiem,
        soBienNhanHopLe,
        giaTrungThau,
        nhaCungCapTrungThau,
        boBangChungOk,
        thoiGianMs: Date.now() - batDau,
      },
      demo,
    };
  }
}

/** Cách nạp một gói có sẵn trên /tao-thau và /mo-thau: bước 2 của cả hai trang. */
const NAP_GOI = 'nạp gói (dán mã gói ở bước 2, bấm "Đọc")';

function moTaNguoi(n: NguoiHoSo | undefined): string {
  return n === undefined ? "(không có)" : `${n.hoTen} — ${n.chucDanh}`;
}

/** Lớp sẽ chặn một lần tự duyệt, theo QUYỀN của người thử — để lời dẫn trình diễn không gán nhầm lớp. */
function lopTuChoi(n: NguoiHoSo, quyen: Parameters<typeof coQuyen>[1], rangBuoc: string): string {
  return coQuyen(n.vai, quyen) ? `ràng buộc ${rangBuoc} (422)` : `cổng quyền (403 — vai ${n.vai} không có ${quyen})`;
}

/** Giá trị kỳ vọng của kịch bản, cho báo cáo và cho test — không gọi mạng. */
export function giaMongDoi(kb: KichBan): { readonly thapNhat: string | null; readonly soNhaCungCap: number } {
  const g = giaVongMot(hoSo(kb.toChuc), kb);
  const xh = xepHang(g);
  return { thapNhat: xh[0] === undefined ? null : (g.get(xh[0]) ?? null), soNhaCungCap: g.size };
}

