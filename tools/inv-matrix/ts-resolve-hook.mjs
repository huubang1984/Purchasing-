// Hook resolve ESM: thử ánh xạ ".js" -> ".ts" khi specifier không tìm thấy module.
//
// BẢN SAO CÓ CHỦ Ý của `tools/bench-keyprovider/ts-resolve-hook.mjs`, không phải sơ suất.
// Hai tool là hai tiện ích dev độc lập; để `tools/inv-matrix` import file của
// `tools/bench-keyprovider` sẽ tạo một CẠNH PHỤ THUỘC giữa hai tool mà `depcruise` phải
// bless — đổi mười chín dòng trùng lặp lấy một quy tắc kiến trúc mới là đổi sai chiều.
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
