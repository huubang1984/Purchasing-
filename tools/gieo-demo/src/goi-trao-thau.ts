// ==============================================================================================
// [S1.282 / S3.5b] GÓI TRAO THẦU — MỘT TỶ, BẬC 2, NĂM MỜI, BỐN NỘP, ĐI TỚI LƯỢT CHẤM (spec S3 §9 dòng S3.5; ADR-154 ⑼)
//
// `gieo:demo --s3` dừng gói chính ở OPEN (nhà cung cấp nộp tay từ link in ra) và ba gói nhỏ ở ~~UNSEALED~~ **[S1.292 / S3.8b]** EVALUATING
// (lịch sử giá; soan2 chấm cả ba cho màn hiệu suất). Không gói nào
// tới trao thầu, nên người demo không gặp được một chốt nào của S3.5a. Gói này đi trọn đường sản phẩm bằng HÀM GÓI như ba gói của
// `goi-da-mo.ts` — rồi WORKER THẬT giải mã (cùng tiến trình con, cùng lượt `chayWorkerToiKhiMo`) — và THÊM một lượt chấm, để dừng ĐÚNG
// ở cạnh người demo phải đi tay (khuôn K10a, chủ dự án chốt 2026-10-07):
//
//   · ngân sách MỘT TỶ ghim bậc 2 của §4.1 (năm nhà cung cấp, HAI chữ ký trao thầu của FINANCE/DIRECTOR, ký danh sách);
//   · NĂM nhà cung cấp đếm được của gói chính được mời — K2 ở lần nộp qua;
//   · chỉ BỐN nộp, giá quanh 0,93 tỷ (bậc của số tiền trao THẤP hơn bậc ước lượng ⇒ bậc cao hơn vẫn là bậc 2): K2b ở lần đề xuất ĐỎ —
//     bốn nhóm có báo giá hợp lệ, bậc đòi năm — người giữ quyền mời lập «Cạnh tranh thực tế thấp» ở bước 7 của `/mo-thau`;
//   · ngoại lệ còn sống ⇒ K5b đòi một trong hai chữ ký là của người ngoài tập loại trừ; duyet1 và duyet2 đều ngoài tập.
//
// VAI TRONG GÓI NÀY — mỗi người một việc, để các cổng theo HÀNH VI ĐÃ XẢY RA (J3, K5, K5b) có thứ để đo:
//   soan3  tạo gói, đặt ngân sách, mời, nộp duyệt, mở gói, yêu cầu và ĐIỀU PHỐI mở thầu ⇒ J3 chặn soan3 đề xuất; soan3 trong tập K5b;
//   soan, soan2  hai chữ ký duyệt gói (ngưỡng kép một tỷ — hai người khác người tạo);
//   duyet1, duyet2  duyệt yêu cầu mở thầu; rồi là HAI người ký trao thầu trên màn (`po.approve`, vai DIRECTOR của bậc);
//   soan2  chấm (`evaluation.perform`), rồi trên màn: lập ngoại lệ hậu kiểm và đề xuất (`award.recommend`);
//   taichinh1 khai phiên bản chính sách (không ký trao thầu — K7), taichinh2 xác minh nhà cung cấp (trong tập K5b);
//   nhapncc dựng hồ sơ nhà cung cấp (K2 đếm được).
// Cửa sổ xoay vòng (K3, `108`) tính theo NGƯỜI CHỌN: soan3 chưa mở gói nào ⇒ không góp suất nào, năm nhà cung cấp cũ vẫn qua.
// K9 (`114`, S3.4a — gộp vào giữa vòng này): bậc 2 mặc định bật `khai_xung_dot`, nên soan, soan2 (chữ ký duyệt gói; soan2 còn chấm và đề
// xuất), duyet1, duyet2 (ký trao thầu trên màn) và hai người tài chính (lượt thử sai) khai *không xung đột* NGAY SAU khi năm lời mời
// dựng xong — `khai-bao.ts` (S3.4b). Ngoại lệ
// hậu kiểm lập sau không đổi băm danh sách (ADR-154 ⑸), nên lời khai còn nguyên tới lúc ký.
// ==============================================================================================

