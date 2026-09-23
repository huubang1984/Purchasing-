// ==============================================================================================
// [S1.105 / S2.3] LƯỢT ĐÁNH GIÁ — LỚP CÓ TRẠNG THÁI, TÁCH KHỎI HÀM THUẦN
//
// Spec §3.2: *"Lớp có trạng thái (đọc báo giá, ghi kết quả, cổng quyền) nằm ở lớp ngoài, cùng
// khuôn mà `packages/unseal` đang dùng."* `chi-phi-hieu-dung.ts` không nhận `client`, không nhận
// `orgId`, không chạm CSDL — và đó là cách duy nhất để **J2** đo được bằng một lời gọi hàm.
//
// ----------------------------------------------------------------------------------------------
// MỘT RANH GIỚI PHẢI ĐỌC TRƯỚC: HÔM NAY CHỈ MỘT THÀNH PHẦN CÓ NGUỒN DỮ LIỆU
// ----------------------------------------------------------------------------------------------
// Chính sách khai được nhiều thành phần, nhưng một BÁO GIÁ chỉ mang đúng một số tiền mà hệ thống
// đọc được: `payload ->> 'totalAmount'`, qua `public.bid_so_tien` (020). Không có chỗ nào để nhà
// cung cấp khai phí vận chuyển riêng, và không có chỗ nào để ai chấm điểm kỹ thuật — màn chấm là
// **S2.4**, và nó chưa có.
//
// Nên vòng này cưỡng chế một vế hẹp và NÓI RA: chính sách phải khai **đúng một** thành phần, mã
// `gia`, đơn vị `TIEN`. Mọi hình dạng khác bị TỪ CHỐI bằng một câu gọi tên — chứ không âm thầm
// lấy `0` cho thành phần không có nguồn. Một `0` ở đây là một con số đi vào bảng xếp hạng mà
// không ai giải thích được, đúng thứ ràng buộc ⑷ của `PRODUCT` §8⑸ cấm.
//
// ----------------------------------------------------------------------------------------------
// XẾP HẠNG: HAI BÁO GIÁ BẰNG NHAU NHẬN CÙNG MỘT HẠNG
// ----------------------------------------------------------------------------------------------
// ADR-052 cố ý KHÔNG chốt luật phá hoà. Nên lớp này không bịa một luật: hai `effective_cost` bằng
// nhau nhận CÙNG một `rank` (xếp hạng thi đấu: 1, 2, 2, 4). Câu ấy đọc được là *"hai báo giá này
// bằng nhau"* — còn gán cho chúng hai hạng khác nhau là khai một thứ tự mà dữ liệu không có.
// ==============================================================================================

import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { PERMISSIONS, requirePermission, resolveSessionActor } from "@trustprocure/identity";
import { nemTuChoi, type MaTuChoiTrangThai } from "./tu-choi-vao-so.js";
import {
  laTuChoi,
  tinhChiPhiHieuDung,
  type ThanhPhanChinhSach,
  type ThanhPhanDaQuyDoi,
} from "./chi-phi-hieu-dung.js";

/** Mã thành phần DUY NHẤT có nguồn dữ liệu ở vòng này — `bid_so_tien(payload->>'totalAmount')`. */
export const MA_THANH_PHAN_GIA = "gia";

/**
 * Các trạng thái RFQ mà một lượt chấm đi ra được — hai cạnh vào `EVALUATING` của bảng cạnh.
 *
 * ~~`UNSEALED` là trạng thái DUY NHẤT — cạnh `UNSEALED->EVALUATING` của `011`.~~
 * [S1.108 / S2.5 / 059] Hai, không một: `BAFO_UNSEALED->EVALUATING` là cạnh chấm LẠI sau vòng
 * BAFO, và một lượt chấm thứ hai ra đời ở đó (spec §4.3 — hàng cũ ở lại nguyên vẹn, vì *"vì sao
 * xếp hạng đổi"* là một câu hỏi kiểm toán thật). Một hằng CHUỖI ở đây sẽ làm cạnh mới sống trong
 * bảng cạnh mà không hàm nào đi qua được.
 *
 * `rfq_evaluations` KHÔNG có `UNIQUE` trên `rfq_id`, nên lượt thứ hai không cần một migration —
 * đã đo ở `057`.
 */
