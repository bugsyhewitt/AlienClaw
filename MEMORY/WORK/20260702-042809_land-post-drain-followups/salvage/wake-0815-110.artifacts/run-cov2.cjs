const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const out = execSync(
  'cd /tmp/wake-0815-110 && ./node_modules/.bin/vitest run test/msb/tool-adapters-ssrf.test.ts test/msb/tool-adapters.test.ts --coverage --coverage.provider=v8 --coverage.include=src/alienclaw/msb/tool-adapters.ts --coverage.reporter=json 2>&1',
  { encoding: 'utf8', timeout: 60000 }
);
// Look for the JSON object in the output
const match = out.match(/\{[\s\S]*"tool-adapters\.ts"[\s\S]*\}/);
if (!match) {
  // Try coverage-final.json approach
  try {
    const covPath = '/tmp/wake-0815-110/coverage/coverage-final.json';
    if (fs.existsSync(covPath)) {
      const data = JSON.parse(fs.readFileSync(covPath, 'utf8'));
      const target = Object.keys(data).find(k => k.endsWith('tool-adapters.ts'));
      if (target) {
        const f = data[target];
        const stmtMap = f.statementMap;
        const s = f.s;
        const uncovered = Object.entries(s).filter(([k,v]) => v === 0).map(([k]) => stmtMap[k]).filter(Boolean).map(r => r.start.line);
        console.log('UNCOVERED-STMT-LINES:', JSON.stringify([...new Set(uncovered)].sort((a,b) => a-b)));
        const branchMap = f.branchMap;
        const b = f.b;
        const uncoveredBranches = Object.entries(b).filter(([k, vs]) => vs.some(v => v === 0)).map(([k]) => branchMap[k]).filter(Boolean).map(r => r.loc.start.line);
        console.log('UNCOVERED-BRANCH-LINES:', JSON.stringify([...new Set(uncoveredBranches)].sort((a,b) => a-b)));
        process.exit(0);
      }
    }
  } catch (e) { console.log('ERR:', e.message); }
  console.log('NO-JSON-FOUND. Output last 500:', out.slice(-500));
  process.exit(1);
}
const data = JSON.parse(match[0]);
// navigate to tool-adapters.ts
for (const key of Object.keys(data)) {
  if (key.endsWith('tool-adapters.ts')) {
    const f = data[key];
    const stmtMap = f.statementMap;
    const s = f.s;
    const uncovered = Object.entries(s).filter(([k,v]) => v === 0).map(([k]) => stmtMap[k]).filter(Boolean).map(r => r.start.line);
    console.log('UNCOVERED-STMT-LINES:', JSON.stringify([...new Set(uncovered)].sort((a,b) => a-b)));
    const branchMap = f.branchMap;
    const b = f.b;
    const uncoveredBranches = Object.entries(b).filter(([k, vs]) => vs.some(v => v === 0)).map(([k]) => branchMap[k]).filter(Boolean).map(r => r.loc.start.line);
    console.log('UNCOVERED-BRANCH-LINES:', JSON.stringify([...new Set(uncoveredBranches)].sort((a,b) => a-b)));
    break;
  }
}
