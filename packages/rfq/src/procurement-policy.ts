import type pg from "pg";
import { appendAuditEvent, assertTenantBound } from "@trustprocure/audit";
import { PERMISSIONS, requirePermission, resolveSessionActor } from "@trustprocure/identity";
import { RfqError } from "./rfq.js";

// =============================================================================================
// ADR-017 — NGƯỠNG PHÊ DUYỆT KÉP LÀ CHÍNH SÁCH THEO TỔ CHỨC, VÀ PHÂN LOẠI PHẢI TÁI LẬP ĐƯỢC
//
// Trước file này, `rfq_packages.requires_dual_approval` là một cờ mà NGƯỜI GỌI đặt: `createRfq`
// nhận `requiresDualApproval ?? true` và không một dòng mã nào tính nó. Mặc định `true` đúng là
// mặc định đóng — nhưng D2 (*"RFQ vượt ngưỡng cần 2 phê duyệt"*) khi ấy chưa có NGƯỠNG nào cả.
//
// ---------------------------------------------------------------------------------------------
// AI TÍNH PHÉP SO — VÀ VÌ SAO CÂU TRẢ LỜI KHÔNG PHẢI "TYPESCRIPT"
// ---------------------------------------------------------------------------------------------
// ADR-017 mục 2 viết "ứng dụng tính, CSDL lưu kết luận". Cài đặt này giữ nguyên phần TRÁCH NHIỆM
// — ứng dụng chọn chính sách, ghi ngân sách, và ra lệnh phân loại — nhưng đặt PHÉP SO ở SQL, qua
// `public.rfq_can_phe_duyet_kep`. Hai lý do, cả hai đều cụ thể:
//
//   ⑴ Trigger `rfq_packages_kiem_nguong_phe_duyet_kep` (014) BẮT BUỘC phải có phép so ấy để cưỡng
//      chế. Nếu TypeScript giữ một bản thứ hai, đó là hai bản sao của một luật — đúng thứ đã hỏng
//      hai lần ở 002 và đúng thứ `tax-code.test.ts` phải dựng một meta-test để canh.
//   ⑵ Tiền trong JavaScript là `double`. `numeric(18,2)` của Postgres thì không. Một phép so tiền
//      viết ở JS là một phép so SAI theo một cách khó thấy.
//
// Đây là một THU HẸP có ghi tên so với chữ của ADR-017, không phải một sự đi chệch: kết luận vẫn
// được LƯU ở `rfq_packages`, và bằng chứng vẫn được lưu ở `rfq_budgets`.
// =============================================================================================

