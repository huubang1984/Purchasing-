// Hook resolve ESM: thử ánh xạ ".js" -> ".ts" khi specifier không tìm thấy module.
//
// BẢN SAO CÓ CHỦ Ý của `tools/neo-so-kiem-toan/ts-resolve-hook.mjs`, không phải sơ suất.
// Hai tool là hai tiện ích độc lập; để `tools/bo-xuat-danh-gia` import file của
// `tools/neo-so-kiem-toan` sẽ tạo một CẠNH PHỤ THUỘC giữa hai tool mà `depcruise` phải
// bless — đổi mười chín dòng trùng lặp lấy một quy tắc kiến trúc mới là đổi sai chiều.
// Ở ĐÂY cạnh ấy còn đắt hơn thường lệ: `g11-khong-import-nguoc-tu-cong-cu-xuat-neo` cấm
// đúng cạnh đó, vì `tools/neo-so-kiem-toan` giữ khả năng KÝ mốc neo.
//
// Lý do tồn tại: mã nguồn dùng quy ước NodeNext chuẩn — import bằng đuôi ".js" dù file nguồn
// là ".ts". `node --experimental-transform-types` chỉ bóc cú pháp TypeScript, KHÔNG tự ánh xạ
// đuôi file như bộ giải quyết module của vitest/vite vẫn làm. Không đổi hành vi runtime nào
// khác: nếu resolve gốc thành công hoặc lỗi không phải "không tìm thấy module", hook không
// can thiệp.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const khongTimThayModule =
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ERR_MODULE_NOT_FOUND";
    if (specifier.endsWith(".js") && khongTimThayModule) {
      return nextResolve(specifier.replace(/\.js$/, ".ts"), context);
    }
    throw error;
  }
}
