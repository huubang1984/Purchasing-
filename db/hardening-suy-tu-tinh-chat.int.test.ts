import { migrate } from "@trustprocure/db";
import { startPostgres, type TestDatabase } from "@trustprocure/test-support";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { docHangHardening as docHangHardeningTu, khoiValues } from "./hardening-hang.js";

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

/**
 * [S1.36, khoản nợ 79 — lượt soi 25a #1 CAO] Vế "trigger canh VÔ ĐIỀU KIỆN": `WHEN (…)` hay `UPDATE OF <cột>`
 * giữ nguyên tên hàm nhưng hàm canh không chạy cho một phần câu (đo: UPDATE cột khác 1 hàng, DELETE 1 hàng,
 * không lỗi — mà vị từ cũ vẫn nhận bảng). Hardening soi hai cột này từ S0 cho bảng CÓ TÊN (CTE_TRIGGER_CHAN);
 * vị từ suy ra thì không, và sáu lượt soi dọc không thấy. Giữ thành một hằng riêng để test khoản 79 đo được
 * vị từ CŨ bằng cách bỏ nó ra — đối chứng rằng vế này là thứ chịu lực.
 */
const VE_TRIGGER_VO_DIEU_KIEN = "                  AND t.tgqual IS NULL AND t.tgattr::pg_catalog.text OPERATOR(pg_catalog.=) ''\n";

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
${VE_TRIGGER_VO_DIEU_KIEN}${T}AND ${veHamCanh(hamCanh, T)}
                  AND (t.tgtype OPERATOR(pg_catalog.&) 19::pg_catalog.int2) OPERATOR(pg_catalog.=) 19) OPERATOR(pg_catalog.>) 0
          AND (SELECT pg_catalog.count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
                  AND p.prorettype OPERATOR(pg_catalog.=) 'pg_catalog.trigger'::regtype
                  AND p.prolang OPERATOR(pg_catalog.=) (SELECT l.oid FROM pg_language l WHERE l.lanname OPERATOR(pg_catalog.=) 'plpgsql')
${VE_TRIGGER_VO_DIEU_KIEN}${T}AND ${veHamCanh(hamCanh, T)}
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
 * khai sai. Đã đo trên PostgreSQL thật (test `[sổ nợ 60] ĐO` *"khai THẬT thì bảng của nó VÀO TẬP của vị từ"* dưới đây). Nay
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
 * **[S1.33] Và cho cả INSERT** (khoản nợ 77): 38 bộ ba (hàm, bảng, INSERT) của 27 hàm — kể cả hai
 * constraint trigger DEFERRED và hai hàm nhạy vai trên `sessions` — đều phải có nhân chứng.
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
 * Hàm trigger GHI (INSERT/UPDATE/DELETE, mọi hình thức) **không** phải hàm canh chỉ-ghi-thêm: chúng từ chối CÓ
 * ĐIỀU KIỆN (máy trạng thái, kiểm quyền, bất biến cột), nên bảng mang chúng vẫn sửa/xoá được ở
 * những đường hợp lệ. Đo tại `bebeb41`.
 */
const HAM_KHONG_PHAI_CANH = [
  "public.kiem_danh_tinh_theo_phien",
  // [S1.32] Mười chín hàm chỉ gắn INSERT vào tập rộng khi tập ấy mở ra bit 4. Chúng không thể là hàm
  // canh chỉ-ghi-thêm (không gắn UPDATE/DELETE); khai ở đây để một hàm INSERT mới không đi vào lặng lẽ.
  "public.bid_dat_so_phien_ban",
  "public.bid_kiem_han_nop",
  "public.bid_kiem_phien_khach",
  "public.bid_phai_co_bien_nhan",
  "public.chinh_sach_phien_ban_tang_dan",
  "public.chot_moc_neo",
  "public.guest_session_kiem_danh_tinh",
  "public.noi_chuoi_kiem_toan",
  "public.otp_kiem_kenh_khac_link",
  "public.rfq_khoa_chi_sinh_luc_mo",
  "public.rfq_khoa_phai_di_kem_lan_mo",
  "public.rfq_kiem_nguoi_duyet",
  "public.rfq_kiem_nguoi_tao",
  "public.sessions_kiem_mfa_khi_tao",
  "public.sessions_kiem_totp_gan_day",
  "public.unseal_canh_bao_break_glass",
  "public.unseal_kiem_nguoi_duyet",
  "public.unseal_kiem_rfq_da_dong",
  "public.unseal_kiem_yeu_cau_khi_ghi_ban_ro",
  // [S1.31] Khối dưới là 20 hàm BEFORE-ROW UPDATE/DELETE của S1.29 CỘNG 5 hàm AFTER-ROW UPDATE vào tập rộng
  // khi tập ấy thôi khoá theo hình thức BEFORE-ROW (kiem_tra_*, users_thu_hoi_phien_khi_dinh_chi), sắp theo tên.
  // [lượt soi 25b #5] Chú thích cũ nói "năm hàm" đứng đầu một khối 25 tên.
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
 * [S1.32, lượt soi 22] Và cả INSERT (bit 4): một trigger BEFORE INSERT ROW trả `NULL` nuốt hàng
 * trong im lặng (`INSERT 0 0`, `RETURNING` rỗng) — cơ chế 15 của ADR-036. Tổng điều tra nay buộc
 * phân loại cả 27 hàm trigger INSERT; nhân chứng hành vi cho INSERT là khoản nợ 77.
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
            OR ((t.tgtype OPERATOR(pg_catalog.&) 8::pg_catalog.int2) OPERATOR(pg_catalog.=) 8)
            OR ((t.tgtype OPERATOR(pg_catalog.&) 4::pg_catalog.int2) OPERATOR(pg_catalog.=) 4))`;

/** TẬP RỘNG theo HÀM — đơn vị của tổng điều tra. */
const CAU_TAP_RONG = `SELECT (np.nspname OPERATOR(pg_catalog.||) '.' OPERATOR(pg_catalog.||) p.proname) AS ten,
              (p.prosrc OPERATOR(pg_catalog.!~*) '\\mRETURN\\M') AS khong_tra_ve,
              pg_catalog.bool_or(t.tgenabled OPERATOR(pg_catalog.=) 'D') AS co_trigger_tat,
              pg_catalog.bool_and(t.tgenabled OPERATOR(pg_catalog.=) 'A') AS luon_bat,
              pg_catalog.bool_or(t.tgqual IS NOT NULL) AS co_when,
              pg_catalog.bool_or(t.tgattr::pg_catalog.text OPERATOR(pg_catalog.<>) '') AS co_cot,
              pg_catalog.bool_and((t.tgtype OPERATOR(pg_catalog.&) 3::pg_catalog.int2) OPERATOR(pg_catalog.=) 3) AS chi_truoc_hang
         ${TU_TAP_RONG}
        GROUP BY 1, 2
        ORDER BY 1`;

/**
 * [khoản nợ 74] TẬP RỘNG theo (HÀM, BẢNG, SỰ KIỆN) — đơn vị của nhân chứng hành vi: một câu
 * INSERT/UPDATE/DELETE chỉ ghi công được cho hàm CÓ trigger ở đúng bảng và đúng sự kiện của nó.
 */
/**
 * [lượt soi 23, NẶNG-3] Vị từ "thân hàm đọc vai đang chạy". Bản đầu là năm tên; lượt soi chỉ ra nó
 * lách được bằng đúng khuôn 037 đã dùng — bọc `pg_has_role` vào một hàm có TÊN KHÁC — và bỏ sót
 * `current_role`, `USER` trần, `current_setting('role')`, `has_*_privilege`, `pg_authid`. Nay: regex
 * rộng hơn VÀ bao đóng bậc một — hàm gọi một hàm (cùng lược đồ dự án) mà thân hàm ấy khớp regex cũng
 * là nhạy vai. Đo: bốn hàm của kho gọi `la_duong_ung_dung`, đều đã khớp trực tiếp; `\muser\M` bắt
 * thêm `mfa_reset_kiem_quyen` qua chuỗi `'user.mfa_reset'` — dương tính giả, và chiều AN TOÀN: nhân
 * chứng của nó nay chạy dưới `app_api`. Đối chứng dương ở test *"vị từ bọc"* dưới đây.
 */
const RE_NHAY_VAI =
  "la_duong_ung_dung|current_user|session_user|pg_has_role|rolsuper|current_role|\\muser\\M|current_setting\\(\\s*''role''|has_\\w+_privilege|pg_authid";

const CAU_TAP_RONG_THEO_BANG = `SELECT (np.nspname OPERATOR(pg_catalog.||) '.' OPERATOR(pg_catalog.||) p.proname) AS ham,
              (n.nspname OPERATOR(pg_catalog.||) '.' OPERATOR(pg_catalog.||) c.relname) AS bang,
              ((t.tgtype OPERATOR(pg_catalog.&) 4::pg_catalog.int2) OPERATOR(pg_catalog.=) 4) AS ins,
              ((t.tgtype OPERATOR(pg_catalog.&) 16::pg_catalog.int2) OPERATOR(pg_catalog.=) 16) AS upd,
              ((t.tgtype OPERATOR(pg_catalog.&) 8::pg_catalog.int2) OPERATOR(pg_catalog.=) 8) AS del,
              ((t.tgtype OPERATOR(pg_catalog.&) 3::pg_catalog.int2) OPERATOR(pg_catalog.=) 3) AS truoc_hang,
              t.tginitdeferred AS hoan,
              ((p.prosrc OPERATOR(pg_catalog.~*) '${RE_NHAY_VAI}')
               OR EXISTS (SELECT 1 FROM pg_proc q
                            JOIN pg_namespace nq ON nq.oid OPERATOR(pg_catalog.=) q.pronamespace
                           WHERE nq.nspname NOT IN ('pg_catalog', 'information_schema')
                             AND q.oid OPERATOR(pg_catalog.<>) p.oid
                             AND q.prosrc OPERATOR(pg_catalog.~*) '${RE_NHAY_VAI}'
                             AND p.prosrc OPERATOR(pg_catalog.~*) ('\\m' OPERATOR(pg_catalog.||) q.proname OPERATOR(pg_catalog.||) '\\s*\\('))) AS nhay_vai
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

/**
 * [S1.39 / khoản nợ 83⑷⑸] Hai danh sách khai còn lại của nửa catalog — đều RỖNG, và rỗng là một lời khai.
 * Khuôn: `lược đồ.tên.trigger (ngôn ngữ)` cho trigger ngoài plpgsql; `lược đồ.tên` cho quan hệ khác bảng thường
 * mà hardening phán (bảng ngoài, matview, view có trigger INSTEAD OF — hẹp hơn census `LOAI_DA_KHAI` ở test,
 * vốn đếm cả view trơn và bảng phân mảnh; xem chú thích ở hardening). Bản ở hardening phải BẰNG — cổng dưới.
 */
const TRIGGER_NGOAI_PLPGSQL_DA_KHAI: readonly string[] = [];
const QUAN_HE_KHAC_DA_KHAI: readonly string[] = [];
/** [S1.40 / khoản nợ 82⑴] cặp kế thừa cổ điển (không phân mảnh) — `con_schema.con INHERITS cha_schema.cha`; RỖNG là lời khai: dự án không dùng INHERITS. Bản hardening: KE_THUA_KHAI. */
const KE_THUA_DA_KHAI: readonly string[] = [];
const docHangHardening = (ten: string): string => docHangHardeningTu(HARDENING, ten);

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
 *   ⑵ Mỗi nhân chứng là ĐÚNG MỘT câu INSERT/UPDATE/DELETE, kẹp giữa hai lần đọc bộ đếm trong CÙNG
 *      giao dịch — bước chuẩn bị (chèn vật liệu khoá, đổi vai) đứng TRƯỚC lần đọc đầu, nên lời gọi
 *      qua INSERT trong khối không bao giờ được gán cho câu UPDATE [lượt soi 20, LOW-1].
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
 *   ⑹ [S1.33, khoản nợ 77] Sự kiện INSERT — và cơ chế nuốt của nó KHÁC hai sự kiện kia: một hàm
 *      canh UPDATE/DELETE từ chối bằng RAISE (không được đếm), còn một hàm nuốt INSERT trả `NULL`
 *      (ĐƯỢC đếm, vì nó trả về). Vế ⒞ là thứ giữ: `INSERT 0 0` không ghi công cho ai, dù `calls`
 *      tăng — đo ở test đột biến thứ hai. Hai constraint trigger DEFERRED của kho (017 khoá phải đi
 *      kèm lần mở; 018 phiên bản báo giá phải có biên nhận) chạy ở COMMIT, ngoài cửa sổ đo; nay
 *      `chung()` ép `SET CONSTRAINTS ALL IMMEDIATE` SAU câu nhân chứng và sau `hoanTat` (câu làm điều
 *      kiện thoả), rồi đọc bộ đếm lần thứ ba: hàm DEFERRABLE chỉ được ghi công ở cửa sổ ấy, hàm
 *      thường chỉ ở cửa sổ đầu. Tiền đề (khẳng định trong test): hàm DEFERRED gắn đúng một trigger,
 *      một sự kiện.
 *   ⑺ [lượt soi 23] Vế ⒞ đo bằng `rowCount` là con số PostgreSQL đếm TRƯỚC khi trigger AFTER chạy —
 *      một trigger AFTER INSERT xoá hàng vừa vào cho `INSERT 0 1` mà bảng rỗng. Nên "hàng thật" còn
 *      đo ở mức BẢNG: `pg_stat_xact_user_tables` ở ba mốc, bộ đếm của đúng sự kiện bằng `rowCount`,
 *      hai bộ đếm kia bằng 0, cửa sổ sau không chạm bảng nhân chứng — lệch thì NÉM. Và mỗi INSERT của
 *      kịch bản khai số hàng nó mong (nuốt MỘT trong nhiều hàng cho `rowCount ≥ 1`).
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
/** [S1.33, khoản nợ 77] INSERT vào tập sự kiện: một hàm nuốt INSERT (`RETURN NULL`) không ném, nên chỉ vế ⒞ (câu chạm ≥ 1 hàng) phân biệt nó với hàm cho hàng đi qua. */
type SuKien = "INSERT" | "UPDATE" | "DELETE";
const MOI_SU_KIEN: readonly SuKien[] = ["INSERT", "UPDATE", "DELETE"];

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
  readonly ins: boolean;
  readonly upd: boolean;
  readonly del: boolean;
  /** Trigger BEFORE cấp HÀNG — hình thức DUY NHẤT mà `VI_TU_BANG_CHI_GHI_THEM` nhận. */
  readonly truoc_hang: boolean;
  /**
   * Constraint trigger DEFERRABLE — chạy ở COMMIT, ~~sau lần đọc bộ đếm thứ hai: không đo được
   * [lượt soi 21]~~ **[S1.33]** nay đo được: `chung()` ép `SET CONSTRAINTS ALL IMMEDIATE` SAU câu
   * nhân chứng (và sau `hoanTat`), rồi đọc bộ đếm lần thứ ba — hàm DEFERRABLE chỉ được ghi công ở
   * cửa sổ ấy. Kho có hai (017 `rfq_khoa_phai_di_kem_lan_mo`, 018 `bid_phai_co_bien_nhan`).
   * [lượt soi 23, NHẸ-4] Cột là `tginitdeferred`, không phải `tgdeferrable`: một constraint trigger
   * `DEFERRABLE INITIALLY IMMEDIATE` chạy cuối CÂU (đo: `calls` = 1 ngay sau câu) — cửa sổ đầu.
   */
  readonly hoan: boolean;
  /** Thân hàm đọc vai đang chạy — nhân chứng của nó phải đến từ một vai KHÔNG superuser. */
  readonly nhay_vai: boolean;
}