export const CURRENCIES = ["VND", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface ProcurementPolicyRecord {
  readonly id: string;
  readonly version: number;
  /** Chuỗi, không phải `number`: `numeric(18,2)` không đi lọt qua `double` mà còn nguyên. */
  readonly dualApprovalThreshold: string;
  readonly currency: Currency;
  readonly effectiveFrom: Date;
}

/**
 * [S1.107 / lượt soi ngang 77 — CAO ②] MỘT THÀNH PHẦN TRỌNG SỐ, ĐÚNG HÌNH DẠNG `057` CƯỠNG CHẾ.
 *
 * Khoá viết theo lối CSDL (`don_vi`, `he_so`) chứ không camelCase, và đó là một quyết định chứ
 * không một sự cẩu thả: hình dạng bên trong của `eval_components` là một hợp đồng do `CHECK` của
 * `057` cưỡng chế, `taoLuotDanhGia` đọc ĐÚNG ba khoá ấy, và một cách viết thứ hai ở cửa API sẽ là
 * CÁCH VIẾT THỨ BA cho cùng một hợp đồng. Kho này đã trả giá nhiều lần cho hai bản sao trôi khỏi
 * nhau — `HINH_DANG_CHUAN`, `TAX_CODE_PATTERN`, `RFQ_TRANSITIONS`.
 */
export interface ThanhPhanTrongSoVao {
  readonly ma: string;
  readonly don_vi: string;
  readonly he_so: string;
}

export interface CreateProcurementPolicyInput {
  readonly version: number;
  readonly dualApprovalThreshold: string;
  readonly currency: Currency;
  /**
   * Trọng số chấm thầu. `undefined` hay `null` ⇒ tổ chức KHÔNG chấm được — và đó là trạng thái
   * của mọi tổ chức trước vòng này, vì không đường sản xuất nào ghi được cột ấy (lượt soi ngang
   * 77, CAO ②: `056` cấp GRANT từ S1.102, `057` cưỡng chế hình dạng từ S1.105, và route chấm
   * thầu của S1.106 vì thế luôn trả 422 `CHINH_SACH_CHUA_KHAI_TRONG_SO` ngoài cụm test).
   *
   * Tầng này CỐ Ý mỏng: nó kiểm hình dạng NGOÀI (mảng không rỗng, ba khoá chuỗi) rồi giao cho
   * `CHECK` của `057` phán xử phần còn lại — `don_vi` thuộc {TIEN, DIEM}, ít nhất một `TIEN`,
   * khuôn của `he_so`. Một bản sao thứ hai của luật ấy ở TypeScript là một bản sao sẽ trôi.
   */
  readonly evalComponents?: readonly ThanhPhanTrongSoVao[] | null;
  /** Số nhà thầu vào vòng BAFO. `0` nghĩa là tổ chức KHÔNG dùng BAFO — xem `056`. */
  readonly bafoTopN?: number | null;
  /**
   * [S1.169 / S3.1c] Bậc giá trị (spec S3 §4.1). Khoá viết theo lối CSDL (`tu_so_tien`, `so_ncc_toi_thieu`, …), cùng lý do
   * `ThanhPhanTrongSoVao`: hình dạng bên trong là hợp đồng do trigger `chinh_sach_kiem_bac` (`069`) cưỡng chế — mười khoá
   * đúng kiểu, bậc 0, cận dưới tăng ngặt, bậc đấu thầu chính thức chỉ đứng cuối — và một cách viết thứ hai ở TypeScript
   * là một bản sao sẽ trôi. Tầng này chỉ kiểm hình dạng NGOÀI. `undefined` hay `null` ⇒ phiên bản không bậc.
   */
  readonly tiers?: readonly Readonly<Record<string, unknown>>[] | null;
  /** [S1.169] Hai cột mức chính sách (`069`): tất-cả-hoặc-không cùng `tiers`, dương — CSDL phán. */
  readonly chiaNhoCuaSoNgay?: number | null;
  readonly thamDinhHieuLucThang?: number | null;
  /**
   * [S1.256 / S4.5b] Nhóm khoá `benchmark` (spec S4 §4.1): sáu khoá, mọi giá trị là CHUỖI. `undefined` hay `null` ⇒ phiên bản
   * KHÔNG cấu hình benchmark — benchmark của gói ghim phiên bản này hiện *"chưa cấu hình"*, lượt chấm vẫn chạy. Tầng này chỉ kiểm
   * hình dạng NGOÀI (một object các chuỗi); tập khoá, biên và thứ tự ngưỡng là của `CHECK` `org_procurement_policies_benchmark_hinh_dang`.
   */
  readonly benchmark?: Readonly<Record<string, string>> | null;
  readonly actorSessionId: string;
}

interface HangChinhSach {
  id: string;
  version: number;
  dual_approval_threshold: string;
  currency: Currency;
  effective_from: Date;
}

const COT_CHINH_SACH = "id, version, dual_approval_threshold, currency, effective_from";

function doiChinhSach(h: HangChinhSach): ProcurementPolicyRecord {
  return {
    id: h.id,
    version: h.version,
    dualApprovalThreshold: h.dual_approval_threshold,
    currency: h.currency,
    effectiveFrom: h.effective_from,
  };
}

/**
 * Hình dạng một số tiền thập phân không dấu, tối đa hai chữ số lẻ.
 *
 * Phép kiểm HÌNH DẠNG, không phải phép kiểm giá trị: `numeric(18,2)` ở CSDL là lớp có thẩm quyền,
 * và nó cũng là lớp duy nhất chặn được `NaN`/`Infinity` — hai giá trị mà `numeric` NHẬN, và
 * `NaN > 0` là TRUE trong Postgres. Dự án đã đo điều đó một lần ở `rfq_items.quantity`.
 */
export const MONEY_PATTERN = /^(0|[1-9][0-9]{0,15})(\.[0-9]{1,2})?$/;

function batBuocTien(giaTri: string, ten: string): string {
  const cat = giaTri.trim();
  if (!MONEY_PATTERN.test(cat)) {
    throw new RfqError(`${ten} phải là số thập phân không âm, tối đa 2 chữ số lẻ`);
  }
  return cat;
}

/**
 * [S1.107] Hình dạng NGOÀI của `evalComponents`, và chỉ hình dạng ngoài. Trả chuỗi JSON để đưa
 * thẳng xuống `$7::jsonb`, hay `null` khi người gọi không khai.
 *
 * `056` đòi `(eval_components IS NULL) = (bafo_top_n IS NULL)`, nên hai trường đi thành một BỘ:
 * khai một mà thiếu cái kia là một lần NÉM có tên ở đây, không phải một lần 23514 khó đọc.
 */
function trongSoJson(input: CreateProcurementPolicyInput): { tp: string | null; topN: number | null } {
  // `unknown` chứ không phải kiểu đã khai: người gọi gần nhất là một thân HTTP, và kiểu ở biên
  // giới TypeScript là một lời HỨA của người gọi, không phải một phép đo. Kiểm lại ở đây thì một
  // thân dị dạng dừng ở một lỗi CÓ TÊN thay vì ở `23514` của `057`.
  const tho: unknown = input.evalComponents ?? null;
  const topN = input.bafoTopN ?? null;
  if (tho === null) {
    if (topN !== null) throw new RfqError("bafoTopN chỉ đặt được cùng evalComponents");
    return { tp: null, topN: null };
  }
  const mang: readonly unknown[] = Array.isArray(tho) ? (tho as readonly unknown[]) : [];
  if (mang.length === 0) throw new RfqError("evalComponents phải là mảng không rỗng");
  const ra: { ma: string; don_vi: string; he_so: string }[] = [];
  for (const t of mang) {
    const o = t as Record<string, unknown> | null;
    if (typeof o?.ma !== "string" || typeof o.don_vi !== "string" || typeof o.he_so !== "string") {
      throw new RfqError('mỗi thành phần cần ba trường chuỗi "ma", "don_vi", "he_so"');
    }
    ra.push({ ma: o.ma, don_vi: o.don_vi, he_so: o.he_so });
  }
  if (topN === null || !Number.isInteger(topN) || topN < 0) {
    throw new RfqError("bafoTopN phải là số nguyên không âm khi có evalComponents");
  }
  return { tp: JSON.stringify(ra), topN };
}

/**
 * [S1.169 / S3.1c] Hình dạng NGOÀI của bậc và hai cột mức, và chỉ hình dạng ngoài: mảng không rỗng các đối tượng, hai số
 * nguyên. Mọi luật còn lại — khoá, kiểu, thứ tự bậc, tất-cả-hoặc-không, *tổ chức đã bật thì phải có bậc* — là của `069`.
 */
function bacJson(input: CreateProcurementPolicyInput): { bac: string | null; chiaNho: number | null; thamDinh: number | null } {
  const tho: unknown = input.tiers ?? null;
  const chiaNho = input.chiaNhoCuaSoNgay ?? null;
  const thamDinh = input.thamDinhHieuLucThang ?? null;
  for (const [ten, n] of [["chiaNhoCuaSoNgay", chiaNho], ["thamDinhHieuLucThang", thamDinh]] as const) {
    if (n !== null && !Number.isInteger(n)) throw new RfqError(`${ten} phải là số nguyên`);
  }
  if (tho === null) return { bac: null, chiaNho, thamDinh };
  const mang: readonly unknown[] = Array.isArray(tho) ? (tho as readonly unknown[]) : [];
  if (mang.length === 0) throw new RfqError("tiers phải là mảng không rỗng");
  for (const b of mang) {
    if (b === null || typeof b !== "object" || Array.isArray(b)) throw new RfqError("mỗi bậc của tiers phải là một đối tượng");
  }
  return { bac: JSON.stringify(mang), chiaNho, thamDinh };
}

/** [S1.256 / S4.5b] Hình dạng NGOÀI của nhóm khoá `benchmark` — object, mọi giá trị là chuỗi. */
function benchmarkJson(input: CreateProcurementPolicyInput): string | null {
  const tho: unknown = input.benchmark ?? null;
  if (tho === null) return null;
  if (typeof tho !== "object" || Array.isArray(tho)) throw new RfqError("benchmark phải là một object");
  for (const v of Object.values(tho as Record<string, unknown>)) {
    if (typeof v !== "string") throw new RfqError("mọi giá trị của benchmark phải là chuỗi");
  }
  return JSON.stringify(tho);
}

/**
 * Thêm MỘT PHIÊN BẢN chính sách. Không có hàm sửa, và đó là toàn bộ cơ chế: `app_api` không có
 * `UPDATE`/`DELETE` trên bảng này (014). Sửa được ngưỡng của một phiên bản đã dùng nghĩa là phân
 * loại của mọi RFQ cũ đổi theo mà không ai biết — tức "tái lập được" thành một lời hứa rỗng.
 */
export async function createProcurementPolicy(
  client: pg.PoolClient,
  orgId: string,
  input: CreateProcurementPolicyInput,
): Promise<ProcurementPolicyRecord> {
  await assertTenantBound(client, orgId, "createProcurementPolicy");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  if (!Number.isInteger(input.version) || input.version <= 0) {
    throw new RfqError("version phải là số nguyên dương");
  }
  const nguong = batBuocTien(input.dualApprovalThreshold, "dualApprovalThreshold");
  if (!CURRENCIES.includes(input.currency)) {
    throw new RfqError("currency chỉ nhận VND hoặc USD");
  }

  const { tp, topN } = trongSoJson(input);
  const { bac, chiaNho, thamDinh } = bacJson(input);
  const benchmark = benchmarkJson(input);

  const { rows } = await client.query<HangChinhSach>(
    `INSERT INTO public.org_procurement_policies
       (org_id, version, dual_approval_threshold, currency, eval_components, bafo_top_n,
        created_by, created_by_session_id, tiers, chia_nho_cua_so_ngay, tham_dinh_hieu_luc_thang, benchmark)
     VALUES ($1, $2, $3::pg_catalog.numeric, $4, $5::pg_catalog.jsonb, $6, $7, $8, $9::pg_catalog.jsonb, $10, $11, $12::pg_catalog.jsonb)
     RETURNING ${COT_CHINH_SACH}`,
    [orgId, input.version, nguong, input.currency, tp, topN, actor.id, actor.sessionId, bac, chiaNho, thamDinh, benchmark],
  );
  const hang = rows[0];
  if (hang === undefined) throw new RfqError("Câu INSERT org_procurement_policies không trả về hàng");

  // `payload` mang NGƯỠNG. Đây là ngoại lệ có lý do với thói quen "không đưa số vào sổ": ngưỡng
  // KHÔNG phải giá thầu và không thuộc bí mật nào của A3/A4 — nó là một tham số quản trị, và một
  // lần đổi ngưỡng là đúng loại sự kiện mà kiểm toán viên cần thấy ngay trong sổ.
  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "PROCUREMENT_POLICY_CREATED",
    resourceType: "procurement_policy",
    resourceId: hang.id,
    // [S1.107] `soThanhPhan` chứ không phải chính các trọng số: mã thành phần là dữ liệu
    // quản trị, nhưng một hàng sổ nên nói CÓ HAY KHÔNG và BAO NHIÊU, không chép cả cấu hình.
    payload: {
      version: hang.version,
      threshold: nguong,
      currency: hang.currency,
      soThanhPhan: input.evalComponents?.length ?? 0,
      bafoTopN: topN,
      // [S1.169] Cùng lý do `soThanhPhan`: sổ nói phiên bản có bậc hay không và bao nhiêu bậc; ma trận nằm ở chính hàng
      // chính sách, bất biến, xuất được.
      soBac: input.tiers?.length ?? 0,
      // [S1.256 / S4.5b] Có cấu hình benchmark hay không — ngưỡng nằm ở chính hàng chính sách, bất biến, xuất được.
      coBenchmark: benchmark !== null,
    },
  });

  return doiChinhSach(hang);
}