export const TRANG_THAI_CHAM_DUOC = ["UNSEALED", "BAFO_UNSEALED"] as const;

// [S1.116 / khoản 239] Suy TỪ `MaTuChoiTrangThai` chứ không viết lại: một mã không có dòng
// trong `VAO_SO` thì KHÔNG biên dịch được — kiểu cưỡng chế từ vựng, rẻ hơn một cổng đọc mã.
export type LyDoTuChoiLuot = Extract<
  MaTuChoiTrangThai,
  | "RFQ_KHONG_CHAM_DUOC"
  | "CHINH_SACH_CHUA_KHAI_TRONG_SO"
  | "THANH_PHAN_CHUA_CO_NGUON"
  | "LECH_TIEN_TE"
  | "KHONG_CO_BAO_GIA_DOC_DUOC"
>;

/**
 * Một lần từ chối của cổng đánh giá. Nó mang `lyDo` máy đọc được VÀ một câu người đọc được —
 * hai thứ khác nhau, và spec §4.1 đòi câu thứ hai gọi tên được phiên bản chính sách.
 */
export class DanhGiaTuChoiError extends Error {
  constructor(
    readonly lyDo: LyDoTuChoiLuot,
    thongDiep: string,
  ) {
    super(thongDiep);
    this.name = "DanhGiaTuChoiError";
  }
}

export interface TaoLuotDanhGiaInput {
  readonly rfqId: string;
  readonly actorSessionId: string;
}

export interface HangXepHang {
  readonly bidVersionId: string;
  readonly effectiveCost: string | null;
  readonly rank: number | null;
  readonly components: readonly ThanhPhanDaQuyDoi[];
}

export interface LuotDanhGia {
  readonly evaluationId: string;
  readonly policyId: string;
  readonly policyVersion: number;
  readonly currency: string;
  readonly lines: readonly HangXepHang[];
}

interface HangChinhSach {
  readonly id: string;
  readonly version: number;
  readonly eval_components: readonly ThanhPhanChinhSachTho[] | null;
}

/** Hình dạng ĐÃ ĐƯỢC `057` cưỡng chế: ba trường, cả ba là chuỗi. */
interface ThanhPhanChinhSachTho {
  readonly ma: string;
  readonly don_vi: string;
  readonly he_so: string;
}

interface HangBaoGia {
  readonly bid_version_id: string;
  readonly tien: string | null;
  readonly currency: string | null;
}

/**
 * Đọc phiên bản chính sách HIỆN HÀNH và khẳng định nó đã khai trọng số.
 *
 * **Vì sao là phiên bản hiện hành, không phải `rfq_budgets.policy_id`:** spec §4.1 viết câu từ
 * chối là *"tạo PHIÊN BẢN MỚI trước khi chấm"*, và câu ấy chỉ có nghĩa nếu lượt chấm đọc bản mới
 * nhất. Ghim vào phiên bản của ngân sách thì tạo bản mới chẳng giúp gì, và mọi RFQ ra đời trước
 * S2 sẽ không bao giờ chấm được.
 */
