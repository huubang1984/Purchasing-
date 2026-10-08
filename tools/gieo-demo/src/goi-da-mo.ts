// ==============================================================================================
// [S1.251 / S4.4b] BA GÓI ĐÃ MỞ NIÊM PHONG — QUA ĐƯỜNG THẬT (spec S4 §9 dòng S4.4b; ADR-140)
//
// Lịch sử giá (`GET /items/:itemId/price-history`) chỉ có quan sát từ gói đã mở niêm phong, và hàng bản rõ chỉ có MỘT bộ ghi:
// worker mở thầu, vai `app_unseal` (`019`). Nên ba gói ở đây đi trọn đường sản phẩm bằng HÀM GÓI — tạo gói, ngân sách, dòng, lời
// mời, nộp duyệt, lượt chuẩn hoá sau lần nộp, một chữ ký, mở gói kèm cặp khoá của chính nó; nhà cung cấp đi link → OTP → phiên
// khách, niêm phong phong bì bằng khoá công khai của gói và nộp lấy biên nhận đã ký; đóng sớm có lý do; yêu cầu mở thầu, duyệt,
// điều phối qua cổng bốn vế — rồi WORKER THẬT (`apps/unseal-worker/src/main.ts`, tiến trình con) giải mã.
//
// VÌ SAO TIẾN TRÌNH CON, không gọi `executeUnsealRequest` trong tiến trình: hàng rào G1/G8 (`.dependency-cruiser.cjs`) chỉ cho
// `apps/unseal-worker` chạm cửa giải mã. Chủ dự án chốt 2026-10-01: worker thật, không nới hàng rào. Tiến trình con nhận môi
// trường theo danh sách CHO PHÉP — URL đặc quyền và mọi bí mật khác của người gọi không đi xuống worker —, rồi đặt đúng những biến
// worker đòi. Trước khi bật, công cụ từ chối nếu cụm có việc worker sẽ nhận của tổ chức khác (lượt soi §S1.251).
//
// HAI CHỖ DỰNG BỐI CẢNH KHÔNG ĐI ĐƯỜNG CỦA MÀN, nói ra: ⑴ ánh xạ dòng bu lông neo do người quản lý dữ liệu ghi bằng `ghiAnhXa`
// TRƯỚC lần mở (dòng ấy không có bí danh — gói demo chính để nó ở hàng đợi); ⑵ bộ OTP dùng một vòng pepper RIÊNG của lượt gieo:
// mã phát và mã đối chiếu cùng tiến trình, phiên khách dùng một lần để nộp rồi gói đóng.
//
// NGÂN SÁCH: ba gói dưới ngưỡng kép, tổng dưới cận 100 triệu — ở tổ chức đã bật S3 (`--s3`) ba gói nằm trong một nhóm hàng RIÊNG,
// và tổng chạm cận ấy sẽ bắn tín hiệu chia nhỏ (K10a) chặn lần mở gói thứ ba.
// ==============================================================================================

import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { submitBid, type ReceiptSigner } from "@trustprocure/bidding";
import { createLocalDevOrgKeyProvisioner, type MasterKeyRing } from "@trustprocure/crypto-keys";
import { chuanHoaSauNop, ghiAnhXa } from "@trustprocure/du-lieu-nen";
import {
  PepperRing,
  createInvitation,
  danhDauDaGui,
  ducTokenKhiMoGoi,
  issueMagicLinkToken,
  issueOtpChallenge,
  redeemMagicLink,
  verifyOtpAndStartSession,
} from "@trustprocure/invitation";
import { addRfqItem, approveRfq, closeRfq, createRfq, openRfq, setRfqBudget, submitRfqForApproval } from "@trustprocure/rfq";
import { getRfqPublicKeys, sealBid } from "@trustprocure/sealed-envelope";
import { withTenant } from "@trustprocure/tenancy";
import { approveUnseal, dispatchUnseal, requestUnseal } from "@trustprocure/unseal";
import { khaiKhongXungDot } from "./khai-bao.js";