/** [S1.169 / S3.1c] Chữ ký thứ hai của một phiên bản chính sách, như CSDL đã đóng dấu. */
export interface ChuKyChinhSach {
  readonly policyId: string;
  readonly version: number;
  readonly signedBy: string;
  readonly signedAt: Date;
  /** `to_chuc_da_bat_s3` ngay sau lần ký: lần ký đầu tiên của một phiên bản có bậc BẬT S3 cho tổ chức, một chiều (ADR-080 ⑵). */
  readonly daBat: boolean;
}

/**
 * [S1.169 / S3.1c / ADR-082 ⑺] Ký một phiên bản chính sách có bậc — và lần ký đầu tiên như thế BẬT S3 cho tổ chức.
 *
 * Mọi luật của lần ký nằm ở trigger `chinh_sach_kiem_nguoi_ky` (`069`, thân từ `097_chan_bat_s3_khi_con_goi_cho`): phiên bản
 * có bậc, người ký khác người tạo và giữ `policy.manage`, là phiên bản MỚI NHẤT, đã tới ngày hiệu lực, dưới khoá tư vấn theo tổ
 * chức; [S1.236 / khoản 261] lần ký BẬT S3 (tổ chức chưa bật) chỉ nhận dưới READ COMMITTED và khi tổ chức không còn gói chờ
 * duyệt — gói nộp dưới luật MVP1 không đi qua lần bật; `signed_by` dẫn xuất từ phiên (`kiem_danh_tinh_theo_phien`); mỗi phiên
 * bản một chữ ký (`UNIQUE`). Hàm này không kiểm lại một luật nào trong số ấy: một bản sao ở TypeScript chỉ thêm một chỗ
 * để trôi, và lời từ chối của trigger đã có tên (`RAISE` ⇒ 422).
 *
 * Cờ triển khai (ADR-105) KHÔNG nằm ở đây mà ở route — hàm này là cơ chế, route là cửa.
 */
