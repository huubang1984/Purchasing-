// Hook resolve ESM: thử ánh xạ ".js" -> ".ts" khi specifier không tìm thấy module.
//
// BẢN SAO CÓ CHỦ Ý của `apps/api/ts-resolve-hook.mjs`, không phải sơ suất.
// [S1.128 / khoản 15] `apps/public-keys` là app CHỈ ĐỌC với danh sách phụ thuộc ghim ngắn có chủ ý;
// cho nó import một tệp của `apps/api` để dùng chung hook là tạo một CẠNH PHỤ THUỘC giữa hai app
// mà `depcruise` phải bless — và kéo tiến trình công bố khoá lại gần cây nghiệp vụ của `api`.
// Đổi mười chín dòng trùng lặp lấy một cạnh như thế là đổi sai chiều.
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