export class GoiDaMoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoiDaMoError";
  }
}

export interface NguoiGieo {
  readonly id: string;
  readonly sessionId: string;
}

export interface NhaCungCapGieo {
  readonly ten: string;
  readonly supplierId: string;
  readonly contactId: string;
}

/** Một dòng của mỗi gói: mô tả (trùng mô tả dòng của gói demo chính — bí danh nối được), đơn vị, đơn giá gốc. */
export interface DongGieo {
  readonly mo: string;
  readonly dvt: string;
  readonly donGiaGoc: number;
}

export interface BoiCanhGoiDaMo {
  readonly pool: pg.Pool;
  readonly org: string;
  readonly duoi: string;
  readonly vong: MasterKeyRing;
  readonly boKy: ReceiptSigner;
  readonly s3: boolean;
  /** Nhóm hàng RIÊNG của ba gói (`--s3`), `null` ở tổ chức chưa bật. */
  readonly nhomHang: string | null;
  readonly soan: NguoiGieo;
  readonly soan2: NguoiGieo;
  readonly duyet1: NguoiGieo;
  readonly duyet2: NguoiGieo;
  readonly duLieu: NguoiGieo;
  readonly nhaCungCap: readonly NhaCungCapGieo[];
  readonly dong: readonly DongGieo[];
  /** Hàng chuẩn của dòng KHÔNG có bí danh — người quản lý dữ liệu ánh xạ tay trước lần mở. */
  readonly anhXaTay: { readonly lineNo: number; readonly hangChuanId: string };
}

/** Ba gói: số lượng mỗi dòng, ngân sách dự tính, hệ số giá theo lượt — giá đi lên rồi xuống, để lịch sử có hình dạng. */
const BA_GOI: readonly { readonly soLuong: readonly number[]; readonly nganSach: string; readonly heSo: number }[] = [
  { soLuong: [2, 10, 40], nganSach: "30000000.00", heSo: 1 },
  { soLuong: [2, 12, 50], nganSach: "32000000.00", heSo: 1.04 },
  { soLuong: [2, 8, 30], nganSach: "28000000.00", heSo: 0.97 },
];
/** Hệ số giá theo nhà cung cấp — ba người, ba mức. */
const HE_SO_NCC: readonly number[] = [1, 1.03, 0.98];

const dongThanhChuoi = (dong: number): string => `${String(dong)}.00`;

export interface GoiDaMo {
  readonly rfqId: string;
  readonly tieuDe: string;
}

