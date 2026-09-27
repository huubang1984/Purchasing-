-- =============================================================================================
-- 9501 — [S1.9101 / khoản 243] TIỀN TỆ CỦA BÁO GIÁ ĐỌC QUA MỘT HÀM, VỀ TẬP ĐÓNG {VND, USD, NULL}
-- =============================================================================================
-- ĐO (vòng S1.9101, Postgres 16 thật, trước khi viết dòng này — biên bản §S1.9101):
--   · báo giá `VND` + `VNĐ` ⇒ lượt chấm ném `LECH_TIEN_TE`, gói đứng yên ở `UNSEALED`;
--   · MỌI báo giá cùng ghi `VNĐ` (kể cả gói một nhà cung cấp) hay cùng ghi `vnd` ⇒ phép so tập
--     trong `luot-danh-gia.ts` cho qua, rồi câu INSERT vỡ ở `CHECK (currency IN ('VND','USD'))`
--     của `057` — 23514 `rfq_evaluations_currency_check`, và API trả một 422 KHÔNG TÊN;
--   · bảng so sánh: trộn cách viết thì mọi phép tổng hợp thành `null`; cùng một cách viết lạ thì
--     `belowBudget` ra 0 thay vì 2 — một con số SAI không để lại dấu.
-- Ô tiền tệ của trang nộp thầu là ô nhập tự do, và phong bì được niêm phong trong trình duyệt:
-- máy chủ không thấy chuỗi ấy trước lúc mở thầu, và `rfq_unsealed_bids` là bảng chỉ-ghi-thêm. Nên
-- lớp DUY NHẤT sửa được mọi cách viết — kể cả của một phong bì dựng ngoài trang — là lớp ĐỌC.
--
-- SỬA: năm chỗ đọc `payload ->> 'currency'` (lượt chấm một chỗ, bảng so sánh bốn chỗ) gọi đúng hàm
-- này, khuôn `bid_so_tien` (`020`, `022`): một luật một chỗ, IMMUTABLE STRICT, không bao giờ ném.
--
-- TẬP ĐÓNG — chủ dự án chốt ngày 2026-09-27 (ADR-9201), khớp CHÍNH XÁC sau khi bỏ khoảng trắng hai
-- đầu và đưa về dạng NFC:
--   VND ← VND · VNĐ · VNđ · Vnđ · vnđ · Vnd · vnd · đ · Đ · ₫ · đồng · Đồng
--   USD ← USD · Usd · usd · US$
-- Mọi chuỗi khác ra NULL, và lượt chấm từ chối NULL bằng một mã có tên (`LECH_TIEN_TE`). Cố ý:
--   · KHÔNG `lower()`/`upper()`: với ký tự ngoài ASCII chúng phụ thuộc thư viện C của cụm — khoản 71
--     đo `Ⓐlice` được nhận trên postgres:16-alpine (musl) và bị từ chối trên postgres:16 (glibc).
--     Danh sách tường minh thì như nhau ở mọi nơi.
--   · `normalize(…, 'NFC')` là hàm của CHÍNH Postgres (bảng Unicode biên dịch cùng máy chủ, IMMUTABLE),
--     không phụ thuộc thư viện C — nó gộp `đồng` gõ dạng tổ hợp (o + dấu mũ + dấu huyền) về dạng dựng
--     sẵn mà bàn phím tiếng Việt thường sinh ra.
--   · Ký tự dễ nhầm KHÔNG được nhận: `Ð` (U+00D0, chữ eth) khác `Đ` (U+0110); `$` trần không nói là
--     đô la nào. Chúng ra NULL — hướng an toàn.
--   · Các ký tự ngoài ASCII viết bằng mã `\u` để người đọc migration không phải đoán byte.
-- Khoảng trắng bỏ ở hai đầu: dấu cách, tab, CR, LF và NBSP (U+00A0) — `btrim()` mặc định chỉ bỏ dấu
-- cách, còn `trim()` của trình duyệt bỏ cả NBSP. Ký tự rộng-bằng-không (U+200B) KHÔNG bị bỏ, và chuỗi
-- mang nó ra NULL.
--
-- Không GRANT: cùng khuôn `bid_so_tien` — hàm thuần, gọi được qua EXECUTE mặc định của PUBLIC (xem
-- khối `[fix S2]` của `001`), và không đọc bảng nào.
-- =============================================================================================
CREATE OR REPLACE FUNCTION public.bid_currency(p_van text) RETURNS text
  LANGUAGE plpgsql IMMUTABLE STRICT
  SET search_path = pg_catalog, public
AS $ham$
DECLARE
  v text;
BEGIN
  BEGIN
    v := pg_catalog.normalize(
           pg_catalog.btrim(p_van, E' \t\r\n' OPERATOR(pg_catalog.||) pg_catalog.chr(160)),
           'NFC');
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  IF v IN ('VND',
           E'VNĐ',        -- VNĐ
           E'VNđ',        -- VNđ
           E'Vnđ',        -- Vnđ
           E'vnđ',        -- vnđ
           'Vnd',
           'vnd',
           E'đ',          -- đ
           E'Đ',          -- Đ
           E'₫',          -- ₫ (ký hiệu đồng)
           E'đồng',  -- đồng
           E'Đồng')  -- Đồng
  THEN
    RETURN 'VND';
  END IF;
  IF v IN ('USD', 'Usd', 'usd', 'US$') THEN
    RETURN 'USD';
  END IF;
  RETURN NULL;
END
$ham$;