export async function kyPhienBanChinhSach(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly policyId: string; readonly actorSessionId: string },
): Promise<ChuKyChinhSach> {
  await assertTenantBound(client, orgId, "kyPhienBanChinhSach");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  const { rows } = await client.query<{ signed_at: Date }>(
    `INSERT INTO public.org_policy_signatures (org_id, policy_id, signed_by, signed_by_session_id)
     VALUES ($1, $2, $3, $4)
     RETURNING signed_at`,
    [orgId, input.policyId, actor.id, actor.sessionId],
  );
  const ky = rows[0];
  if (ky === undefined) throw new RfqError("Câu INSERT org_policy_signatures không trả về hàng");

  const { rows: pb } = await client.query<{ version: number; da_bat: boolean }>(
    `SELECT p.version, public.to_chuc_da_bat_s3($1::pg_catalog.uuid) AS da_bat
       FROM public.org_policy_signatures s
       JOIN public.org_procurement_policies p ON p.id OPERATOR(pg_catalog.=) s.policy_id
      WHERE s.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND s.policy_id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid`,
    [orgId, input.policyId],
  );
  const hang = pb[0];
  if (hang === undefined) throw new RfqError("Không đọc lại được phiên bản vừa ký");

  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "PROCUREMENT_POLICY_SIGNED",
    resourceType: "procurement_policy",
    resourceId: input.policyId,
    payload: { version: hang.version, daBat: hang.da_bat },
  });

  return { policyId: input.policyId, version: hang.version, signedBy: actor.id, signedAt: ky.signed_at, daBat: hang.da_bat };
}

