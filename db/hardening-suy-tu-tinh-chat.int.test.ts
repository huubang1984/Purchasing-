import { migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));
const HARDENING = readFileSync(
  fileURLToPath(new URL("./migrations/hardening.always.sql", import.meta.url)),
  "utf8",
);

/**
 * [S1.20 / sổ nợ 3 + 16] HARDENING KHÔNG ĐƯỢC TỰ LÀM MÙ BẰNG MỘT DANH SÁCH TÊN.
 *
 * Khoản nợ 16 mô tả một bất đối xứng: `bang_so` nhận bảng theo HAI TÊN VIẾT CỨNG
 * (`audit_events`, `audit_chain_anchors`) trong khi `bang_al` nhận bảng lạ theo TÍNH CHẤT (mang
 * trigger gọi `chan_sua_xoa()`). Nó dự báo *"bảng báo giá S1 sẽ rơi thẳng vào đó"*.
 *
 * **Dự báo ấy đã thành hiện thực, và đo được — S1 dựng một hàm canh chỉ-ghi-thêm THỨ HAI**
 * (`public.bid_chi_ghi_them()`, migration 018) cắm trên BA bảng: `bid_receipts`,
 * `rfq_unsealed_bids`, `vendor_bid_versions`. Cả ba nằm ngoài `bang_so` (không có trong danh
 * sách hai tên) VÀ ngoài `bang_al` (vế ấy khoá theo OID của `chan_sua_xoa`). Đo trên
 * PostgreSQL 16 ngày 2026-09-07, mỗi lần `migrate()` trả về `applied=[]` và KHÔNG một lỗi nào:
 *
 *   - `ALTER TABLE bid_receipts SET UNLOGGED`     -> MIGRATE OK, relpersistence còn 'u'
 *   - `GRANT UPDATE, DELETE ON bid_receipts TO app_api` -> MIGRATE OK, acl còn `app_api=rwd`
 *   - `TRUNCATE public.bid_receipts`              -> **OK** (audit_events thì NÉM)
 *
 * **Vế thứ ba là lỗ mà sổ nợ 16 KHÔNG nêu, và nó nặng hơn hai vế kia:** ba trigger của 018 và 019
 * là `BEFORE DELETE OR UPDATE FOR EACH ROW` (tgtype 27) — chúng KHÔNG chạm TRUNCATE, trong khi
 * bảng sổ có hẳn một trigger TRUNCATE riêng từ 003. Một câu lệnh xoá sạch mọi biên nhận nộp thầu
 * (**B2**), mọi phiên bản báo giá (**B1**) và mọi giá đã mở — và ma trận đang ghi cả hai mã ✅.
 *
 * KHUÔN SỬA, theo ADR-027/ADR-028: **suy từ một TÍNH CHẤT, và tính chất phải không giả mạo được
 * theo chiều nguy hiểm.** Tính chất ở đây:
 *
 *   một bảng là CHỈ-GHI-THÊM khi nó mang CẢ HAI trigger BEFORE-ROW-UPDATE và BEFORE-ROW-DELETE
 *   mà hàm plpgsql của chúng KHÔNG BAO GIỜ TRẢ VỀ (thân không có `RETURN` nào)
 *
 * Một hàm trigger không trả về thì chỉ có thể NÉM. Giả mạo tính chất này là THÊM bảo vệ, không
 * phải gỡ. Gỡ nó (viết lại thân hàm thành `BEGIN RETURN NEW; END`) làm bảng rời khỏi tập — nhưng
 * đường ấy đã có lớp khác đứng: mỗi hàm trigger trong `public` đều có một mục ghim thân trong
 * `hardening.always.sql`, và `db/migrations.int.test.ts` [S1.14/S1.15] giữ danh sách loại trừ RỖNG.
 *
 * **Vì sao vế `RETURN` là cần chứ không thừa — có phản ví dụ thật trong kho:**
 * `rfq_items_cam_truncate` (011) cũng có thân `BEGIN RAISE EXCEPTION … END` không `RETURN`, nhưng
 * nó là trigger TRUNCATE cấp CÂU LỆNH. `rfq_items` KHÔNG chỉ-ghi-thêm — nó sửa và xoá được khi RFQ
 * còn DRAFT. Vế "cả UPDATE lẫn DELETE, cấp HÀNG" là thứ loại nó ra.
 *
 * **Vì sao vế `prolang = plpgsql` là cần [review lượt 12, M4]:** `prosrc` của một hàm
 * `LANGUAGE internal`/`c` là TÊN SYMBOL — đã đo, `suppress_redundant_updates_trigger` có
 * `prosrc = 'suppress_redundant_updates_trigger'`. Không chứa `RETURN`, nên không có vế ngôn ngữ
 * thì hai trigger dựng sẵn của PostgreSQL đủ để một bảng bị nhận nhầm là chỉ-ghi-thêm và bị CHẶN
 * DEPLOY.
 */
/**
 * [S1.29, khoản nợ 60] Danh sách KHAI BÁO hàm canh — vế thứ hai của vị từ dưới đây. Tên KHÔNG mang
 * lược đồ vì vị từ ghim `pronamespace = public`; tổng điều tra thì định danh theo `lược đồ.tên`.
 * Bất kỳ tên nào thêm vào đây phải xuất hiện NGUYÊN VĂN trong `hardening.always.sql` (cổng ở test
 * đầu tiên), nên một hàm canh mới là một sửa đổi ở CẢ hai tệp — cố ý.
 */
const HAM_CANH_CHI_GHI_THEM = ["bid_chi_ghi_them", "chan_sua_xoa"];

/** Vế "hàm này là hàm canh": HÌNH DẠNG (không bao giờ trả về) HOẶC KHAI BÁO (có tên trong danh sách). */
function veHamCanh(hamCanh: readonly string[], thut: string): string {
  const ten = hamCanh.map((h) => `'${h}'`).join(", ");
  return (
    `(p.prosrc !~* '\\mRETURN\\M'\n` +
    `${thut}     OR (p.pronamespace OPERATOR(pg_catalog.=) 'public'::pg_catalog.regnamespace\n` +
    `${thut}         AND p.proname IN (${ten})))`
  );
}

/** Vị từ bảng chỉ-ghi-thêm cho một danh sách khai báo — để test đo được CẢ HAI phía của khai báo. */
function viTuBangChiGhiThem(hamCanh: readonly string[]): string {
  const T = "                  "; // 18 khoảng trắng — phải BẰNG thụt lề trong hardening.always.sql
  return `SELECT c.oid AS bang_oid, c.relname, c.relpersistence, c.relowner
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp%'
          AND c.relkind IN ('r', 'p')
          AND (SELECT pg_catalog.count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
                  AND p.prorettype OPERATOR(pg_catalog.=) 'pg_catalog.trigger'::regtype
                  AND p.prolang OPERATOR(pg_catalog.=) (SELECT l.oid FROM pg_language l WHERE l.lanname OPERATOR(pg_catalog.=) 'plpgsql')
${T}AND ${veHamCanh(hamCanh, T)}
                  AND (t.tgtype OPERATOR(pg_catalog.&) 19::pg_catalog.int2) OPERATOR(pg_catalog.=) 19) OPERATOR(pg_catalog.>) 0
          AND (SELECT pg_catalog.count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
                  AND p.prorettype OPERATOR(pg_catalog.=) 'pg_catalog.trigger'::regtype
                  AND p.prolang OPERATOR(pg_catalog.=) (SELECT l.oid FROM pg_language l WHERE l.lanname OPERATOR(pg_catalog.=) 'plpgsql')
${T}AND ${veHamCanh(hamCanh, T)}
                  AND (t.tgtype OPERATOR(pg_catalog.&) 11::pg_catalog.int2) OPERATOR(pg_catalog.=) 11) OPERATOR(pg_catalog.>) 0`;
}

const VI_TU_BANG_CHI_GHI_THEM = viTuBangChiGhiThem(HAM_CANH_CHI_GHI_THEM);

/** Tập bảng chỉ-ghi-thêm ĐO ĐƯỢC hôm nay. Hai tên đầu là bảng sổ (003), ba tên sau là S1 (018/019). */
const BANG_CHI_GHI_THEM_THAT = [
  "audit_chain_anchors",
  "audit_events",
  "bid_receipts",
  "rfq_unsealed_bids",
  "vendor_bid_versions",
];

/** Hai bảng có TÊN trong `BANG_CHI_GHI_THEM` — hardening TỰ CHỮA chúng. Ba bảng kia thì chỉ PHÁN XÉT. */
const BANG_CO_TEN = ["audit_chain_anchors", "audit_events"];

async function thu(db: TestDatabase, cau: string): Promise<string> {
  try {
    await db.pool.query(cau);
    return "OK";
  } catch (e) {
    return `NÉM: ${(e as Error).message}`;
  }
}

/** `migrate()` lại và cho biết nó NÉM hay không — mọi mục hardening chạy lại ở mỗi lần gọi. */
async function migrateLai(db: TestDatabase): Promise<string> {
  try {
    await migrate(db.pool, MIGRATIONS_DIR);
    return "OK";
  } catch (e) {
    return `NÉM: ${(e as Error).message}`;
  }
}

/**
 * [khoản nợ 60] TỔNG ĐIỀU TRA HÀM TRIGGER — THAY *NHẬN DIỆN THEO HÌNH DẠNG* BẰNG *LIỆT KÊ RỘNG
 * RỒI BUỘC PHÂN LOẠI*.
 *
 * Vị từ ở trên hỏi *`prosrc` có chứa `RETURN` không* — một phép so khớp VĂN BẢN trên thân hàm.
 * Nó ĐÚNG hôm nay, nhưng một hàm canh viết theo kiểu khác (`IF … THEN RAISE … END IF; RETURN
 * NULL;`) sẽ **rơi khỏi tập** và bảng của nó thôi được canh, TRONG IM LẶNG. Đó là nguyên văn
 * khoản nợ 60, và sổ nợ nói đúng mức: *"một khoảng trống đã ĐO chứ chưa phải một lỗ đang mở"*.
 *
 * **Đo trên PostgreSQL 16 ngày 2026-09-09, trước khi viết khối này:** tập RỘNG — mọi hàm
 * `plpgsql` trả `trigger`, gắn `BEFORE … FOR EACH ROW` trên `UPDATE` hoặc `DELETE`, ở lược đồ
 * không phải hệ thống — có **23 hàm**. Vị từ hình dạng nhận **2**; **21 hàm còn lại đi qua nó
 * mà không lớp nào nói gì về chúng**.
 *
 * Bản vá KHÔNG phải nới vị từ hình dạng, vì nới thế nào cũng lại là một hình dạng. Nó là hai
 * việc: ⑴ vị từ bảng chỉ-ghi-thêm thành **HÌNH DẠNG ∪ KHAI BÁO** — một hàm canh có `RETURN`
 * vào tập bằng cách được kê tên ở `HAM_CANH_CHI_GHI_THEM`, và tên ấy phải xuất hiện nguyên văn
 * trong `hardening.always.sql` (cổng ở test đầu tiên) nên SẢN XUẤT canh nó chứ không chỉ test;
 * ⑵ **mỗi hàm trong tập rộng phải nằm trong ĐÚNG MỘT trong hai danh sách.** Một hàm mới rơi ra
 * ngoài cả hai ⇒ ĐỎ.
 *
 * ~~cách duy nhất làm nó xanh là ghi nó vào một danh sách~~ **[lượt soi 19 bác, bác đúng]:** bản
 * đầu dùng vị từ hình dạng làm nguồn sự thật, nên một hàm canh kiểu `RAISE …; RETURN NULL` khai
 * THẬT thì đỏ (mâu thuẫn với hình dạng) còn khai SAI vào KHÔNG-CANH thì xanh — cổng thưởng lời
 * khai sai. Đã đo trên PostgreSQL thật (test *"khai thật thì bảng ĐƯỢC canh"* dưới đây). Nay
 * khai thật là đường xanh duy nhất SAU KHI bảng đã vào tập.
 *
 * **Chiều mâu thuẫn chỉ còn MỘT hướng, và đó là hướng suy được:** thân không có `RETURN` ⇒ hàm
 * không thể từ chối có điều kiện ⇒ PHẢI là hàm canh; khai KHÔNG-CANH ⇒ ĐỎ. Hướng ngược (khai
 * CANH nhưng có `RETURN`) là HỢP LỆ — đó chính là ca khoản nợ 60 mô tả.
 *
 * ~~**Thứ vẫn KHÔNG có lớp, nói ra thay vì để người đọc tự phát hiện:** một hàm canh có `RETURN`
 * bị khai SAI vào KHÔNG-CANH thì không phép kiểm văn bản nào bắt được — chỉ một phép đo HÀNH VI
 * (thử UPDATE/DELETE trên bảng của từng hàm) mới phân biệt được, và đó là khoản nợ 74.~~
 * **[S1.30] Phép đo hành vi ấy nay CÓ** — xem khối `NHÂN CHỨNG HÀNH VI` dưới đây: mỗi cặp (hàm,
 * sự kiện) khai KHÔNG-CANH phải để một hàng thật đi qua, đo bằng `pg_stat_user_functions`.
 *
 * **Điều khối này KHÔNG làm:** nó không phán xét một phân loại là ĐÚNG. Hai danh sách được sinh
 * từ trạng thái đo được tại `bebeb41` rồi đóng băng. Nó chặn hàm thứ 24 đi vào lặng lẽ; nó không
 * kiểm toán 23 hàm có sẵn.
 * **[S1.30] Nửa KHÔNG-CANH của câu trên nay ĐƯỢC kiểm toán:** khối NHÂN CHỨNG HÀNH VI đòi mỗi cặp
 * (hàm, sự kiện) khai KHÔNG-CANH để một hàng thật đi qua — 21 hàm ấy không còn là lời khai đóng
 * băng. Hai hàm khai CANH thì vẫn không kiểm toán được bằng hành vi (chứng minh *"từ chối MỌI
 * hàng"* không phải một phép thử), và hôm nay hình dạng đứng thay: cả hai đều không có `RETURN`.
 */
