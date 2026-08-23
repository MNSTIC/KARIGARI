const fs = require('fs');

// 1. Fix Insights page duplicate divs
let insights = fs.readFileSync('src/app/artisan/insights/page.tsx', 'utf8');
insights = insights.replace(`              </div>
            </div>

            </div> {/* End Inner Map Wrapper */}
            </div> {/* End Outer Container */}`, `              </div>
            </div> {/* End Inner Map Wrapper */}
            </div> {/* End Outer Container */}`);
fs.writeFileSync('src/app/artisan/insights/page.tsx', insights);

// 2. Fix Market API jwt import
let marketRoute = fs.readFileSync('src/app/api/items/market/route.ts', 'utf8');
marketRoute = marketRoute.replace(`import { verifyJwt } from '@/lib/jwt';`, `import jwt from 'jsonwebtoken';`);
marketRoute = marketRoute.replace(`const payload = verifyJwt(token);`, `const payload = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret') as any;`);
fs.writeFileSync('src/app/api/items/market/route.ts', marketRoute);
console.log("Fixes applied");