/** [S1.169 / S3.1c] Một phiên bản chính sách như màn `/chinh-sach` đọc: trọn ma trận, chữ ký, và có đang hiệu lực không. */
export interface PhienBanChinhSach extends ProcurementPolicyRecord {
  readonly tiers: readonly Readonly<Record<string, unknown>>[] | null;
  readonly chiaNhoCuaSoNgay: number | null;
  readonly thamDinhHieuLucThang: number | null;
  /** [S1.256 / S4.5b] Nhóm khoá `benchmark`, đúng như CSDL cất; `null`: chưa cấu hình. */
  readonly benchmark: Readonly<Record<string, string>> | null;
  readonly createdBy: string;
  readonly signedBy: string | null;
  readonly signedAt: Date | null;
  /** Đúng phiên bản `chinh_sach_hieu_luc(org, now())` chọn — hàm DUY NHẤT trả lời câu ấy (S1.156). */
  readonly hieuLuc: boolean;
}

export interface DanhSachChinhSach {
  /** Mọi phiên bản của tổ chức, mới nhất trước. */
  readonly phienBan: readonly PhienBanChinhSach[];
  /** `to_chuc_da_bat_s3(org)`. */
  readonly daBat: boolean;
}

interface HangPhienBan extends HangChinhSach {
  tiers: Record<string, unknown>[] | null;
  chia_nho_cua_so_ngay: number | null;
  tham_dinh_hieu_luc_thang: number | null;
  benchmark: Record<string, string> | null;
  created_by: string;
  signed_by: string | null;
  signed_at: Date | null;
  hieu_luc: boolean | null;
}

/**
 * [S1.169 / S3.1c] Mọi phiên bản chính sách của tổ chức, mới nhất trước — cho màn `/chinh-sach` và cho phép tính phiên bản
 * KẾ TIẾP của `POST /policy`.
 *
 * Câu này đọc MỌI phiên bản nên nó không chọn phiên bản nào; phiên bản hiệu lực được đánh dấu bằng CHÍNH
 * `chinh_sach_hieu_luc`, nên tổng điều tra *một hàm chọn phiên bản* (`tests/architecture/doc-chinh-sach-mot-ham.test.ts`)
 * xếp nó vào lớp `QUA_HAM` và không lớp thứ tư nào phải mở.
 */