/**
 * Hàm trigger UPDATE/DELETE (mọi hình thức) **không** phải hàm canh chỉ-ghi-thêm: chúng từ chối CÓ
 * ĐIỀU KIỆN (máy trạng thái, kiểm quyền, bất biến cột), nên bảng mang chúng vẫn sửa/xoá được ở
 * những đường hợp lệ. Đo tại `bebeb41`.
 */
const HAM_KHONG_PHAI_CANH = [
  "public.kiem_danh_tinh_theo_phien",
  // [S1.31] Năm hàm AFTER-ROW UPDATE vào tập rộng khi tập ấy thôi khoá theo hình thức BEFORE-ROW.
  "public.kiem_tra_ma_tran_quyen",
  "public.kiem_tra_nguong_khong_cung_tay_nguoi_dung",
  "public.kiem_tra_nguong_khong_cung_tay_vai_tro",
  "public.kiem_tra_phan_tach_nhiem_vu",
  "public.loi_moi_khong_song_lai",
  "public.mfa_credentials_khoa_ho_so_da_xac_nhan",
  "public.mfa_credentials_xoa_can_yeu_cau",
  "public.mfa_reset_kiem_chuyen_trang_thai",
  "public.mfa_reset_kiem_quyen",
  "public.otp_go_khoa_khong_xoa_dau_vet",
  "public.outbox_jobs_xoa_payload_dang_nhap",
  "public.rfq_budgets_chi_sua_khi_soan",
  "public.rfq_gia_han_khong_hoi_sinh",
  "public.rfq_items_chi_sua_khi_soan",
  "public.rfq_key_material_bat_bien",
  "public.rfq_khoa_chi_thu_hoi_khi_huy",
  "public.rfq_kiem_chuyen_trang_thai",
  "public.rfq_kiem_khoa_khi_mo",
  "public.rfq_kiem_nguong_phe_duyet_kep",
  "public.rfq_kiem_yeu_cau_mo_thau",
  "public.thu_hoi_don_dieu",
  "public.unseal_dieu_phoi_mot_lan",
  "public.unseal_kiem_chuyen_trang_thai",
  "public.unseal_kiem_du_phe_duyet",
  "public.users_thu_hoi_phien_khi_dinh_chi",
];

/**
 * Nguồn của TẬP RỘNG — không xét thân hàm. Đây là chỗ khác biệt với `VI_TU_BANG_CHI_GHI_THEM` ở trên.
 * [S1.31, khoản nợ 75] Tiêu chí là *mọi trigger plpgsql trên UPDATE hoặc DELETE* — bit 16/8 của
 * `tgtype`, KHÔNG xét bit ROW (1) hay BEFORE (2): một trigger cấp CÂU LỆNH hay AFTER-ROW ném vô điều
 * kiện cũng làm bảng chỉ-ghi-thêm (đo: `BEFORE UPDATE OR DELETE FOR EACH STATEMENT` với thân `RAISE`
 * ⇒ `migrate()` OK, `TRUNCATE` OK, bảng ngoài `VI_TU_BANG_CHI_GHI_THEM`). Vế `19`/`11` cũ của tập
 * rộng đã loại chúng — đúng cái lỗ ADR-035 §2⑴ cấm: chọn ứng viên bằng một hình dạng.
 */
const TU_TAP_RONG = `FROM pg_trigger t
         JOIN pg_proc p ON p.oid OPERATOR(pg_catalog.=) t.tgfoid
         JOIN pg_namespace np ON np.oid OPERATOR(pg_catalog.=) p.pronamespace
         JOIN pg_class c ON c.oid OPERATOR(pg_catalog.=) t.tgrelid
         JOIN pg_namespace n ON n.oid OPERATOR(pg_catalog.=) c.relnamespace
         JOIN pg_language l ON l.oid OPERATOR(pg_catalog.=) p.prolang
        WHERE NOT t.tgisinternal
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND l.lanname OPERATOR(pg_catalog.=) 'plpgsql'
          AND p.prorettype OPERATOR(pg_catalog.=) 'pg_catalog.trigger'::regtype
          AND (((t.tgtype OPERATOR(pg_catalog.&) 16::pg_catalog.int2) OPERATOR(pg_catalog.=) 16)
            OR ((t.tgtype OPERATOR(pg_catalog.&) 8::pg_catalog.int2) OPERATOR(pg_catalog.=) 8))`;

/** TẬP RỘNG theo HÀM — đơn vị của tổng điều tra. */
const CAU_TAP_RONG = `SELECT (np.nspname OPERATOR(pg_catalog.||) '.' OPERATOR(pg_catalog.||) p.proname) AS ten,
              (p.prosrc OPERATOR(pg_catalog.!~*) '\\mRETURN\\M') AS khong_tra_ve,
              pg_catalog.bool_or(t.tgenabled OPERATOR(pg_catalog.=) 'D') AS co_trigger_tat,
              pg_catalog.bool_and((t.tgtype OPERATOR(pg_catalog.&) 3::pg_catalog.int2) OPERATOR(pg_catalog.=) 3) AS chi_truoc_hang
         ${TU_TAP_RONG}
        GROUP BY 1, 2
        ORDER BY 1`;

/**
 * [khoản nợ 74] TẬP RỘNG theo (HÀM, BẢNG, SỰ KIỆN) — đơn vị của nhân chứng hành vi: một câu
 * UPDATE/DELETE chỉ ghi công được cho hàm CÓ trigger ở đúng bảng và đúng sự kiện của nó.
 */
const CAU_TAP_RONG_THEO_BANG = `SELECT (np.nspname OPERATOR(pg_catalog.||) '.' OPERATOR(pg_catalog.||) p.proname) AS ham,
              (n.nspname OPERATOR(pg_catalog.||) '.' OPERATOR(pg_catalog.||) c.relname) AS bang,
              ((t.tgtype OPERATOR(pg_catalog.&) 16::pg_catalog.int2) OPERATOR(pg_catalog.=) 16) AS upd,
              ((t.tgtype OPERATOR(pg_catalog.&) 8::pg_catalog.int2) OPERATOR(pg_catalog.=) 8) AS del,
              ((t.tgtype OPERATOR(pg_catalog.&) 3::pg_catalog.int2) OPERATOR(pg_catalog.=) 3) AS truoc_hang,
              t.tgdeferrable AS hoan,
              (p.prosrc OPERATOR(pg_catalog.~*) 'la_duong_ung_dung|current_user|session_user|pg_has_role|rolsuper') AS nhay_vai
         ${TU_TAP_RONG}`;

/**
 * [S1.31, khoản nợ 73] TỔNG ĐIỀU TRA RULE — cùng khuôn ADR-035, cho một cơ chế KHÔNG ĐI QUA TRIGGER.
 *
 * `CREATE RULE … AS ON UPDATE TO t DO INSTEAD NOTHING` làm bảng chỉ-ghi-thêm mà không tạo trigger
 * nào: đo trên PostgreSQL 16 — UPDATE/DELETE trả `0 hàng`, KHÔNG lỗi, hàng còn nguyên, `migrate()`
 * OK. Bảng ấy đứng ngoài `VI_TU_BANG_CHI_GHI_THEM`, tức ngoài LOGGED / chốt TRUNCATE / ACL của
 * H19. Và chiều ngược cũng thật: một rule trên một bảng chỉ-ghi-thêm viết lại câu lệnh TRƯỚC khi
 * hàm canh chạy — `hardening.always.sql` [CR1] gỡ rule khỏi HAI bảng sổ, nhưng đo được: rule trên
 * `bid_receipts` SỐNG QUA `migrate()`. Vòng này đóng cả hai: sản xuất phán xét rule trên mọi bảng
 * chỉ-ghi-thêm suy ra (mục *trạng thái vật lý*), còn ở đây MỌI rule trên MỌI quan hệ của dự án
 * phải nằm trong `RULE_DA_KHAI` — danh sách RỖNG, và rỗng là một lời khai: dự án không dùng RULE.
 * Tiêu chí ứng viên là `pg_rewrite` trừ `_RETURN` (rule của VIEW), không lách được bằng cách viết.
 * [lượt soi 21] Vế loại theo TÊN có lách được bằng một rule đặt tên `"_RETURN"` trên BẢNG không? Đo
 * trên PostgreSQL 16: `CREATE RULE "_RETURN" AS ON DELETE TO bid_receipts …` ⇒ NÉM *non-view rule
 * for "bid_receipts" must not be named "_RETURN"* — chính PostgreSQL giữ tên ấy cho view.
 */
const RULE_DA_KHAI: readonly string[] = [];

const CAU_RULE_RONG = `SELECT (n.nspname OPERATOR(pg_catalog.||) '.' OPERATOR(pg_catalog.||) c.relname
                OPERATOR(pg_catalog.||) '/' OPERATOR(pg_catalog.||) rw.rulename::pg_catalog.text) AS ten,
              rw.ev_type::pg_catalog.text AS su_kien, rw.is_instead
         FROM pg_rewrite rw
         JOIN pg_class c ON c.oid OPERATOR(pg_catalog.=) rw.ev_class
         JOIN pg_namespace n ON n.oid OPERATOR(pg_catalog.=) c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND rw.rulename OPERATOR(pg_catalog.<>) '_RETURN'
        ORDER BY 1`;

