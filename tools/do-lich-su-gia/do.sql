-- ==============================================================================================
-- tools/do-lich-su-gia/do.sql — [S1.235 / S4.4a] ĐO THỜI GIAN ĐỌC LỊCH SỬ GIÁ (spec S4 §2.5 ㉓)
--
-- Chạy sau `gieo.sql`, trên cùng CSDL THỬ. Đo DƯỚI VAI `app_api` với tổ chức gắn ở phiên — đúng đường của một route: RLS của
-- mọi bảng áp theo người gọi (`quan_sat_gia` là `SECURITY INVOKER`), nên đo dưới vai chủ cụm (bỏ qua RLS) là đo một đường không
-- tồn tại.
--
-- Mỗi lần đọc là một câu `SELECT … FROM quan_sat_gia(now(), <hàng chuẩn>)` — hàm SQL có `SET search_path` không nội tuyến được,
-- nên thân của nó được lập kế hoạch lại ở MỖI câu, như ở mỗi request. `so_mau` hàng chuẩn chọn ngẫu nhiên, mỗi hàng đọc một lần
-- sau một lượt khởi động. In: số quan sát mỗi lần đọc, p50, p95, lớn nhất (ms); rồi một lần đọc HẾT tổ chức để biết cỡ.
--
--   psql "$URL_CUM_THU" -v so_mau=50 -f tools/do-lich-su-gia/do.sql
-- ==============================================================================================
\set ON_ERROR_STOP on
\if :{?so_mau}
\else
  \set so_mau 50
\endif

SELECT id AS to_chuc FROM organizations WHERE slug LIKE 'do-lsg-%' ORDER BY created_at DESC LIMIT 1 \gset
SELECT set_config('do_lsg.so_mau', :'so_mau', false);
SET ROLE app_api;
SELECT set_config('app.org_id', :'to_chuc', false);

DO $do$
DECLARE
  so_mau  integer := current_setting('do_lsg.so_mau')::integer;
  h       uuid;
  t0      timestamptz;
  n       bigint;
  ms      double precision[] := '{}';
  dem     bigint[] := '{}';
  p50     double precision;
  p95     double precision;
  lon     double precision;
BEGIN
  -- Khởi động: một lần đọc cho ấm bộ đệm — lần đầu đọc đĩa không phải thứ ngưỡng hỏi.
  SELECT count(*) INTO n FROM public.quan_sat_gia(now(), (SELECT id FROM public.canonical_items LIMIT 1));
  FOR h IN SELECT id FROM public.canonical_items ORDER BY random() LIMIT so_mau LOOP
    t0 := clock_timestamp();
    SELECT count(*) INTO n FROM public.quan_sat_gia(now(), h);
    ms := ms || (extract(epoch FROM clock_timestamp() - t0) * 1000)::double precision;
    dem := dem || n;
  END LOOP;
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY x), percentile_cont(0.95) WITHIN GROUP (ORDER BY x), max(x)
    INTO p50, p95, lon
    FROM unnest(ms) x;
  RAISE NOTICE 'doc lich su MOT hang chuan: % lan, quan sat moi lan % .. %, p50 % ms, p95 % ms, lon nhat % ms',
    so_mau, (SELECT min(x) FROM unnest(dem) x), (SELECT max(x) FROM unnest(dem) x), round(p50::numeric, 1), round(p95::numeric, 1),
    round(lon::numeric, 1);

  t0 := clock_timestamp();
  SELECT count(*) INTO n FROM public.quan_sat_gia(now());
  RAISE NOTICE 'doc HET to chuc: % quan sat, % ms', n, round((extract(epoch FROM clock_timestamp() - t0) * 1000)::numeric, 1);
END
$do$;

RESET ROLE;