export async function lietKePhienBanChinhSach(client: pg.PoolClient, orgId: string): Promise<DanhSachChinhSach> {
  await assertTenantBound(client, orgId, "lietKePhienBanChinhSach");

  const { rows } = await client.query<HangPhienBan>(
    `SELECT p.id, p.version, p.dual_approval_threshold, p.currency, p.effective_from, p.tiers,
            p.chia_nho_cua_so_ngay, p.tham_dinh_hieu_luc_thang, p.benchmark, p.created_by, s.signed_by, s.signed_at,
            p.id OPERATOR(pg_catalog.=) public.chinh_sach_hieu_luc($1::pg_catalog.uuid, pg_catalog.now()) AS hieu_luc
       FROM public.org_procurement_policies p
       LEFT JOIN public.org_policy_signatures s
         ON s.org_id OPERATOR(pg_catalog.=) p.org_id AND s.policy_id OPERATOR(pg_catalog.=) p.id
      WHERE p.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
      ORDER BY p.version DESC`,
    [orgId],
  );
  const { rows: bat } = await client.query<{ da_bat: boolean }>(
    "SELECT public.to_chuc_da_bat_s3($1::pg_catalog.uuid) AS da_bat",
    [orgId],
  );
  return {
    phienBan: rows.map((h) => ({
      ...doiChinhSach(h),
      tiers: h.tiers,
      chiaNhoCuaSoNgay: h.chia_nho_cua_so_ngay,
      thamDinhHieuLucThang: h.tham_dinh_hieu_luc_thang,
      benchmark: h.benchmark,
      createdBy: h.created_by,
      signedBy: h.signed_by,
      signedAt: h.signed_at,
      hieuLuc: h.hieu_luc === true,
    })),
    daBat: bat[0]?.da_bat === true,
  };
}

/**
 * Chính sách đang có hiệu lực: phiên bản CAO NHẤT đã tới ngày hiệu lực. ~~(đọc thẳng bảng)~~
 * **[S1.156]** Đọc qua `chinh_sach_hieu_luc` — hàm DUY NHẤT trả lời câu ấy, nên một phiên bản có bậc
 * chưa có chữ ký thứ hai không có hiệu lực ở đây cũng như ở ba chỗ đọc còn lại (ADR-082 ⑺).
 *
 * Trả `null` khi tổ chức chưa đặt chính sách nào — và người gọi PHẢI xử lý ca đó chứ không được
 * coi là "ngưỡng bằng 0". Ở `setRfqBudget` bên dưới, ca ấy là một lần NÉM.
 */
export async function getActiveProcurementPolicy(
  client: pg.PoolClient,
  orgId: string,
): Promise<ProcurementPolicyRecord | null> {
  await assertTenantBound(client, orgId, "getActiveProcurementPolicy");

  const { rows } = await client.query<HangChinhSach>(
    `SELECT ${COT_CHINH_SACH} FROM public.org_procurement_policies
      WHERE id OPERATOR(pg_catalog.=) public.chinh_sach_hieu_luc($1::pg_catalog.uuid, pg_catalog.now())`,
    [orgId],
  );
  const hang = rows[0];
  return hang === undefined ? null : doiChinhSach(hang);
}

export interface SetRfqBudgetInput {
  readonly rfqId: string;
  readonly estimatedValue: string;
  readonly currency: Currency;
  readonly actorSessionId: string;
}

export interface RfqBudgetRecord {
  readonly rfqId: string;
  readonly estimatedValue: string;
  readonly currency: Currency;
  readonly policyId: string;
  /** Kết luận SAU khi phân loại — đọc lại từ `rfq_packages`, không phải thứ hàm này suy ra. */
  readonly requiresDualApproval: boolean;
}

/**
 * Đặt (hoặc sửa) ngân sách dự tính của một RFQ, rồi PHÂN LOẠI nó theo chính sách đang hiệu lực.
 *
 * Ba câu lệnh, một transaction của người gọi:
 *   ⑴ ghi bằng chứng (`rfq_budgets`) — trigger 014 đòi RFQ còn ở DRAFT;
 *   ⑵ đặt kết luận (`rfq_packages.requires_dual_approval`) từ `rfq_can_phe_duyet_kep`;
 *   ⑶ ghi sổ kiểm toán.
 *
 * Hàm này là đường DUY NHẤT hạ `requires_dual_approval` xuống `false`, và nó không hạ được nếu
 * bằng chứng không cho phép — vì chính CSDL tính phép so. `createRfq` không còn nhận cờ ấy nữa.
 */