/**
 * [khoản nợ 74] NHÂN CHỨNG HÀNH VI — ĐÓNG CHIỀU NÓI DỐI CỦA TỔNG ĐIỀU TRA.
 *
 * Tổng điều tra ở trên bắt được chiều IM LẶNG (hàm mới chưa phân loại ⇒ đỏ) và một nửa chiều
 * NÓI DỐI (thân không `RETURN` mà khai KHÔNG-CANH ⇒ đỏ). Nửa còn lại — một hàm canh CÓ `RETURN`
 * (kiểu `IF … RAISE … END IF; RETURN NULL;`) bị khai KHÔNG-CANH — không phép kiểm văn bản nào
 * bắt được, vì hai lời khai văn bản không mâu thuẫn nhau. Khoản nợ 74 nói đúng: chỉ một phép đo
 * HÀNH VI mới phân biệt được, và giá của nó là một hàng hợp lệ trên mỗi bảng.
 *
 * PHÉP ĐO, và vì sao nó không phải một lời khai thứ ba:
 *
 *   ⑴ `track_functions = 'pl'` trên MỘT kết nối, rồi đọc `pg_stat_xact_user_functions` — bộ đếm
 *      CỤC BỘ của chính backend cho giao dịch hiện tại, đọc được ngay, không cần chờ đẩy ra vùng
 *      thống kê chung. PostgreSQL chỉ cộng `calls` khi hàm TRẢ VỀ BÌNH THƯỜNG: `ExecCallTriggerFunc`
 *      gọi `pgstat_end_function_call` SAU khối `PG_TRY`, nên một `RAISE` nhảy qua nó. Đã đo ở test
 *      đột biến dưới đây: hàm canh ném ⇒ `calls` đứng yên. Vậy "calls tăng" = "hàm này có một
 *      đường trả về VÀ đường ấy vừa được đi trên một hàng thật".
 *   ⑵ Mỗi nhân chứng là ĐÚNG MỘT câu UPDATE/DELETE, kẹp giữa hai lần đọc bộ đếm trong CÙNG giao
 *      dịch — bước chuẩn bị (chèn vật liệu khoá, đổi vai) đứng TRƯỚC lần đọc đầu, nên lời gọi qua
 *      INSERT trong khối không bao giờ được gán cho câu UPDATE [lượt soi 20, LOW-1].
 *   ⑶ Ghi công theo BỘ BA (hàm, bảng, sự kiện), không theo hàm: thân một hàm trigger đọc
 *      `TG_TABLE_NAME`/`TG_ARGV`/`TG_RELID`, nên nó có thể canh vô điều kiện ở bảng này mà có điều
 *      kiện ở bảng kia — `thu_hoi_don_dieu` gắn 5 bảng với `TG_ARGV` khác nhau là ca thật trong
 *      kho [lượt soi 20, HIGH-1]. Một câu ghi công cho bộ ba khi ⒜ hàm có trigger BEFORE-ROW ở
 *      đúng (bảng, sự kiện) theo TẬP RỘNG, ⒝ `calls` tăng trong lúc câu chạy, ⒞ câu chạm ít nhất
 *      MỘT hàng — vế ⒞ chặn kiểu canh-bằng-im-lặng (`RETURN NULL` bỏ hàng: hàm trả về nhưng không
 *      hàng nào đổi).
 *   ⑷ Vai được ĐO chứ không được khai: mỗi nhân chứng ghi lại `current_user` và `rolsuper` của nó.
 *      Hàm mà thân đọc vai đang chạy (`la_duong_ung_dung`, `current_user`, `pg_has_role`, …) ngắn
 *      mạch dưới chủ sở hữu — `IF la_duong_ung_dung('app_api') THEN RAISE; END IF; RETURN NEW;` là
 *      một hàm canh với toàn bộ lưu lượng sản xuất mà chủ sở hữu đi qua tự do — nên nhân chứng của
 *      nó phải đến từ một vai KHÔNG superuser [lượt soi 20, HIGH-2]. Vế văn bản `nhay_vai` chỉ chọn
 *      ĐỘ MỊN của phép đo, không phân loại ai.
 *   ⑸ Mỗi bộ ba mà tập rộng THẤY cho một hàm khai KHÔNG-CANH phải được ghi công hợp lệ sau kịch
 *      bản — hoặc được khai là CANH MỘT SỰ KIỆN và ĐO được là NÉM từ chính hàm ấy. Một hàm canh
 *      khai sai thì không câu UPDATE/DELETE nào ghi công được cho nó — nó ném ở mọi hàng — nên lời
 *      khai sai ĐỎ, và cách duy nhất làm xanh là đổi lời khai. Xoá nhân chứng cũng đỏ: bộ ba ấy thôi
 *      được ghi công.
 *
 * Kịch bản dựng bằng SQL viết tay dưới chủ sở hữu (đúng cách `tests/adversarial` dựng fixture);
 * nhân chứng của hàm nhạy vai chạy dưới `SET LOCAL ROLE app_api` trong tenant.
 *
 * **Thứ phép đo này ĐÃ LỘ RA trước khi nó được viết xong:** `rfq_key_material_bat_bien` từ chối
 * DELETE VÔ ĐIỀU KIỆN (`IF TG_OP = 'DELETE' THEN RAISE`) và cho UPDATE có điều kiện. Hai danh
 * sách của tổng điều tra không tả được nó — xem `HAM_CANH_MOT_SU_KIEN`.
 *
 * **Giới hạn, nói ra:** ⒜ ghi công theo (hàm, bảng), không theo TRIGGER — `kiem_danh_tinh_theo_phien`
 * gắn 4 trigger BEFORE-ROW UPDATE trên `rfq_packages` với `WHEN` khác nhau, một lần đi qua là đủ
 * cho cả bốn, vì thân hàm là một; ⒝ một hàm gọi lồng từ trigger AFTER của cùng bảng, cùng sự kiện,
 * cùng câu, vẫn được ghi công — kho hôm nay không có ca ấy, và nó đòi hàm ấy CŨNG có trigger
 * BEFORE-ROW ở đó; ⒞ phép đo nói "có một đường trả về", không nói "mọi điều kiện của hàm đều
 * đúng"; ⒟ kịch bản là một lời khai về ĐƯỜNG HỢP LỆ của từng bảng — nó không thể tự sinh, nhưng
 * nó không thể nói dối: một câu không đi qua thì ném, một câu 0 hàng thì không ghi công; ⒠ ~~tập
 * rộng khoá theo trigger BEFORE cấp HÀNG — một trigger cấp CÂU LỆNH hay AFTER-ROW ném vô điều
 * kiện cũng làm bảng chỉ-ghi-thêm mà không vào tổng điều tra lẫn nhân chứng: khoản nợ 75.~~
 * **[S1.31] Tập rộng nay là MỌI trigger trên UPDATE/DELETE**; một hàm canh ngoài hình thức
 * BEFORE-ROW là ĐỎ ở tổng điều tra, và năm hàm AFTER-ROW của kho có nhân chứng như mọi hàm khác.
 */
type SuKien = "UPDATE" | "DELETE";

/**
 * Hàm canh MỘT SỰ KIỆN: từ chối vô điều kiện ở sự kiện nêu tên, có điều kiện ở sự kiện kia.
 * Không phải hàm canh chỉ-ghi-thêm (bảng vẫn sửa được) nên vẫn đứng ở `HAM_KHONG_PHAI_CANH`;
 * nhân chứng của nó chỉ có được ở sự kiện kia, và sự kiện nêu tên phải được ĐO là NÉM từ chính
 * hàm ấy (`where` của lỗi PostgreSQL) — không được im lặng bỏ qua. Mỗi tên phải có trong
 * `HAM_KHONG_PHAI_CANH` và mang trigger ở đúng sự kiện ấy trong tập rộng; sự kiện ấy mà có một
 * câu đi qua thì lời khai này là sai và ĐỎ.
 */
const HAM_CANH_MOT_SU_KIEN: Readonly<Record<string, SuKien>> = {
  "public.rfq_key_material_bat_bien": "DELETE",
};

interface HangTapRong {
  readonly ham: string;
  readonly bang: string;
  readonly upd: boolean;
  readonly del: boolean;
  /** Trigger BEFORE cấp HÀNG — hình thức DUY NHẤT mà `VI_TU_BANG_CHI_GHI_THEM` nhận. */
  readonly truoc_hang: boolean;
  /** Constraint trigger DEFERRABLE — chạy ở COMMIT, sau lần đọc bộ đếm thứ hai: không đo được [lượt soi 21]. */
  readonly hoan: boolean;
  /** Thân hàm đọc vai đang chạy — nhân chứng của nó phải đến từ một vai KHÔNG superuser. */
  readonly nhay_vai: boolean;
}

function coSuKien(r: HangTapRong, suKien: SuKien): boolean {
  return suKien === "UPDATE" ? r.upd : r.del;
}

/** `calls` của từng hàm plpgsql TRONG GIAO DỊCH HIỆN TẠI — bộ đếm cục bộ của backend, không cần đẩy ra vùng chung. */
async function demGoiTrongGiaoDich(c: pg.PoolClient): Promise<Map<string, number>> {
  const { rows } = await c.query<{ ten: string; calls: string }>(
    "SELECT (schemaname OPERATOR(pg_catalog.||) '.' OPERATOR(pg_catalog.||) funcname) AS ten, " +
      "calls::pg_catalog.text AS calls FROM pg_catalog.pg_stat_xact_user_functions",
  );
  return new Map(rows.map((r) => [r.ten, Number(r.calls)]));
}

/** Một nhân chứng: bước chuẩn bị (tuỳ chọn) rồi ĐÚNG MỘT câu UPDATE/DELETE, trong cùng giao dịch. */
interface NhanChung {
  readonly chuanBi?: (c: pg.PoolClient) => Promise<void>;
  readonly cau: (c: pg.PoolClient) => Promise<number | null>;
}

/** Vai đã chạy câu nhân chứng — ĐO bằng `current_user`, không khai. */
interface VaiDo {
  readonly ten: string;
  readonly sieu: boolean;
}

/** Sổ ghi công nhân chứng: "hàm/bảng/sự kiện" ⇒ các vai đã để một hàng thật đi qua. */
class SoNhanChung {
  readonly ghiCong = new Map<string, VaiDo[]>();
  constructor(
    private readonly c: pg.PoolClient,
    private readonly tapRong: readonly HangTapRong[],
  ) {}

