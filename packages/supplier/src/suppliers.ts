import type pg from "pg";
import { appendAuditEvent, assertTenantBound, type ActorType } from "@trustprocure/audit";

// =============================================================================================
// SỔ NHÀ CUNG CẤP MỨC LEVEL 0/1 (S1.1)
//
// Gói này KHÔNG dựng lại một lớp cô lập tổ chức của riêng nó. Nó dựa vào ba thứ đã có, và nói rõ
// thứ tự để người đọc sau không đi tìm một hàng rào không tồn tại ở đây:
//   (1) RLS + FORCE trên cả hai bảng (008) — lớp có thẩm quyền, ở tầng CSDL;
//   (2) `assertTenantBound` gọi TRƯỚC MỌI THỨ trong từng hàm — nó KHÔNG phải một lớp an ninh
//       thứ hai mà là một lớp chống HIỂU LẦM: không có nó, "hỏi tổ chức A trên phiên đang gắn
//       tổ chức B" trả về MẢNG RỖNG, và mảng rỗng đọc như "không có gì" chứ không như "bạn đang
//       hỏi sai chỗ" (xem docstring của chính hàm đó);
//   (3) quyền theo CỘT ở 008 — thứ quyết định `app_api` ghi được vào đâu.
//
// ---------------------------------------------------------------------------------------------
// E4 — MST KHÔNG BAO GIỜ LÀ CREDENTIAL, VÀ `findSupplierByTaxCode` LÀ CHỖ DỄ VI PHẠM NHẤT
// ---------------------------------------------------------------------------------------------
// Hàm tra theo MST tồn tại vì một nhu cầu thật: chống tạo trùng hồ sơ TRONG một tổ chức. Nó
// NHẬN `orgId` và chạy dưới RLS, nên nó trả lời câu hỏi "tổ chức của tôi đã có nhà cung cấp này
// chưa" — KHÔNG phải "nhà cung cấp này có tồn tại không".
//
// Điều nó KHÔNG BAO GIỜ được dùng làm: một đường ĐĂNG NHẬP hay một đường CẤP QUYỀN. Biết MST của
// một công ty là chuyện tra cứu công khai; nếu có ngày một luồng nào đó nhận MST rồi trả về dữ
// liệu mà không hỏi thêm gì, đó là vi phạm E4 — và nó sẽ đi qua đúng hàm này. Không có lớp máy
// nào canh điều đó hôm nay; lớp phòng thủ là dòng chữ này cộng code review.
// =============================================================================================

/** Lỗi thuộc GIAO THỨC của gói này, phân biệt với lỗi do Postgres ném. */
export class SupplierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupplierError";
  }
}

/** Level 0 = Guest Bidder · Level 1 = Known Supplier. Level 2 thuộc S3+ (ADR-013 mục 4). */
export const SUPPLIER_LEVELS = [0, 1] as const;
export type SupplierLevel = (typeof SUPPLIER_LEVELS)[number];

export const SUPPLIER_STATUSES = ["ACTIVE", "SUSPENDED", "DISABLED"] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];

/**
 * Hình dạng MST Việt Nam: 10 chữ số, đơn vị phụ thuộc thêm '-' và 3 chữ số. BẢN SAO của CHECK ở
 * 008 — và sự nhân bản này là CÓ CHỦ ĐÍCH chứ không phải sơ suất: lớp CSDL là lớp có thẩm quyền
 * (nó chặn cả đường đi không qua gói này), còn lớp ở đây tồn tại để thông báo lỗi nói được
 * "sai định dạng" thay vì để người dùng nhận một mã lỗi 23514 của Postgres.
 *
 * Có test khẳng định hai biểu thức KHỚP NHAU, nên sửa một bên mà quên bên kia sẽ đỏ.
 */
export const TAX_CODE_PATTERN = /^[0-9]{10}(-[0-9]{3})?$/;

export interface SupplierActor {
  readonly type: ActorType;
  /** Phải là UUID hoặc null — `audit_events.actor_id` là cột `uuid`. */
  readonly id?: string | null;
}

export interface CreateSupplierInput {
  readonly legalName: string;
  readonly taxCode?: string | null;
  readonly level?: SupplierLevel;
  readonly actor: SupplierActor;
}

export interface SupplierRecord {
  readonly id: string;
  readonly legalName: string;
  readonly taxCode: string | null;
  readonly level: number;
  readonly status: SupplierStatus;
  readonly createdAt: Date;
}

export interface AddSupplierContactInput {
  readonly supplierId: string;
  readonly fullName: string;
  readonly email: string;
  /**
   * Kênh OTP theo ADR-015. NULL được phép ở Level 0, và hệ quả bắt buộc nằm ở S1.3: lời mời phải
   * BỊ TỪ CHỐI khi thiếu số, KHÔNG được lặng lẽ rơi về email — rơi về email là đúng thứ ADR-015
   * mục 1 cấm (OTP không bao giờ đi cùng kênh với magic link).
   */
  readonly phone?: string | null;
  readonly actor: SupplierActor;
}