async function docChinhSach(client: pg.PoolClient, orgId: string): Promise<{
  readonly id: string;
  readonly version: number;
  readonly thanhPhan: readonly ThanhPhanChinhSach[];
}> {
  const { rows } = await client.query<HangChinhSach>(
    `SELECT o.id, o.version, o.eval_components
       FROM public.org_procurement_policies o
      WHERE o.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
      ORDER BY o.version DESC
      LIMIT 1`,
    [orgId],
  );
  const cs = rows[0];
  if (cs === undefined) {
    throw new DanhGiaTuChoiError(
      "CHINH_SACH_CHUA_KHAI_TRONG_SO",
      "Tổ chức chưa có một phiên bản chính sách mua sắm nào; tạo chính sách trước khi chấm.",
    );
  }
  if (cs.eval_components === null) {
    throw new DanhGiaTuChoiError(
      "CHINH_SACH_CHUA_KHAI_TRONG_SO",
      `Chính sách phiên bản ${String(cs.version)} chưa khai trọng số đánh giá; tạo phiên bản mới trước khi chấm.`,
    );
  }
  const tp = cs.eval_components.map((t) => ({ ma: t.ma, donVi: t.don_vi, heSo: t.he_so }));
  // Vế HẸP của vòng này, nói ra ở khối đầu tệp: đúng một thành phần, mã `gia`, đơn vị `TIEN`.
  const laVeHep = tp.length === 1 && tp[0]?.ma === MA_THANH_PHAN_GIA && tp[0]?.donVi === "TIEN";
  if (!laVeHep) {
    throw new DanhGiaTuChoiError(
      "THANH_PHAN_CHUA_CO_NGUON",
      `Chính sách phiên bản ${String(cs.version)} khai thành phần mà vòng này chưa có nguồn dữ liệu: ` +
        `chỉ mã "${MA_THANH_PHAN_GIA}" (đơn vị TIEN) đọc được từ báo giá. Điểm phi giá cần màn chấm của S2.4.`,
    );
  }
  return {
    id: cs.id,
    version: cs.version,
    thanhPhan: tp as readonly ThanhPhanChinhSach[],
  };
}

/**
 * ~~Đọc mọi báo giá ĐÃ MỞ của một gói thầu, cùng số tiền đọc được và đơn vị tiền của nó.~~
 *
 * [S1.108 / S2.5] MỘT hàng cho MỘT luồng báo giá — phiên bản `version` LỚN NHẤT trong số đã mở.
 *
 * ~~Bản trước đọc MỌI hàng của `rfq_unsealed_bids` thuộc RFQ.~~ Câu ấy đúng cho tới khi có vòng
 * BAFO, và nó đúng vì một lý do KHÔNG ai viết ra: `apps/unseal-worker/src/index.ts:511` mở phong bì
 * bằng `SELECT DISTINCT ON (v.bid_id) … ORDER BY v.bid_id, v.version DESC` — **một** phong bì mỗi
 * luồng — nên bảng bản rõ hôm nay đã có đúng một hàng cho mỗi nhà cung cấp, và một phép đọc "mọi
 * hàng" cho ra cùng kết quả.
 *
 * Vòng BAFO phá tiền đề ấy: lượt mở thầu THỨ HAI thêm một hàng bản rõ cho mỗi nhà cung cấp top-N,
 * còn hàng vòng MỘT của họ ở lại (`rfq_unsealed_bids` là bảng chỉ-ghi-thêm, và lịch sử ấy là một
 * câu hỏi kiểm toán thật). Đọc "mọi hàng" khi ấy xếp hạng một nhà cung cấp HAI LẦN — một lần với
 * giá cũ, một lần với giá mới — và bảng xếp hạng thôi là một thứ tự trên NGƯỜI DỰ THẦU.
 *
 * Luật ở đây là bản sao của luật mà worker đã chọn một lần: **lần nộp SAU thay lần nộp TRƯỚC**.
 * Nó cũng là luật đúng cho nhà cung cấp NGOÀI top-N — họ không được mời nộp lại, nên phiên bản mới
 * nhất của họ vẫn là báo giá vòng một, và họ vẫn đứng trong bảng. BAFO cải thiện giá của top-N; nó
 * không loại ai khỏi cuộc thi.
 */