import { randomBytes } from "node:crypto";
import type pg from "pg";
import { submitBid, type ReceiptSigner } from "@trustprocure/bidding";
import { createLocalDevOrgKeyProvisioner, type MasterKeyRing } from "@trustprocure/crypto-keys";
import { taoLuotDanhGia } from "@trustprocure/danh-gia";
import { chuanHoaSauNop } from "@trustprocure/du-lieu-nen";
import {
  PepperRing,
  createInvitation,
  danhDauDaGui,
  ducTokenKhiMoGoi,
  issueOtpChallenge,
  redeemMagicLink,
  verifyOtpAndStartSession,
} from "@trustprocure/invitation";
import { addRfqItem, approveRfq, closeRfq, createRfq, datSoNgayGiao, openRfq, setRfqBudget, submitRfqForApproval } from "@trustprocure/rfq";
import { getRfqPublicKeys, sealBid } from "@trustprocure/sealed-envelope";
import { withTenant } from "@trustprocure/tenancy";
import { approveUnseal, dispatchUnseal, requestUnseal } from "@trustprocure/unseal";
import type { DongGieo, NguoiGieo, NhaCungCapGieo } from "./goi-da-mo.js";
import { khaiKhongXungDot } from "./khai-bao.js";

export class GoiTraoThauError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoiTraoThauError";
  }
}

export interface BoiCanhGoiTraoThau {
  readonly pool: pg.Pool;
  readonly org: string;
  readonly duoi: string;
  readonly vong: MasterKeyRing;
  readonly boKy: ReceiptSigner;
  /** Nhóm hàng RIÊNG — không gói anh em nào cho K10a. */
  readonly nhomHang: string;
  /** Người tạo, mời, nộp, mở, yêu cầu và điều phối mở thầu. */
  readonly soan3: NguoiGieo;
  /** Hai chữ ký duyệt gói. */
  readonly soan: NguoiGieo;
  readonly soan2: NguoiGieo;
  /** Hai người duyệt yêu cầu mở thầu. */
  readonly duyet1: NguoiGieo;
  readonly duyet2: NguoiGieo;
  /** Hai người tài chính — chỉ để lượt thử sai trên màn chạm K7/K5b (người khai chính sách, người xác minh) thay vì dừng ở K9. */
  readonly taichinh1: NguoiGieo;
  readonly taichinh2: NguoiGieo;
  /** ĐÚNG năm nhà cung cấp đếm được (K2 bậc 2). */
  readonly nhaCungCap: readonly NhaCungCapGieo[];
  readonly dong: readonly DongGieo[];
  /**
   * [S1.286 / S4.7b2] Gói TCO của `--s3` (`index.ts`): cùng đường đi, khác bốn chỗ — tiêu đề, ngân sách (bậc 1: không xoay vòng, nên
   * cùng người chọn và cùng năm nhà cung cấp không vướng K3), số lượng từng dòng, và thước TCO: số ngày giao yêu cầu đặt lúc gói còn
   * soạn, mỗi phong bì mang thêm ô khai của người nộp thứ k. Vắng ⇒ gói trao thầu như trước, nguyên văn.
   */
  readonly tco?: {
    readonly tieuDe: string;
    readonly nganSach: string;
    readonly soLuong: readonly number[];
    readonly soNgayGiao: number;
    readonly khai: readonly Readonly<Record<string, string>>[];
  };
}

/** Ngân sách một tỷ — bậc 2 từ 1 000 000 000 (`BAC_DEMO`). */
export const NGAN_SACH_GOI_TRAO_THAU = "1000000000.00";
/** Số lượng từng dòng: với đơn giá gốc của ba dòng (12,5 triệu / 265 nghìn / 48 nghìn) tổng gốc ≈ 928 triệu. */
const SO_LUONG_TRAO_THAU: readonly number[] = [50, 600, 3000];
/** Bốn người đầu nộp, mỗi người một hệ số giá; người thứ năm KHÔNG nộp — đó là lý do K2b đỏ. */
const HE_SO_NOP: readonly number[] = [1, 1.03, 0.98, 1.05];
export const SO_NOP = HE_SO_NOP.length;

const dongThanhChuoi = (dong: number): string => `${String(dong)}.00`;

export interface GoiTraoThau {
  readonly rfqId: string;
  readonly tieuDe: string;
}