  /** Chạy một nhân chứng. Ném thì ném ra ngoài — kịch bản hỏng phải NHÌN THẤY. */
  async chung(bang: string, suKien: SuKien, nc: NhanChung): Promise<void> {
    const c = this.c;
    await c.query("BEGIN");
    try {
      await nc.chuanBi?.(c);
      // Một constraint trigger DEFERRED chạy ở COMMIT — SAU lần đọc bộ đếm thứ hai — nên hàm của nó
      // không bao giờ được ghi công: ĐỎ nhìn thấy được, không im lặng. Hôm nay 0/46 trigger UPDATE/
      // DELETE là deferrable (BEFORE không thể là constraint trigger; 5 AFTER-ROW đo được false).
      // KHÔNG ép `SET CONSTRAINTS ALL IMMEDIATE` ở đây: 017 có một constraint trigger DEFERRED trên
      // INSERT `rfq_key_material` đòi RFQ được mở TRONG CÙNG giao dịch — ép nó chạy ngay là tự bắn
      // vào chân, và bản đầu của vòng S1.31 đã đo đúng cú ấy.
      const vai = (
        await c.query<VaiDo>(
          "SELECT r.rolname AS ten, r.rolsuper AS sieu FROM pg_catalog.pg_roles r " +
            "WHERE r.rolname OPERATOR(pg_catalog.=) pg_catalog.current_user()",
        )
      ).rows[0];
      if (!vai) throw new Error("không đọc được vai đang chạy");
      const truoc = await demGoiTrongGiaoDich(c);
      const soHang = (await nc.cau(c)) ?? 0;
      const sau = await demGoiTrongGiaoDich(c);
      await c.query("COMMIT");
      if (soHang < 1) return; // ⒞ — không hàng nào đổi thì không ai được ghi công
      for (const r of this.tapRong) {
        if (r.bang !== bang || !coSuKien(r, suKien)) continue; // ⒜ — mọi hình thức trigger [S1.31]
        if ((sau.get(r.ham) ?? 0) > (truoc.get(r.ham) ?? 0)) {
          // ⒝
          const khoa = `${r.ham}/${bang}/${suKien}`;
          this.ghiCong.set(khoa, [...(this.ghiCong.get(khoa) ?? []), vai]);
        }
      }
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  }

  /**
   * Mọi bộ ba (hàm, bảng, sự kiện) tập rộng THẤY cho các hàm đã khai mà chưa có nhân chứng hợp lệ —
   * với hàm nhạy vai, hợp lệ nghĩa là đến từ một vai KHÔNG superuser — trừ bộ ba đã khai canh-một-sự-kiện.
   */
  chuaCoNhanChung(daKhai: readonly string[]): string[] {
    const thieu = new Set<string>();
    for (const r of this.tapRong) {
      if (!daKhai.includes(r.ham)) continue;
      for (const suKien of ["UPDATE", "DELETE"] as const) {
        if (!coSuKien(r, suKien) || HAM_CANH_MOT_SU_KIEN[r.ham] === suKien) continue;
        const vai = this.ghiCong.get(`${r.ham}/${r.bang}/${suKien}`) ?? [];
        const hopLe = r.nhay_vai ? vai.some((v) => !v.sieu) : vai.length > 0;
        if (!hopLe)
          thieu.add(
            `${r.ham}/${r.bang}/${suKien}` +
              (r.nhay_vai ? " (cần vai không superuser)" : "") +
              (r.hoan ? " (trigger DEFERRABLE chạy ở COMMIT — phép đo không với tới; đổi thành NOT DEFERRABLE)" : ""),
          );
      }
    }
    return [...thieu].sort();
  }

  /** Các bộ ba đã ghi công của một (hàm, sự kiện) — để khẳng định một hàm canh một sự kiện KHÔNG có nhân chứng ở sự kiện ấy. */
  daGhiCong(ham: string, suKien: SuKien): string[] {
    return [...this.ghiCong.keys()].filter((k) => k.startsWith(`${ham}/`) && k.endsWith(`/${suKien}`)).sort();
  }
}

/** UPDATE/DELETE trần dưới vai của kết nối — trả số hàng chạm. */
function cau(sql: string, thamSo: readonly unknown[]): NhanChung {
  return { cau: async (c) => (await c.query(sql, [...thamSo])).rowCount };
}

/** Cùng câu ấy, có bước chuẩn bị trong cùng giao dịch — chuẩn bị đứng TRƯỚC lần đọc bộ đếm đầu. */
function cauSauKhi(chuanBi: (c: pg.PoolClient) => Promise<void>, sql: string, thamSo: readonly unknown[]): NhanChung {
  return { chuanBi, ...cau(sql, thamSo) };
}

/** Cùng câu ấy nhưng dưới `app_api` trong tenant — cho hàm đọc vai đang chạy. */
function cauDuoiAppApi(orgId: string, sql: string, thamSo: readonly unknown[]): NhanChung {
  return cauSauKhi(
    async (c) => {
      await c.query("SET LOCAL ROLE app_api");
      await c.query("SELECT pg_catalog.set_config('app.org_id', $1, true)", [orgId]);
    },
    sql,
    thamSo,
  );
}

/** Lỗi PostgreSQL kèm `where` — để khẳng định lời từ chối đến từ ĐÚNG hàm, không từ một ràng buộc khác. */
async function loiCua(
  chay: () => Promise<unknown>,
): Promise<{ readonly message: string; readonly where: string } | null> {
  try {
    await chay();
    return null;
  } catch (e) {
    const err = e as Error & { where?: string };
    return { message: err.message, where: err.where ?? "" };
  }
}

/**
 * Kịch bản nhân chứng: một đời RFQ (soạn → nộp → mở → gia hạn → mời → đóng → yêu cầu mở thầu →
 * duyệt → điều phối → mở thầu), một RFQ thứ hai bị huỷ để thu hồi vật liệu khoá, một việc
 * outbox, một liên kết đăng nhập, và một lượt đặt lại TOTP hai người. Mỗi `so.chung(...)` là một
 * câu UPDATE/DELETE hợp lệ; các INSERT chỉ dựng trạng thái. Dữ liệu để lại là vô hại với các test
 * còn lại của tệp — chúng đọc catalog, không đọc dữ liệu — và mọi khoá duy nhất mang một hậu tố
 * ngẫu nhiên nên kịch bản chạy được nhiều lần trên cùng CSDL.
 */
async function dungKichBan(c: pg.PoolClient, so: SoNhanChung): Promise<{ readonly orgId: string }> {
  const hex = randomBytes(4).toString("hex");
  const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const XA_HON = new Date(Date.now() + 14 * 24 * 3600 * 1000);
  const id = async (sql: string, thamSo: readonly unknown[]): Promise<string> => {
    const { rows } = await c.query<{ id: string }>(sql, [...thamSo]);
    const v = rows[0]?.id;
    if (!v) throw new Error(`không có id trả về: ${sql.slice(0, 60)}`);
    return v;
  };
  const org = await id("INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [`nc-${hex}`]);
  const nguoi = async (vai: string): Promise<{ readonly u: string; readonly s: string }> => {
    const u = await id(
      "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $2) RETURNING id",
      [org, `${vai.toLowerCase()}-${randomBytes(3).toString("hex")}@vidu.vn`],
    );
    await c.query("INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [org, u, vai]);
    const s = await id(
      "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) " +
        "VALUES ($1, $2, $3, now() + interval '1 day', now()) RETURNING id",
      [org, u, randomBytes(32)],
    );
    return { u, s };
  };
  const pm = await nguoi("PROCUREMENT_MANAGER");
  const pm2 = await nguoi("PROCUREMENT_MANAGER");
  const gd = await nguoi("DIRECTOR");
  const nan = await nguoi("BUYER");
  const cs = await id(
    "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, " +
      "created_by, created_by_session_id) VALUES ($1, 1, '100000000.00', 'VND', $2, $3) RETURNING id",
    [org, pm.u, pm.s],
  );

  const rfqSoan = async (): Promise<string> => {
    const r = await id(
      "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, " +
        "created_by_session_id) VALUES ($1, 'Mua thep tam', $2, false, $3, $4) RETURNING id",
      [org, MAI_SAU, pm.u, pm.s],
    );
    await c.query(
      "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, created_by, " +
        "created_by_session_id) VALUES ($1, $2, 1, 'Thep tam', '10.0000', 'tam', $3, $4), " +
        "($1, $2, 2, 'Thep cuon', '5.0000', 'cuon', $3, $4)",
      [org, r, pm.u, pm.s],
    );
    await c.query(
      "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, created_by, " +
        "created_by_session_id) VALUES ($1, $2, '1000000.00', 'VND', $3, $4, $5)",
      [org, r, cs, pm.u, pm.s],
    );
    return r;
  };
  /** Nộp duyệt rồi mở — 017 đòi vật liệu khoá sinh TRONG giao dịch mở, nên nó là bước chuẩn bị. */
  const rfqMo = async (r: string): Promise<void> => {
    await so.chung(
      "public.rfq_packages",
      "UPDATE",
      cau("UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1", [r, pm.u, pm.s]),
    );
    await so.chung(
      "public.rfq_packages",
      "UPDATE",
      cauSauKhi(
        async (cc) => {
          await cc.query(
            "INSERT INTO rfq_key_material (org_id, rfq_id, algorithm, public_key, wrapped_private_key, " +
              "key_version, created_by, created_by_session_id) VALUES ($1, $2, 'ECDH_P256', $3, $4, 'test-v1', $5, $6)",
            [org, r, Buffer.alloc(91, 1), Buffer.alloc(80, 2), pm.u, pm.s],
          );
        },
        "UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, opened_by_session_id = $3 WHERE id = $1",
        [r, pm.u, pm.s],
      ),
    );
  };

  // ---- RFQ 1: trọn một đời --------------------------------------------------------------------
  const rfq1 = await rfqSoan();
  await so.chung("public.rfq_items", "UPDATE", cau("UPDATE rfq_items SET description = 'Thep tam day 10' WHERE rfq_id = $1 AND line_no = 1", [rfq1]));
  await so.chung("public.rfq_items", "DELETE", cau("DELETE FROM rfq_items WHERE rfq_id = $1 AND line_no = 2", [rfq1]));
  await so.chung("public.rfq_budgets", "UPDATE", cau("UPDATE rfq_budgets SET estimated_value = '2000000.00' WHERE rfq_id = $1", [rfq1]));
  await so.chung("public.rfq_packages", "UPDATE", cau("UPDATE rfq_packages SET title = 'Mua thep tam day' WHERE id = $1", [rfq1]));
  await rfqMo(rfq1);
  await so.chung("public.rfq_packages", "UPDATE", cau("UPDATE rfq_packages SET deadline_at = $2 WHERE id = $1", [rfq1, XA_HON]));
  // Mời một nhà cung cấp trong lúc RFQ đang OPEN.
  const ncc = await id(
    "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) VALUES ($1, $2, $3, $4) RETURNING id",
    [org, `NCC ${hex}`, pm.u, pm.s],
  );
  const lh = await id(
    "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
      "VALUES ($1, $2, 'Nguoi ban', $3, '0900000001', $4, $5) RETURNING id",
    [org, ncc, `${hex}@vidu.vn`, pm.u, pm.s],
  );
  const lm = await id(
    "INSERT INTO rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, invited_by, invited_by_session_id) " +
      "VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6) RETURNING id",
    [org, rfq1, ncc, lh, pm.u, pm.s],
  );
  const tk = await id(
    "INSERT INTO rfq_invitation_tokens (org_id, invitation_id, token_hash, purpose, expires_at, issued_by, issued_by_session_id) " +
      "VALUES ($1, $2, $3, 'BID_SUBMISSION', now() + interval '1 day', $4, $5) RETURNING id",
    [org, lm, randomBytes(32), pm.u, pm.s],
  );
  const tt = await id(
    "INSERT INTO invitation_otp_challenges (org_id, invitation_id, token_id, contact_id, channel, code_hash, " +
      "destination_hash, pepper_version, expires_at) VALUES ($1, $2, $3, $4, 'SMS', $5, $6, 'test-v1', now() + interval '1 day') RETURNING id",
    [org, lm, tk, lh, randomBytes(32), randomBytes(32)],
  );
  await so.chung("public.invitation_otp_challenges", "UPDATE", cau("UPDATE invitation_otp_challenges SET failed_attempts = failed_attempts + 1 WHERE id = $1", [tt]));
  // Khách xác minh xong: thách thức được tiêu thụ, một phiên khách ra đời rồi bị thu hồi, token bị thu hồi.
  await c.query("UPDATE invitation_otp_challenges SET consumed_at = now() WHERE id = $1", [tt]);
  const pk = await id(
    "INSERT INTO guest_sessions (org_id, invitation_id, challenge_id, token_hash, verified_contact_id, verified_channel, expires_at) " +
      "VALUES ($1, $2, $3, $4, $5, 'SMS', now() + interval '1 day') RETURNING id",
    [org, lm, tt, randomBytes(32), lh],
  );
  await so.chung("public.guest_sessions", "UPDATE", cau("UPDATE guest_sessions SET revoked_at = now() WHERE id = $1", [pk]));
  await so.chung("public.rfq_invitation_tokens", "UPDATE", cau("UPDATE rfq_invitation_tokens SET revoked_at = now() WHERE id = $1", [tk]));
  await so.chung(
    "public.rfq_invitations",
    "UPDATE",
    cau("UPDATE rfq_invitations SET status = 'REVOKED', revoked_at = now(), revoked_by = $2, revoked_by_session_id = $3 WHERE id = $1", [lm, pm.u, pm.s]),
  );
  await so.chung(
    "public.rfq_packages",
    "UPDATE",
    cau("UPDATE rfq_packages SET status = 'CLOSED', closed_at = now(), early_close_reason = 'dong som de do', closed_by = $2, closed_by_session_id = $3 WHERE id = $1", [rfq1, pm.u, pm.s]),
  );
  const yc = await id(
    "INSERT INTO unseal_requests (org_id, rfq_id, reason, requested_by, requested_by_session_id) VALUES ($1, $2, 'den gio mo thau', $3, $4) RETURNING id",
    [org, rfq1, pm.u, pm.s],
  );
  await c.query(
    "INSERT INTO unseal_approvals (org_id, unseal_request_id, approver_user_id, approver_session_id) VALUES ($1, $2, $3, $4)",
    [org, yc, gd.u, gd.s],
  );
  await so.chung("public.unseal_requests", "UPDATE", cau("UPDATE unseal_requests SET status = 'APPROVED', approved_at = now() WHERE id = $1", [yc]));
  await so.chung(
    "public.unseal_requests",
    "UPDATE",
    cau("UPDATE unseal_requests SET dispatched_at = now(), dispatched_by = $2, dispatched_by_session_id = $3 WHERE id = $1", [yc, pm.u, pm.s]),
  );
  await so.chung("public.rfq_packages", "UPDATE", cau("UPDATE rfq_packages SET status = 'UNSEALED' WHERE id = $1", [rfq1]));

  // ---- RFQ 2: huỷ để thu hồi vật liệu khoá ---------------------------------------------------
  const rfq2 = await rfqSoan();
  await rfqMo(rfq2);
  await so.chung(
    "public.rfq_packages",
    "UPDATE",
    cau("UPDATE rfq_packages SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = $2, cancelled_by_session_id = $3 WHERE id = $1", [rfq2, pm.u, pm.s]),
  );
  await so.chung(
    "public.rfq_key_material",
    "UPDATE",
    cau("UPDATE rfq_key_material SET revoked_at = now(), revoked_reason = 'rfq da huy', revoked_by = $2, revoked_by_session_id = $3 WHERE rfq_id = $1", [rfq2, pm.u, pm.s]),
  );

  // ---- Outbox: việc gửi liên kết đăng nhập kết thúc thì payload bị xoá; liên kết được tiêu thụ ---
  const viec = await id("INSERT INTO outbox_jobs (org_id, kind, payload) VALUES ($1, 'LOGIN_LINK_SEND', $2::jsonb) RETURNING id", [org, JSON.stringify({ email: "x@vidu.vn" })]);
  await so.chung("public.outbox_jobs", "UPDATE", cau("UPDATE outbox_jobs SET status = 'DONE', finished_at = now() WHERE id = $1", [viec]));
  const lk = await id(
    "INSERT INTO user_login_tokens (org_id, user_id, token_hash, purpose, expires_at) VALUES ($1, $2, $3, 'LOGIN', now() + interval '1 hour') RETURNING id",
    [org, nan.u, randomBytes(32)],
  );
  await so.chung("public.user_login_tokens", "UPDATE", cau("UPDATE user_login_tokens SET consumed_at = now() WHERE id = $1", [lk]));

  // ---- TOTP: ghi danh lại khi CHƯA xác nhận (031), rồi đặt lại hai người và xoá (040) ----------
  await c.query(
    "INSERT INTO mfa_credentials (org_id, user_id, kind, secret_wrapped, secret_key_version) VALUES ($1, $2, 'TOTP', '\\x01', 'v1')",
    [org, nan.u],
  );
  await so.chung(
    "public.mfa_credentials",
    "UPDATE",
    cauDuoiAppApi(org, "UPDATE mfa_credentials SET secret_wrapped = '\\x02', secret_key_version = 'v2' WHERE org_id = $1 AND user_id = $2", [org, nan.u]),
  );
  const yd = await id(
    "INSERT INTO mfa_reset_requests (org_id, user_id, reason, requested_by, requested_by_session_id) VALUES ($1, $2, 'mat dien thoai', $3, $4) RETURNING id",
    [org, nan.u, pm.u, pm.s],
  );
  await so.chung(
    "public.mfa_reset_requests",
    "UPDATE",
    cau("UPDATE mfa_reset_requests SET status = 'APPROVED', approved_by = $2, approved_by_session_id = $3, approved_at = now() WHERE id = $1", [yd, pm2.u, pm2.s]),
  );
  await so.chung("public.mfa_credentials", "DELETE", cauDuoiAppApi(org, "DELETE FROM mfa_credentials WHERE org_id = $1 AND user_id = $2", [org, nan.u]));

  // ---- [S1.31] Năm hàm AFTER-ROW UPDATE: ma trận quyền, phân tách nhiệm vụ, đình chỉ -------------
  await so.chung("public.user_roles", "UPDATE", cau("UPDATE user_roles SET role_code = role_code WHERE org_id = $1 AND user_id = $2", [org, pm.u]));
  await so.chung("public.role_permissions", "UPDATE", cau("UPDATE role_permissions SET permission_code = permission_code WHERE role_code = 'BUYER'", []));
  const dc = await nguoi("BUYER");
  await so.chung("public.users", "UPDATE", cau("UPDATE users SET status = 'SUSPENDED' WHERE org_id = $1 AND id = $2", [org, dc.u]));

  return { orgId: org };
}

describe("[INV-H19] hardening suy chủ thể từ TÍNH CHẤT, không từ danh sách tên", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startPostgres();
    await migrate(db.pool, MIGRATIONS_DIR);
  }, 180000);

  afterAll(async () => {
    await db.stop();
  });

  it("vị từ chỉ-ghi-thêm suy từ tính chất, và nó nhận ĐÚNG năm bảng — kể cả ba bảng S1 mà danh sách hai tên bỏ sót", async () => {
    const { rows } = await db.pool.query<{ relname: string }>(
      `${VI_TU_BANG_CHI_GHI_THEM} ORDER BY c.relname`,
    );
    expect(rows.map((r) => r.relname)).toEqual(BANG_CHI_GHI_THEM_THAT);

    // Đối chứng ÂM cho vế `RETURN`: `rfq_items` có một trigger TRUNCATE (`rfq_items_cam_truncate`)
    // thân không RETURN, và nó KHÔNG được lọt vào tập. Không có khẳng định này thì một vị từ lỏng
    // hơn vẫn xanh ở trên.
    expect(rows.map((r) => r.relname)).not.toContain("rfq_items");

    // Và vị từ này phải là CÙNG MỘT VĂN BẢN với vị từ trong hardening — hai bản sao trôi khỏi
    // nhau tái tạo đúng cái mù mà test này tồn tại để đóng (khuôn BANG_GOC_TENANT của Task 3-4).
    expect(
      HARDENING.includes(VI_TU_BANG_CHI_GHI_THEM),
      "vị từ trong test phải xuất hiện NGUYÊN VĂN trong hardening.always.sql",
    ).toBe(true);

    // [review lượt 12, H2] Và vế SCHEMA của nó phải là `MAU_SCHEMA_DU_AN` đã khai triển, không phải
    // một `nspname = 'public'` viết cứng — bản đầu của vòng này viết khoá cứng, tức tái lập đúng
    // thứ [CR2a] đã CỐ Ý gỡ khỏi `bang_so`. Đọc thẳng hằng ấy từ file rồi so, để hai bên không trôi.
    const mauSchema = /MAU_SCHEMA_DU_AN constant text :=\s*\$q\$([\s\S]*?)\$q\$;/.exec(HARDENING);
    expect(mauSchema, "không tìm thấy MAU_SCHEMA_DU_AN").not.toBeNull();
    // So sau khi gộp khoảng trắng: hai chỗ có mức thụt lề khác nhau, và thụt lề không phải thứ
    // đang được đo.
    const gonTrang = (t: string): string => t.replace(/\s+/gu, " ").trim();
    const khaiTrien = gonTrang(mauSchema![1]!.replaceAll("%1$s", "n").replaceAll("%%", "%"));
    expect(
      gonTrang(VI_TU_BANG_CHI_GHI_THEM).includes(khaiTrien),
      "vế schema phải BẰNG MAU_SCHEMA_DU_AN khai triển cho bí danh `n`",
    ).toBe(true);
  });

  it("mọi bảng chỉ-ghi-thêm đều LOGGED — bảng có TÊN thì hardening TỰ CHỮA, bảng SUY RA thì hardening NÉM", async () => {
    const { rows } = await db.pool.query<{ relname: string; relpersistence: string }>(
      `${VI_TU_BANG_CHI_GHI_THEM} ORDER BY c.relname`,
    );
    expect(rows.filter((r) => r.relpersistence !== "p").map((r) => r.relname)).toEqual([]);

    // [CR5] đo hậu quả bằng SIGKILL postgres thật: trước-crash 4 hàng, sau-crash 0. Cửa sổ phơi
    // là VĨNH VIỄN vì `SET UNLOGGED` đòi quyền SỞ HỮU, không phải quyền ghi.
    //
    // KHÔNG ép danh sách bảng: PostgreSQL TỪ CHỐI `SET UNLOGGED` cho một bảng đang được một bảng
    // LOGGED tham chiếu (`vendor_bid_versions`, `rfq_unsealed_bids` rơi vào đó — đã đo). Đó là một
    // lớp khác, của chính PostgreSQL, và nó KHÔNG phủ hết: `audit_chain_anchors` và `bid_receipts`
    // đổi được. Test thử từng bảng và chỉ đòi hỏi ở những bảng mà đột biến THÀNH CÔNG.
    //
    // HAI KẾT QUẢ ĐÚNG KHÁC NHAU, và sự khác nhau ấy CHÍNH LÀ ADR-028 §2⑵ đo được:
    //   - bảng có TÊN trong `BANG_CHI_GHI_THEM` -> hardening TỰ CHỮA: migrate() OK, bảng về LOGGED;
    //   - bảng SUY RA (ba bảng của S1)          -> hardening chỉ PHÁN XÉT: migrate() NÉM.
    // `migrate()` không bao giờ tự tay đổi trạng thái vật lý của một bảng mà nó chỉ SUY RA.
    let soDotBien = 0;
    for (const r of rows) {
      if ((await thu(db, `ALTER TABLE public.${r.relname} SET UNLOGGED`)) !== "OK") continue;
      soDotBien += 1;
      const ketQua = await migrateLai(db);
      if (BANG_CO_TEN.includes(r.relname)) {
        expect(ketQua, `${r.relname} có tên trong danh sách nên hardening TỰ CHỮA`).toBe("OK");
        const { rows: sau } = await db.pool.query<{ p: string }>(
          `SELECT relpersistence AS p FROM pg_class WHERE oid = to_regclass('public.${r.relname}')`,
        );
        expect(sau[0]?.p, `${r.relname} phải được đưa về LOGGED`).toBe("p");
      } else {
        expect(ketQua, `${r.relname} là bảng SUY RA nên hardening chỉ phán xét`).toMatch(/UNLOGGED/u);
        expect(await thu(db, `ALTER TABLE public.${r.relname} SET LOGGED`)).toBe("OK");
      }
    }
    expect(soDotBien, "phải có ít nhất hai bảng đổi được sang UNLOGGED, nếu không test này rỗng")
      .toBeGreaterThan(1);
    expect(await migrateLai(db), "đối chứng dương: lược đồ đúng vẫn migrate() được").toBe("OK");
  }, 180000);

  it("mọi bảng chỉ-ghi-thêm CHẶN CẢ TRUNCATE — không chỉ UPDATE và DELETE", async () => {
    // Ba bảng của S1 chỉ có trigger BEFORE DELETE OR UPDATE (tgtype 27). TRUNCATE đi qua chúng.
    for (const bang of BANG_CHI_GHI_THEM_THAT) {
      expect(await thu(db, `TRUNCATE public.${bang} CASCADE`), `TRUNCATE ${bang}`).toMatch(
        /chỉ-ghi-thêm|chi duoc ghi them/u,
      );
    }

    // [review lượt 12, M2] Vế "có chốt TRUNCATE" nay đòi trigger ĐANG BẬT (`tgenabled='A'`) và
    // BEFORE. Bản đầu chỉ hỏi *có hàng nào trong pg_trigger mang bit 32 không*, nên một
    // `DISABLE TRIGGER` cho ra mục XANH trong khi TRUNCATE đi lọt hoàn toàn.
    //
    // Trên `bid_receipts` đột biến ấy KHÔNG dừng ở phán xét, và đó là kết quả ĐÚNG: ba trigger của
    // ba bảng S1 có TÊN trong mục ghim `bid_chi_ghi_them (047)`, nên hardening **TỰ CHỮA** — cùng
    // ranh giới ADR-028 §2⑵ mà đột biến UNLOGGED ở trên đo. Lượt ĐỎ THẬT của vế `tgenabled` nằm ở
    // ca PHÂN MẢNH bên dưới, nơi bảng là SUY RA và không mục ghim nào che.
    expect(
      await thu(db, "ALTER TABLE public.bid_receipts DISABLE TRIGGER bid_receipts_chan_truncate"),
    ).toBe("OK");
    expect(await thu(db, "TRUNCATE public.bid_receipts CASCADE"), "chốt đã tắt thì TRUNCATE đi lọt")
      .toBe("OK");
    expect(await migrateLai(db), "trigger có TÊN trong mục ghim nên hardening tự chữa").toBe("OK");
    const { rows: bat } = await db.pool.query<{ e: string }>(
      "SELECT tgenabled AS e FROM pg_trigger WHERE tgname = 'bid_receipts_chan_truncate'",
    );
    expect(bat[0]?.e, "chốt phải được dựng lại ở ENABLE ALWAYS").toBe("A");
    expect(await thu(db, "TRUNCATE public.bid_receipts CASCADE"), "và chặn trở lại").toMatch(
      /chi duoc ghi them/u,
    );
  }, 180000);

  it("không ai ngoài chủ sở hữu được cấp UPDATE/DELETE/TRUNCATE trên bảng chỉ-ghi-thêm — kể cả ở MỨC CỘT", async () => {
    const cauQuyen = `SELECT b.relname, a.privilege_type
         FROM (${VI_TU_BANG_CHI_GHI_THEM}) b
         JOIN pg_class c ON c.oid = b.bang_oid
         CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        WHERE a.grantee <> c.relowner
          AND a.privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE')`;
    const { rows } = await db.pool.query(cauQuyen);
    expect(rows).toEqual([]);

    // Đột biến 1 — mức BẢNG: một GRANT của kẻ tấn công phải KHÔNG sống qua `migrate()`.
    expect(await thu(db, "GRANT UPDATE, DELETE, TRUNCATE ON public.bid_receipts TO app_api")).toBe(
      "OK",
    );
    expect(await migrateLai(db), "GRANT lạ phải làm migrate() NÉM").toMatch(/bid_receipts/u);
    expect(await thu(db, "REVOKE UPDATE, DELETE, TRUNCATE ON public.bid_receipts FROM app_api")).toBe(
      "OK",
    );
    expect(await migrateLai(db)).toBe("OK");

    // Đột biến 2 — mức CỘT [review lượt 12, M1]. Quyền cột nằm ở `pg_attribute.attacl` và VÔ HÌNH
    // với `relacl`, nên bản đầu của vòng này để nó sống qua mọi deploy. `canonical_text` là CHÍNH
    // CHUỖI ĐƯỢC KÝ của biên nhận, nên đây chạm thẳng B2.
    expect(await thu(db, "GRANT UPDATE (canonical_text) ON public.bid_receipts TO app_api")).toBe(
      "OK",
    );
    expect(await migrateLai(db), "GRANT mức CỘT cũng phải làm migrate() NÉM").toMatch(
      /canonical_text/u,
    );
    expect(
      await thu(db, "REVOKE UPDATE (canonical_text) ON public.bid_receipts FROM app_api"),
    ).toBe("OK");
    expect(await migrateLai(db), "đối chứng dương").toBe("OK");
  }, 180000);

  it("[sổ nợ 16] bảng sổ không có cột nào NGOÀI chuỗi hash — phép ĐẾM không cấm cột thừa", async () => {
    // `MAU_HINH_DANG_SO` là `count(attname IN (15 tên)) = 15`: thêm một cột thứ 16 vẫn cho ra 15.
    // Đo được: `ALTER TABLE audit_events ADD COLUMN payload_plaintext text` -> MIGRATE OK,
    // applied=[]. Cột ấy nằm NGOÀI mọi trường mà `noi_chuoi_kiem_toan()` băm, tức nội dung sống
    // trong sổ kiểm toán mà chuỗi hash KHÔNG phủ — nền của B3 mất một mảng.
    expect(
      await thu(db, "ALTER TABLE public.audit_events ADD COLUMN payload_plaintext text"),
    ).toBe("OK");
    expect(await migrateLai(db), "cột ngoài chuỗi hash phải làm migrate() NÉM").toMatch(
      /payload_plaintext/u,
    );
    expect(await thu(db, "ALTER TABLE public.audit_events DROP COLUMN payload_plaintext")).toBe(
      "OK",
    );
    expect(await migrateLai(db), "đối chứng dương").toBe("OK");
  }, 180000);

  it("[sổ nợ 16] bảng gốc của cây tenant suy từ TÍNH CHẤT (đích của khoá ngoại org_id một cột), không từ tên 'organizations'", async () => {
    // Hôm nay `VI_TU_BANG_TENANT` giấu `OR relname IN ('organizations')` bên trong một vị từ
    // tính-chất. Đo được: 28 bảng có cột `org_id`, và cả 28 khoá ngoại MỘT CỘT `org_id` đều trỏ
    // tới `organizations` — tức tính chất ấy có thật và duy nhất, không cần cái tên.
    const { rows: goc } = await db.pool.query<{ goc: string }>(
      `SELECT DISTINCT ref.relname AS goc
         FROM pg_constraint con
         JOIN pg_class cl ON cl.oid = con.conrelid
         JOIN pg_class ref ON ref.oid = con.confrelid
         JOIN pg_namespace n ON n.oid = cl.relnamespace
        WHERE con.contype = 'f' AND n.nspname = 'public'
          AND array_length(con.conkey, 1) = 1
          AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = cl.oid
                        AND a.attnum = con.conkey[1] AND a.attname = 'org_id'
                        AND NOT a.attisdropped)`,
    );
    expect(goc.map((r) => r.goc)).toEqual(["organizations"]);

    // Đột biến: một bảng gốc tenant THỨ HAI — đúng khuôn của dự án, kèm policy đúng `HINH_DANG_
    // CHUAN` — phải được bật RLS + FORCE như `organizations`, và `migrate()` vẫn phải THÀNH CÔNG.
    // Vế thứ hai là đối chứng dương bắt buộc của vòng này: một vị từ rộng hơn sẽ CHẶN DEPLOY trên
    // một lược đồ hợp lệ, và đó là chế độ hỏng nguy hiểm hơn của file hardening.
    await db.pool.query("CREATE TABLE public.chi_nhanh (id uuid PRIMARY KEY)");
    await db.pool.query(
      `CREATE TABLE public.chi_nhanh_thanh_vien (
         id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES public.chi_nhanh(id))`,
    );
    await db.pool.query(
      `CREATE POLICY chi_nhanh_tenant_isolation ON public.chi_nhanh
         USING (id = app_current_org_id()) WITH CHECK (id = app_current_org_id())`,
    );
    await db.pool.query(
      `CREATE POLICY chi_nhanh_thanh_vien_tenant_isolation ON public.chi_nhanh_thanh_vien
         USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id())`,
    );
    try {
      const ketQua = await migrateLai(db);
      const { rows } = await db.pool.query<{ ten: string; r: boolean; f: boolean }>(
        `SELECT relname AS ten, relrowsecurity AS r, relforcerowsecurity AS f FROM pg_class
          WHERE oid IN (to_regclass('public.chi_nhanh'), to_regclass('public.chi_nhanh_thanh_vien'))
          ORDER BY relname`,
      );
      expect(
        { migrate: ketQua, rls: rows },
        "bảng gốc tenant thứ hai phải được bật RLS + FORCE, và deploy vẫn phải đi qua",
      ).toEqual({
        migrate: "OK",
        rls: [
          { ten: "chi_nhanh", r: true, f: true },
          { ten: "chi_nhanh_thanh_vien", r: true, f: true },
        ],
      });
    } finally {
      await db.pool.query("DROP TABLE IF EXISTS public.chi_nhanh_thanh_vien");
      await db.pool.query("DROP TABLE IF EXISTS public.chi_nhanh");
      await migrateLai(db);
    }
  }, 180000);

  it("[review lượt 12, H1] một bảng chỉ-ghi-thêm PHÂN MẢNH: mỗi LÁ cũng vào tập, và chốt trên CHA KHÔNG phủ LÁ", async () => {
    // Reviewer lượt 12 nêu ca này như một khả năng CHẶN DEPLOY trên lược đồ hợp lệ. Phép đo cho
    // thấy tiền đề *"hợp lệ"* SAI: lá thật sự TRUNCATE được, tức nó là một LỖ chứ không phải một
    // báo động giả. Bốn sự kiện, đo trên PostgreSQL 16:
    //   ⑴ `CREATE TRIGGER … BEFORE TRUNCATE` trên bảng CHA (relkind='p') CHẠY ĐƯỢC — nên ca "điều
    //      kiện không thoả mãn được bằng bất kỳ migration nào" KHÔNG tồn tại;
    //   ⑵ trigger cấp HÀNG ĐƯỢC nhân bản xuống lá (`tgparentid <> 0`, `tgisinternal = false`) nên
    //      LÁ cũng vào tập suy ra — đúng như reviewer nói;
    //   ⑶ trigger TRUNCATE thì KHÔNG được nhân bản (003:323-324 đã ghi), và
    //   ⑷ `TRUNCATE <lá>` **đi lọt** dù CHA có chốt.
    // Kết luận: đòi chốt trên từng lá là ĐÚNG, không phải quá chặt. Cái giá là một phân mảnh mới
    // thêm ngoài migration sẽ chặn deploy tới khi có chốt — ghi ở ADR-028 §6, và thông điệp của
    // mục canh nói thẳng ra điều đó.
    // Phân mảnh theo `id`, KHÔNG theo `org_id`: một cột `org_id` biến bảng này thành bảng tenant
    // và kéo theo mọi phép kiểm policy — thứ không liên quan gì tới điều đang đo ở đây.
    await db.pool.query("CREATE TABLE public.so_pm (id uuid) PARTITION BY LIST (id)");
    try {
      await db.pool.query(
        "CREATE TABLE public.so_pm_a PARTITION OF public.so_pm " +
          "FOR VALUES IN ('00000000-0000-4000-8000-00000000000a')",
      );
      await db.pool.query(
        "CREATE TRIGGER so_pm_chan BEFORE DELETE OR UPDATE ON public.so_pm " +
          "FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them()",
      );
      expect(
        await thu(
          db,
          "CREATE TRIGGER so_pm_chan_truncate BEFORE TRUNCATE ON public.so_pm " +
            "FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them()",
        ),
        "⑴ trigger TRUNCATE trên bảng CHA phải cắm được",
      ).toBe("OK");
      await db.pool.query("ALTER TABLE public.so_pm ENABLE ALWAYS TRIGGER so_pm_chan_truncate");

      const { rows } = await db.pool.query<{ relname: string }>(
        `${VI_TU_BANG_CHI_GHI_THEM} ORDER BY c.relname`,
      );
      expect(rows.map((r) => r.relname), "⑵ CẢ cha lẫn lá đều vào tập suy ra").toEqual(
        [...BANG_CHI_GHI_THEM_THAT, "so_pm", "so_pm_a"].sort(),
      );

      const { rows: tg } = await db.pool.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM pg_trigger t " +
          " WHERE t.tgrelid = 'public.so_pm_a'::regclass AND NOT t.tgisinternal " +
          "   AND (t.tgtype & 32::int2) <> 0",
      );
      expect(tg[0]!.n, "⑶ trigger TRUNCATE KHÔNG được nhân bản xuống lá").toBe("0");

      expect(await thu(db, "TRUNCATE public.so_pm_a"), "⑷ TRUNCATE thẳng vào LÁ đi lọt").toBe("OK");
      expect(await thu(db, "TRUNCATE public.so_pm"), "TRUNCATE vào CHA thì bị chặn").toMatch(
        /chi duoc ghi them/u,
      );

      // Và vì lá là một lỗ thật, hardening phải KÊU về nó.
      expect(await migrateLai(db), "lá thiếu chốt TRUNCATE phải làm migrate() NÉM").toMatch(
        /so_pm_a/u,
      );
      // Đối chứng dương: cắm chốt cho lá xong thì deploy đi qua.
      await db.pool.query(
        "CREATE TRIGGER so_pm_a_chan_truncate BEFORE TRUNCATE ON public.so_pm_a " +
          "FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them()",
      );
      await db.pool.query(
        "ALTER TABLE public.so_pm_a ENABLE ALWAYS TRIGGER so_pm_a_chan_truncate",
      );
      expect(await migrateLai(db), "lá có chốt rồi thì deploy phải đi qua").toBe("OK");

      // [review lượt 12, M2] LƯỢT ĐỎ THẬT của vế `tgenabled = 'A'`. Đây là chỗ duy nhất đo được
      // nó: `so_pm_a` là bảng SUY RA, không mục ghim nào có tên nó, nên không có lớp tự chữa nào
      // che mất phán xét. Bản đầu của vòng này chỉ hỏi *có hàng nào mang bit 32 không* ⇒ mục XANH
      // trong khi `TRUNCATE` đi lọt.
      await db.pool.query("ALTER TABLE public.so_pm_a DISABLE TRIGGER so_pm_a_chan_truncate");
      expect(await thu(db, "TRUNCATE public.so_pm_a"), "chốt đã tắt thì TRUNCATE đi lọt").toBe("OK");
      expect(await migrateLai(db), "chốt bị TẮT trên bảng SUY RA phải làm migrate() NÉM").toMatch(
        /so_pm_a.*chốt TRUNCATE ĐANG BẬT/su,
      );
      await db.pool.query("ALTER TABLE public.so_pm_a ENABLE ALWAYS TRIGGER so_pm_a_chan_truncate");
      expect(await migrateLai(db), "đối chứng dương").toBe("OK");
    } finally {
      await db.pool.query("DROP TABLE IF EXISTS public.so_pm CASCADE");
      await migrateLai(db);
    }
  }, 180000);

