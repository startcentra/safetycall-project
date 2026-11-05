import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const expected = [
  "package.json", "tsconfig.json", ".gitignore", ".env.example", "README.md",
  "src/app/page.tsx", "src/app/layout.tsx", "src/app/api/health/route.ts",
  "src/components/dashboard.tsx", "src/components/simulator.tsx", "src/app/simulator/page.tsx", "src/modules/simulation/engine.ts", "src/app/api/simulations/route.ts", "tests/simulation.test.ts", "src/lib/contracts.ts", "docs/PRD.md",
  "docs/ARCHITECTURE.md", "docs/API_CONTRACT.md", "docs/SAFETY_POLICY.md",
];
for (const file of expected) {
  if (!existsSync(join(root, file))) throw new Error(`필수 파일 누락: ${file}`);
}
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tsconfig = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"));
if (!pkg.private || !tsconfig.compilerOptions.strict) throw new Error("private 또는 strict 설정 오류");
const ignore = readFileSync(join(root, ".gitignore"), "utf8");
if (!ignore.includes(".env.*") || !ignore.includes("node_modules/")) throw new Error(".gitignore 검토 필요");
if (existsSync(join(root, ".env.local"))) throw new Error("실제 비밀 환경변수 파일 발견: ZIP 배포 전 점검 필요");
const dirs = ["src", "docs", "tests"];
for (const dir of dirs) { if (!readdirSync(join(root, dir)).length) throw new Error(`${dir} 폴더 비어 있음`); }
console.log(`정적 파일 검사 통과: ${expected.length}개 필수 파일, private/strict, .gitignore`);
console.log("참고: 이 검사는 npm install, TypeScript 타입검사, 브라우저/빌드 테스트를 대체하지 않습니다.");