function coSuKien(r: HangTapRong, suKien: SuKien): boolean {
  return suKien === "INSERT" ? r.ins : suKien === "UPDATE" ? r.upd : r.del;
}

/** `calls` của từng hàm plpgsql TRONG GIAO DỊCH HIỆN TẠI — bộ đếm cục bộ của backend, không cần đẩy ra vùng chung. */
async function demGoiTrongGiaoDich(c: pg.PoolClient): Promise<Map<string, number>> {
  const { rows } = await c.query<{ ten: string; calls: string }>(
    "SELECT (schemaname OPERATOR(pg_catalog.||) '.' OPERATOR(pg_catalog.||) funcname) AS ten, " +
      "calls::pg_catalog.text AS calls FROM pg_catalog.pg_stat_xact_user_functions",
  );
  return new Map(rows.map((r) => [r.ten, Number(r.calls)]));
}

/** Số hàng THẬT đã chèn/sửa/xoá trên MỘT bảng trong giao dịch hiện tại — `pg_stat_xact_user_tables`, cùng khuôn với bộ đếm hàm. */
interface DemHang {
  readonly ins: number;
  readonly upd: number;
  readonly del: number;
}
async function demHangTrongGiaoDich(c: pg.PoolClient, bang: string): Promise<DemHang> {
  const { rows } = await c.query<{ ins: string; upd: string; del: string }>(
    "SELECT n_tup_ins::pg_catalog.text AS ins, n_tup_upd::pg_catalog.text AS upd, n_tup_del::pg_catalog.text AS del " +
      "FROM pg_catalog.pg_stat_xact_user_tables WHERE (schemaname OPERATOR(pg_catalog.||) '.' OPERATOR(pg_catalog.||) relname) OPERATOR(pg_catalog.=) $1",
    [bang],
  );
  const r = rows[0];
  return { ins: Number(r?.ins ?? 0), upd: Number(r?.upd ?? 0), del: Number(r?.del ?? 0) };
}
function hieuHang(b: DemHang, a: DemHang): DemHang {
  return { ins: b.ins - a.ins, upd: b.upd - a.upd, del: b.del - a.del };
}
const COT_CUA: Readonly<Record<SuKien, keyof DemHang>> = { INSERT: "ins", UPDATE: "upd", DELETE: "del" };

/**
 * Một nhân chứng: bước chuẩn bị (tuỳ chọn) rồi ĐÚNG MỘT câu INSERT/UPDATE/DELETE, trong cùng giao
 * dịch. [S1.33] `hoanTat` (tuỳ chọn) chạy SAU lần đọc bộ đếm thứ hai, TRƯỚC `SET CONSTRAINTS ALL
 * IMMEDIATE` — chỗ duy nhất của nó là làm cho một constraint trigger DEFERRED thoả (mở RFQ sau khi
 * chèn khoá; phát biên nhận sau khi chèn phiên bản báo giá). Nó nhận kết quả của câu nhân chứng
 * (để lấy `id` vừa chèn) và KHÔNG được ghi công cho ai ở cửa sổ đầu.
 */
interface NhanChung {
  readonly chuanBi?: (c: pg.PoolClient) => Promise<void>;
  readonly cau: (c: pg.PoolClient) => Promise<pg.QueryResult>;
  readonly hoanTat?: (c: pg.PoolClient, kq: pg.QueryResult) => Promise<void>;
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