/** Ba gói đi tới chỗ một job `UNSEAL_RFQ` đã điều phối cho mỗi gói. Worker chạy SAU (`chayWorkerToiKhiMo`). */
export async function gieoBaGoiDaDieuPhoi(b: BoiCanhGoiDaMo): Promise<readonly GoiDaMo[]> {
  const { pool, org } = b;
  const pepper = new PepperRing("gieo-demo-1", { "gieo-demo-1": randomBytes(32) });
  const ra: GoiDaMo[] = [];
  for (const [i, g] of BA_GOI.entries()) {
    const tieuDe = `Goi da mo ${String(i + 1)} ${b.duoi}`;
    const rfqId = await withTenant(pool, org, async (c) => {
      const r = await createRfq(c, org, {
        title: tieuDe,
        deadlineAt: new Date(Date.now() + 2 * 24 * 3600 * 1000),
        createdBySessionId: b.soan.sessionId,
        ...(b.nhomHang === null ? {} : { categoryId: b.nhomHang }),
      });
      await setRfqBudget(c, org, { rfqId: r.id, estimatedValue: g.nganSach, currency: "VND", actorSessionId: b.soan.sessionId });
      for (const [j, d] of b.dong.entries()) {
        await addRfqItem(c, org, {
          rfqId: r.id,
          lineNo: j + 1,
          description: d.mo,
          quantity: `${String(g.soLuong[j] ?? 1)}.0000`,
          unit: d.dvt,
          actorSessionId: b.soan.sessionId,
        });
      }
      return r.id;
    });

    // Tổ chức đã bật S3 mời ở DRAFT (K4a, K6 — token đúc lúc mở); tổ chức chưa bật mời sau khi mở, token ngay lúc mời.
    const moi = async (c: pg.PoolClient): Promise<string[]> => {
      const ids: string[] = [];
      for (const n of b.nhaCungCap) {
        const lm = await createInvitation(
          c,
          org,
          { rfqId, supplierId: n.supplierId, contactId: n.contactId, linkChannel: "EMAIL", actorSessionId: b.soan.sessionId },
          pool,
        );
        ids.push(lm.id);
      }
      return ids;
    };
    const loiMoiTruoc = b.s3 ? await withTenant(pool, org, moi) : [];

    await withTenant(pool, org, (c) => submitRfqForApproval(c, org, { rfqId, actorSessionId: b.soan.sessionId }, pool));
    // Lượt chuẩn hoá sau lần nộp — cùng hàm route nộp duyệt đăng ký sau commit: hai dòng có bí danh tự nối.
    await withTenant(pool, org, (c) => chuanHoaSauNop(c, org, { rfqId, actorSessionId: b.soan.sessionId }));
    await withTenant(pool, org, (c) =>
      ghiAnhXa(c, org, {
        rfqId,
        lineNo: b.anhXaTay.lineNo,
        hangChuanId: b.anhXaTay.hangChuanId,
        lyDo: null,
        taoBiDanh: false,
        bamMongDoi: null,
        actorSessionId: b.duLieu.sessionId,
      }),
    );
    const lanNop = await withTenant(pool, org, async (c) => {
      const { rows } = await c.query<{ n: number }>(
        "SELECT p.lan_nop AS n FROM public.rfq_packages p WHERE p.id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid",
        [rfqId],
      );
      const n = rows[0]?.n;
      if (n === undefined) throw new GoiDaMoError(`gói ${tieuDe} không đọc được lần nộp`);
      return n;
    });
    // [S1.283 / S3.4b · K9] `--s3`: soan2 khai *không xung đột* trước chữ ký công cụ ghi thay (bậc demo đòi khai).
    if (b.s3) await khaiKhongXungDot(pool, org, rfqId, b.soan2);
    await withTenant(pool, org, (c) => approveRfq(c, org, { rfqId, sessionId: b.soan2.sessionId, lanNopDaXem: lanNop }, pool));

    const token: string[] = await withTenant(pool, org, async (c) => {
      await openRfq(c, org, { rfqId, actorSessionId: b.soan.sessionId, orgKeys: createLocalDevOrgKeyProvisioner(b.vong) }, pool);
      if (b.s3) {
        const links = await ducTokenKhiMoGoi(c, org, { rfqId, actorSessionId: b.soan.sessionId });
        const theoThuTu: string[] = [];
        for (const id of loiMoiTruoc) {
          const link = links.find((l) => l.invitationId === id);
          if (link === undefined) throw new GoiDaMoError(`gói ${tieuDe}: lời mời không có token lúc mở`);
          if (!(await danhDauDaGui(c, org, id))) throw new GoiDaMoError(`gói ${tieuDe}: lời mời không thành SENT`);
          theoThuTu.push(link.token.token);
        }
        return theoThuTu;
      }
      const ra2: string[] = [];
      for (const id of await moi(c)) ra2.push((await issueMagicLinkToken(c, org, { invitationId: id, actorSessionId: b.soan.sessionId })).token);
      return ra2;
    });

    const khoa = (await withTenant(pool, org, (c) => getRfqPublicKeys(c, org, rfqId))).find((k) => k.algorithm === "ECDH_P256");
    if (khoa === undefined) throw new GoiDaMoError(`gói ${tieuDe} không có khoá ECDH_P256`);
    for (const [k, tk] of token.entries()) {
      const phien = await withTenant(pool, org, async (c) => {
        await redeemMagicLink(c, org, tk);
        const otp = await issueOtpChallenge(c, org, { token: tk, channel: "SMS", callerFingerprint: `gieo-demo-${String(k)}`, pepper });
        if (!otp.ok) throw new GoiDaMoError(`gói ${tieuDe}: không phát được OTP cho nhà cung cấp ${String(k + 1)}`);
        const v = await verifyOtpAndStartSession(c, org, { token: tk, code: otp.code, pepper });
        if (!v.ok) throw new GoiDaMoError(`gói ${tieuDe}: OTP vừa phát không đối chiếu được`);
        return v.sessionId;
      });
      // Phong bì như trình duyệt dựng (`nop-thau.js`): `amount` = số lượng × đơn giá, `totalAmount` = Σ `amount`.
      const lines = b.dong.map((d, j) => {
        const donGia = Math.round(d.donGiaGoc * g.heSo * (HE_SO_NCC[k] ?? 1));
        return { lineNo: j + 1, unitPrice: dongThanhChuoi(donGia), amount: dongThanhChuoi(donGia * (g.soLuong[j] ?? 1)) };
      });
      const tong = dongThanhChuoi(lines.reduce((s, l) => s + Number(l.amount), 0));
      const phongBi = await sealBid({
        rfqId,
        algorithm: "ECDH_P256",
        recipientPublicKey: khoa.publicKey,
        plaintext: new TextEncoder().encode(JSON.stringify({ totalAmount: tong, currency: "VND", lines })),
      });
      await withTenant(pool, org, (c) => submitBid(c, org, { guestSessionId: phien, envelope: phongBi, signer: b.boKy }));
    }

    await withTenant(pool, org, (c) =>
      closeRfq(c, org, { rfqId, reason: "gieo demo: dong som de mo thau cho lich su gia", actorSessionId: b.soan.sessionId }),
    );
    const yc = await withTenant(pool, org, (c) =>
      requestUnseal(c, org, { rfqId, reason: "gieo demo: mo thau cho lich su gia", actorSessionId: b.soan.sessionId }, pool),
    );
    for (const nd of [b.duyet1, b.duyet2]) {
      const tt = await withTenant(pool, org, (c) => approveUnseal(c, org, { unsealRequestId: yc.id, actorSessionId: nd.sessionId }, pool));
      if (tt.status === "APPROVED") break;
    }
    await withTenant(pool, org, (c) => dispatchUnseal(c, org, { unsealRequestId: yc.id, actorSessionId: b.soan.sessionId }, pool));
    ra.push({ rfqId, tieuDe });
  }
  return ra;
}

