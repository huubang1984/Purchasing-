// [ADR-084] Sinh `lambda/canh-moc-neo.mjs` = `src/canh-moc-neo.ts` gỡ kiểu (Node `module.stripTypeScriptTypes`, chế độ
// "strip": chỉ thay kiểu bằng khoảng trắng, giữ nguyên dòng — lỗi trên Lambda chỉ đúng dòng của tệp nguồn).
// `pnpm neo:dong-goi-lambda`; `src/canh-moc-neo.test.ts` đòi tệp sinh ra trùng byte với nguồn hiện tại.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const nguon = new URL("./src/canh-moc-neo.ts", import.meta.url);
const dich = new URL("./lambda/canh-moc-neo.mjs", import.meta.url);
mkdirSync(new URL("./lambda/", import.meta.url), { recursive: true });
writeFileSync(dich, stripTypeScriptTypes(readFileSync(nguon, "utf8"), { mode: "strip" }));
console.error("da ghi tools/neo-so-kiem-toan/lambda/canh-moc-neo.mjs");
