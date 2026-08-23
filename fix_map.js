const fs = require('fs');

const path = 'src/app/artisan/insights/page.tsx';
let content = fs.readFileSync(path, 'utf8');

const oldMapContainer = `<div className="relative w-full aspect-[4/3] sm:aspect-[21/9] bg-[#E8F0F2] rounded-2xl border border-gray-200 overflow-hidden shadow-inner">
              <Image 
                src="https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/India_map_en.svg/1200px-India_map_en.svg.png" 
                alt="India Map"
                fill
                className="object-contain opacity-40 mix-blend-multiply p-4"
              />`;

const newMapContainer = `<div className="relative w-full bg-[#E8F0F2] rounded-2xl border border-gray-200 overflow-hidden shadow-inner flex items-center justify-center p-4 min-h-[400px]">
              {/* Inner wrapper with strict aspect ratio matching the India SVG */}
              <div className="relative w-full max-w-[400px] aspect-[8/9]">
                <Image 
                  src="https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/India_map_en.svg/1200px-India_map_en.svg.png" 
                  alt="India Map"
                  fill
                  className="object-contain opacity-40 mix-blend-multiply"
                />`;

// I also need to close the inner div right after the last hotspot.
// The last hotspot is "Local Cluster (High Supply)"
// I'll replace the closing tags.

content = content.replace(oldMapContainer, newMapContainer);

const oldLegend = `{/* Legend */}
            <div className="flex flex-wrap gap-4 mt-6 px-2">`;
const newLegend = `</div> {/* End Inner Map Wrapper */}
            </div> {/* End Outer Container */}

            {/* Legend */}
            <div className="flex flex-wrap gap-4 mt-6 px-2">`;

content = content.replace(oldLegend, newLegend);

// Update coordinates to accurately match the India map SVG bounding box!
// Delhi is roughly Top 25%, Left 38%
content = content.replace('top-[30%] left-[32%]', 'top-[26%] left-[40%]');
// Mumbai is roughly Top 55%, Left 24%
content = content.replace('top-[45%] left-[25%]', 'top-[57%] left-[24%]');
// Bangalore is roughly Top 75%, Left 38%
content = content.replace('top-[65%] left-[35%]', 'top-[74%] left-[37%]');
// Local cluster (Odisha/Bengal) is roughly Top 48%, Left 68%
content = content.replace('top-[50%] left-[60%]', 'top-[50%] left-[70%]');

fs.writeFileSync(path, content);
console.log("Insights map fixed");