/**
 * [lượt soi §S1.251 — L3] Môi trường của tiến trình con theo danh sách CHO PHÉP: chỉ những biến một tiến trình Node cần để chạy
 * (đường dẫn, thư mục nhà và tạm, ngôn ngữ, múi giờ), rồi đúng những biến worker đòi được đặt tường minh. Một danh sách CẤM (khuôn
 * `pilot-gia-lap`) để lọt mọi bí mật đặt tên khác (`POSTGRES_PASSWORD`, `AWS_*`, token CI) xuống tiến trình cầm cửa giải mã — trái
 * lời hứa G1 *"worker không cầm lối vào bí mật nào khác"* (`apps/unseal-worker/src/cau-hinh.ts`).
 */
const BIEN_CHO_WORKER = ["PATH", "Path", "HOME", "USERPROFILE", "SYSTEMROOT", "SystemRoot", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "TZ"];
function moiTruongChoWorker(goc: NodeJS.ProcessEnv): Record<string, string> {
  const ra: Record<string, string> = {};
  for (const k of BIEN_CHO_WORKER) {
    const v = goc[k];
    if (v !== undefined) ra[k] = v;
  }
  return ra;
}

/**
 * [lượt soi §S1.251 — T1] Hai loại việc worker nhận (`apps/unseal-worker/src/composition.ts`) — cộng sổ `kind` mồ côi
 * (`KIND_KHONG_NGUOI_NHAN`, rỗng hôm nay). Worker liệt kê MỌI tổ chức của cụm, nên worker con của công cụ này nhận cả việc của tổ
 * chức khác: mở khoá của họ bằng vòng khoá của lượt gieo, giao cảnh báo break-glass của họ vào một thư mục tạm (người nhận thật
 * không bao giờ được báo — D4).
 */