/** Tạo, mời năm, nộp, hai chữ ký, mở, bốn phong bì, đóng sớm, cổng bốn vế, điều phối — dừng ở một job `UNSEAL_RFQ`. Worker chạy SAU. */
export async function gieoGoiTraoThauDenDieuPhoi(b: BoiCanhGoiTraoThau): Promise<GoiTraoThau> {
  const { pool, org } = b;
  if (b.nhaCungCap.length !== 5) throw new GoiTraoThauError(`gói trao thầu cần đúng năm nhà cung cấp, có ${String(b.nhaCungCap.length)}`);
  const pepper = new PepperRing("gieo-demo-tt", { "gieo-demo-tt": randomBytes(32) });
  const tieuDe = b.tco?.tieuDe ?? `Goi trao thau ${b.duoi}`;
  const soLuong = b.tco?.soLuong ?? SO_LUONG_TRAO_THAU;
  const rfqId = await withTenant(pool, org, async (c) => {
    const r = await createRfq(c, org, {
      title: tieuDe,
      deadlineAt: new Date(Date.now() + 2 * 24 * 3600 * 1000),
      createdBySessionId: b.soan3.sessionId,
      categoryId: b.nhomHang,
    });
    await setRfqBudget(c, org, {
      rfqId: r.id,
      estimatedValue: b.tco?.nganSach ?? NGAN_SACH_GOI_TRAO_THAU,
      currency: "VND",
      actorSessionId: b.soan3.sessionId,
    });
    // [S1.286 / S4.7b2] Số ngày giao yêu cầu — chỉ đặt được khi gói còn soạn, và nằm trong chữ ký của hai người duyệt phía dưới.
    if (b.tco !== undefined) {
      await datSoNgayGiao(c, org, { rfqId: r.id, soNgayGiao: b.tco.soNgayGiao, actorSessionId: b.soan3.sessionId });
    }
    for (const [j, d] of b.dong.entries()) {
      await addRfqItem(c, org, {
        rfqId: r.id,
        lineNo: j + 1,
        description: d.mo,
        quantity: `${String(soLuong[j] ?? 1)}.0000`,
        unit: d.dvt,
        actorSessionId: b.soan3.sessionId,
      });
    }
    return r.id;
  });

  // Tổ chức đã bật: mời ở DRAFT (K4a, K6 — token đúc lúc mở), danh sách năm lời mời vào băm mà hai người duyệt ký.
  const loiMoi = await withTenant(pool, org, async (c) => {
    const ids: string[] = [];
    for (const n of b.nhaCungCap) {
      const lm = await createInvitation(
        c,
        org,
        { rfqId, supplierId: n.supplierId, contactId: n.contactId, linkChannel: "EMAIL", actorSessionId: b.soan3.sessionId },
        pool,
      );
      ids.push(lm.id);
    }
    return ids;
  });

  // K9: danh sách mời đã đủ — sáu người sắp ký, chấm, đề xuất, duyệt (và hai người của lượt thử sai) khai trước (xem đầu tệp).
  for (const n of [b.soan, b.soan2, b.duyet1, b.duyet2, b.taichinh1, b.taichinh2]) await khaiKhongXungDot(pool, org, rfqId, n);

  await withTenant(pool, org, (c) => submitRfqForApproval(c, org, { rfqId, actorSessionId: b.soan3.sessionId }, pool));
  await withTenant(pool, org, (c) => chuanHoaSauNop(c, org, { rfqId, actorSessionId: b.soan3.sessionId }));
  const lanNop = await withTenant(pool, org, async (c) => {
    const { rows } = await c.query<{ n: number }>(
      "SELECT p.lan_nop AS n FROM public.rfq_packages p WHERE p.id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid",
      [rfqId],
    );
    const n = rows[0]?.n;
    if (n === undefined) throw new GoiTraoThauError(`gói ${tieuDe} không đọc được lần nộp`);
    return n;
  });
  // Ngưỡng kép một tỷ: HAI chữ ký của hai người khác người tạo (D2).
  for (const nd of [b.soan, b.soan2]) {
    await withTenant(pool, org, (c) => approveRfq(c, org, { rfqId, sessionId: nd.sessionId, lanNopDaXem: lanNop }, pool));
  }

  const token = await withTenant(pool, org, async (c) => {
    await openRfq(c, org, { rfqId, actorSessionId: b.soan3.sessionId, orgKeys: createLocalDevOrgKeyProvisioner(b.vong) }, pool);
    const links = await ducTokenKhiMoGoi(c, org, { rfqId, actorSessionId: b.soan3.sessionId });
    const theoThuTu: string[] = [];
    for (const id of loiMoi) {
      const link = links.find((l) => l.invitationId === id);
      if (link === undefined) throw new GoiTraoThauError(`gói ${tieuDe}: lời mời không có token lúc mở`);
      if (!(await danhDauDaGui(c, org, id))) throw new GoiTraoThauError(`gói ${tieuDe}: lời mời không thành SENT`);
      theoThuTu.push(link.token.token);
    }
    return theoThuTu;
  });

  const khoa = (await withTenant(pool, org, (c) => getRfqPublicKeys(c, org, rfqId))).find((k) => k.algorithm === "ECDH_P256");
  if (khoa === undefined) throw new GoiTraoThauError(`gói ${tieuDe} không có khoá ECDH_P256`);
  // BỐN người đầu nộp; người thứ năm giữ link mà không nộp.
  for (const [k, heSo] of HE_SO_NOP.entries()) {
    const tk = token[k];
    if (tk === undefined) throw new GoiTraoThauError(`gói ${tieuDe}: thiếu token của nhà cung cấp ${String(k + 1)}`);
    const phien = await withTenant(pool, org, async (c) => {
      await redeemMagicLink(c, org, tk);
      const otp = await issueOtpChallenge(c, org, { token: tk, channel: "SMS", callerFingerprint: `gieo-demo-tt-${String(k)}`, pepper });
      if (!otp.ok) throw new GoiTraoThauError(`gói ${tieuDe}: không phát được OTP cho nhà cung cấp ${String(k + 1)}`);
      const v = await verifyOtpAndStartSession(c, org, { token: tk, code: otp.code, pepper });
      if (!v.ok) throw new GoiTraoThauError(`gói ${tieuDe}: OTP vừa phát không đối chiếu được`);
      return v.sessionId;
    });
    const lines = b.dong.map((d, j) => {
      const donGia = Math.round(d.donGiaGoc * heSo);
      return { lineNo: j + 1, unitPrice: dongThanhChuoi(donGia), amount: dongThanhChuoi(donGia * (soLuong[j] ?? 1)) };
    });
    const tong = dongThanhChuoi(lines.reduce((s, l) => s + Number(l.amount), 0));
    // [S1.286 / S4.7b2] Ô khai TCO của người nộp thứ k — đúng bốn khoá màn `/nop-thau` đặt (`truongKhai`).
    const khai = b.tco?.khai[k] ?? {};
    const phongBi = await sealBid({
      rfqId,
      algorithm: "ECDH_P256",
      recipientPublicKey: khoa.publicKey,
      plaintext: new TextEncoder().encode(JSON.stringify({ totalAmount: tong, currency: "VND", lines, ...khai })),
    });
    await withTenant(pool, org, (c) => submitBid(c, org, { guestSessionId: phien, envelope: phongBi, signer: b.boKy }));
  }

  await withTenant(pool, org, (c) =>
    closeRfq(c, org, { rfqId, reason: "gieo demo: dong som de di toi trao thau", actorSessionId: b.soan3.sessionId }),
  );
  const yc = await withTenant(pool, org, (c) =>
    requestUnseal(c, org, { rfqId, reason: "gieo demo: mo thau cho goi trao thau", actorSessionId: b.soan3.sessionId }, pool),
  );
  for (const nd of [b.duyet1, b.duyet2]) {
    const tt = await withTenant(pool, org, (c) => approveUnseal(c, org, { unsealRequestId: yc.id, actorSessionId: nd.sessionId }, pool));
    if (tt.status === "APPROVED") break;
  }
  await withTenant(pool, org, (c) => dispatchUnseal(c, org, { unsealRequestId: yc.id, actorSessionId: b.soan3.sessionId }, pool));
  return { rfqId, tieuDe };
}

/**
 * Sau khi worker đã mở: MỘT lượt chấm dưới phiên người chấm (`evaluation.perform`) — gói sang EVALUATING, cạnh người demo đi tay.
 * [S1.292 / S3.8b] Cũng chấm gói TCO và ba gói đã mở (màn hiệu suất) — hàm không đọc gì riêng của gói trao thầu.
 */
export async function chamGoiTraoThau(pool: pg.Pool, org: string, rfqId: string, nguoiCham: NguoiGieo): Promise<string> {
  const luot = await withTenant(pool, org, (c) => taoLuotDanhGia(c, org, { rfqId, actorSessionId: nguoiCham.sessionId }, pool));
  const { rows } = await withTenant(pool, org, (c) =>
    c.query<{ status: string }>("SELECT p.status FROM public.rfq_packages p WHERE p.id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid", [rfqId]),
  );
  if (rows[0]?.status !== "EVALUATING") throw new GoiTraoThauError(`gói ${rfqId} sau lượt chấm ở ${rows[0]?.status ?? "?"}, không phải EVALUATING`);
  return luot.evaluationId;
}