  /** Chạy một nhân chứng, trả kết quả câu của nó. Ném thì ném ra ngoài — kịch bản hỏng phải NHÌN THẤY. */
  async chung(bang: string, suKien: SuKien, nc: NhanChung): Promise<pg.QueryResult> {
    const c = this.c;
    await c.query("BEGIN");
    try {
      await nc.chuanBi?.(c);
      // Một constraint trigger DEFERRED chạy ở COMMIT — SAU lần đọc bộ đếm thứ hai. ~~Hôm nay 0/46
      // trigger UPDATE/DELETE là deferrable… KHÔNG ép `SET CONSTRAINTS ALL IMMEDIATE` ở đây: 017 có
      // một constraint trigger DEFERRED trên INSERT `rfq_key_material` đòi RFQ được mở TRONG CÙNG
      // giao dịch — ép nó chạy ngay là tự bắn vào chân.~~ [S1.33] Tập sự kiện mở ra INSERT thì hai
      // trigger DEFERRED của kho (017, 018) vào tập, và chúng PHẢI đo được. Cách: ép IMMEDIATE — nhưng
      // SAU câu nhân chứng và sau `hoanTat` (câu làm điều kiện thoả: mở RFQ, phát biên nhận), rồi đọc
      // bộ đếm lần THỨ BA. Hàm DEFERRABLE chỉ được ghi công ở cửa sổ thứ hai; hàm thường chỉ ở cửa sổ
      // đầu. Bản S1.31 ép IMMEDIATE TRƯỚC câu chèn khoá nên tự bắn vào chân; thứ tự là toàn bộ khác biệt.
      const vai = (
        await c.query<VaiDo>(
          "SELECT r.rolname AS ten, r.rolsuper AS sieu FROM pg_catalog.pg_roles r " +
            "WHERE r.rolname OPERATOR(pg_catalog.=) pg_catalog.current_user()",
        )
      ).rows[0];
      if (!vai) throw new Error("không đọc được vai đang chạy");
      const truoc = await demGoiTrongGiaoDich(c);
      const hang0 = await demHangTrongGiaoDich(c, bang);
      const kq = await nc.cau(c);
      const sau = await demGoiTrongGiaoDich(c);
      const hang1 = await demHangTrongGiaoDich(c, bang);
      await nc.hoanTat?.(c, kq);
      await c.query("SET CONSTRAINTS ALL IMMEDIATE");
      const sauHoan = await demGoiTrongGiaoDich(c);
      const hang2 = await demHangTrongGiaoDich(c, bang);
      // ⒞′ [lượt soi 23, NẶNG-1] `rowCount` là con số PostgreSQL đếm TRƯỚC khi trigger AFTER chạy: một
      // trigger AFTER INSERT xoá đúng hàng vừa vào cho `INSERT 0 1`, `RETURNING` đầy đủ, `calls` tăng —
      // và bảng rỗng (đo: n_tup_ins 1, n_tup_del 1). Nên vế "hàng thật" đo ở mức BẢNG, cùng giao dịch:
      // cửa sổ đầu, bộ đếm của ĐÚNG sự kiện phải bằng `rowCount` và hai bộ đếm kia bằng 0; cửa sổ sau
      // (`hoanTat` + SET CONSTRAINTS) không được chạm bảng nhân chứng. Lệch thì NÉM — kịch bản hỏng
      // hay một trigger nuốt-sau-khi-đếm (ADR-036 ⑰) đều phải nhìn thấy, không phải "thiếu nhân chứng".
      const n = kq.rowCount ?? 0;
      const d1 = hieuHang(hang1, hang0);
      const d2 = hieuHang(hang2, hang1);
      const cot = COT_CUA[suKien];
      const lech1 = d1[cot] !== n || (["ins", "upd", "del"] as const).some((k) => k !== cot && d1[k] !== 0);
      const lech2 = d2.ins !== 0 || d2.upd !== 0 || d2.del !== 0;
      if (lech1 || lech2)
        throw new Error(
          `nhân chứng ${bang}/${suKien}: câu báo ${n} hàng nhưng bảng ghi nhận ins/upd/del = ${d1.ins}/${d1.upd}/${d1.del} ` +
            `trong cửa sổ đo và ${d2.ins}/${d2.upd}/${d2.del} ở cửa sổ sau — một trigger đã chèn/sửa/xoá thêm hàng trên ` +
            "chính bảng nhân chứng (nuốt SAU khi đếm, ADR-036 hàng 17), hoặc hoanTat chạm bảng nhân chứng",
        );
      await c.query("COMMIT");
      if (n < 1) return kq; // ⒞ — không hàng nào đổi thì không ai được ghi công
      for (const r of this.tapRong) {
        if (r.bang !== bang || !coSuKien(r, suKien)) continue; // ⒜ — mọi hình thức trigger [S1.31]
        const [a, b] = r.hoan ? [sau, sauHoan] : [truoc, sau]; // ⑹ — cửa sổ theo loại trigger [S1.33]
        if ((b.get(r.ham) ?? 0) > (a.get(r.ham) ?? 0)) {
          // ⒝
          const khoa = `${r.ham}/${bang}/${suKien}`;
          this.ghiCong.set(khoa, [...(this.ghiCong.get(khoa) ?? []), vai]);
        }
      }
      return kq;
    } catch (e) {
      // [lượt soi 23, INFO-11] ROLLBACK ném (kết nối chết) không được đè lỗi gốc.
      try {
        await c.query("ROLLBACK");
      } catch {
        /* lỗi gốc quan trọng hơn */
      }
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
      for (const suKien of MOI_SU_KIEN) {
        if (!coSuKien(r, suKien) || HAM_CANH_MOT_SU_KIEN[r.ham] === suKien) continue;
        const vai = this.ghiCong.get(`${r.ham}/${r.bang}/${suKien}`) ?? [];
        const hopLe = r.nhay_vai ? vai.some((v) => !v.sieu) : vai.length > 0;
        if (!hopLe)
          thieu.add(
            `${r.ham}/${r.bang}/${suKien}` +
              (r.nhay_vai ? " (cần vai không superuser)" : "") +
              (r.hoan ? " (trigger DEFERRABLE — chỉ ghi công ở cửa sổ sau hoanTat + SET CONSTRAINTS ALL IMMEDIATE)" : ""),
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

/** Câu ghi trần dưới vai của kết nối — kết quả (số hàng chạm, hàng RETURNING) là của câu ấy. */
function cau(sql: string, thamSo: readonly unknown[]): NhanChung {
  return { cau: (c) => c.query(sql, [...thamSo]) };
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
 * Kịch bản nhân chứng: một đời RFQ (soạn → nộp → một phê duyệt → mở → gia hạn → mời → khách xác
 * minh → NỘP BÁO GIÁ kèm biên nhận → đóng → yêu cầu mở thầu → duyệt → ghi bản rõ → điều phối → mở
 * thầu), một RFQ thứ hai bị huỷ để thu hồi vật liệu khoá, một việc outbox, một liên kết đăng nhập,
 * một lượt đặt lại TOTP hai người, một sự kiện kiểm toán và một mốc neo, một vai tạm nhận một quyền,
 * và một phiên mở dưới `app_api` sau một lần TOTP đúng. [S1.33] Mọi câu ghi của kịch bản TRÊN MỘT BẢNG CÓ
 * TRIGGER Ở SỰ KIỆN ẤY là một nhân chứng — INSERT cũng như UPDATE/DELETE; vài câu dựng dữ liệu (vai tạm,
 * TOTP của người thứ hai, `consumed_at` của OTP) chạy trần ngoài `chung()` và không ai được ghi công vì
 * chúng — `chuaCoNhanChung` vẫn đòi đủ mọi bộ ba, nên bảng nào có trigger ở sự kiện ấy thì một nhân chứng
 * khác phải phủ [lượt soi 25b #6: lời khai cũ "MỌI câu ghi" rộng hơn mã]. Dữ liệu để lại là vô hại với các test còn lại của tệp — chúng đọc catalog, không
 * đọc dữ liệu — và mọi khoá duy nhất mang một hậu tố ngẫu nhiên nên kịch bản chạy được nhiều lần
 * trên cùng CSDL (vai tạm được xoá ngay, CASCADE).
 */
async function dungKichBan(c: pg.PoolClient, so: SoNhanChung): Promise<{ readonly orgId: string }> {
  const hex = randomBytes(4).toString("hex");
  const MAI_SAU = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const XA_HON = new Date(Date.now() + 14 * 24 * 3600 * 1000);
  // [lượt soi 23, NẶNG-2] Nuốt CÓ ĐIỀU KIỆN trong cùng một câu — một câu chèn hai hàng mà trigger nuốt
  // một — cho `rowCount = 1 ≥ 1` và vẫn được ghi công. Nên mỗi INSERT của kịch bản khai SỐ HÀNG nó mong,
  // và số ấy phải bằng đúng `rowCount` (mặc định 1; `rfq_items` là 2).
  const doiSoHang = (kq: pg.QueryResult, soHang: number, sql: string): void => {
    if ((kq.rowCount ?? 0) !== soHang) throw new Error(`mong ${soHang} hàng, câu chạm ${kq.rowCount ?? 0}: ${sql.slice(0, 60)}`);
  };
  /** INSERT làm nhân chứng ở bảng của nó, trả `id` vừa chèn. */
  const chen = async (bang: string, sql: string, thamSo: readonly unknown[], hoanTat?: NhanChung["hoanTat"]): Promise<string> => {
    const kq = await so.chung(bang, "INSERT", { ...cau(sql, thamSo), hoanTat });
    doiSoHang(kq, 1, sql);
    const v = (kq.rows[0] as { readonly id?: string } | undefined)?.id;
    if (!v) throw new Error(`không có id trả về: ${sql.slice(0, 60)}`);
    return v;
  };
  /** INSERT làm nhân chứng, không cần `id`. */
  const chenKhongId = async (bang: string, sql: string, thamSo: readonly unknown[], soHang = 1): Promise<void> => {
    doiSoHang(await so.chung(bang, "INSERT", cau(sql, thamSo)), soHang, sql);
  };
  /** INSERT làm nhân chứng dưới `app_api` trong tenant, trả `id`. */
  const chenDuoiAppApi = async (bang: string, sql: string, thamSo: readonly unknown[]): Promise<string> => {
    const kq = await so.chung(bang, "INSERT", cauDuoiAppApi(org, sql, thamSo));
    doiSoHang(kq, 1, sql);
    const v = (kq.rows[0] as { readonly id?: string } | undefined)?.id;
    if (!v) throw new Error(`không có id trả về: ${sql.slice(0, 60)}`);
    return v;
  };

  const org = await chen("public.organizations", "INSERT INTO organizations (name, slug) VALUES ($1, $1) RETURNING id", [`nc-${hex}`]);

  // ---- Sổ kiểm toán (003): một sự kiện nối chuỗi, rồi một mốc neo chốt lên đầu chuỗi ------------
  await chen(
    "public.audit_events",
    "INSERT INTO audit_events (org_id, actor_type, action, resource_type) VALUES ($1, 'SYSTEM', 'nhan_chung.dung_kich_ban', 'organization') RETURNING id",
    [org],
  );
  await chen("public.audit_chain_anchors", "INSERT INTO audit_chain_anchors (org_id) VALUES ($1) RETURNING id", [org]);

  const nguoi = async (vai: string): Promise<{ readonly u: string; readonly s: string }> => {
    const u = await chen(
      "public.users",
      "INSERT INTO users (org_id, email, full_name) VALUES ($1, $2, $2) RETURNING id",
      [org, `${vai.toLowerCase()}-${randomBytes(3).toString("hex")}@vidu.vn`],
    );
    await chenKhongId("public.user_roles", "INSERT INTO user_roles (org_id, user_id, role_code) VALUES ($1, $2, $3)", [org, u, vai]);
    const s = await chen(
      "public.sessions",
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
  const cs = await chen(
    "public.org_procurement_policies",
    "INSERT INTO org_procurement_policies (org_id, version, dual_approval_threshold, currency, " +
      "created_by, created_by_session_id) VALUES ($1, 1, '100000000.00', 'VND', $2, $3) RETURNING id",
    [org, pm.u, pm.s],
  );

  // ---- Ma trận quyền (005/033): một vai tạm nhận MỘT quyền — hai hàm AFTER INSERT của D3 cho qua;
  // vai tạm xoá ngay (CASCADE, không trigger DELETE trên role_permissions) để ma trận trở về nguyên trạng.
  // [lượt soi 23, NHẸ-6] Đây là ghi NGOÀI tenant duy nhất của kịch bản; xoá vai nằm ở `finally` để một
  // nhân chứng ném không để vai tạm lại trong danh mục toàn cục. (Không đưa vào `hoanTat`: CASCADE xoá
  // `role_permissions` là một `n_tup_del` trên chính bảng nhân chứng ở cửa sổ sau — vế ⒞′ cấm.)
  const vaiTam = `ZZ_NHAN_CHUNG_${hex}`;
  await c.query("INSERT INTO roles (code, name) VALUES ($1, 'vai tam cua nhan chung')", [vaiTam]);
  try {
    await chenKhongId("public.role_permissions", "INSERT INTO role_permissions (role_code, permission_code) VALUES ($1, 'rfq.create')", [vaiTam]);
  } finally {
    await c.query("DELETE FROM roles WHERE code = $1", [vaiTam]);
  }

  // ---- Phiên dưới app_api (029, 039): hai hàm nhạy vai trên `sessions` — đường đăng nhập thật đòi
  // `mfa_verified_at` đặt ngay trong câu INSERT VÀ một hồ sơ TOTP đã xác nhận với bộ đếm gần hiện tại.
  const tt = await nguoi("BUYER");
  await c.query(
    "INSERT INTO mfa_credentials (org_id, user_id, kind, secret_wrapped, secret_key_version, confirmed_at, last_used_counter) " +
      "VALUES ($1, $2, 'TOTP', '\\x01', 'v1', now(), pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()) / 30)::pg_catalog.int8)",
    [org, tt.u],
  );
  await so.chung(
    "public.sessions",
    "INSERT",
    cauDuoiAppApi(org, "INSERT INTO sessions (org_id, user_id, token_hash, expires_at, mfa_verified_at) VALUES ($1, $2, $3, now() + interval '1 day', now())", [org, tt.u, randomBytes(32)]),
  );

  const rfqSoan = async (): Promise<string> => {
    const r = await chen(
      "public.rfq_packages",
      "INSERT INTO rfq_packages (org_id, title, deadline_at, requires_dual_approval, created_by, " +
        "created_by_session_id) VALUES ($1, 'Mua thep tam', $2, false, $3, $4) RETURNING id",
      [org, MAI_SAU, pm.u, pm.s],
    );
    await chenKhongId(
      "public.rfq_items",
      "INSERT INTO rfq_items (org_id, rfq_id, line_no, description, quantity, unit, created_by, " +
        "created_by_session_id) VALUES ($1, $2, 1, 'Thep tam', '10.0000', 'tam', $3, $4), " +
        "($1, $2, 2, 'Thep cuon', '5.0000', 'cuon', $3, $4)",
      [org, r, pm.u, pm.s],
      2,
    );
    await chenKhongId(
      "public.rfq_budgets",
      "INSERT INTO rfq_budgets (org_id, rfq_id, estimated_value, currency, policy_id, created_by, " +
        "created_by_session_id) VALUES ($1, $2, '1000000.00', 'VND', $3, $4, $5)",
      [org, r, cs, pm.u, pm.s],
    );
    return r;
  };
  const CHEN_KHOA =
    "INSERT INTO rfq_key_material (org_id, rfq_id, algorithm, public_key, wrapped_private_key, " +
    "key_version, created_by, created_by_session_id) VALUES ($1, $2, 'ECDH_P256', $3, $4, 'test-v1', $5, $6)";
  const MO_RFQ = "UPDATE rfq_packages SET status = 'OPEN', opened_at = now(), opened_by = $2, opened_by_session_id = $3 WHERE id = $1";
  /**
   * Nộp duyệt → một phê duyệt (D2, 011) → mở. 017 đòi vật liệu khoá sinh TRONG giao dịch mở (trigger
   * BEFORE INSERT) và có một constraint trigger DEFERRED kiểm ở COMMIT rằng RFQ đã đi qua cửa OPEN,
   * nên chèn khoá và mở phải chung giao dịch — và mỗi câu cần làm nhân chứng ở một lượt riêng:
   * `khoaLaNhanChung` thì chèn khoá là câu đo còn mở là `hoanTat` (trigger DEFERRED chạy ở cửa sổ đo
   * thứ hai); ngược lại chèn khoa là bước chuẩn bị còn mở là câu đo (`rfq_kiem_khoa_khi_mo` chỉ chạy ở đó).
   */
  const rfqMo = async (r: string, khoaLaNhanChung: boolean): Promise<void> => {
    await so.chung(
      "public.rfq_packages",
      "UPDATE",
      cau("UPDATE rfq_packages SET status = 'PENDING_APPROVAL', submitted_by = $2, submitted_by_session_id = $3 WHERE id = $1", [r, pm.u, pm.s]),
    );
    await chen(
      "public.rfq_approvals",
      "INSERT INTO rfq_approvals (org_id, rfq_id, approver_user_id, session_id) VALUES ($1, $2, $3, $4) RETURNING id",
      [org, r, gd.u, gd.s],
    );
    const thamSoKhoa = [org, r, Buffer.alloc(91, 1), Buffer.alloc(80, 2), pm.u, pm.s];
    if (khoaLaNhanChung) {
      await so.chung("public.rfq_key_material", "INSERT", {
        ...cau(CHEN_KHOA, thamSoKhoa),
        hoanTat: async (cc) => {
          await cc.query(MO_RFQ, [r, pm.u, pm.s]);
        },
      });
    } else {
      await so.chung(
        "public.rfq_packages",
        "UPDATE",
        cauSauKhi(
          async (cc) => {
            await cc.query(CHEN_KHOA, thamSoKhoa);
          },
          MO_RFQ,
          [r, pm.u, pm.s],
        ),
      );
    }
  };

  // ---- RFQ 1: trọn một đời --------------------------------------------------------------------
  const rfq1 = await rfqSoan();
  await so.chung("public.rfq_items", "UPDATE", cau("UPDATE rfq_items SET description = 'Thep tam day 10' WHERE rfq_id = $1 AND line_no = 1", [rfq1]));
  await so.chung("public.rfq_items", "DELETE", cau("DELETE FROM rfq_items WHERE rfq_id = $1 AND line_no = 2", [rfq1]));
  await so.chung("public.rfq_budgets", "UPDATE", cau("UPDATE rfq_budgets SET estimated_value = '2000000.00' WHERE rfq_id = $1", [rfq1]));
  await so.chung("public.rfq_packages", "UPDATE", cau("UPDATE rfq_packages SET title = 'Mua thep tam day' WHERE id = $1", [rfq1]));
  await rfqMo(rfq1, true);
  await so.chung("public.rfq_packages", "UPDATE", cau("UPDATE rfq_packages SET deadline_at = $2 WHERE id = $1", [rfq1, XA_HON]));
  // Mời một nhà cung cấp trong lúc RFQ đang OPEN.
  const ncc = await chen(
    "public.suppliers",
    "INSERT INTO suppliers (org_id, legal_name, created_by, created_by_session_id) VALUES ($1, $2, $3, $4) RETURNING id",
    [org, `NCC ${hex}`, pm.u, pm.s],
  );
  const lh = await chen(
    "public.supplier_contacts",
    "INSERT INTO supplier_contacts (org_id, supplier_id, full_name, email, phone, created_by, created_by_session_id) " +
      "VALUES ($1, $2, 'Nguoi ban', $3, '0900000001', $4, $5) RETURNING id",
    [org, ncc, `${hex}@vidu.vn`, pm.u, pm.s],
  );
  const lm = await chen(
    "public.rfq_invitations",
    "INSERT INTO rfq_invitations (org_id, rfq_id, supplier_id, contact_id, link_channel, invited_by, invited_by_session_id) " +
      "VALUES ($1, $2, $3, $4, 'EMAIL', $5, $6) RETURNING id",
    [org, rfq1, ncc, lh, pm.u, pm.s],
  );
  const tk = await chen(
    "public.rfq_invitation_tokens",
    "INSERT INTO rfq_invitation_tokens (org_id, invitation_id, token_hash, purpose, expires_at, issued_by, issued_by_session_id) " +
      "VALUES ($1, $2, $3, 'BID_SUBMISSION', now() + interval '1 day', $4, $5) RETURNING id",
    [org, lm, randomBytes(32), pm.u, pm.s],
  );
  const otp = await chen(
    "public.invitation_otp_challenges",
    "INSERT INTO invitation_otp_challenges (org_id, invitation_id, token_id, contact_id, channel, code_hash, " +
      "destination_hash, pepper_version, expires_at) VALUES ($1, $2, $3, $4, 'SMS', $5, $6, 'test-v1', now() + interval '1 day') RETURNING id",
    [org, lm, tk, lh, randomBytes(32), randomBytes(32)],
  );
  await so.chung("public.invitation_otp_challenges", "UPDATE", cau("UPDATE invitation_otp_challenges SET failed_attempts = failed_attempts + 1 WHERE id = $1", [otp]));
  // Khách xác minh xong: thách thức được tiêu thụ, một phiên khách ra đời…
  await c.query("UPDATE invitation_otp_challenges SET consumed_at = now() WHERE id = $1", [otp]);
  const pk = await chen(
    "public.guest_sessions",
    "INSERT INTO guest_sessions (org_id, invitation_id, challenge_id, token_hash, verified_contact_id, verified_channel, expires_at) " +
      "VALUES ($1, $2, $3, $4, $5, 'SMS', now() + interval '1 day') RETURNING id",
    [org, lm, otp, randomBytes(32), lh],
  );
  // …và NỘP BÁO GIÁ bằng phiên ấy (018): một luồng, một phiên bản, biên nhận phát trong CÙNG giao dịch —
  // constraint trigger DEFERRED `bid_phai_co_bien_nhan` (B2) chạy ở cửa sổ đo thứ hai, sau `hoanTat`.
  const luong = await chen("public.vendor_bids", "INSERT INTO vendor_bids (org_id, invitation_id) VALUES ($1, $2) RETURNING id", [org, lm]);
  const pb = await chen(
    "public.vendor_bid_versions",
    "INSERT INTO vendor_bid_versions (org_id, bid_id, version, envelope, submitted_by_guest_session_id) VALUES ($1, $2, 1, $3, $4) RETURNING id",
    [org, luong, randomBytes(64), pk],
    async (cc, kq) => {
      const idPb = (kq.rows[0] as { readonly id: string }).id;
      await cc.query(
        "INSERT INTO bid_receipts (org_id, bid_version_id, canonical_text, signature) VALUES ($1, $2, $3, $4)",
        [org, idPb, `trustprocure-receipt-v1\n${"0".repeat(80)}`, randomBytes(64)],
      );
    },
  );
  // Rồi phiên khách bị thu hồi, token bị thu hồi, lời mời bị thu hồi.
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
  // Break-glass (D4, 019/022): yêu cầu đường riêng phải sinh cảnh báo NGAY trong giao dịch tạo — trigger
  // AFTER INSERT `WHEN (NEW.break_glass)` — và mang nhân chứng là người khác, phiên khác. Rồi huỷ nó để
  // đường thường đi tiếp: một RFQ chỉ có một yêu cầu đang mở.
  const bg = await chen(
    "public.unseal_requests",
    "INSERT INTO unseal_requests (org_id, rfq_id, reason, break_glass, requested_by, requested_by_session_id, " +
      "break_glass_witness_user_id, break_glass_witness_session_id) VALUES ($1, $2, 'su co: can mo ngay', true, $3, $4, $5, $6) RETURNING id",
    [org, rfq1, pm.u, pm.s, gd.u, gd.s],
  );
  await so.chung("public.unseal_requests", "UPDATE", cau("UPDATE unseal_requests SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1", [bg]));
  const yc = await chen(
    "public.unseal_requests",
    "INSERT INTO unseal_requests (org_id, rfq_id, reason, requested_by, requested_by_session_id) VALUES ($1, $2, 'den gio mo thau', $3, $4) RETURNING id",
    [org, rfq1, pm.u, pm.s],
  );
  await chenKhongId(
    "public.unseal_approvals",
    "INSERT INTO unseal_approvals (org_id, unseal_request_id, approver_user_id, approver_session_id) VALUES ($1, $2, $3, $4)",
    [org, yc, gd.u, gd.s],
  );
  await so.chung("public.unseal_requests", "UPDATE", cau("UPDATE unseal_requests SET status = 'APPROVED', approved_at = now() WHERE id = $1", [yc]));
  // Bản rõ của phiên bản báo giá ghi dưới yêu cầu đã phê duyệt (019, A1).
  await chen(
    "public.rfq_unsealed_bids",
    "INSERT INTO rfq_unsealed_bids (org_id, unseal_request_id, bid_version_id, payload) VALUES ($1, $2, $3, '{}'::jsonb) RETURNING id",
    [org, yc, pb],
  );
  await so.chung(
    "public.unseal_requests",
    "UPDATE",
    cau("UPDATE unseal_requests SET dispatched_at = now(), dispatched_by = $2, dispatched_by_session_id = $3 WHERE id = $1", [yc, pm.u, pm.s]),
  );
  await so.chung("public.rfq_packages", "UPDATE", cau("UPDATE rfq_packages SET status = 'UNSEALED' WHERE id = $1", [rfq1]));

  // ---- RFQ 2: huỷ để thu hồi vật liệu khoá — lượt này MỞ là câu đo, chèn khoá là bước chuẩn bị ----
  const rfq2 = await rfqSoan();
  await rfqMo(rfq2, false);
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
  const viec = await chen(
    "public.outbox_jobs",
    "INSERT INTO outbox_jobs (org_id, kind, payload) VALUES ($1, 'LOGIN_LINK_SEND', $2::jsonb) RETURNING id",
    [org, JSON.stringify({ email: "x@vidu.vn" })],
  );
  await so.chung("public.outbox_jobs", "UPDATE", cau("UPDATE outbox_jobs SET status = 'DONE', finished_at = now() WHERE id = $1", [viec]));
  const lk = await chen(
    "public.user_login_tokens",
    "INSERT INTO user_login_tokens (org_id, user_id, token_hash, purpose, expires_at) VALUES ($1, $2, $3, 'LOGIN', now() + interval '1 hour') RETURNING id",
    [org, nan.u, randomBytes(32)],
  );
  await so.chung("public.user_login_tokens", "UPDATE", cau("UPDATE user_login_tokens SET consumed_at = now() WHERE id = $1", [lk]));

  // ---- TOTP: ghi danh lại khi CHƯA xác nhận (031), rồi đặt lại hai người và xoá (040) ----------
  await chenKhongId(
    "public.mfa_credentials",
    "INSERT INTO mfa_credentials (org_id, user_id, kind, secret_wrapped, secret_key_version) VALUES ($1, $2, 'TOTP', '\\x01', 'v1')",
    [org, nan.u],
  );
  await so.chung(
    "public.mfa_credentials",
    "UPDATE",
    cauDuoiAppApi(org, "UPDATE mfa_credentials SET secret_wrapped = '\\x02', secret_key_version = 'v2' WHERE org_id = $1 AND user_id = $2", [org, nan.u]),
  );
  // `mfa_reset_kiem_quyen` mang chuỗi 'user.mfa_reset' nên vị từ nhạy vai bắt nó (dương tính giả, chiều an
  // toàn) — nhân chứng chạy dưới app_api, đúng đường 040 (INSERT/UPDATE mức cột đã cấp).
  const yd = await chenDuoiAppApi(
    "public.mfa_reset_requests",
    "INSERT INTO mfa_reset_requests (org_id, user_id, reason, requested_by, requested_by_session_id) VALUES ($1, $2, 'mat dien thoai', $3, $4) RETURNING id",
    [org, nan.u, pm.u, pm.s],
  );
  await so.chung(
    "public.mfa_reset_requests",
    "UPDATE",
    cauDuoiAppApi(org, "UPDATE mfa_reset_requests SET status = 'APPROVED', approved_by = $2, approved_by_session_id = $3, approved_at = now() WHERE id = $1", [yd, pm2.u, pm2.s]),
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
      // [S1.36, khoản nợ 79] Fixture này từng để so_pm_chan ở ENABLE thường ('O') và evidence bắt ngay khi mục
      // phán xét "trigger canh không ENABLE ALWAYS" ra đời (lượt soi 27 NẶNG-1): lược đồ ấy KHÔNG hợp lệ —
      // session_replication_role = replica đi qua nó. Nâng lên ALWAYS như 047 làm cho bảng có tên.
      await db.pool.query("ALTER TABLE public.so_pm ENABLE ALWAYS TRIGGER so_pm_chan");
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

  it("[sổ nợ 60] TỔNG ĐIỀU TRA: mọi hàm trigger ghi (INSERT/UPDATE/DELETE, mọi hình thức) phải nằm trong ĐÚNG MỘT danh sách", async () => {
    const { rows } = await db.pool.query<{ ten: string; khong_tra_ve: boolean; co_trigger_tat: boolean; chi_truoc_hang: boolean; luon_bat: boolean; co_when: boolean; co_cot: boolean }>(CAU_TAP_RONG);
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
      "Một hàm trigger GHI (INSERT/UPDATE/DELETE, bất kể BEFORE/AFTER, hàng/câu lệnh) vừa ra đời mà chưa được phân loại. Đây KHÔNG " +
        "phải lỗi cú pháp: nó là câu hỏi 'đây có phải một hàm canh chỉ-ghi-thêm không'. Nếu CÓ: thêm " +
        "tên vào HAM_CANH_CHI_GHI_THEM VÀ vào vị từ trong hardening.always.sql (cổng ở test đầu giữ " +
        "hai bản khớp nhau), kèm bảng của nó vào BANG_CHI_GHI_THEM_THAT — bảng ấy sẽ được H19 canh " +
        "kể cả khi thân hàm có RETURN. Nếu KHÔNG: thêm vào HAM_KHONG_PHAI_CANH VÀ một câu INSERT/UPDATE/DELETE " +
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
    // [S1.32, ADR-036 ⑹] Chặt hơn 'không TẮT': trigger canh phải ENABLE ALWAYS. `tgenabled = 'O'`
    // (mặc định) KHÔNG chạy khi `session_replication_role = replica` — một phiên đặt GUC ấy đi qua
    // mọi hàm canh 'O' mà không lỗi. 047 đã ghim ALWAYS cho chốt TRUNCATE; đây là vế cho UPDATE/DELETE.
    expect(
      rows.filter((r) => canhDayDu.includes(r.ten) && !r.luon_bat).map((r) => r.ten),
      "Một trigger của hàm canh không ở ENABLE ALWAYS — `session_replication_role = replica` tắt nó.",
    ).toEqual([]);
    // [S1.36, khoản nợ 79 / ADR-036 ⑳] Và trigger canh phải VÔ ĐIỀU KIỆN: `WHEN (…)` hay `UPDATE OF <cột>`
    // giữ nguyên tên hàm nhưng hàm canh không chạy cho một phần câu (đo ở test khoản 79 dưới đây). Vị từ
    // nay đã THẢ bảng ấy; vế này giữ cho việc thả không xảy ra trong im lặng — cùng với mục phán xét ở hardening.
    expect(
      rows.filter((r) => canhDayDu.includes(r.ten) && (r.co_when || r.co_cot)).map((r) => r.ten),
      "Một trigger của hàm canh có WHEN hay UPDATE OF — hàm canh chỉ chạy có điều kiện, bảng ấy không chỉ-ghi-thêm.",
    ).toEqual([]);
    // Đối chứng dương, hoàn tác: hạ một trigger canh về ENABLE thường ('O') ⇒ vế ALWAYS phải đỏ; và một
    // trigger `WHEN (false)` gọi hàm canh ⇒ vế vô điều kiện phải đỏ.
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("ALTER TABLE public.audit_events ENABLE TRIGGER audit_events_chan_update");
      const { rows: sau } = await c.query<{ ten: string; luon_bat: boolean }>(CAU_TAP_RONG);
      expect(sau.find((r) => r.ten === "public.chan_sua_xoa")?.luon_bat).toBe(false);
      await c.query("CREATE TABLE public.zz_dk_tap (id int); CREATE TRIGGER zz_dk BEFORE DELETE ON public.zz_dk_tap FOR EACH ROW WHEN (false) EXECUTE FUNCTION public.chan_sua_xoa()");
      const { rows: sau2 } = await c.query<{ ten: string; co_when: boolean; co_cot: boolean }>(CAU_TAP_RONG);
      expect(sau2.find((r) => r.ten === "public.chan_sua_xoa"), "tập rộng phải THẤY mệnh đề WHEN trên hàm canh").toMatchObject({ co_when: true, co_cot: false });
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
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

  it("[sổ nợ 60] ĐO: một hàm canh kiểu `RAISE …; RETURN NULL` khai THẬT thì bảng của nó VÀO TẬP của vị từ", async () => {
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

  it("[S1.32 / ADR-036] TỔNG ĐIỀU TRA loại quan hệ: mọi quan hệ nhận DML của dự án là BẢNG THƯỜNG, trừ khi khai — view/matview/bảng ngoài/bảng phân mảnh là đường ghi khác mà H19 không nhìn", async () => {
    // Đích của INSERT/UPDATE/DELETE là r (bảng), p (bảng phân mảnh), v (view), m (matview), f (bảng
    // ngoài). Chỉ 'r' đi qua đủ các lớp của H19 hôm nay: view nhận trigger INSTEAD OF (trả NULL là
    // nuốt hàng), bảng ngoài ghi ra một cụm khác, phân mảnh cần chốt trên từng lá (đã đo ở test lá).
    const LOAI_DA_KHAI: readonly string[] = [];
    // [S1.34 / khoản nợ 78] Vì sao loại `pg_temp%`: bảng tạm là của PHIÊN, không phải của lược đồ, và
    // một bảng tạm trùng tên đứng TRƯỚC public trong search_path — đúng cơ chế che tên của ADR-036 ⑯.
    // Tổng điều tra này không nhìn thấy nó theo thiết kế; thứ đóng đường ấy là hardening thu hồi TEMP
    // trên database khỏi PUBLIC và các vai ứng dụng (đo ở `migrations.int.test.ts`, khoản 78).
    const cau = `SELECT n.nspname OPERATOR(pg_catalog.||) '.' OPERATOR(pg_catalog.||) c.relname AS ten, c.relkind::pg_catalog.text AS loai
                   FROM pg_class c JOIN pg_namespace n ON n.oid OPERATOR(pg_catalog.=) c.relnamespace
                  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
                    AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp%'
                    AND c.relkind IN ('r', 'p', 'v', 'm', 'f') ORDER BY 1`;
    const { rows } = await db.pool.query<{ ten: string; loai: string }>(cau);
    expect(rows.length, "câu truy vấn đang mù").toBeGreaterThan(30);
    const khac = rows.filter((r) => r.loai !== "r").map((r) => `${r.ten} (${r.loai})`);
    expect(khac.filter((t) => !LOAI_DA_KHAI.includes(t)), "Một quan hệ nhận DML không phải bảng thường vừa ra đời — khai kèm lý do, hoặc đưa nó qua đủ các lớp của H19.").toEqual([]);
    expect(LOAI_DA_KHAI.filter((t) => !khac.includes(t)), "khai một quan hệ không còn có").toEqual([]);
    // Đối chứng chống rỗng ruột: một view tạm phải được THẤY.
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("CREATE VIEW public.zz_v AS SELECT 1 AS mot");
      const { rows: sau } = await c.query<{ ten: string; loai: string }>(cau);
      expect(sau.some((r) => r.ten === "public.zz_v" && r.loai === "v")).toBe(true);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  }, 180000);

  it("[S1.32 / ADR-036 ⑮] ĐO: trigger BEFORE INSERT ROW trả NULL nuốt INSERT im lặng — tập rộng mới THẤY hàm ấy, và tổng điều tra đòi phân loại", async () => {
    const ten = "zz_nuot_chen";
    await db.pool.query(`
      CREATE TABLE public.zz_chen (id int PRIMARY KEY, ghi text);
      CREATE FUNCTION public.${ten}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
      CREATE TRIGGER zz_chen_nuot BEFORE INSERT ON public.zz_chen FOR EACH ROW EXECUTE FUNCTION public.${ten}();
    `);
    try {
      const chen = await db.pool.query("INSERT INTO public.zz_chen VALUES (1, 'a') RETURNING id");
      expect([chen.rowCount, chen.rows.length], "INSERT 0 0, RETURNING rỗng, KHÔNG lỗi").toEqual([0, 0]);
      const { rows } = await db.pool.query<{ ten: string }>(CAU_TAP_RONG);
      expect(rows.some((r) => r.ten === `public.${ten}`), "tập rộng phải thấy hàm trigger INSERT").toBe(true);
      const daKhai = new Set([...HAM_CANH_CHI_GHI_THEM.map((h) => `public.${h}`), ...HAM_KHONG_PHAI_CANH]);
      expect(daKhai.has(`public.${ten}`), "chưa khai ⇒ tổng điều tra đỏ").toBe(false);
    } finally {
      await db.pool.query(`DROP TABLE IF EXISTS public.zz_chen; DROP FUNCTION IF EXISTS public.${ten}();`);
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

  it("[sổ nợ 73] ĐO: một RULE làm bảng chỉ-ghi-thêm mà KHÔNG lỗi, KHÔNG trigger, và ngoài tập của H19 — ~~tổng điều tra là lớp duy nhất thấy nó~~ [S1.39] tổng điều tra thấy, và migrate() NÉM ở mục khoản 83⑹", async () => {
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
      // (b) không trigger nào ⇒ ngoài tập rộng của tổng điều tra hàm, ngoài vị từ của H19 — và ~~migrate() OK~~
      //     [S1.39 / khoản nợ 83⑹] migrate() NÉM: rule trên MỌI quan hệ của dự án nay là mục phán xét (đo trước
      //     S1.39: đi qua — chỉ rule trên bảng sổ/bảng chỉ-ghi-thêm suy ra bị soi).
      const tapRong = (await db.pool.query<{ bang: string }>(CAU_TAP_RONG_THEO_BANG)).rows;
      expect(tapRong.some((r) => r.bang === "public.zz_rule")).toBe(false);
      const chiGhiThem = (await db.pool.query<{ relname: string }>(VI_TU_BANG_CHI_GHI_THEM)).rows;
      expect(chiGhiThem.some((r) => r.relname === "zz_rule")).toBe(false);
      const kqRule = await migrateLai(db);
      expect(kqRule).toMatch(/^NÉM/);
      expect(kqRule).toContain("public.zz_rule.zz_khong_sua: RULE trên một quan hệ của dự án (khoản 83⑹");
      expect(kqRule).toContain("public.zz_rule.zz_khong_xoa: RULE");
      // (c) tổng điều tra rule THẤY nó — ở đúng hai tên.
      const { rows } = await db.pool.query<{ ten: string }>(CAU_RULE_RONG);
      expect(rows.map((r) => r.ten).filter((t) => !RULE_DA_KHAI.includes(t))).toEqual([
        "public.zz_rule/zz_khong_sua",
        "public.zz_rule/zz_khong_xoa",
      ]);
      // (d) [lượt soi 30, NHẸ-6] đối chứng dương: gỡ rule ⇒ đi qua.
      await db.pool.query("DROP RULE zz_khong_sua ON public.zz_rule; DROP RULE zz_khong_xoa ON public.zz_rule");
      expect(await migrateLai(db)).toBe("OK");
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

  it("[sổ nợ 75] ĐO: một hàm canh gắn BEFORE UPDATE OR DELETE FOR EACH STATEMENT làm bảng chỉ-ghi-thêm mà H19 không nhận — tập rộng mới THẤY nó, tổng điều tra ĐỎ ở cả hai lời khai, và [S1.39] migrate() NÉM ở mục khoản 83⑺", async () => {
    const ten = "zz_canh_cau_lenh";
    await db.pool.query(`
      CREATE TABLE public.zz_cau (id int PRIMARY KEY, ghi text);
      INSERT INTO public.zz_cau VALUES (1, 'a');
      CREATE FUNCTION public.${ten}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'zz_cau chi ghi them'; END $$;
      CREATE TRIGGER zz_cau_canh BEFORE UPDATE OR DELETE ON public.zz_cau FOR EACH STATEMENT EXECUTE FUNCTION public.${ten}();
      ALTER TABLE public.zz_cau ENABLE ALWAYS TRIGGER zz_cau_canh;
    `);
    // [S1.36] ENABLE ALWAYS ở trên là do evidence bác bản đầu của khoản 79: mục phán xét mới bắt trigger canh
    // (hình dạng: thân không RETURN) ở ENABLE thường — đúng, và phép đo (b) dưới đây nói về H19 KHÔNG NHẬN
    // bảng vì hình thức cấp câu lệnh, không nói về tgenabled.
    try {
      // (a) nó LÀ hàm canh: mọi UPDATE/DELETE ném, kể cả câu chạm 0 hàng.
      expect(await thu(db, "UPDATE public.zz_cau SET ghi = 'b' WHERE id = 1")).toMatch(/^NÉM/);
      expect(await thu(db, "DELETE FROM public.zz_cau WHERE id = 99")).toMatch(/^NÉM/);
      // (b) nhưng H19 không nhận bảng và TRUNCATE đi lọt — đúng khoản nợ 75; ~~migrate() OK~~ [S1.39 / khoản nợ
      //     83⑺] migrate() NÉM: hàm canh (hình dạng) gắn ngoài BEFORE … FOR EACH ROW nay là mục phán xét (đo trước
      //     S1.39: đi qua — tổng điều tra ở test là lớp duy nhất).
      const chiGhiThem = (await db.pool.query<{ relname: string }>(VI_TU_BANG_CHI_GHI_THEM)).rows;
      expect(chiGhiThem.some((r) => r.relname === "zz_cau")).toBe(false);
      const kq75 = await migrateLai(db);
      expect(kq75).toMatch(/^NÉM/);
      // regprocedure::text bỏ `public.` khi schema ấy ở search_path — không ghim tiền tố.
      expect(kq75).toMatch(new RegExp(`zz_cau\\.zz_cau_canh: trigger của hàm canh (public\\.)?${ten}\\(\\) ở hình thức BEFORE FOR EACH STATEMENT`, "u"));
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
      // (e) [lượt soi 30, NHẸ-6] đối chứng dương: gỡ trigger ⇒ đi qua (dựng lại BEFORE ROW thì bảng thành chỉ-ghi-thêm
      //     và H19 đòi chốt TRUNCATE — chuyện của một test khác).
      await db.pool.query("DROP TRIGGER zz_cau_canh ON public.zz_cau");
      expect(await migrateLai(db)).toBe("OK");
    } finally {
      await db.pool.query(`DROP TABLE public.zz_cau; DROP FUNCTION public.${ten}();`);
    }
  }, 180000);

  it("[khoản nợ 79] ĐO: trigger canh có WHEN / UPDATE OF giữ tên hàm mà hàm canh KHÔNG chạy cho một phần câu — vị từ CŨ nhận bảng là chỉ-ghi-thêm, vị từ MỚI thả, tổng điều tra thấy, migrate() NÉM", async () => {
    // Đúng ca lượt soi 25a #1 dựng, đo lại trên PostgreSQL 16. Ba trigger cùng gọi hàm canh, cùng ENABLE ALWAYS —
    // ba vế hardening cũ (LOGGED, chốt TRUNCATE, ACL) không có gì để phán trên bảng này (khẳng định ở (d):
    // thông điệp NÉM chỉ nêu mục mới), vế ALWAYS của tổng điều tra cũng xanh.
    await db.pool.query(`
      CREATE TABLE public.zz_dk (id int PRIMARY KEY, a text, b text);
      INSERT INTO public.zz_dk VALUES (1, 'a', 'b');
      CREATE TRIGGER u BEFORE UPDATE OF a ON public.zz_dk FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
      CREATE TRIGGER d BEFORE DELETE ON public.zz_dk FOR EACH ROW WHEN (false) EXECUTE FUNCTION public.bid_chi_ghi_them();
      CREATE TRIGGER t BEFORE TRUNCATE ON public.zz_dk FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
      ALTER TABLE public.zz_dk ENABLE ALWAYS TRIGGER u;
      ALTER TABLE public.zz_dk ENABLE ALWAYS TRIGGER d;
      ALTER TABLE public.zz_dk ENABLE ALWAYS TRIGGER t;
    `);
    try {
      // (a) cơ chế: hàm canh KHÔNG chạy cho UPDATE cột ngoài UPDATE OF và cho mọi DELETE — 1 hàng, không lỗi.
      expect((await db.pool.query("UPDATE public.zz_dk SET b = 'x' WHERE id = 1")).rowCount, "UPDATE cột ngoài UPDATE OF đi qua").toBe(1);
      expect(await thu(db, "UPDATE public.zz_dk SET a = 'x' WHERE id = 1"), "UPDATE đúng cột thì hàm canh chạy").toMatch(/^NÉM/);
      expect((await db.pool.query("DELETE FROM public.zz_dk WHERE id = 1")).rowCount, "DELETE với WHEN (false) đi qua").toBe(1);
      await db.pool.query("INSERT INTO public.zz_dk VALUES (1, 'a', 'b')");
      // (b) vị từ CŨ (bỏ vế vô điều kiện) NHẬN bảng — đúng lỗ lượt soi 25a #1; vị từ MỚI thả nó.
      const viTuCu = VI_TU_BANG_CHI_GHI_THEM.replaceAll(VE_TRIGGER_VO_DIEU_KIEN, "");
      expect(viTuCu, "vế vô điều kiện phải NẰM trong vị từ").not.toBe(VI_TU_BANG_CHI_GHI_THEM);
      expect((await db.pool.query<{ relname: string }>(viTuCu)).rows.some((r) => r.relname === "zz_dk"), "vị từ CŨ nhận bảng có trigger canh điều kiện").toBe(true);
      expect((await db.pool.query<{ relname: string }>(VI_TU_BANG_CHI_GHI_THEM)).rows.some((r) => r.relname === "zz_dk"), "vị từ MỚI thả bảng").toBe(false);
      // (c) tập rộng thấy điều kiện trên hàm canh ⇒ vế mới của tổng điều tra đỏ đúng tên.
      const { rows } = await db.pool.query<{ ten: string; co_when: boolean; co_cot: boolean }>(CAU_TAP_RONG);
      expect(rows.find((r) => r.ten === "public.bid_chi_ghi_them")).toMatchObject({ co_when: true, co_cot: true });
      // (d) và migrate() NÉM nêu tên cả hai trigger — lớp SẢN XUẤT, để bảng không rơi khỏi tập trong im lặng.
      const kq = await migrateLai(db);
      expect(kq).toMatch(/^NÉM/);
      // [lượt soi 27, NHẸ-3] ghép TÊN trigger với VẾ: đảo hai nhánh CASE trong hardening phải đỏ.
      expect(kq).toMatch(/zz_dk\.u: [^;]*có UPDATE OF/u);
      expect(kq).not.toMatch(/zz_dk\.u: [^;]*có mệnh đề WHEN/u);
      expect(kq).toMatch(/zz_dk\.d: [^;]*có mệnh đề WHEN/u);
      expect(kq).not.toMatch(/zz_dk\.d: [^;]*có UPDATE OF <cột>/u);
      expect(kq).toContain("không sửa được 1 mục");
      // (e) đối chứng: dựng lại hai trigger vô điều kiện ⇒ bảng vào tập, migrate() đi qua.
      await db.pool.query(`
        DROP TRIGGER u ON public.zz_dk; DROP TRIGGER d ON public.zz_dk;
        CREATE TRIGGER u BEFORE UPDATE ON public.zz_dk FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
        CREATE TRIGGER d BEFORE DELETE ON public.zz_dk FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
        ALTER TABLE public.zz_dk ENABLE ALWAYS TRIGGER u; ALTER TABLE public.zz_dk ENABLE ALWAYS TRIGGER d;
      `);
      expect((await db.pool.query<{ relname: string }>(VI_TU_BANG_CHI_GHI_THEM)).rows.some((r) => r.relname === "zz_dk")).toBe(true);
      expect(await migrateLai(db)).toBe("OK");
      // (f) [lượt soi 27, NẶNG-1] Cột thứ ba giữ tên hàm mà hàm canh không chạy: tgenabled. Trigger canh bị
      //     DISABLE ('D') hay ở ENABLE thường ('O') — bảng VẪN trong tập (vị từ cố ý không đọc tgenabled), và
      //     UPDATE đi qua: 'D' luôn; 'O' khi session_replication_role = replica (ADR-036 ⑧). Bản đầu của mục phán
      //     xét bỏ sót cột này — lớp duy nhất là tổng điều tra ở test, tức chính vế khoản 81 đang treo.
      await db.pool.query("ALTER TABLE public.zz_dk DISABLE TRIGGER u");
      expect((await db.pool.query("UPDATE public.zz_dk SET a = 'y' WHERE id = 1")).rowCount, "trigger canh DISABLE ⇒ UPDATE đi qua").toBe(1);
      expect((await db.pool.query<{ relname: string }>(VI_TU_BANG_CHI_GHI_THEM)).rows.some((r) => r.relname === "zz_dk"), "bảng vẫn trong tập").toBe(true);
      expect(await migrateLai(db)).toMatch(/zz_dk\.u: [^;]*tgenabled=D/u);
      await db.pool.query("ALTER TABLE public.zz_dk ENABLE TRIGGER u");
      const cr = await db.pool.connect();
      try {
        await cr.query("BEGIN");
        await cr.query("SET LOCAL session_replication_role = replica");
        expect((await cr.query("UPDATE public.zz_dk SET a = 'z' WHERE id = 1")).rowCount, "ENABLE thường + replica ⇒ UPDATE đi qua").toBe(1);
      } finally {
        await cr.query("ROLLBACK");
        cr.release();
      }
      expect(await migrateLai(db)).toMatch(/zz_dk\.u: [^;]*tgenabled=O/u);
      await db.pool.query("ALTER TABLE public.zz_dk ENABLE ALWAYS TRIGGER u");
      expect(await migrateLai(db)).toBe("OK");
    } finally {
      await db.pool.query("DROP TABLE public.zz_dk");
    }
  }, 180000);

  it("[khoản nợ 79] ĐO: chốt TRUNCATE mang WHEN (false) là HỢP LỆ với PostgreSQL 16 và TRUNCATE đi lọt — hardening đòi chốt VÔ ĐIỀU KIỆN", async () => {
    // Cùng cơ chế ADR-036 ⑳ trên vế TRUNCATE: bảng LÀ chỉ-ghi-thêm (hai trigger canh vô điều kiện), chốt
    // TRUNCATE tồn tại, ENABLE ALWAYS, đúng tgtype 34 — chỉ khác một mệnh đề WHEN.
    await db.pool.query(`
      CREATE TABLE public.zz_tr (id int PRIMARY KEY);
      INSERT INTO public.zz_tr VALUES (1);
      CREATE TRIGGER u BEFORE UPDATE ON public.zz_tr FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
      CREATE TRIGGER d BEFORE DELETE ON public.zz_tr FOR EACH ROW EXECUTE FUNCTION public.bid_chi_ghi_them();
      CREATE TRIGGER t BEFORE TRUNCATE ON public.zz_tr FOR EACH STATEMENT WHEN (false) EXECUTE FUNCTION public.bid_chi_ghi_them();
      ALTER TABLE public.zz_tr ENABLE ALWAYS TRIGGER u;
      ALTER TABLE public.zz_tr ENABLE ALWAYS TRIGGER d;
      ALTER TABLE public.zz_tr ENABLE ALWAYS TRIGGER t;
    `);
    try {
      expect((await db.pool.query<{ relname: string }>(VI_TU_BANG_CHI_GHI_THEM)).rows.some((r) => r.relname === "zz_tr"), "bảng LÀ chỉ-ghi-thêm").toBe(true);
      expect(await thu(db, "UPDATE public.zz_tr SET id = 2")).toMatch(/^NÉM/);
      expect(await thu(db, "TRUNCATE public.zz_tr"), "TRUNCATE đi lọt qua chốt có WHEN (false)").toBe("OK");
      expect((await db.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM public.zz_tr")).rows[0]?.n).toBe("0");
      const kq = await migrateLai(db);
      expect(kq).toMatch(/^NÉM/);
      expect(kq).toContain("chốt TRUNCATE");
      // [lượt soi 27, INFO-6] hai lớp cho một ca: vế chốt TRUNCATE và mục phán xét mới đều nêu tên trigger.
      expect(kq).toMatch(/zz_tr\.t: [^;]*có mệnh đề WHEN/u);
      expect(kq).toContain("không sửa được 2 mục");
      // Đối chứng: chốt vô điều kiện ⇒ migrate() đi qua.
      await db.pool.query(`
        DROP TRIGGER t ON public.zz_tr;
        CREATE TRIGGER t BEFORE TRUNCATE ON public.zz_tr FOR EACH STATEMENT EXECUTE FUNCTION public.bid_chi_ghi_them();
        ALTER TABLE public.zz_tr ENABLE ALWAYS TRIGGER t;
      `);
      expect(await migrateLai(db)).toBe("OK");
      expect(await thu(db, "TRUNCATE public.zz_tr")).toMatch(/^NÉM/);
    } finally {
      await db.pool.query("DROP TABLE public.zz_tr");
    }
  }, 180000);

  it("[khoản nợ 79] TỔNG ĐIỀU TRA ngôn ngữ trigger: mọi trigger của dự án gọi hàm plpgsql, trừ khi khai — hàm internal/C vô hình với mọi tổng điều tra khác (ADR-036 ㉑)", async () => {
    // [lượt soi 25a #2] Mọi tổng điều tra ở tệp này lọc `lanname = 'plpgsql'`. Lý do ấy đúng cho vị từ HÌNH
    // DẠNG (prosrc của hàm C là tên symbol, không có RETURN), nhưng nó được kế thừa sang tổng điều tra — nơi
    // tiêu chí phải "không lách được bằng cách viết" (ADR-036 §3⑵). Một trigger gọi hàm KHÔNG plpgsql
    // (built-in `suppress_redundant_updates_trigger`, hàm C từ extension, `LANGUAGE <khác>`) vô hình với
    // census, vị từ và nhân chứng. Tổng điều tra này đếm CHIỀU NGƯỢC: mọi trigger của dự án phải plpgsql,
    // trừ khai đích danh (rỗng). Vế plpgsql ở VI_TU giữ nguyên — lý do đo được của nó vẫn đúng.
    // [lượt soi 27, INFO-5] Vì sao CHỈ Ở TEST trong khi WHEN/UPDATE OF/tgenabled (cùng vòng) vào hardening:
    // ~~tạo hàm internal/C cần superuser, PL tin cậy khác chưa cài — ngoài mô hình đe doạ~~ [S1.37, lượt soi
    // 28] BÁC: chỉ TẠO hàm C cần superuser; GẮN hàm C có sẵn thì không — built-in ở trên, và extension tin
    // cậy `tcn` (hàm trigger C) chủ DB thường cài được (đo); plperl là extension tin cậy, plpython3u thì
    // không. Mục hardening `prolang` là khoản nợ 83⑸.
    const cau = `SELECT (n.nspname OPERATOR(pg_catalog.||) '.' OPERATOR(pg_catalog.||) c.relname OPERATOR(pg_catalog.||) '.' OPERATOR(pg_catalog.||) t.tgname) AS ten,
                        l.lanname::pg_catalog.text AS ngon_ngu
                   FROM pg_trigger t
                   JOIN pg_proc p ON p.oid OPERATOR(pg_catalog.=) t.tgfoid
                   JOIN pg_language l ON l.oid OPERATOR(pg_catalog.=) p.prolang
                   JOIN pg_class c ON c.oid OPERATOR(pg_catalog.=) t.tgrelid
                   JOIN pg_namespace n ON n.oid OPERATOR(pg_catalog.=) c.relnamespace
                  WHERE NOT t.tgisinternal
                    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                    AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp%'
                  ORDER BY 1`;
    const { rows } = await db.pool.query<{ ten: string; ngon_ngu: string }>(cau);
    expect(rows.filter((r) => r.ngon_ngu === "plpgsql").length, "câu truy vấn đang mù").toBeGreaterThan(30);
    const khac = rows.filter((r) => r.ngon_ngu !== "plpgsql").map((r) => `${r.ten} (${r.ngon_ngu})`);
    expect(
      khac.filter((t) => !TRIGGER_NGOAI_PLPGSQL_DA_KHAI.includes(t)),
      "Một trigger gọi hàm KHÔNG plpgsql vừa ra đời — nó vô hình với tổng điều tra hàm, vị từ chỉ-ghi-thêm và nhân " +
        "chứng. Khai đích danh kèm lý do, hoặc viết lại bằng plpgsql.",
    ).toEqual([]);
    expect(TRIGGER_NGOAI_PLPGSQL_DA_KHAI.filter((t) => !khac.includes(t)), "khai một trigger không còn có").toEqual([]);
    // Đối chứng dương + cơ chế, hoàn tác: chính hàm built-in của PostgreSQL.
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "CREATE TABLE public.zz_srut (id int PRIMARY KEY, g text); INSERT INTO public.zz_srut VALUES (1, 'a'); " +
          "CREATE TRIGGER s BEFORE UPDATE ON public.zz_srut FOR EACH ROW EXECUTE FUNCTION suppress_redundant_updates_trigger()",
      );
      expect((await c.query("UPDATE public.zz_srut SET g = 'a' WHERE id = 1")).rowCount, "UPDATE cùng giá trị: 0 hàng, KHÔNG lỗi").toBe(0);
      expect((await c.query("UPDATE public.zz_srut SET g = 'b' WHERE id = 1")).rowCount).toBe(1);
      const { rows: sau } = await c.query<{ ten: string; ngon_ngu: string }>(cau);
      expect(sau.find((r) => r.ten === "public.zz_srut.s")?.ngon_ngu, "tổng điều tra ngôn ngữ phải THẤY nó").toBe("internal");
      // Và tập rộng (lọc plpgsql) KHÔNG thấy — đúng lý do tổng điều tra này tồn tại.
      const rong = await c.query<{ ten: string }>(CAU_TAP_RONG);
      expect(rong.rows.some((r) => r.ten.includes("suppress_redundant_updates_trigger"))).toBe(false);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  }, 180000);

  it("[khoản nợ 83⑷⑸⑹ + 82⑴] HAI BẢN KHỚP: ~~ba~~ [S1.40] bốn danh sách khai ở hardening bằng bản ở test, và bộ giải hằng giải được cả ~~năm~~ sáu câu phán xét", () => {
    expect(docHangHardening("QUAN_HE_KHAC_KHAI")).toBe(khoiValues(QUAN_HE_KHAC_DA_KHAI.map((t) => t.split(".") as [string, string]), "q", ["nspname", "relname"]));
    expect(docHangHardening("KE_THUA_KHAI")).toBe(khoiValues(
      KE_THUA_DA_KHAI.map((t) => { const [con, cha] = t.split(" INHERITS "); return [...con!.split("."), ...cha!.split(".")] as [string, string, string, string]; }),
      "k", ["con_nspname", "con_relname", "cha_nspname", "cha_relname"]));
    expect(docHangHardening("TRIGGER_NGOAI_PLPGSQL_KHAI")).toBe(khoiValues(
      TRIGGER_NGOAI_PLPGSQL_DA_KHAI.map((t) => t.replace(/ \(.*\)$/u, "").split(".") as [string, string, string]), "g", ["nspname", "relname", "tgname"]));
    expect(docHangHardening("RULE_KHAI")).toBe(khoiValues(
      RULE_DA_KHAI.map((t) => { const [bang, rule] = t.split("/"); return [...bang!.split("."), rule!] as [string, string, string]; }), "r", ["nspname", "relname", "rulename"]));
    for (const ten of ["CAU_QUAN_HE_KHAC_SAI", "CAU_TRIGGER_NGOAI_PLPGSQL_SAI", "CAU_RULE_SAI", "CAU_HAM_CANH_HINH_THUC_SAI", "CAU_PARAMETER_ACL_SAI", "CAU_KE_THUA_SAI"]) {
      expect(docHangHardening(ten).length, ten).toBeGreaterThan(200);
    }
    // [lượt soi 30, NHẸ-2] vị từ hàm canh là MỘT hằng, cả hai mục trigger-canh (S1.36, S1.39) tham chiếu nó — và danh
    // sách tên trong hằng ấy bằng HAM_CANH_CHI_GHI_THEM.
    for (const ten of ["CAU_TRIGGER_CANH_CO_DIEU_KIEN", "CAU_HAM_CANH_HINH_THUC_SAI"]) {
      expect(HARDENING, `${ten} phải tham chiếu VI_TU_HAM_CANH_HINH_DANG`).toMatch(new RegExp(`${ten} constant text :=[\\s\\S]*?VI_TU_HAM_CANH_HINH_DANG[\\s\\S]*?\\$q\\$;`, "u"));
    }
    expect(docHangHardening("VI_TU_HAM_CANH_HINH_DANG")).toContain(`p.proname IN (${HAM_CANH_CHI_GHI_THEM.map((h) => `'${h}'`).join(", ")})`);
  });

  it("[khoản nợ 83⑷⑸⑹⑺⑧] CÂU PHÁN XÉT CỦA HARDENING chạy trong test: hôm nay rỗng cả năm; fixture trong giao dịch cho mỗi cơ chế được THẤY đúng tên, và cái hợp lệ không bị phán", async () => {
    const cau = Object.fromEntries(["CAU_QUAN_HE_KHAC_SAI", "CAU_TRIGGER_NGOAI_PLPGSQL_SAI", "CAU_RULE_SAI", "CAU_HAM_CANH_HINH_THUC_SAI", "CAU_PARAMETER_ACL_SAI"].map((t) => [t, docHangHardening(t)]));
    const ten = async (c: pg.PoolClient | pg.Pool, t: string): Promise<string[]> =>
      (await c.query<{ mo_ta: string }>(cau[t]!)).rows.map((r) => r.mo_ta.split(":")[0]!).sort();
    for (const t of Object.keys(cau)) expect(await ten(db.pool, t), `${t} phải rỗng trên lược đồ hợp lệ`).toEqual([]);
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      // ⑷ — view TRƠN (kể cả security_invoker) và bảng phân mảnh KHÔNG bị phán; view có INSTEAD OF, matview, bảng ngoài thì bị.
      await c.query(`
        CREATE VIEW public.zz_v_tron WITH (security_invoker = true) AS SELECT 1 AS mot;
        CREATE TABLE public.zz_p (id int, org_id uuid) PARTITION BY LIST (org_id);
        CREATE VIEW public.zz_v_nuot AS SELECT 1 AS mot;
        CREATE FUNCTION public.zz_instead() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
        CREATE TRIGGER zz_io INSTEAD OF UPDATE ON public.zz_v_nuot FOR EACH ROW EXECUTE FUNCTION public.zz_instead();
        CREATE MATERIALIZED VIEW public.zz_m AS SELECT 1 AS mot;
      `);
      // [lượt soi 30, INFO-10] fixture bảng ngoài tựa vào contrib `file_fdw` — nói rõ khi image thiếu.
      expect((await c.query("SELECT 1 FROM pg_available_extensions WHERE name = 'file_fdw'")).rowCount, "image PostgreSQL thiếu contrib file_fdw — fixture bảng ngoài không dựng được").toBe(1);
      await c.query(`
        CREATE EXTENSION IF NOT EXISTS file_fdw;
        CREATE SERVER zz_srv FOREIGN DATA WRAPPER file_fdw;
        CREATE FOREIGN TABLE public.zz_f (a int) SERVER zz_srv OPTIONS (filename '/dev/null');
      `);
      expect(await ten(c, "CAU_QUAN_HE_KHAC_SAI")).toEqual(["public.zz_f", "public.zz_m", "public.zz_v_nuot"]);
      // ⑸ — hàm built-in `internal` gắn được không cần tạo hàm; hàm plpgsql thì không bị phán.
      await c.query("CREATE TABLE public.zz_t (id int PRIMARY KEY, g text); CREATE TRIGGER s BEFORE UPDATE ON public.zz_t FOR EACH ROW EXECUTE FUNCTION suppress_redundant_updates_trigger()");
      expect(await ten(c, "CAU_TRIGGER_NGOAI_PLPGSQL_SAI")).toEqual(["public.zz_t.s"]);
      // ⑹ — rule trên bảng KHÔNG chỉ-ghi-thêm (sessions của dự án) bị phán; `_RETURN` của view thì không.
      await c.query("CREATE RULE zz_r AS ON UPDATE TO public.sessions DO INSTEAD NOTHING");
      expect(await ten(c, "CAU_RULE_SAI")).toEqual(["public.sessions.zz_r"]);
      // ⑺ — hàm canh (hình dạng) gắn AFTER ROW và cấp câu lệnh bị phán; trigger TRUNCATE của nó thì không.
      await c.query(`
        CREATE FUNCTION public.zz_canh() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'canh'; END $$;
        CREATE TRIGGER zz_sau AFTER UPDATE ON public.zz_t FOR EACH ROW EXECUTE FUNCTION public.zz_canh();
        CREATE TRIGGER zz_cau BEFORE DELETE ON public.zz_t FOR EACH STATEMENT EXECUTE FUNCTION public.zz_canh();
        CREATE TRIGGER zz_chot BEFORE TRUNCATE ON public.zz_t FOR EACH STATEMENT EXECUTE FUNCTION public.zz_canh();
        CREATE TRIGGER zz_dung BEFORE INSERT ON public.zz_t FOR EACH ROW EXECUTE FUNCTION public.zz_canh();
      `);
      expect(await ten(c, "CAU_HAM_CANH_HINH_THUC_SAI")).toEqual(["zz_t.zz_cau", "zz_t.zz_sau"]);
      // ⑧ — quyền trên tham số cho vai ứng dụng, đích danh hay qua PUBLIC.
      await c.query("GRANT SET ON PARAMETER session_replication_role TO app_api; GRANT ALTER SYSTEM ON PARAMETER work_mem TO PUBLIC");
      expect(await ten(c, "CAU_PARAMETER_ACL_SAI")).toEqual(["session_replication_role", "work_mem"]);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  }, 180000);

  it("[khoản nợ 83⑷⑸⑧] ĐO: migrate() NÉM ở đúng mục — view có INSTEAD OF (⑷), trigger gọi hàm built-in (⑸), GRANT SET ON PARAMETER cho app_api (⑧); đối chứng đi qua sau khi gỡ", async () => {
    await db.pool.query(`
      CREATE VIEW public.zz_v83 AS SELECT 1 AS mot;
      CREATE FUNCTION public.zz_io83() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
      CREATE TRIGGER zz_io INSTEAD OF UPDATE ON public.zz_v83 FOR EACH ROW EXECUTE FUNCTION public.zz_io83();
    `);
    try {
      const kq = await migrateLai(db);
      expect(kq).toMatch(/^NÉM/);
      expect(kq).toContain("public.zz_v83: VIEW có trigger INSTEAD OF (trả NULL là nuốt hàng) trong lược đồ dự án chưa khai (khoản 83⑷");
      await db.pool.query("DROP TRIGGER zz_io ON public.zz_v83");
      expect(await migrateLai(db), "view trơn không bị phán").toBe("OK");
    } finally {
      await db.pool.query("DROP VIEW IF EXISTS public.zz_v83; DROP FUNCTION IF EXISTS public.zz_io83()");
    }
    await db.pool.query("CREATE TABLE public.zz_t83 (id int PRIMARY KEY, g text); CREATE TRIGGER s BEFORE UPDATE ON public.zz_t83 FOR EACH ROW EXECUTE FUNCTION suppress_redundant_updates_trigger()");
    try {
      const kq = await migrateLai(db);
      expect(kq).toMatch(/^NÉM/);
      expect(kq).toContain("public.zz_t83.s: trigger gọi hàm suppress_redundant_updates_trigger() ngôn ngữ internal — không phải plpgsql (khoản 83⑸");
    } finally {
      await db.pool.query("DROP TABLE public.zz_t83");
    }
    await db.pool.query("GRANT SET ON PARAMETER session_replication_role TO app_api");
    try {
      const kq = await migrateLai(db);
      expect(kq).toMatch(/^NÉM/);
      expect(kq).toContain("session_replication_role: quyền SET trên tham số cấp cho app_api (khoản 83⑧");
    } finally {
      await db.pool.query("REVOKE SET ON PARAMETER session_replication_role FROM app_api");
    }
    // [lượt soi 30, NHẸ-3] quyền đến QUA NHÓM: cấp cho một role thứ ba rồi cho app_api làm thành viên — BƯỚC 1 gỡ tư cách
    // thành viên lạ ở lượt sửa, nên migrate() vẫn NÉM nhưng ở mục membership; câu phán xét ⑧ chạy riêng TRƯỚC khi gỡ
    // phải tự thấy (has_parameter_privilege), không tựa vào BƯỚC 1.
    await db.pool.query("CREATE ROLE zz_nhom83; GRANT SET ON PARAMETER work_mem TO zz_nhom83; GRANT zz_nhom83 TO app_api");
    try {
      const thay = (await db.pool.query<{ mo_ta: string }>(docHangHardening("CAU_PARAMETER_ACL_SAI"))).rows.map((r) => r.mo_ta.split(":")[0]);
      expect(thay, "⑧ phải thấy quyền hiệu dụng qua nhóm").toEqual(["work_mem"]);
    } finally {
      await db.pool.query("REVOKE zz_nhom83 FROM app_api; DROP OWNED BY zz_nhom83; DROP ROLE zz_nhom83");
    }
    // [lượt soi 30, NHẸ-4] mức database (superuser) — mục tự chữa RESET.
    const tenDb = (await db.pool.query<{ d: string }>("SELECT current_database() AS d")).rows[0]!.d;
    await db.pool.query(`ALTER DATABASE "${tenDb}" SET session_replication_role = replica`);
    expect(await migrateLai(db), "mục tự chữa: RESET ở lượt sửa, đi qua").toBe("OK");
    expect((await db.pool.query<{ n: string }>("SELECT count(*)::text AS n FROM pg_db_role_setting s WHERE s.setrole = 0 AND EXISTS (SELECT 1 FROM unnest(s.setconfig) c WHERE c LIKE 'session\\_replication\\_role=%')")).rows[0]?.n, "GUC mức database đã bị RESET").toBe("0");
    expect(await migrateLai(db), "đối chứng: gỡ hết ⇒ đi qua").toBe("OK");
  }, 180000);

  it("[khoản nợ 82⑴] TỔNG ĐIỀU TRA kế thừa cổ điển — câu phán xét của hardening chạy trong test: rỗng hôm nay; một cặp INHERITS được THẤY, lá và chỉ mục phân mảnh không; NO INHERIT làm câu ghi qua cha ra 0 hàng (ADR-036 hàng 22) rồi cặp biến khỏi catalog — chiều ngược bắt cặp ĐÃ KHAI", async () => {
    const cau = docHangHardening("CAU_KE_THUA_SAI");
    const ten = async (c: pg.PoolClient | pg.Pool, q: string): Promise<string[]> =>
      (await c.query<{ mo_ta: string }>(q)).rows.map((r) => r.mo_ta.split(":")[0]!).sort();
    expect(await ten(db.pool, cau), "lược đồ thật của dự án không có INHERITS").toEqual([]);
    const c = await db.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`
        CREATE TABLE public.zz_cha (id int, gia int);
        CREATE TABLE public.zz_con () INHERITS (public.zz_cha);
        CREATE TABLE public.zz_pm (id int, org_id uuid) PARTITION BY LIST (org_id);
        CREATE TABLE public.zz_pm_a PARTITION OF public.zz_pm DEFAULT;
        CREATE INDEX zz_pm_idx ON public.zz_pm (id);
        INSERT INTO public.zz_con VALUES (1, 10);
      `);
      expect(await ten(c, cau), "cặp INHERITS bị thấy; lá phân mảnh và chỉ mục phân mảnh (cũng nằm ở pg_inherits) thì không").toEqual(["public.zz_con INHERITS public.zz_cha"]);
      // Chiều ngược: giả lập MỘT dòng khai đúng cặp ấy bằng cách thay khối VALUES rỗng (xuất hiện ở cả hai chiều) của
      // câu đã giải — danh sách thật hôm nay rỗng nên không có cách nào khác để chạy nhánh này trên CSDL thật.
      const khai = cau.replaceAll("(VALUES ('', '', '', '')) AS k(", "(VALUES ('public', 'zz_con', 'public', 'zz_cha')) AS k(");
      expect(khai.split("'zz_con'").length - 1, "khối khai phải được thay ở CẢ HAI chiều").toBe(2);
      expect(await ten(c, khai), "khai đúng cặp đang có ⇒ im cả hai chiều").toEqual([]);
      // ADR-036 hàng 22, đo lại tại chỗ: trước 1 hàng, sau NO INHERIT 0 hàng — không lỗi, con vẫn là bảng thường.
      expect((await c.query("UPDATE public.zz_cha SET gia = 11 WHERE id = 1")).rowCount).toBe(1);
      await c.query("ALTER TABLE public.zz_con NO INHERIT public.zz_cha");
      expect((await c.query("UPDATE public.zz_cha SET gia = 12 WHERE id = 1")).rowCount, "cơ chế hàng 22: 0 hàng, không lỗi").toBe(0);
      expect(await ten(c, cau), "sau NO INHERIT catalog không còn dấu vết — chiều xuôi im: mục này canh TIỀN ĐỀ, không canh cú tách").toEqual([]);
      expect((await c.query<{ mo_ta: string }>(khai)).rows.map((r) => r.mo_ta), "cặp ĐÃ KHAI mà bị tách ⇒ chiều ngược kêu").toEqual([
        expect.stringContaining("khai public.zz_con INHERITS public.zz_cha (khoản 82⑴) mà CSDL không còn cặp kế thừa như thế"),
      ]);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  }, 180000);

  it("[khoản nợ 82⑴] ĐO: migrate() NÉM ở mục kế thừa cho một cặp INHERITS chưa khai; đối chứng: NO INHERIT làm cặp biến mất và migrate() đi qua — đúng giới hạn nói thẳng của mục (canh tiền đề)", async () => {
    await db.pool.query("CREATE TABLE public.zz_cha82 (id int, gia int); CREATE TABLE public.zz_con82 () INHERITS (public.zz_cha82)");
    try {
      const kq = await migrateLai(db);
      expect(kq).toMatch(/^NÉM/);
      expect(kq).toContain("public.zz_con82 INHERITS public.zz_cha82: cặp kế thừa cổ điển (không phải phân mảnh) trong lược đồ dự án chưa khai (khoản 82⑴");
      await db.pool.query("ALTER TABLE public.zz_con82 NO INHERIT public.zz_cha82");
      expect(await migrateLai(db), "đối chứng: không còn cặp ⇒ đi qua").toBe("OK");
    } finally {
      await db.pool.query("DROP TABLE IF EXISTS public.zz_con82; DROP TABLE IF EXISTS public.zz_cha82");
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

      // [S1.33] Tiền đề của cửa sổ đo thứ hai: mỗi hàm có trigger DEFERRABLE chỉ gắn ĐÚNG MỘT trigger
      // trong tập rộng — nếu không, `hoanTat` chạm một bảng khác có thể làm `calls` của nó tăng mà
      // không phải do trigger DEFERRED. Hôm nay 2/2 (017, 018), và vế này phải có ít nhất một người chịu.
      const hoan = tapRong.filter((r) => r.hoan);
      expect(hoan.length, "không trigger DEFERRABLE nào trong tập rộng — vế cửa sổ thứ hai không ai chịu").toBeGreaterThan(0);
      for (const r of hoan) {
        expect(tapRong.filter((x) => x.ham === r.ham), `${r.ham} DEFERRED mà gắn nhiều trigger — cửa sổ thứ hai không quy được cho trigger nào`).toHaveLength(1);
        // [lượt soi 23, NHẸ-5] …và trigger ấy mang ĐÚNG MỘT sự kiện: `AFTER INSERT OR UPDATE` là một hàng
        // nhưng hai sự kiện, và một `hoanTat` UPDATE sẽ làm hàm cháy vì UPDATE mà được ghi công cho INSERT.
        expect(Number(r.ins) + Number(r.upd) + Number(r.del), `${r.ham} DEFERRED mang nhiều sự kiện`).toBe(1);
      }
      // Đối chứng cho sự kiện mới: cửa sổ INSERT không rỗng ruột, và hai hàm DEFERRABLE được ghi công thật.
      expect([...so.ghiCong.keys()].filter((k) => k.endsWith("/INSERT")).length, "không bộ ba INSERT nào được ghi công").toBeGreaterThan(0);
      for (const r of hoan) expect(so.ghiCong.has(`${r.ham}/${r.bang}/INSERT`), `${r.ham} DEFERRABLE không được ghi công ở cửa sổ thứ hai`).toBe(true);

      // ⑸ mọi bộ ba mà tập rộng thấy cho một hàm khai KHÔNG-CANH phải có nhân chứng hợp lệ.
      expect(
        so.chuaCoNhanChung(HAM_KHONG_PHAI_CANH),
        "Bộ ba (hàm, bảng, sự kiện) này được khai là KHÔNG phải hàm canh, nhưng không câu INSERT/UPDATE/DELETE " +
          "nào trong kịch bản đi qua được nó trên một hàng thật (với hàm đọc vai: dưới một vai không " +
          "superuser). Hoặc nó LÀ hàm canh (khai sai — chuyển sang HAM_CANH_CHI_GHI_THEM, hay " +
          "HAM_CANH_MOT_SU_KIEN nếu chỉ một sự kiện), hoặc kịch bản chưa có nhân chứng cho nó — thêm " +
          "một câu hợp lệ vào dungKichBan().",
      ).toEqual([]);

      // Hàm canh một sự kiện: lời khai phải suy ra được từ tập rộng, sự kiện nêu tên KHÔNG được có
      // nhân chứng, và phải ĐO được là NÉM từ chính hàm ấy trên một hàng thật của kịch bản.
      for (const [ham, suKien] of Object.entries(HAM_CANH_MOT_SU_KIEN)) {
        // [lượt soi 23, NHẸ-7] Hàng rào đứng ĐẦU vòng: INSERT không thể khai canh-một-sự-kiện cho tới khi
        // có phép đo lời từ chối cho INSERT (cần một hàng mẫu hợp lệ theo bảng) — khoảng trống, ghi ở ADR-036.
        expect(suKien, `${ham} khai canh-một-sự-kiện INSERT — chưa có phép đo lời từ chối cho INSERT; không khai được`).not.toBe("INSERT");
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

  it("[khoản nợ 77] ĐỘT BIẾN: một hàm NUỐT INSERT (`RETURN NULL` vô điều kiện) khai KHÔNG-CANH thì `calls` TĂNG — hàm trả về — nhưng câu chạm 0 hàng, nên vế ⒞ không ghi công và bộ ba ấy ĐỎ; hàm cho hàng đi qua bên cạnh thì được ghi công", async () => {
    // Đây là chỗ INSERT KHÁC hai sự kiện kia: hàm canh UPDATE/DELETE từ chối bằng RAISE (không được
    // đếm — test trên), còn hàm nuốt INSERT trả NULL (ĐƯỢC đếm). Nếu phép đo chỉ dựa vào bộ đếm, lời
    // khai sai này XANH. Vế ⒞ (câu chạm ≥ 1 hàng) là toàn bộ lớp cho cơ chế 15 của ADR-036.
    const nuot = "zz_nuot_chen_khai_sai";
    const qua = "zz_cho_qua";
    const xoaSau = "zz_xoa_sau_khi_dem";
    const bangNuot = "public.zz_bang_nuot";
    const bangQua = "public.zz_bang_qua";
    const bangXoaSau = "public.zz_bang_xoa_sau";
    const c = await db.pool.connect();
    try {
      await c.query(`
        CREATE TABLE ${bangNuot} (id int PRIMARY KEY, ghi text);
        CREATE TABLE ${bangQua} (id int PRIMARY KEY, ghi text);
        CREATE TABLE ${bangXoaSau} (id int PRIMARY KEY, ghi text);
        CREATE FUNCTION public.${nuot}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
        CREATE FUNCTION public.${qua}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
        CREATE FUNCTION public.${xoaSau}() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN DELETE FROM ${bangXoaSau} WHERE id OPERATOR(pg_catalog.=) NEW.id; RETURN NULL; END $$;
        CREATE TRIGGER zz_nuot BEFORE INSERT ON ${bangNuot} FOR EACH ROW EXECUTE FUNCTION public.${nuot}();
        CREATE TRIGGER zz_qua BEFORE INSERT ON ${bangQua} FOR EACH ROW EXECUTE FUNCTION public.${qua}();
        CREATE TRIGGER zz_xoa_sau AFTER INSERT ON ${bangXoaSau} FOR EACH ROW EXECUTE FUNCTION public.${xoaSau}();
      `);
      await c.query("SET track_functions = 'pl'");
      const tapRong = (await c.query<HangTapRong>(CAU_TAP_RONG_THEO_BANG)).rows;
      expect(tapRong.filter((r) => r.ham === `public.${nuot}`).map((r) => `${r.bang}/${r.ins ? "INSERT" : "?"}`)).toEqual([`${bangNuot}/INSERT`]);
      const so = new SoNhanChung(c, tapRong);

      // Vế chịu lực, đo trực tiếp: hàm nuốt KHÔNG ném, `calls` TĂNG, và câu trả `INSERT 0 0`.
      await c.query("BEGIN");
      try {
        const truoc = (await demGoiTrongGiaoDich(c)).get(`public.${nuot}`) ?? 0;
        const kq = await c.query(`INSERT INTO ${bangNuot} VALUES (1, 'a') RETURNING id`);
        expect([kq.rowCount, kq.rows.length], "INSERT 0 0, RETURNING rỗng, KHÔNG lỗi").toEqual([0, 0]);
        expect((await demGoiTrongGiaoDich(c)).get(`public.${nuot}`) ?? 0, "hàm nuốt trả về nên ĐƯỢC đếm — bộ đếm một mình sẽ ghi công sai").toBe(truoc + 1);
      } finally {
        await c.query("ROLLBACK");
      }

      // Qua nhân chứng: hàm nuốt không được ghi công (⒞), hàm cho qua thì có — cùng khuôn, khác kết quả.
      expect((await so.chung(bangNuot, "INSERT", cau(`INSERT INTO ${bangNuot} VALUES (2, 'b') RETURNING id`, []))).rowCount).toBe(0);
      expect((await so.chung(bangQua, "INSERT", cau(`INSERT INTO ${bangQua} VALUES (1, 'a') RETURNING id`, []))).rowCount).toBe(1);
      expect(so.chuaCoNhanChung([`public.${nuot}`, `public.${qua}`])).toEqual([`public.${nuot}/${bangNuot}/INSERT`]);
      // Và bảng nuốt thật sự rỗng sau hai lần "chèn": không ai ghi gì, không ai báo gì.
      expect((await c.query<{ n: string }>(`SELECT pg_catalog.count(*)::pg_catalog.text AS n FROM ${bangNuot}`)).rows[0]?.n).toBe("0");

      // [lượt soi 23, NẶNG-1] Nuốt SAU KHI ĐẾM: trigger AFTER INSERT xoá đúng hàng vừa vào. `rowCount` = 1,
      // `RETURNING` có hàng, `calls` tăng — ba vế ⒜⒝⒞ đều xanh, và bảng rỗng. Đo: n_tup_ins 1, n_tup_del 1.
      await c.query("BEGIN");
      try {
        const truoc = await demHangTrongGiaoDich(c, bangXoaSau);
        const kq = await c.query(`INSERT INTO ${bangXoaSau} VALUES (1, 'a') RETURNING id`);
        expect([kq.rowCount, kq.rows.length], "câu báo 1 hàng, RETURNING đầy đủ").toEqual([1, 1]);
        expect(hieuHang(await demHangTrongGiaoDich(c, bangXoaSau), truoc)).toEqual({ ins: 1, upd: 0, del: 1 });
        expect((await c.query<{ n: string }>(`SELECT pg_catalog.count(*)::pg_catalog.text AS n FROM ${bangXoaSau}`)).rows[0]?.n).toBe("0");
      } finally {
        await c.query("ROLLBACK");
      }
      // Nên vế ⒞′ (bộ đếm BẢNG) là lớp: nhân chứng NÉM và nêu đúng ba con số, không ghi công, không im lặng.
      const loi = await loiCua(() => so.chung(bangXoaSau, "INSERT", cau(`INSERT INTO ${bangXoaSau} VALUES (2, 'b') RETURNING id`, [])));
      expect(loi?.message ?? "").toContain("câu báo 1 hàng nhưng bảng ghi nhận ins/upd/del = 1/0/1");
      expect(so.chuaCoNhanChung([`public.${xoaSau}`])).toEqual([`public.${xoaSau}/${bangXoaSau}/INSERT`]);
    } finally {
      c.release(true);
      await db.pool.query(
        `DROP TABLE IF EXISTS ${bangNuot}; DROP TABLE IF EXISTS ${bangQua}; DROP TABLE IF EXISTS ${bangXoaSau}; ` +
          `DROP FUNCTION IF EXISTS public.${nuot}(); DROP FUNCTION IF EXISTS public.${qua}(); DROP FUNCTION IF EXISTS public.${xoaSau}();`,
      );
    }
  }, 180000);

  it("[lượt soi 23] ĐỐI CHỨNG DƯƠNG cho vị từ nhạy vai: một hàm trigger KHÔNG đọc vai trực tiếp mà gọi một vị từ BỌC (khuôn 037) phải bị THẤY là nhạy vai; hàm không đọc vai thì không", async () => {
    const boc = "zz_vi_tu_boc";
    const goi = "zz_goi_vi_tu_boc";
    const tho = "zz_khong_doc_vai";
    const bang = "public.zz_bang_nhay_vai";
    await db.pool.query(`
      CREATE TABLE ${bang} (id int PRIMARY KEY);
      CREATE FUNCTION public.${boc}() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_role OPERATOR(pg_catalog.=) 'app_api'::pg_catalog.name $$;
      CREATE FUNCTION public.${goi}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF public.${boc}() THEN RAISE EXCEPTION 'khong cho app_api'; END IF; RETURN NEW; END $$;
      CREATE FUNCTION public.${tho}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      CREATE TRIGGER zz_goi BEFORE INSERT ON ${bang} FOR EACH ROW EXECUTE FUNCTION public.${goi}();
      CREATE TRIGGER zz_tho BEFORE UPDATE ON ${bang} FOR EACH ROW EXECUTE FUNCTION public.${tho}();
    `);
    try {
      const tapRong = (await db.pool.query<HangTapRong>(CAU_TAP_RONG_THEO_BANG)).rows.filter((r) => r.bang === bang);
      expect(tapRong.map((r) => [r.ham, r.nhay_vai]).sort()).toEqual([
        [`public.${goi}`, true],
        [`public.${tho}`, false],
      ]);
      // Regex trực tiếp không thấy hàm gọi (thân nó chỉ có tên hàm bọc) — chính bao đóng bậc một thấy.
      const { rows } = await db.pool.query<{ truc_tiep: boolean }>(
        `SELECT (p.prosrc OPERATOR(pg_catalog.~*) '${RE_NHAY_VAI}') AS truc_tiep FROM pg_proc p WHERE p.proname OPERATOR(pg_catalog.=) $1`,
        [goi],
      );
      expect(rows[0]?.truc_tiep).toBe(false);
    } finally {
      await db.pool.query(
        `DROP TABLE IF EXISTS ${bang}; DROP FUNCTION IF EXISTS public.${goi}(); DROP FUNCTION IF EXISTS public.${tho}(); DROP FUNCTION IF EXISTS public.${boc}();`,
      );
    }
  }, 180000);

  it("[khoản nợ 77] ĐO: constraint trigger DEFERRED chạy ở SET CONSTRAINTS ALL IMMEDIATE — được ghi công ở CỬA SỔ THỨ HAI và không ở cửa sổ đầu; hàm DEFERRED mà ném thì nhân chứng NÉM, không im lặng", async () => {
    // [lượt soi 21] từng nói hàm DEFERRABLE "ngoài phép đo"; đây là phép đo ấy. Hai hàm: một trả NULL
    // (đi qua), một RAISE nếu bảng phụ chưa có hàng — đúng khuôn 018 `bid_phai_co_bien_nhan`.
    const qua = "zz_hoan_qua";
    const canh = "zz_hoan_canh";
    const ngay = "zz_hoan_ngay";
    const bang = "public.zz_bang_hoan";
    const bangPhu = "public.zz_bang_hoan_phu";
    const c = await db.pool.connect();
    try {
      await c.query(`
        CREATE TABLE ${bang} (id int PRIMARY KEY, ghi text);
        CREATE TABLE ${bangPhu} (id int PRIMARY KEY, cha int NOT NULL);
        CREATE FUNCTION public.${qua}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
        CREATE FUNCTION public.${canh}() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NOT EXISTS (SELECT 1 FROM ${bangPhu} p WHERE p.cha OPERATOR(pg_catalog.=) NEW.id) THEN
              RAISE EXCEPTION 'zz_bang_hoan: thieu hang phu trong cung giao dich';
            END IF;
            RETURN NULL;
          END $$;
        CREATE CONSTRAINT TRIGGER zz_hoan_qua AFTER INSERT ON ${bang} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.${qua}();
        CREATE CONSTRAINT TRIGGER zz_hoan_canh AFTER INSERT ON ${bang} DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.${canh}();
        CREATE FUNCTION public.${ngay}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
        CREATE CONSTRAINT TRIGGER zz_hoan_ngay AFTER INSERT ON ${bang} DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION public.${ngay}();
      `);
      await c.query("SET track_functions = 'pl'");
      const tapRong = (await c.query<HangTapRong>(CAU_TAP_RONG_THEO_BANG)).rows;
      const hoan = tapRong.filter((r) => r.bang === bang);
      // [lượt soi 23, NHẸ-4] DEFERRABLE INITIALLY IMMEDIATE không phải "hoãn": nó chạy cuối câu, cửa sổ đầu.
      expect(hoan.map((r) => [r.ham, r.hoan, r.ins]).sort()).toEqual([
        [`public.${canh}`, true, true],
        [`public.${ngay}`, false, true],
        [`public.${qua}`, true, true],
      ]);
      const so = new SoNhanChung(c, tapRong);

      // Không `hoanTat` ⇒ hàm canh DEFERRED ném ở SET CONSTRAINTS — từ chính nó, và nhân chứng ném ra ngoài.
      const loi = await loiCua(() => so.chung(bang, "INSERT", cau(`INSERT INTO ${bang} VALUES (1, 'a') RETURNING id`, [])));
      expect(loi?.where ?? "", "lời từ chối phải đến từ hàm DEFERRED").toContain(canh);
      expect(so.ghiCong.size, "một nhân chứng ném thì không ai được ghi công").toBe(0);

      // Có `hoanTat` chèn hàng phụ ⇒ cả hai hàm DEFERRED chạy ở cửa sổ thứ hai và được ghi công.
      await so.chung(bang, "INSERT", {
        ...cau(`INSERT INTO ${bang} VALUES (2, 'b') RETURNING id`, []),
        hoanTat: async (cc, kq) => {
          await cc.query(`INSERT INTO ${bangPhu} VALUES (1, $1)`, [(kq.rows[0] as { readonly id: number }).id]);
        },
      });
      expect(so.chuaCoNhanChung([`public.${qua}`, `public.${canh}`, `public.${ngay}`])).toEqual([]);

      // Đối chứng cửa sổ: hàm DEFERRED chỉ tăng SAU SET CONSTRAINTS — đo trực tiếp quanh hai mốc.
      await c.query("BEGIN");
      try {
        const truoc = (await demGoiTrongGiaoDich(c)).get(`public.${qua}`) ?? 0;
        await c.query(`INSERT INTO ${bang} VALUES (3, 'c')`);
        await c.query(`INSERT INTO ${bangPhu} VALUES (2, 3)`);
        expect((await demGoiTrongGiaoDich(c)).get(`public.${qua}`) ?? 0, "trước SET CONSTRAINTS: chưa chạy").toBe(truoc);
        await c.query("SET CONSTRAINTS ALL IMMEDIATE");
        expect((await demGoiTrongGiaoDich(c)).get(`public.${qua}`) ?? 0, "sau SET CONSTRAINTS: đã chạy").toBe(truoc + 1);
      } finally {
        await c.query("ROLLBACK");
      }
    } finally {
      c.release(true);
      await db.pool.query(
        `DROP TABLE IF EXISTS ${bangPhu}; DROP TABLE IF EXISTS ${bang}; DROP FUNCTION IF EXISTS public.${qua}(); DROP FUNCTION IF EXISTS public.${canh}(); DROP FUNCTION IF EXISTS public.${ngay}();`,
      );
    }
  }, 180000);
});