export interface SupplierContactRecord {
  readonly id: string;
  readonly supplierId: string;
  readonly fullName: string;
  readonly email: string;
  readonly phone: string | null;
  readonly status: SupplierStatus;
  readonly createdAt: Date;
}

interface HangSupplier {
  id: string;
  legal_name: string;
  tax_code: string | null;
  level: number;
  status: SupplierStatus;
  created_at: Date;
}

interface HangContact {
  id: string;
  supplier_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  status: SupplierStatus;
  created_at: Date;
}

const COT_SUPPLIER = "id, legal_name, tax_code, level, status, created_at";
const COT_CONTACT = "id, supplier_id, full_name, email, phone, status, created_at";

function doiSupplier(h: HangSupplier): SupplierRecord {
  return {
    id: h.id,
    legalName: h.legal_name,
    taxCode: h.tax_code,
    level: h.level,
    status: h.status,
    createdAt: h.created_at,
  };
}

function doiContact(h: HangContact): SupplierContactRecord {
  return {
    id: h.id,
    supplierId: h.supplier_id,
    fullName: h.full_name,
    email: h.email,
    phone: h.phone,
    status: h.status,
    createdAt: h.created_at,
  };
}

/**
 * Cắt khoảng trắng và từ chối chuỗi rỗng.
 *
 * Cố ý KHÔNG nội suy giá trị bị từ chối vào thông báo: thông báo lỗi đi vào log, và khuôn "ném
 * dữ liệu đầu vào vào message" là thứ được sao chép sang chỗ mà dữ liệu ĐÚNG LÀ bí mật (giá
 * thầu, token, mã OTP). Cùng quy ước với `packages/tenancy/src/with-tenant.ts`.
 */
function batBuoc(giaTri: string, ten: string, gioiHan: number): string {
  const cat = giaTri.trim();
  if (cat.length === 0) throw new SupplierError(`${ten} không được rỗng`);
  if (Buffer.byteLength(cat, "utf8") > gioiHan) {
    throw new SupplierError(`${ten} dài quá ${gioiHan} byte`);
  }
  return cat;
}

function chuanHoaMst(taxCode: string | null | undefined): string | null {
  if (taxCode === null || taxCode === undefined) return null;
  const cat = taxCode.trim();
  if (cat.length === 0) return null;
  if (!TAX_CODE_PATTERN.test(cat)) {
    throw new SupplierError(
      "tax_code sai định dạng — chờ 10 chữ số, đơn vị phụ thuộc thêm '-' và 3 chữ số",
    );
  }
  return cat;
}

/**
 * Tạo một nhà cung cấp trong tổ chức đang gắn.
 *
 * Ghi kiểm toán TRONG CÙNG transaction với hàng mới: rollback thì không còn gì để kiểm toán, và
 * commit thì bản ghi đã tồn tại. Đây là lựa chọn KHÁC với `requirePermission` (nó ghi ở một
 * transaction ĐỘC LẬP) và khác vì một lý do: ở đó thứ phải sống sót là một lần TỪ CHỐI mà người
 * gọi có thể nuốt; ở đây thứ được ghi là hệ quả của một thay đổi dữ liệu, nên nó phải sống chết
 * cùng thay đổi ấy.
 *
 * `payload` cố ý CHỈ mang `level`. Tên công ty và MST KHÔNG vào payload: sổ kiểm toán đọc được
 * bởi mọi người có quyền đọc sổ, và `resource_id` đã đủ để truy ngược về hàng thật.
 */
export async function createSupplier(
  client: pg.PoolClient,
  orgId: string,
  input: CreateSupplierInput,
): Promise<SupplierRecord> {
  await assertTenantBound(client, orgId, "createSupplier");

  const legalName = batBuoc(input.legalName, "legal_name", 500);
  const taxCode = chuanHoaMst(input.taxCode);
  const level: SupplierLevel = input.level ?? 0;
  if (!SUPPLIER_LEVELS.includes(level)) {
    throw new SupplierError("level chỉ nhận 0 (Guest Bidder) hoặc 1 (Known Supplier)");
  }

  const { rows } = await client.query<HangSupplier>(
    `INSERT INTO suppliers (org_id, legal_name, tax_code, level)
     VALUES ($1, $2, $3, $4) RETURNING ${COT_SUPPLIER}`,
    [orgId, legalName, taxCode, level],
  );

  const hang = rows[0];
  if (hang === undefined) throw new SupplierError("INSERT suppliers không trả về hàng nào");

  await appendAuditEvent(client, orgId, {
    actorType: input.actor.type,
    actorId: input.actor.id ?? null,
    action: "SUPPLIER_CREATED",
    resourceType: "supplier",
    resourceId: hang.id,
    payload: { level },
  });

  return doiSupplier(hang);
}