  it("[sổ nợ 3] cây role của dự án BẰNG tập tên được ghim — và một role lạ mang BYPASSRLS bị ĐẨY KHỎI cây", async () => {
    // KHOẢN NỢ 3 VIẾT: *"`NOBYPASSRLS` chỉ ghim đúng BỐN TÊN ROLE"*, và đọc thì đúng: bốn khối
    // `ARRAY[…]` trong `hardening.always.sql` gọi thẳng tên. Vòng này dựng một mục thứ năm suy từ
    // tính chất — rồi GỠ nó, vì phép đo bác bỏ tiền đề: **BƯỚC 1 thu hồi mọi tư cách thành viên
    // LẠ**, nên tập "role trong cây dự án" LUÔN BẰNG tập tên đã ghim. Cửa mà khoản nợ mô tả có
    // thật và ĐÃ ĐÓNG — bởi một lớp KHÁC với lớp mà khoản nợ chỉ tên.
    //
    // Thứ CÓ THỂ TRÔI thì được canh ở đây: ngày một migration mở danh sách trắng cho role thứ
    // năm, khẳng định "cây == tập ghim" ĐỎ, và người mở phải ghim nó hoặc viết ra vì sao không.
    const cay = async (): Promise<string[]> => {
      const { rows } = await db.pool.query<{ rolname: string }>(
        `SELECT vai.rolname FROM pg_roles vai
          WHERE NOT vai.rolsuper
            AND EXISTS (SELECT 1 FROM unnest(ARRAY['app_api', 'app_unseal']) AS g(ten)
                         WHERE to_regrole(g.ten) IS NOT NULL
                           AND pg_has_role(vai.oid, to_regrole(g.ten)::oid, 'MEMBER'))
          ORDER BY 1`,
      );
      return rows.map((r) => r.rolname);
    };

    // Tập tên mà hardening ghim `NOBYPASSRLS` — đọc THẲNG từ file, không viết tay lại.
    const daGhim = [...HARDENING.matchAll(/ALTER ROLE (\w+) NOSUPERUSER[^$]*?NOBYPASSRLS/gu)]
      .map((m) => m[1]!)
      .sort();
    expect(daGhim, "bốn tên được ghim NOBYPASSRLS").toEqual([
      "app_api",
      "app_api_login",
      "app_unseal",
      "app_unseal_login",
    ]);

    // Cây thật ⊆ tập ghim. (Hai role `*_login` chỉ tồn tại trên cụm đã tạo chúng, nên là tập con.)
    const truoc = await cay();
    expect(truoc.filter((r) => !daGhim.includes(r)), "cây role không được có tên ngoài tập ghim")
      .toEqual([]);

    // Đột biến: role thứ năm, có BYPASSRLS, là THÀNH VIÊN của `app_api` — tức thừa hưởng mọi quyền
    // của nó VÀ bỏ qua toàn bộ RLS. Đo được: sau `migrate()` nó KHÔNG còn trong cây.
    expect(await thu(db, "CREATE ROLE ke_gian BYPASSRLS NOLOGIN")).toBe("OK");
    try {
      expect(await thu(db, "GRANT app_api TO ke_gian")).toBe("OK");
      expect(await cay(), "trước migrate: ke_gian ở trong cây").toContain("ke_gian");
      expect(await migrateLai(db)).toBe("OK");
      expect(await cay(), "sau migrate: BƯỚC 1 phải đẩy ke_gian ra khỏi cây").toEqual(truoc);
    } finally {
      await db.pool.query("DROP ROLE IF EXISTS ke_gian");
    }
  }, 180000);