export async function setRfqBudget(
  client: pg.PoolClient,
  orgId: string,
  input: SetRfqBudgetInput,
): Promise<RfqBudgetRecord> {
  await assertTenantBound(client, orgId, "setRfqBudget");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  const giaTri = batBuocTien(input.estimatedValue, "estimatedValue");
  if (!CURRENCIES.includes(input.currency)) {
    throw new RfqError("currency chỉ nhận VND hoặc USD");
  }

  const chinhSach = await getActiveProcurementPolicy(client, orgId);
  if (chinhSach === null) {
    // FAIL-CLOSED, và nó phải NÉM chứ không được lặng lẽ để nguyên `true`: một RFQ đi tiếp với
    // "cần hai phê duyệt" mà người mua tưởng đã phân loại là một sự bất ngờ ở đúng lúc tệ nhất.
    throw new RfqError(
      "tổ chức chưa có chính sách mua sắm nào — không phân loại được ngưỡng phê duyệt kép",
    );
  }
  if (chinhSach.currency !== input.currency) {
    throw new RfqError(
      `đơn vị tiền tệ của ngân sách (${input.currency}) khác của chính sách (${chinhSach.currency})`,
    );
  }

  await client.query(
    `INSERT INTO public.rfq_budgets
       (org_id, rfq_id, estimated_value, currency, policy_id, created_by, created_by_session_id)
     VALUES ($1, $2, $3::pg_catalog.numeric, $4, $5, $6, $7)
     ON CONFLICT (org_id, rfq_id) DO UPDATE
       SET estimated_value = EXCLUDED.estimated_value,
           currency = EXCLUDED.currency,
           policy_id = EXCLUDED.policy_id`,
    [orgId, input.rfqId, giaTri, input.currency, chinhSach.id, actor.id, actor.sessionId],
  );

  const { rows } = await client.query<{ requires_dual_approval: boolean }>(
    `UPDATE public.rfq_packages
        SET requires_dual_approval = public.rfq_can_phe_duyet_kep(id)
      WHERE id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid
        AND status OPERATOR(pg_catalog.=) 'DRAFT'
      RETURNING requires_dual_approval`,
    [input.rfqId],
  );
  const hang = rows[0];
  if (hang === undefined) {
    // 0 hàng nghĩa là RFQ không còn ở DRAFT, hoặc thuộc tổ chức khác và bị RLS lọc. Hai ca cố ý
    // cùng một thông báo — phân biệt được chúng là một oracle xuyên tổ chức.
    throw new RfqError("không phân loại được: RFQ không còn ở DRAFT hoặc không thuộc tổ chức này");
  }

  await appendAuditEvent(client, orgId, {
    actorType: actor.type,
    actorId: actor.id,
    action: "RFQ_BUDGET_SET",
    resourceType: "rfq_package",
    resourceId: input.rfqId,
    // `payload` mang KẾT LUẬN và phiên bản chính sách, KHÔNG mang số tiền: sổ kiểm toán đọc được
    // bởi mọi người có `audit.read`, còn ngân sách dự tính là thứ neo giá nếu rò xuống bên bán.
    payload: { policyVersion: chinhSach.version, requiresDualApproval: hang.requires_dual_approval },
  });

  return {
    rfqId: input.rfqId,
    estimatedValue: giaTri,
    currency: input.currency,
    policyId: chinhSach.id,
    requiresDualApproval: hang.requires_dual_approval,
  };
}

/**
 * [S1.200 / khoản 258] Ngân sách của một gói ĐÚNG như chữ ký duyệt gói ràng vào — năm thứ `rfq_bam_ngan_sach` (`086`) băm: ước
 * lượng, tiền tệ, phiên bản chính sách ghim, bậc, cờ duyệt kép. Gói chưa có ngân sách: bốn trường đầu `null`.
 */
export interface RfqBudgetView {
  readonly rfqId: string;
  readonly estimatedValue: string | null;
  readonly currency: Currency | null;
  /** Số phiên bản của chính sách ngân sách ghim vào (`rfq_budgets.policy_id`), đọc được thay cho mã. */
  readonly policyVersion: number | null;
  /** Cận dưới của bậc áp (`rfq_budgets.tier_tu_so_tien`, `072`); `null` ở phiên bản không bậc. */
  readonly tierTuSoTien: string | null;
  readonly requiresDualApproval: boolean;
}