const KIND_WORKER_GIEO = ["UNSEAL_RFQ", "BREAK_GLASS_UNSEAL_ALERT"];

/**
 * [lượt soi §S1.251 — T1] Từ chối khi cụm có việc worker sẽ nhận của tổ chức KHÁC `org` (`null`: của bất kỳ tổ chức nào — lần kiểm
 * TRƯỚC khi gieo, lúc tổ chức của lượt chưa tồn tại). Một câu chỉ đọc trên kết nối đặc quyền: câu hỏi "những tổ chức nào" đứng trước
 * câu hỏi "tổ chức nào", không gắn được tenant. Còn một cửa sổ — việc của tổ chức khác xếp TRONG lúc worker con chạy —, nói ra ở
 * ADR-140.
 */
export async function tuChoiKhiCoViecCuaToChucKhac(pool: pg.Pool, org: string | null): Promise<void> {
  const n = (
    await pool.query<{ n: number }>(
      "SELECT pg_catalog.count(*)::pg_catalog.int4 AS n FROM public.outbox_jobs j " +
        "WHERE ($1::pg_catalog.uuid IS NULL OR j.org_id OPERATOR(pg_catalog.<>) $1::pg_catalog.uuid) " +
        "AND j.kind OPERATOR(pg_catalog.=) ANY ($2::pg_catalog.text[]) " +
        "AND j.status OPERATOR(pg_catalog.=) ANY (ARRAY['PENDING', 'RUNNING']::pg_catalog.text[])",
      [org, KIND_WORKER_GIEO],
    )
  ).rows[0]?.n;
  if (n !== 0) {
    throw new GoiDaMoError(
      `cụm có ${String(n)} việc mở thầu hay cảnh báo break-glass đang chờ của tổ chức khác — worker con của gieo:demo nhận việc ` +
        "của MỌI tổ chức. Chạy gieo:demo trên một CSDL riêng, hay đợi worker của cụm xử lý xong.",
    );
  }
}

export interface WorkerGieo {
  /** `app_unseal_login` — KHÔNG phải URL đặc quyền của công cụ. */
  readonly databaseUrl: string;
  readonly masterKeys: string;
  readonly masterKeyActive: string;
}

/**
 * Bật worker mở thầu THẬT, đợi tới khi mọi gói cho trước ở `UNSEALED`, rồi dừng nó. Worker không có cổng HTTP: "xong" đọc từ
 * trạng thái gói. Worker dừng giữa chừng hay quá hạn thì ném kèm đuôi log của nó.
 */
