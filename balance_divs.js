const fs = require('fs');

const path = 'src/app/artisan/insights/page.tsx';
let code = fs.readFileSync(path, 'utf8');

// Let's count <div and </div
const openDivs = (code.match(/<div(\s|>)/g) || []).length;
const closeDivs = (code.match(/<\/div>/g) || []).length;

console.log(`Open divs: ${openDivs}, Close divs: ${closeDivs}`);

if (openDivs > closeDivs) {
  const diff = openDivs - closeDivs;
  console.log(`Missing ${diff} closing divs. Appending them before the final closing tag.`);
  
  // Find the end of the return statement
  const endOfReturn = code.lastIndexOf(');');
  if (endOfReturn !== -1) {
    const missingDivs = '</div>\n'.repeat(diff);
    code = code.substring(0, endOfReturn) + missingDivs + code.substring(endOfReturn);
    fs.writeFileSync(path, code);
  }
} else if (closeDivs > openDivs) {
  const diff = closeDivs - openDivs;
  console.log(`Extra ${diff} closing divs. Removing the last ones.`);
  
  // We'll just remove the first `</div>` instances found near the error line or at the end.
  // Actually, easiest is to remove them from right before `</main>` or similar.
  // But wait, the error is at line 188. Let's just remove one `</div>` from the map container end.
  code = code.replace('</div> {/* End Inner Map Wrapper */}\n            </div> {/* End Outer Container */}', '</div> {/* End Inner/Outer Map Wrapper */}');
  fs.writeFileSync(path, code);
}
