const fs = require('fs');
let c = fs.readFileSync('src/app/admin/dashboard/page.tsx', 'utf8');
c = c.replace(/\\`/g, '`');
fs.writeFileSync('src/app/admin/dashboard/page.tsx', c);
console.log('Fixed page.tsx');

let api = fs.readFileSync('src/app/api/admin/dashboard/route.ts', 'utf8');
api = api.replace(/\\`/g, '`');
fs.writeFileSync('src/app/api/admin/dashboard/route.ts', api);
console.log('Fixed route.ts');