export async function chayWorkerToiKhiMo(
  pool: pg.Pool,
  org: string,
  rfqIds: readonly string[],
  ch: WorkerGieo,
  choMs = 90_000,
): Promise<void> {
  // Lần kiểm thứ hai, ngay trước khi bật: việc của tổ chức khác có thể đã xếp trong lúc gieo ba gói.
  await tuChoiKhiCoViecCuaToChucKhac(pool, org);
  const thuMuc = await mkdtemp(join(tmpdir(), "tp-gieo-worker-"));
  const log = join(thuMuc, "unseal-worker.log");
  const fd = openSync(log, "a", 0o600);
  const con = (() => {
    try {
      return spawn(
        process.execPath,
        ["--experimental-transform-types", "--import", "./apps/unseal-worker/register-ts-resolve.mjs", "apps/unseal-worker/src/main.ts"],
        {
          cwd: fileURLToPath(new URL("../../../", import.meta.url)),
          env: {
            ...moiTruongChoWorker(process.env),
            NODE_ENV: "development",
            TRUSTPROCURE_DATABASE_URL: ch.databaseUrl,
            TRUSTPROCURE_KEY_ADAPTER: "local-dev",
            TRUSTPROCURE_MASTER_KEYS: ch.masterKeys,
            TRUSTPROCURE_MASTER_KEY_ACTIVE: ch.masterKeyActive,
            TRUSTPROCURE_ALERT_ADAPTER: "dev-file",
            TRUSTPROCURE_ALERT_DIR: join(thuMuc, "canh-bao"),
            TRUSTPROCURE_OUTBOX_POLL_MS: "500",
          },
          stdio: ["ignore", fd, fd],
          windowsHide: true,
        },
      );
    } finally {
      closeSync(fd);
    }
  })();
  const duoiLogWorker = (): string => {
    try {
      return readFileSync(log, "utf8").trimEnd().split("\n").slice(-8).join("\n");
    } catch {
      return "(không đọc được log)";
    }
  };
  // [lượt soi §S1.251 — L4] Cha thoát giữa chừng (lỗi không bắt, Ctrl-C) thì worker không được sống tiếp, cầm vòng khoá và phục vụ
  // mọi tổ chức: giết nó ĐỒNG BỘ ở `exit`, và biến hai tín hiệu thành một lần thoát có mã.
  const gietCon = (): void => {
    if (con.exitCode === null && con.signalCode === null) con.kill("SIGKILL");
  };
  const thoatVi = (tinHieu: NodeJS.Signals): void => {
    gietCon();
    process.exit(tinHieu === "SIGINT" ? 130 : 143);
  };
  process.once("exit", gietCon);
  process.once("SIGINT", thoatVi);
  process.once("SIGTERM", thoatVi);
  let xongSach = false;
  try {
    const han = Date.now() + choMs;
    for (;;) {
      if (con.exitCode !== null || con.signalCode !== null) throw new GoiDaMoError(`worker dừng giữa chừng — log ${log}:\n${duoiLogWorker()}`);
      const daMo = await withTenant(pool, org, async (c) => {
        const { rows } = await c.query<{ n: number }>(
          "SELECT pg_catalog.count(*)::pg_catalog.int4 AS n FROM public.rfq_packages p " +
            "WHERE p.id OPERATOR(pg_catalog.=) ANY ($1::pg_catalog.uuid[]) AND p.status OPERATOR(pg_catalog.=) 'UNSEALED'",
          [rfqIds],
        );
        return rows[0]?.n ?? 0;
      });
      if (daMo === rfqIds.length) {
        xongSach = true;
        return;
      }
      if (Date.now() > han) throw new GoiDaMoError(`worker chưa mở xong ${String(rfqIds.length)} gói sau ${String(choMs)} ms — log ${log}:\n${duoiLogWorker()}`);
      await new Promise((xong) => setTimeout(xong, 500));
    }
  } finally {
    if (con.exitCode === null && con.signalCode === null) {
      const xong = new Promise<void>((kq) => con.once("exit", () => kq()));
      con.kill("SIGTERM");
      const hetGio = new Promise<"het">((kq) => setTimeout(() => kq("het"), 8000).unref());
      if ((await Promise.race([xong.then(() => "xong" as const), hetGio])) === "het") con.kill("SIGKILL");
    }
    process.removeListener("exit", gietCon);
    process.removeListener("SIGINT", thoatVi);
    process.removeListener("SIGTERM", thoatVi);
    // Thư mục tạm (log, thư mục cảnh báo dev) đi khi xong sạch; hỏng thì ở lại — thông điệp lỗi trỏ tới log trong nó.
    if (xongSach) await rm(thuMuc, { recursive: true, force: true });
  }
}