export async function getSupplier(
  client: pg.PoolClient,
  orgId: string,
  supplierId: string,
): Promise<SupplierRecord | null> {
  await assertTenantBound(client, orgId, "getSupplier");

  const { rows } = await client.query<HangSupplier>(
    `SELECT ${COT_SUPPLIER} FROM suppliers WHERE id = $1`,
    [supplierId],
  );
  const hang = rows[0];
  return hang === undefined ? null : doiSupplier(hang);
}

/**
 * `WHERE id = $1` KHÔNG kèm `AND org_id = $2`, và đó là CÓ CHỦ ĐÍCH — nhưng không phải vì "RLS
 * đã lo rồi". Phát biểu đúng, hẹp hơn: hàm này chỉ chạy sau `assertTenantBound`, tức chỉ chạy
 * trên một phiên ĐÃ gắn đúng tổ chức, và policy của 008 cắt tập hàng theo `app.org_id`. Bài học
 * đo được của Task 8 vẫn đứng: "RLS đã giới hạn tập hàng" là câu CÓ ĐIỀU KIỆN, sai với một phiên
 * KHÔNG chịu RLS (chủ sở hữu bảng không FORCE, superuser). Ở dự án này FORCE bật trên mọi bảng
 * tenant nên điều kiện ấy đúng — và nó đúng vì một câu lệnh trong migration, không vì một thói
 * quen viết truy vấn.
 */
export async function listSuppliers(
  client: pg.PoolClient,
  orgId: string,
): Promise<SupplierRecord[]> {
  await assertTenantBound(client, orgId, "listSuppliers");

  const { rows } = await client.query<HangSupplier>(
    `SELECT ${COT_SUPPLIER} FROM suppliers ORDER BY created_at, id`,
  );
  return rows.map(doiSupplier);
}

/** Xem khối E4 ở đầu file TRƯỚC KHI dùng hàm này ở bất kỳ luồng xác thực nào. */
export async function findSupplierByTaxCode(
  client: pg.PoolClient,
  orgId: string,
  taxCode: string,
): Promise<SupplierRecord | null> {
  await assertTenantBound(client, orgId, "findSupplierByTaxCode");

  const chuan = chuanHoaMst(taxCode);
  if (chuan === null) throw new SupplierError("tax_code không được rỗng");

  const { rows } = await client.query<HangSupplier>(
    `SELECT ${COT_SUPPLIER} FROM suppliers WHERE tax_code = $1`,
    [chuan],
  );
  const hang = rows[0];
  return hang === undefined ? null : doiSupplier(hang);
}

/**
 * Thêm một người liên hệ cho một nhà cung cấp.
 *
 * `org_id` được ghi tường minh và `supplier_id` đi kèm: khoá ngoại HỢP THÀNH của 008 kiểm cặp
 * `(org_id, supplier_id)`, nên một `supplierId` thuộc tổ chức khác bị CSDL từ chối — không phải
 * bị hàm này từ chối. Đó là chỗ nên đặt lớp ấy: một phép kiểm ở đây chỉ canh được đường đi qua
 * đây, còn ràng buộc thì canh mọi đường.
 */
export async function addSupplierContact(
  client: pg.PoolClient,
  orgId: string,
  input: AddSupplierContactInput,
): Promise<SupplierContactRecord> {
  await assertTenantBound(client, orgId, "addSupplierContact");

  const fullName = batBuoc(input.fullName, "full_name", 200);
  const email = batBuoc(input.email, "email", 320);
  const phoneCat = input.phone?.trim() ?? "";
  const phone = phoneCat.length === 0 ? null : phoneCat;

  const { rows } = await client.query<HangContact>(
    `INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${COT_CONTACT}`,
    [orgId, input.supplierId, fullName, email, phone],
  );

  const hang = rows[0];
  if (hang === undefined) {
    throw new SupplierError("INSERT supplier_contacts không trả về hàng nào");
  }

  // `payload` KHÔNG mang họ tên, email hay số điện thoại. Đó là dữ liệu cá nhân, và sổ kiểm toán
  // là bảng chỉ-ghi-thêm không xoá được — một lần ghi nhầm PII vào đó là vĩnh viễn.
  await appendAuditEvent(client, orgId, {
    actorType: input.actor.type,
    actorId: input.actor.id ?? null,
    action: "SUPPLIER_CONTACT_ADDED",
    resourceType: "supplier_contact",
    resourceId: hang.id,
    payload: { supplierId: hang.supplier_id, hasPhone: phone !== null },
  });

  return doiContact(hang);
}

export async function listSupplierContacts(
  client: pg.PoolClient,
  orgId: string,
  supplierId: string,
): Promise<SupplierContactRecord[]> {
  await assertTenantBound(client, orgId, "listSupplierContacts");

  const { rows } = await client.query<HangContact>(
    `SELECT ${COT_CONTACT} FROM supplier_contacts WHERE supplier_id = $1 ORDER BY created_at, id`,
    [supplierId],
  );
  return rows.map(doiContact);
}