async function docBaoGia(
  client: pg.PoolClient,
  orgId: string,
  rfqId: string,
): Promise<readonly HangBaoGia[]> {
  const { rows } = await client.query<HangBaoGia>(
    `SELECT DISTINCT ON (v.bid_id)
            u.bid_version_id,
            public.bid_so_tien((u.payload OPERATOR(pg_catalog.->>) 'totalAmount'))::pg_catalog.text AS tien,
            (u.payload OPERATOR(pg_catalog.->>) 'currency') AS currency
       FROM public.rfq_unsealed_bids u
       JOIN public.vendor_bid_versions v ON v.id OPERATOR(pg_catalog.=) u.bid_version_id
                                       AND v.org_id OPERATOR(pg_catalog.=) u.org_id
       JOIN public.vendor_bids b        ON b.id OPERATOR(pg_catalog.=) v.bid_id
                                       AND b.org_id OPERATOR(pg_catalog.=) v.org_id
       JOIN public.rfq_invitations i    ON i.id OPERATOR(pg_catalog.=) b.invitation_id
                                       AND i.org_id OPERATOR(pg_catalog.=) b.org_id
      WHERE u.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND i.rfq_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
      ORDER BY v.bid_id, v.version DESC`,
    [orgId, rfqId],
  );
  return rows;
}

/**
 * Xếp hạng thi đấu trên các số tiền ĐỌC ĐƯỢC: 1, 2, 2, 4. Báo giá không đọc được giá không có
 * hạng, và nó KHÔNG chiếm một chỗ trong dãy — nó không tham gia thứ tự nào cả.
 */
function xepHang(gia: readonly (string | null)[]): readonly (number | null)[] {
  const doc = gia
    .map((g, i) => ({ i, v: g === null ? null : BigInt(g.replace(".", "")) }))
    .filter((x): x is { i: number; v: bigint } => x.v !== null)
    .sort((a, b) => (a.v < b.v ? -1 : a.v > b.v ? 1 : 0));
  const hang = new Array<number | null>(gia.length).fill(null);
  let truoc: bigint | null = null;
  let hangTruoc = 0;
  doc.forEach((x, viTri) => {
    const h = truoc !== null && x.v === truoc ? hangTruoc : viTri + 1;
    hang[x.i] = h;
    truoc = x.v;
    hangTruoc = h;
  });
  return hang;
}

/**
 * Tạo một lượt đánh giá cho một gói thầu ĐÃ MỞ THẦU, và chuyển RFQ sang `EVALUATING`.
 *
 * **J6**: một hàng sổ `RFQ_EVALUATED` cho lượt thành công; mọi lần từ chối QUYỀN đã nằm lại trong
 * `requirePermission`. Các lần từ chối TRẠNG THÁI (chính sách chưa khai, lệch tiền tệ, RFQ sai
 * trạng thái) là từ chối trạng thái chứ không phải từ chối quyền — cùng hạng với các nhánh của
 * `dieuPhoiLaiSauKhiChet`, nên chúng không đi qua đường ghi sổ từ chối của cổng.
 */