  it("[sổ nợ 60] TỔNG ĐIỀU TRA: mọi hàm trigger BEFORE-ROW UPD/DEL phải nằm trong ĐÚNG MỘT danh sách", async () => {
    const { rows } = await db.pool.query<{ ten: string; khong_tra_ve: boolean; co_trigger_tat: boolean; chi_truoc_hang: boolean }>(CAU_TAP_RONG);
    const that = rows.map((r) => r.ten);
    const canhDayDu = HAM_CANH_CHI_GHI_THEM.map((h) => `public.${h}`);

    // [S1.31, khoản nợ 75] Tập rộng nay có cả trigger AFTER và cấp CÂU LỆNH — đối chứng: nó phải
    // THẤY ít nhất một hàm không ở hình thức BEFORE-ROW, nếu không vế mở rộng là rỗng ruột.
    expect(rows.some((r) => !r.chi_truoc_hang), "tập rộng không thấy trigger nào ngoài BEFORE-ROW").toBe(true);
    // Và một hàm canh — theo hình dạng HAY theo khai báo — chỉ được gắn ở hình thức BEFORE-ROW: đó là
    // hình thức DUY NHẤT `VI_TU_BANG_CHI_GHI_THEM` nhận, nên một hàm canh cấp câu lệnh hay AFTER-ROW
    // làm bảng chỉ-ghi-thêm mà H19 không canh LOGGED / TRUNCATE / ACL cho nó.
    expect(
      rows.filter((r) => (r.khong_tra_ve || canhDayDu.includes(r.ten)) && !r.chi_truoc_hang).map((r) => r.ten),
      "Hàm canh này gắn ở một trigger KHÔNG phải BEFORE … FOR EACH ROW trên UPDATE/DELETE. H19 chỉ nhận " +
        "bảng chỉ-ghi-thêm qua hình thức BEFORE-ROW; viết lại trigger theo hình thức ấy.",
    ).toEqual([]);

    // Đối chứng chống rỗng ruột: câu truy vấn phải THẤY thứ gì đó, và phải thấy các hàm canh đã
    // biết. Một câu hỏng cú pháp NÉM; một câu hỏng vị từ trả rỗng và sẽ xanh im lặng.
    expect(that.length, "tập rộng RỖNG — câu truy vấn đang mù").toBeGreaterThan(0);
    for (const canh of canhDayDu) expect(that).toContain(canh);

    const daKhai = new Set([...canhDayDu, ...HAM_KHONG_PHAI_CANH]);
    expect(
      that.filter((t) => !daKhai.has(t)),
      "Một hàm trigger UPDATE/DELETE (bất kể BEFORE/AFTER, hàng/câu lệnh) vừa ra đời mà chưa được phân loại. Đây KHÔNG " +
        "phải lỗi cú pháp: nó là câu hỏi 'đây có phải một hàm canh chỉ-ghi-thêm không'. Nếu CÓ: thêm " +
        "tên vào HAM_CANH_CHI_GHI_THEM VÀ vào vị từ trong hardening.always.sql (cổng ở test đầu giữ " +
        "hai bản khớp nhau), kèm bảng của nó vào BANG_CHI_GHI_THEM_THAT — bảng ấy sẽ được H19 canh " +
        "kể cả khi thân hàm có RETURN. Nếu KHÔNG: thêm vào HAM_KHONG_PHAI_CANH VÀ một câu UPDATE/DELETE " +
        "hợp lệ vào dungKichBan() — nhân chứng hành vi [khoản nợ 74] sẽ đòi nó.",
    ).toEqual([]);

    // Chiều ngược: một dòng khai THIU cũng là một lời khai sai, và nó là đối chứng dương thứ hai.
    expect(
      [...daKhai].filter((t) => !that.includes(t)),
      "Danh sách phân loại kể một hàm mà CSDL không còn có.",
    ).toEqual([]);

    // [lượt soi 19] Một trigger canh BỊ TẮT (tgenabled = 'D') là bảng thôi được canh mà tập vẫn
    // nhận — vì vị từ đếm trigger, không đếm trigger ĐANG BẬT. Trên hàm canh, đó là vi phạm.
    expect(
      rows.filter((r) => canhDayDu.includes(r.ten) && r.co_trigger_tat).map((r) => r.ten),
      "Một trigger của hàm canh đang bị TẮT — bảng ấy không còn chỉ-ghi-thêm.",
    ).toEqual([]);
  }, 180000);

