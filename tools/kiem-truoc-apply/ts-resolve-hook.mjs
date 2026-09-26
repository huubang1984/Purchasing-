// Hook resolve ESM: thử ánh xạ ".js" -> ".ts" khi specifier không tìm thấy module.
//
// BẢN SAO CÓ CHỦ Ý thứ MƯỜI MỘT của cùng hook (lý do ghi ở đầu `tools/inv-matrix/ts-resolve-hook.mjs`: để hai tool
// không sinh ra một cạnh phụ thuộc lẫn nhau mà depcruise phải bless), cho `pnpm kiem-truoc-apply`.
//
// Mã nguồn import bằng đuôi ".js" dù tệp là ".ts" (NodeNext); `node --experimental-transform-types` chỉ bóc cú pháp
// TypeScript, không ánh xạ đuôi. Resolve gốc thành công hoặc lỗi khác "không tìm thấy module" ⇒ hook không can thiệp.
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