/**
 * [S1.200 / khoản 258] Đọc ngân sách cho người duyệt — lời duyệt ràng vào nó (ADR-115), nên người ký phải ĐỌC được nó.
 *
 * Hàm đọc CÓ CỔNG (rổ `HAM_DOC_CO_QUYEN`, khoản nợ 33): ngân sách dự tính là thứ neo giá nếu rò xuống bên bán — `setRfqBudget`
 * cố ý không ghi số tiền vào sổ kiểm toán. Chủ dự án chốt ngày 2026-09-29 (ADR-118): người tạo gói đọc bằng `rfq.create`, người khác cần
 * `rfq.approve` — đúng chuỗi *tạo → duyệt* ràng vào ngân sách; khuôn `returnRfqToDraft`. Bị từ chối ⇒ `PermissionDeniedError` và
 * một hàng `PERMISSION_DENIED` ở `auditPool`. Route đọc không mở cho agent (khoản 141 / ADR-039).
 *
 * `null` khi gói không có trong tổ chức đang gắn — trả TRƯỚC phép kiểm quyền, cùng thứ tự `returnRfqToDraft`: trong một tổ chức,
 * gói có hay không đã là điều `GET /rfqs/:rfqId` trả lời cho mọi phiên người mua.
 *
 * Hàng từ chối mang `resourceType` RIÊNG `RFQ_BUDGET` (khuôn `RFQ_INVITATION`): cùng `rfq.approve` trên cùng mã gói, một lần đọc
 * ngân sách bị từ chối không lẫn trong sổ với một lần định trả gói của người khác về soạn thảo (lượt soi §S1.200, F2). Hai câu đọc
 * lọc cả `org_id` của tổ chức đang gắn, không chỉ dựa vào RLS (khuôn `listInvitations`).
 */
export async function getRfqBudget(
  client: pg.PoolClient,
  orgId: string,
  input: { readonly rfqId: string; readonly actorSessionId: string },
  auditPool: pg.Pool,
): Promise<RfqBudgetView | null> {
  await assertTenantBound(client, orgId, "getRfqBudget");
  const actor = await resolveSessionActor(client, orgId, input.actorSessionId);

  const { rows: goi } = await client.query<{ created_by: string }>(
    `SELECT p.created_by FROM public.rfq_packages p
      WHERE p.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND p.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid`,
    [orgId, input.rfqId],
  );
  const g = goi[0];
  if (g === undefined) return null;

  await requirePermission(
    client,
    {
      userId: actor.id,
      orgId,
      permission: g.created_by === actor.id ? PERMISSIONS.RFQ_CREATE : PERMISSIONS.RFQ_APPROVE,
      resourceType: "RFQ_BUDGET",
      resourceId: input.rfqId,
    },
    auditPool,
  );

  const { rows } = await client.query<{
    estimated_value: string | null;
    currency: Currency | null;
    policy_version: number | null;
    tier_tu_so_tien: string | null;
    requires_dual_approval: boolean;
  }>(
    `SELECT b.estimated_value::pg_catalog.text AS estimated_value, b.currency, pol.version AS policy_version,
            b.tier_tu_so_tien::pg_catalog.text AS tier_tu_so_tien, p.requires_dual_approval
       FROM public.rfq_packages p
       LEFT JOIN public.rfq_budgets b
         ON b.rfq_id OPERATOR(pg_catalog.=) p.id AND b.org_id OPERATOR(pg_catalog.=) p.org_id
       LEFT JOIN public.org_procurement_policies pol
         ON pol.id OPERATOR(pg_catalog.=) b.policy_id AND pol.org_id OPERATOR(pg_catalog.=) b.org_id
      WHERE p.org_id OPERATOR(pg_catalog.=) $1::pg_catalog.uuid AND p.id OPERATOR(pg_catalog.=) $2::pg_catalog.uuid`,
    [orgId, input.rfqId],
  );
  const h = rows[0];
  if (h === undefined) return null;
  return {
    rfqId: input.rfqId,
    estimatedValue: h.estimated_value,
    currency: h.currency,
    policyVersion: h.policy_version,
    tierTuSoTien: h.tier_tu_so_tien,
    requiresDualApproval: h.requires_dual_approval,
  };
}
