// ==============================================================================================
// [khoản 109] PHẦN CẤM CỦA SEARCH PATH HIỆU LỰC LÀ BẤT BIẾN — KIỂM NÓ TUYỆT ĐỐI
//
// `ganVaiChoClient` (`packages/db`) và `withTenant` (`packages/tenancy`) so search path hiệu lực
// TƯƠNG ĐỐI — với mốc của chính kết nối, hay với lúc mở giao dịch — vì *"giá trị hợp lệ không bất
// biến"* (S1.54, S1.59). Khoản 109 đo rằng câu ấy đúng một nửa: GIÁ TRỊ hợp lệ thì không bất biến,
// nhưng phần CẤM thì có. Một mặc định vai `public, pg_catalog` hay một `ALTER SYSTEM SET search_path
// = ke_gian, public` đặt giữa hai lần deploy lấy mốc ngay từ lần lấy ĐẦU của kết nối, nên phép so
// tương đối không bao giờ thấy nó (đo S1.66).
//
// Ba điều cấm, đọc trên mảng `current_schemas(false)` — tức search path đã PHÂN GIẢI, không phải
// chuỗi GUC ([INV-H21] chỉ cho `migrate.ts` nêu tên GUC trong SQL):
//   ⑴ `public` phải có mặt — mọi đối tượng của dự án ở đó;
//   ⑵ đứng TRƯỚC `public` chỉ được là `pg_catalog` hay schema trùng tên vai hiện tại (`"$user"`);
//   ⑶ `pg_catalog` KHÔNG được đứng SAU `public` — khi nó có mặt tường minh, PostgreSQL thôi tìm nó
//      ngầm ở đầu, và một `public.lower(text)` sẽ thắng `pg_catalog.lower(text)` với tên trần.
// Schema đứng SAU `public` (khác `pg_catalog`) không bị cấm ở đây: phần ấy vẫn do phép so tương đối
// canh, đúng như khoản 109 đề xuất ("giữ so tương đối phần còn lại").
//
// Tệp này là hàm THUẦN: không kết nối, không SQL. `ganVaiTroChoPool` gọi nó trên chuỗi mà câu của chính
// nó đã đọc — không thêm vòng đi-về nào.
//
// VÌ SAO CHỈ Ở `ganVaiTroChoPool`, KHÔNG Ở `withTenant` — một quyết định, đo được: bản đầu đặt phép kiểm ở CẢ HAI
// và mười lăm test QT3 (`packages/{audit,identity,outbox,tenancy}`) đỏ — chúng dựng một pool KHÔNG vai dưới search
// path thù địch để đo lớp ghim `pg_catalog.` NẰM DƯỚI, và phép kiểm ở `withTenant` chặn trước khi tới lớp ấy. Mọi
// pool của mã sản xuất đều có vai (vế ⒜ của `tests/architecture/duong-sql-ngoai-with-tenant.test.ts`), nên đường sản
// xuất nào cũng đi qua `ganVaiTroChoPool`; pool không vai chỉ còn ở test, và đó chính là chỗ lớp ghim cần được đo.
// ==============================================================================================

/**
 * Tách một mảng văn bản PostgreSQL (`{a,"b c",d}`) thành phần tử. Chỉ đủ cho tên schema: dấu nháy
 * kép bao phần tử có ký tự đặc biệt, và `\` thoát ký tự kế trong phần tử có nháy.
 */
export function tachMangVanBan(vanBan: string): string[] {
  if (!vanBan.startsWith("{") || !vanBan.endsWith("}")) {
    throw new Error("tachMangVanBan: không phải mảng văn bản PostgreSQL.");
  }
  const than = vanBan.slice(1, -1);
  if (than === "") return [];
  const ra: string[] = [];
  let i = 0;
  while (i <= than.length) {
    let phan = "";
    if (than[i] === '"') {
      i += 1;
      while (i < than.length && than[i] !== '"') {
        if (than[i] === "\\") i += 1;
        phan += than[i] ?? "";
        i += 1;
      }
      i += 1; // nháy đóng
    } else {
      while (i < than.length && than[i] !== ",") {
        phan += than[i];
        i += 1;
      }
    }
    ra.push(phan);
    i += 1; // dấu phẩy
  }
  return ra;
}

/**
 * Trả MÔ TẢ vi phạm (chỉ tên điều bị vi phạm, không in schema nào), hay `null` khi hợp lệ.
 *
 * `vai` là `current_user` của cùng câu đọc — schema trùng tên nó là thứ `"$user"` phân giải ra.
 */
export function viPhamLuocDoTuyetDoi(luocDo: string, vai: string): string | null {
  const ds = tachMangVanBan(luocDo);
  const viTriPublic = ds.indexOf("public");
  if (viTriPublic < 0) return "search path hiệu lực không có public";
  if (ds.slice(0, viTriPublic).some((s) => s !== "pg_catalog" && s !== vai)) {
    return "search path hiệu lực có schema lạ đứng trước public";
  }
  if (ds.slice(viTriPublic + 1).includes("pg_catalog")) {
    return "search path hiệu lực đặt pg_catalog sau public";
  }
  return null;
}