  it("[sổ nợ 60] mâu thuẫn MỘT chiều: thân không có RETURN thì KHÔNG được khai là KHÔNG-CANH", async () => {
    // Hướng suy được: một hàm trigger không bao giờ trả về thì chỉ có thể NÉM, tức từ chối VÔ ĐIỀU
    // KIỆN — nó không thể là một máy trạng thái. Khai nó là KHÔNG-CANH là một lời khai sai bắt được.
    // Hướng ngược (khai CANH nhưng thân có RETURN) là HỢP LỆ, và được đo ở test kế tiếp.
    const { rows } = await db.pool.query<{ ten: string; khong_tra_ve: boolean }>(CAU_TAP_RONG);
    const theoTen = new Map(rows.map((r) => [r.ten, r.khong_tra_ve]));
    expect(
      HAM_KHONG_PHAI_CANH.filter((t) => theoTen.get(t) === true),
      "Hàm này được khai là KHÔNG phải hàm canh, nhưng thân nó không có đường trả về nào — nó " +
        "chỉ có thể từ chối vô điều kiện. Chuyển sang HAM_CANH_CHI_GHI_THEM.",
    ).toEqual([]);
    // Và mọi hàm hình dạng nhận đều đã được khai CANH — tập hình dạng ⊆ tập khai báo.
    const hinhDang = rows.filter((r) => r.khong_tra_ve).map((r) => r.ten);
    for (const h of hinhDang) expect(HAM_CANH_CHI_GHI_THEM.map((x) => `public.${x}`)).toContain(h);
    // Khoảng trống này có kích thước: hình dạng chỉ nói về một PHẦN NHỎ của các hàm đang chạy.
    expect(rows.length).toBeGreaterThan(hinhDang.length * 5);
  }, 180000);

  it("[sổ nợ 60] ĐO: một hàm canh kiểu `RAISE …; RETURN NULL` khai THẬT thì bảng của nó ĐƯỢC canh", async () => {
    // Đúng kịch bản khoản nợ 60 nêu tên, dựng trên PostgreSQL thật. Bốn phép đo, theo thứ tự:
    //   (a) hàm vào TẬP RỘNG với khong_tra_ve = false — tức vị từ hình dạng KHÔNG nhận nó;
    //   (b) nó LÀ hàm canh thật: UPDATE và DELETE trên một hàng đều NÉM;
    //   (c) CHƯA khai ⇒ bảng KHÔNG trong tập của vị từ hiện hành (đây là lỗ, và nó không im: test
    //       tổng điều tra sẽ đỏ vì hàm chưa phân loại);
    //   (d) KHAI vào danh sách ⇒ cùng vị từ nhận bảng. Không cần đổi thân hàm.
    const ten = "zz_canh_kieu_moi";
    await db.pool.query(`
      CREATE TABLE public.zz_so_moi (id int PRIMARY KEY, ghi text);
      CREATE FUNCTION public.${ten}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF TG_OP IN ('UPDATE', 'DELETE') THEN RAISE EXCEPTION 'zz_so_moi chi ghi them'; END IF;
          RETURN NULL;
        END $$;
      CREATE TRIGGER zz_canh_upd BEFORE UPDATE ON public.zz_so_moi FOR EACH ROW EXECUTE FUNCTION public.${ten}();
      CREATE TRIGGER zz_canh_del BEFORE DELETE ON public.zz_so_moi FOR EACH ROW EXECUTE FUNCTION public.${ten}();
      INSERT INTO public.zz_so_moi VALUES (1, 'a');
    `);
    try {
      const rong = await db.pool.query<{ ten: string; khong_tra_ve: boolean }>(CAU_TAP_RONG);
      const moi = rong.rows.find((r) => r.ten === `public.${ten}`);
      expect(moi, "(a) hàm mới phải vào tập rộng").toBeDefined();
      expect(moi!.khong_tra_ve, "(a) và vị từ hình dạng KHÔNG nhận nó").toBe(false);

      expect(await thu(db, "UPDATE public.zz_so_moi SET ghi = 'b' WHERE id = 1")).toMatch(/^NÉM/);
      expect(await thu(db, "DELETE FROM public.zz_so_moi WHERE id = 1")).toMatch(/^NÉM/);

      const chuaKhai = await db.pool.query<{ relname: string }>(`${VI_TU_BANG_CHI_GHI_THEM} ORDER BY c.relname`);
      expect(chuaKhai.rows.map((r) => r.relname), "(c) chưa khai ⇒ chưa vào tập").not.toContain("zz_so_moi");

      const daKhai = await db.pool.query<{ relname: string }>(
        `${viTuBangChiGhiThem([...HAM_CANH_CHI_GHI_THEM, ten])} ORDER BY c.relname`,
      );
      expect(daKhai.rows.map((r) => r.relname), "(d) khai thật ⇒ bảng vào tập, thân hàm giữ nguyên")
        .toContain("zz_so_moi");
    } finally {
      await db.pool.query(`DROP TABLE public.zz_so_moi; DROP FUNCTION public.${ten}();`);
    }
  }, 180000);

  it("[sổ nợ 73] TỔNG ĐIỀU TRA RULE: mọi rule trên mọi quan hệ của dự án phải nằm trong RULE_DA_KHAI — hôm nay rỗng, và rỗng là một lời khai", async () => {
    const { rows } = await db.pool.query<{ ten: string; su_kien: string; is_instead: boolean }>(CAU_RULE_RONG);
    // Cả hai chiều: rule chưa khai là đỏ, dòng khai thiu cũng đỏ (ADR-035 §2⑶).
    expect(
      rows.map((r) => r.ten).filter((t) => !RULE_DA_KHAI.includes(t)),
      "Một RULE vừa ra đời. Rule viết lại câu lệnh TRƯỚC khi trigger nào chạy, nên nó đứng ngoài toàn bộ " +
        "lớp canh của H19: `DO INSTEAD NOTHING` trên UPDATE/DELETE làm bảng chỉ-ghi-thêm mà không lớp nào " +
        "canh LOGGED/TRUNCATE/ACL; trên INSERT nó nuốt hàng trong im lặng. Dự án không dùng RULE — viết " +
        "lại thành trigger BEFORE … FOR EACH ROW. Nếu vẫn cần, kê tên vào RULE_DA_KHAI kèm lý do.",
    ).toEqual([]);
    expect(RULE_DA_KHAI.filter((t) => !rows.some((r) => r.ten === t)), "RULE_DA_KHAI kể một rule CSDL không còn có").toEqual([]);
    // Đối chứng chống rỗng ruột NGAY TRONG test này [lượt soi 21]: một câu truy vấn mù (join sai, lọc
    // sai) trả rỗng và xanh im lặng. Dựng một rule tạm và đòi câu ấy THẤY nó, rồi gỡ.
    await db.pool.query("CREATE TABLE public.zz_doi_chung (id int); CREATE RULE zz_thay AS ON UPDATE TO public.zz_doi_chung DO INSTEAD NOTHING");
    try {
      const { rows: sau } = await db.pool.query<{ ten: string }>(CAU_RULE_RONG);
      expect(sau.map((r) => r.ten)).toContain("public.zz_doi_chung/zz_thay");
    } finally {
      await db.pool.query("DROP TABLE public.zz_doi_chung");
    }
  }, 180000);

  it("[sổ nợ 73] ĐO: một RULE làm bảng chỉ-ghi-thêm mà KHÔNG lỗi, KHÔNG trigger, và ngoài tập của H19 — tổng điều tra là lớp duy nhất thấy nó", async () => {
    await db.pool.query(`
      CREATE TABLE public.zz_rule (id int PRIMARY KEY, ghi text);
      INSERT INTO public.zz_rule VALUES (1, 'a');
      CREATE RULE zz_khong_sua AS ON UPDATE TO public.zz_rule DO INSTEAD NOTHING;
      CREATE RULE zz_khong_xoa AS ON DELETE TO public.zz_rule DO INSTEAD NOTHING;
    `);
    try {
      // (a) hành vi: chỉ-ghi-thêm THẬT — nhưng bằng im lặng, không bằng lỗi.
      const u = await db.pool.query("UPDATE public.zz_rule SET ghi = 'b' WHERE id = 1");
      const d = await db.pool.query("DELETE FROM public.zz_rule WHERE id = 1");
      expect([u.rowCount, d.rowCount]).toEqual([0, 0]);
      expect((await db.pool.query<{ ghi: string }>("SELECT ghi FROM public.zz_rule")).rows).toEqual([{ ghi: "a" }]);
      // (b) không trigger nào ⇒ ngoài tập rộng của tổng điều tra hàm, ngoài vị từ của H19, migrate() OK.
      const tapRong = (await db.pool.query<{ bang: string }>(CAU_TAP_RONG_THEO_BANG)).rows;
      expect(tapRong.some((r) => r.bang === "public.zz_rule")).toBe(false);
      const chiGhiThem = (await db.pool.query<{ relname: string }>(VI_TU_BANG_CHI_GHI_THEM)).rows;
      expect(chiGhiThem.some((r) => r.relname === "zz_rule")).toBe(false);
      expect(await migrateLai(db)).toBe("OK");
      // (c) tổng điều tra rule THẤY nó — ở đúng hai tên.
      const { rows } = await db.pool.query<{ ten: string }>(CAU_RULE_RONG);
      expect(rows.map((r) => r.ten).filter((t) => !RULE_DA_KHAI.includes(t))).toEqual([
        "public.zz_rule/zz_khong_sua",
        "public.zz_rule/zz_khong_xoa",
      ]);
    } finally {
      await db.pool.query("DROP TABLE public.zz_rule");
    }
  }, 180000);

  it("[sổ nợ 73] RULE trên bảng chỉ-ghi-thêm: bảng có TÊN thì hardening TỰ GỠ, bảng SUY RA thì hardening NÉM", async () => {
    // Đo trước khi viết mục hardening: rule trên bid_receipts SỐNG QUA migrate() — [CR1] chỉ với tới
    // bang_so. Hai kết quả đúng khác nhau, cùng ranh giới ADR-028 §2⑵ với test LOGGED ở trên.
    const { rows } = await db.pool.query<{ relname: string }>(`${VI_TU_BANG_CHI_GHI_THEM} ORDER BY c.relname`);
    expect(rows.length).toBeGreaterThan(0);
    try {
      for (const r of rows) {
        await db.pool.query(`CREATE RULE zz_nuot AS ON DELETE TO public.${r.relname} DO INSTEAD NOTHING`);
        const ketQua = await migrateLai(db);
        const conRule = async (): Promise<string[]> =>
          (await db.pool.query<{ rulename: string }>(`SELECT rulename FROM pg_rewrite WHERE ev_class = to_regclass('public.${r.relname}')`)).rows.map((x) => x.rulename);
        if (BANG_CO_TEN.includes(r.relname)) {
          expect(ketQua, `${r.relname} có tên trong danh sách nên hardening TỰ GỠ rule`).toBe("OK");
          expect(await conRule(), `${r.relname}: rule phải bị gỡ`).toEqual([]);
        } else {
          expect(ketQua, `${r.relname} là bảng SUY RA nên hardening chỉ phán xét`).toMatch(/RULE trên bảng CHỈ-GHI-THÊM/u);
          expect(await conRule()).toEqual(["zz_nuot"]);
          await db.pool.query(`DROP RULE zz_nuot ON public.${r.relname}`);
        }
      }
    } finally {
      // [lượt soi 21] Một assert đỏ giữa vòng để rule sống ⇒ mọi migrate() sau đó ném vì chính mục
      // hardening mới ⇒ đỏ dây chuyền với thông điệp không liên quan. Gỡ sạch dù đỏ hay xanh.
      for (const r of rows) await db.pool.query(`DROP RULE IF EXISTS zz_nuot ON public.${r.relname}`);
    }
    expect(rows.filter((r) => !BANG_CO_TEN.includes(r.relname)).length, "phải có bảng SUY RA để đo vế phán xét").toBeGreaterThan(0);
    expect(await migrateLai(db), "đối chứng dương: lược đồ đúng vẫn migrate() được").toBe("OK");
  }, 180000);