export async function taoLuotDanhGia(
  client: pg.PoolClient,
  orgId: string,
  input: TaoLuotDanhGiaInput,
  auditPool: pg.Pool,
): Promise<LuotDanhGia> {
  await assertTenantBound(client, orgId, "taoLuotDanhGia");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  await requirePermission(
    client,
    {
      userId: actor.id,
      orgId,
      permission: PERMISSIONS.EVALUATION_PERFORM,
      // [S1.107 / lượt soi ngang 77 — ②] `RFQ`, KHÔNG `RFQ_EVALUATION`. Cặp này đi NGUYÊN
      // VĂN vào hàng sổ `PERMISSION_DENIED` (`rbac.ts` truyền thẳng cho `appendAuditEvent`),
      // nên một `resource_type` khai một loại còn `resource_id` mang id của loại khác là một
      // câu SAI ghi vào sổ kiểm toán: ai nối `resource_id` sang `rfq_evaluations` sẽ được 0
      // hàng cho một sự kiện CÓ THẬT. Ở đường ghi còn một lý do thứ hai: lúc cổng quyền chạy,
      // lượt đánh giá CHƯA tồn tại. Mọi anh em trong kho khớp cặp — `RFQ`+rfqId ở
      // `buildComparisonTable` và `requestUnseal`, `UNSEAL_REQUEST`+unsealId ở `gate.ts` —
      // và hàng sổ THÀNH CÔNG ngay dưới đây đã khớp đúng (`rfq_evaluation`+evaluationId).
      resourceType: "RFQ",
      resourceId: input.rfqId,
    },
    auditPool,
  );

  // `FOR NO KEY UPDATE`: giữ hàng RFQ suốt lượt chấm, để câu `UPDATE` trạng thái ở cuối không đua
  // với một lượt chấm thứ hai. Cùng khuôn `dieuPhoiLaiSauKhiChet`.
  const { rows: rfq } = await client.query<{ status: string }>(
    `SELECT p.status FROM public.rfq_packages p
      WHERE p.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND p.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
      FOR NO KEY UPDATE`,
    [orgId, input.rfqId],
  );
  const trangThai = rfq[0]?.status;
  if (trangThai === undefined || !(TRANG_THAI_CHAM_DUOC as readonly string[]).includes(trangThai)) {
    return nemTuChoi(
      auditPool,
      orgId,
      actor.id,
      input.rfqId,
      new DanhGiaTuChoiError(
        "RFQ_KHONG_CHAM_DUOC",
        `Chỉ chấm được gói thầu đang ở trạng thái ${TRANG_THAI_CHAM_DUOC.join(" hoặc ")}; ` +
          `gói này đang ở ${trangThai ?? "(không tìm thấy)"}.`,
      ),
    );
  }

  const cs = await docChinhSach(client, orgId);
  const baoGia = await docBaoGia(client, orgId, input.rfqId);

  const docDuoc = baoGia.filter((b) => b.tien !== null);
  if (docDuoc.length === 0) {
    throw new DanhGiaTuChoiError(
      "KHONG_CO_BAO_GIA_DOC_DUOC",
      "Không một báo giá nào của gói thầu này có số tiền đọc được; không có gì để xếp hạng.",
    );
  }
  // Spec §2.3⑻: lệch tiền tệ thì TỪ CHỐI cả lượt. Mạnh hơn `buildComparisonTable` (nó trả `null`
  // vì nó chỉ HIỂN THỊ) là cố ý — một `rank` thì không có giá trị `null` nào có nghĩa.
  const donVi = [...new Set(docDuoc.map((b) => b.currency))];
  if (donVi.length !== 1 || donVi[0] === null) {
    throw new DanhGiaTuChoiError(
      "LECH_TIEN_TE",
      `Các báo giá đọc được không cùng một đơn vị tiền (${donVi.map((d) => d ?? "(trống)").join(", ")}); ` +
        "chuẩn hoá đơn vị tiền trước khi chấm.",
    );
  }
  // `donVi[0]` đã qua hai vế lọc ngay trên (đúng một phần tử, và không `null`), nhưng TS không
  // thu hẹp được qua chỉ số mảng — nên khẳng định lại ở đây thay vì ép kiểu.
  const currency = donVi[0] ?? "";
  if (currency === "") throw new Error("đơn vị tiền rỗng sau khi đã lọc — bất khả");

  const tinh = baoGia.map((b) => {
    if (b.tien === null) return { bidVersionId: b.bid_version_id, gia: null, components: [] as ThanhPhanDaQuyDoi[] };
    const kq = tinhChiPhiHieuDung(cs.thanhPhan, [{ ma: MA_THANH_PHAN_GIA, giaTri: b.tien }]);
    if (laTuChoi(kq)) {
      // Không với tới được qua đường công khai: `docChinhSach` đã khẳng định hình dạng hẹp, và
      // `bid_so_tien` đã lọc bốn ca của `020`. Fail-closed tường minh thay vì một `null` im lặng.
      throw new DanhGiaTuChoiError(
        "THANH_PHAN_CHUA_CO_NGUON",
        `Không tính được chi phí hiệu dụng cho một báo giá (${kq.lyDo}).`,
      );
    }
    return { bidVersionId: b.bid_version_id, gia: kq.effectiveCost, components: [...kq.components] };
  });

  const hang = xepHang(tinh.map((t) => t.gia));

  const { rows: luot } = await client.query<{ id: string }>(
    `INSERT INTO public.rfq_evaluations
       (org_id, rfq_id, policy_id, currency, created_by, created_by_session_id)
     VALUES ($1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.uuid, $4::pg_catalog.text,
             $5::pg_catalog.uuid, $6::pg_catalog.uuid)
     RETURNING id`,
    [orgId, input.rfqId, cs.id, currency, actor.id, input.actorSessionId],
  );
  const evaluationId = luot[0]?.id;
  if (evaluationId === undefined) throw new Error("Không ghi được lượt đánh giá.");

  const lines: HangXepHang[] = [];
  for (const [i, t] of tinh.entries()) {
    await client.query(
      `INSERT INTO public.rfq_evaluation_lines
         (org_id, evaluation_id, bid_version_id, effective_cost, components, rank)
       VALUES ($1::pg_catalog.uuid, $2::pg_catalog.uuid, $3::pg_catalog.uuid,
               $4::pg_catalog.numeric, $5::pg_catalog.jsonb, $6::pg_catalog.int4)`,
      [orgId, evaluationId, t.bidVersionId, t.gia, JSON.stringify(t.components), hang[i] ?? null],
    );
    lines.push({
      bidVersionId: t.bidVersionId,
      effectiveCost: t.gia,
      rank: hang[i] ?? null,
      components: t.components,
    });
  }

  // Cạnh `UNSEALED->EVALUATING` có từ `011:147` và CHƯA AI ĐI QUA. Câu này là thứ làm nó sống.
  // Vế `AND status IN (...)` là lớp CÓ THẨM QUYỀN cho ca trạng thái đổi giữa lần đọc ở trên và
  // câu này; phép kiểm ở trên chỉ làm thông điệp nói được VÌ SAO.
  //
  // [S1.108 / S2.5] Hai giá trị viết NỘI TUYẾN, KHÔNG nội suy `${TRANG_THAI_CHAM_DUOC}`: khoản
  // nợ ở `test-int` đã đo rằng một hằng nội suy vào câu SQL làm cổng `PREPARE` của `[T3]` đọc
  // thành một tham số và đỏ, trong khi mã vẫn chạy đúng. Hai bản sao ở đây được khoá bằng một
  // test đọc cả hai.
  const doi = await client.query(
    `UPDATE public.rfq_packages
        SET status = 'EVALUATING'
      WHERE org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid
        AND status IN ('UNSEALED', 'BAFO_UNSEALED')`,
    [orgId, input.rfqId],
  );
  if (doi.rowCount !== 1) {
    return nemTuChoi(
      auditPool,
      orgId,
      actor.id,
      input.rfqId,
      new DanhGiaTuChoiError(
        "RFQ_KHONG_CHAM_DUOC",
        "Trạng thái gói thầu đã đổi giữa lúc chấm; lượt đánh giá này không được ghi nhận.",
      ),
    );
  }

  await appendAuditEvent(client, orgId, {
    actorType: "USER",
    actorId: actor.id,
    action: "RFQ_EVALUATED",
    resourceType: "rfq_evaluation",
    resourceId: evaluationId,
    payload: {
      rfqId: input.rfqId,
      policyId: cs.id,
      policyVersion: cs.version,
      currency,
      soBaoGia: lines.length,
      soDocDuoc: docDuoc.length,
      evaluatedBySessionId: input.actorSessionId,
    },
  });

  return { evaluationId, policyId: cs.id, policyVersion: cs.version, currency, lines };
}
