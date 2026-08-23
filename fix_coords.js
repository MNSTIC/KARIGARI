const fs = require('fs');

const path = 'src/app/artisan/insights/page.tsx';
let code = fs.readFileSync(path, 'utf8');

// Update Delhi
code = code.replace('top-[30%] left-[32%]', 'top-[25%] left-[31%]');
// Update Mumbai
code = code.replace('top-[45%] left-[25%]', 'top-[59%] left-[16%]');
// Update Bangalore
code = code.replace('top-[65%] left-[35%]', 'top-[82%] left-[32%]');
// Update Local Cluster
code = code.replace('top-[50%] left-[60%]', 'top-[55%] left-[61%]');

fs.writeFileSync(path, code);
console.log("Coordinates safely updated!");