  it("[sổ nợ 75] ĐO: một hàm canh gắn BEFORE UPDATE OR DELETE FOR EACH STATEMENT làm bảng chỉ-ghi-thêm mà H19 không nhận — tập rộng mới THẤY nó và tổng điều tra ĐỎ ở cả hai lời khai", async () => {
    const ten = "zz_canh_cau_lenh";
    await db.pool.query(`
      CREATE TABLE public.zz_cau (id int PRIMARY KEY, ghi text);
      INSERT INTO public.zz_cau VALUES (1, 'a');
      CREATE FUNCTION public.${ten}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'zz_cau chi ghi them'; END $$;
      CREATE TRIGGER zz_cau_canh BEFORE UPDATE OR DELETE ON public.zz_cau FOR EACH STATEMENT EXECUTE FUNCTION public.${ten}();
    `);
    try {
      // (a) nó LÀ hàm canh: mọi UPDATE/DELETE ném, kể cả câu chạm 0 hàng.
      expect(await thu(db, "UPDATE public.zz_cau SET ghi = 'b' WHERE id = 1")).toMatch(/^NÉM/);
      expect(await thu(db, "DELETE FROM public.zz_cau WHERE id = 99")).toMatch(/^NÉM/);
      // (b) nhưng H19 không nhận bảng, migrate() OK, và TRUNCATE đi lọt — đúng khoản nợ 75.
      const chiGhiThem = (await db.pool.query<{ relname: string }>(VI_TU_BANG_CHI_GHI_THEM)).rows;
      expect(chiGhiThem.some((r) => r.relname === "zz_cau")).toBe(false);
      expect(await migrateLai(db)).toBe("OK");
      // (c) tập rộng MỚI thấy nó — hình dạng canh, KHÔNG ở BEFORE-ROW.
      const { rows } = await db.pool.query<{ ten: string; khong_tra_ve: boolean; chi_truoc_hang: boolean }>(CAU_TAP_RONG);
      const moi = rows.find((r) => r.ten === `public.${ten}`);
      expect(moi).toMatchObject({ khong_tra_ve: true, chi_truoc_hang: false });
      const theoBang = (await db.pool.query<HangTapRong>(CAU_TAP_RONG_THEO_BANG)).rows.filter((r) => r.ham === `public.${ten}`);
      expect(theoBang.map((r) => [r.bang, r.upd, r.del, r.truoc_hang])).toEqual([["public.zz_cau", true, true, false]]);
      // (d) và tổng điều tra đỏ ở CẢ HAI lời khai có thể có: chưa khai ⇒ đỏ; khai CANH ⇒ đỏ vì không
      //     BEFORE-ROW; khai KHÔNG-CANH ⇒ đỏ vì thân không RETURN (mâu thuẫn một chiều).
      const daKhai = new Set([...HAM_CANH_CHI_GHI_THEM.map((h) => `public.${h}`), ...HAM_KHONG_PHAI_CANH]);
      expect(daKhai.has(`public.${ten}`)).toBe(false);
      expect(moi!.khong_tra_ve && !moi!.chi_truoc_hang, "khai CANH thì luật BEFORE-ROW bắt").toBe(true);
      expect(moi!.khong_tra_ve, "khai KHÔNG-CANH thì mâu thuẫn một chiều bắt").toBe(true);
    } finally {
      await db.pool.query(`DROP TABLE public.zz_cau; DROP FUNCTION public.${ten}();`);
    }
  }, 180000);

  it("[sổ nợ 74] NHÂN CHỨNG HÀNH VI: mỗi bộ ba (hàm, bảng, sự kiện) khai KHÔNG-CANH để một hàng THẬT đi qua — hàm đọc vai thì dưới vai không superuser; hàm canh MỘT sự kiện thì NÉM từ chính nó ở sự kiện ấy", async () => {
    const c = await db.pool.connect();
    try {
      await c.query("SET track_functions = 'pl'");
      const tapRong = (await c.query<HangTapRong>(CAU_TAP_RONG_THEO_BANG)).rows;
      expect(tapRong.length, "tập rộng theo bảng RỖNG — câu truy vấn đang mù").toBeGreaterThan(0);
      // Đối chứng cho vế vai: vị từ `nhay_vai` phải THẤY ít nhất một hàm đã khai — nếu không, đòi hỏi
      // "vai không superuser" là một vế không ai chịu và xanh rỗng ruột.
      expect(tapRong.some((r) => r.nhay_vai && HAM_KHONG_PHAI_CANH.includes(r.ham))).toBe(true);
      const so = new SoNhanChung(c, tapRong);

      // Đối chứng chống rỗng ruột: cơ chế đếm phải THẤY một lời gọi trước khi ai được ghi công.
      // Nếu track_functions không có tác dụng, mọi bộ ba dưới đây đều thiếu nhân chứng — đỏ ồn ào.
      const { orgId } = await dungKichBan(c, so);
      expect(so.ghiCong.size, "kịch bản chạy trọn mà không hàm nào được ghi công — pg_stat_xact_user_functions đang mù").toBeGreaterThan(0);

      // ⑸ mọi bộ ba mà tập rộng thấy cho một hàm khai KHÔNG-CANH phải có nhân chứng hợp lệ.
      expect(
        so.chuaCoNhanChung(HAM_KHONG_PHAI_CANH),
        "Bộ ba (hàm, bảng, sự kiện) này được khai là KHÔNG phải hàm canh, nhưng không câu UPDATE/DELETE " +
          "nào trong kịch bản đi qua được nó trên một hàng thật (với hàm đọc vai: dưới một vai không " +
          "superuser). Hoặc nó LÀ hàm canh (khai sai — chuyển sang HAM_CANH_CHI_GHI_THEM, hay " +
          "HAM_CANH_MOT_SU_KIEN nếu chỉ một sự kiện), hoặc kịch bản chưa có nhân chứng cho nó — thêm " +
          "một câu hợp lệ vào dungKichBan().",
      ).toEqual([]);

      // Hàm canh một sự kiện: lời khai phải suy ra được từ tập rộng, sự kiện nêu tên KHÔNG được có
      // nhân chứng, và phải ĐO được là NÉM từ chính hàm ấy trên một hàng thật của kịch bản.
      for (const [ham, suKien] of Object.entries(HAM_CANH_MOT_SU_KIEN)) {
        expect(HAM_KHONG_PHAI_CANH, `${ham} khai canh-một-sự-kiện nhưng không có trong HAM_KHONG_PHAI_CANH`).toContain(ham);
        const bangCua = [...new Set(tapRong.filter((r) => r.ham === ham && coSuKien(r, suKien)).map((r) => r.bang))];
        expect(bangCua, `${ham} không có trigger ${suKien} nào — dòng khai thiu`).not.toEqual([]);
        expect(so.daGhiCong(ham, suKien), `${ham} được khai là từ chối ${suKien} vô điều kiện, nhưng một câu ${suKien} đã đi qua nó`).toEqual([]);
        for (const bang of bangCua) {
          const { rows } = await c.query<{ n: string }>(`SELECT pg_catalog.count(*)::pg_catalog.text AS n FROM ${bang} WHERE org_id = $1`, [orgId]);
          expect(Number(rows[0]?.n), `kịch bản chưa để lại hàng nào ở ${bang} — không có gì để đo lời từ chối`).toBeGreaterThan(0);
          const thu =
            suKien === "DELETE"
              ? `DELETE FROM ${bang} WHERE org_id = $1`
              : `UPDATE ${bang} SET org_id = org_id WHERE org_id = $1`;
          const loi = await loiCua(() => c.query(thu, [orgId]));
          expect(loi, `${suKien} trên ${bang} phải bị từ chối`).not.toBeNull();
          // `where` của PL/pgSQL là `format_procedure`: bỏ lược đồ khi nó nằm trên search_path.
          expect(loi?.where, `lời từ chối phải đến từ ${ham}, không từ một ràng buộc khác`).toMatch(
            new RegExp(`function (public\\.)?${ham.replace(/^public\./, "")}\\(`),
          );
        }
      }
    } finally {
      // Huỷ client thay vì trả về pool: GUC phiên (`track_functions`) chết theo, và một RESET ném
      // không thể giữ client lại làm `pool.end()` treo [lượt soi 20, MEDIUM-3].
      c.release(true);
    }
  }, 180000);

  it("[sổ nợ 74] ĐỘT BIẾN: một hàm canh có `RETURN` khai SAI là KHÔNG-CANH thì không nhân chứng nào ghi công được — vì PostgreSQL không đếm một lời gọi kết thúc bằng RAISE", async () => {
    // Đúng ca lượt soi 19 dựng: hàm canh kiểu `IF … RAISE … END IF; RETURN NULL` khai vào
    // KHÔNG-CANH ⇒ ba khẳng định của tổng điều tra đều xanh. Ở đây nó phải ĐỎ, ở đúng hai bộ ba của nó.
    const ten = "zz_canh_khai_sai";
    const bangZz = "public.zz_so_khai_sai";
    const c = await db.pool.connect();
    try {
      await c.query(`
        CREATE TABLE ${bangZz} (id int PRIMARY KEY, org_id uuid, ghi text);
        CREATE FUNCTION public.${ten}() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF TG_OP IN ('UPDATE', 'DELETE') THEN RAISE EXCEPTION 'zz_so_khai_sai chi ghi them'; END IF;
            RETURN NULL;
          END $$;
        CREATE TRIGGER zz_upd BEFORE UPDATE ON ${bangZz} FOR EACH ROW EXECUTE FUNCTION public.${ten}();
        CREATE TRIGGER zz_del BEFORE DELETE ON ${bangZz} FOR EACH ROW EXECUTE FUNCTION public.${ten}();
        INSERT INTO ${bangZz} VALUES (1, NULL, 'a');
      `);
      await c.query("SET track_functions = 'pl'");
      const tapRong = (await c.query<HangTapRong>(CAU_TAP_RONG_THEO_BANG)).rows;
      // So theo TẬP, không theo thứ tự: catalog không hứa thứ tự [lượt soi 20, MEDIUM-2].
      expect(
        tapRong.filter((r) => r.ham === `public.${ten}`).map((r) => `${r.bang}/${r.upd ? "UPDATE" : "DELETE"}`).sort(),
      ).toEqual([`${bangZz}/DELETE`, `${bangZz}/UPDATE`]);
      const so = new SoNhanChung(c, tapRong);
      const khaiSai = [...HAM_KHONG_PHAI_CANH, `public.${ten}`];

      // Mọi cách lấy nhân chứng cho nó đều NÉM từ chính nó…
      for (const [suKien, sql] of [
        ["UPDATE", `UPDATE ${bangZz} SET ghi = 'b' WHERE id = 1`],
        ["DELETE", `DELETE FROM ${bangZz} WHERE id = 1`],
      ] as const) {
        const loi = await loiCua(() => so.chung(bangZz, suKien, cau(sql, [])));
        expect(loi?.where ?? "", `${suKien} phải bị chính ${ten} từ chối`).toContain(ten);
      }
      // …và `calls` không nhúc nhích, đo TRONG cùng giao dịch quanh chính lời gọi ném — đây là vế
      // chịu lực của cả phép đo: một hàm ném KHÔNG được đếm, nên "calls tăng" đồng nghĩa "có một
      // đường trả về đã được đi".
      await c.query("BEGIN");
      try {
        const truoc = (await demGoiTrongGiaoDich(c)).get(`public.${ten}`) ?? 0;
        await c.query("SAVEPOINT thu");
        const loi = await loiCua(() => c.query(`UPDATE ${bangZz} SET ghi = 'c' WHERE id = 1`));
        expect(loi?.where ?? "").toContain(ten);
        await c.query("ROLLBACK TO SAVEPOINT thu");
        expect((await demGoiTrongGiaoDich(c)).get(`public.${ten}`) ?? 0).toBe(truoc);
        expect(truoc).toBe(0);
      } finally {
        await c.query("ROLLBACK");
      }

      // Nên lời khai sai ĐỎ ở đúng hai bộ ba của nó, trong khi kịch bản thật vẫn ghi công đủ 21 hàm kia.
      await dungKichBan(c, so);
      expect(so.chuaCoNhanChung(khaiSai)).toEqual([`public.${ten}/${bangZz}/DELETE`, `public.${ten}/${bangZz}/UPDATE`]);
      expect(so.chuaCoNhanChung(HAM_KHONG_PHAI_CANH)).toEqual([]);
    } finally {
      c.release(true);
      await db.pool.query(`DROP TABLE IF EXISTS ${bangZz}; DROP FUNCTION IF EXISTS public.${ten}();`);
    }
  }, 180000);
});
