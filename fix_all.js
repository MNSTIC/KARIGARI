const fs = require('fs');

// 1. Fix Insights Map
const insightsPath = 'src/app/artisan/insights/page.tsx';
let insights = fs.readFileSync(insightsPath, 'utf8');

// I will just find the whole block from "Local Cluster (High Supply)" to "Legend" and replace it properly.
const startMarker = '{/* Local Cluster (High Supply) */}';
const endMarker = '{/* Legend */}';

const startIndex = insights.indexOf(startMarker);
const endIndex = insights.indexOf(endMarker);

if (startIndex !== -1 && endIndex !== -1) {
  const newMiddle = `{/* Local Cluster (High Supply) */}
              <div className="absolute top-[50%] left-[70%] group cursor-pointer">
                <div className="relative z-10 w-4 h-4 bg-green-500 border-[3px] border-white rounded-full shadow-md"></div>
                <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-white rounded-xl shadow-2xl border border-gray-100 w-56 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-20 overflow-hidden">
                  <div className="bg-green-50 px-3 py-2 border-b border-green-100">
                    <div className="font-bold text-sm text-green-900">Local Cluster Hub</div>
                  </div>
                  <div className="p-3 bg-white">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Active Demand</span>
                      <span className="text-sm font-bold text-gray-900">45 Units</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Available Supply</span>
                      <span className="text-sm font-bold text-green-600">890 Units</span>
                    </div>
                  </div>
                </div>
              </div>
            </div> {/* End Inner Map Wrapper */}
            </div> {/* End Outer Container */}

            `;
  insights = insights.substring(0, startIndex) + newMiddle + insights.substring(endIndex);
  fs.writeFileSync(insightsPath, insights);
  console.log("Insights fixed.");
} else {
  console.log("Could not find markers in insights.");
}

// 2. Fix Dashboard Modal
const dashboardPath = 'src/app/artisan/dashboard/page.tsx';
let dashboard = fs.readFileSync(dashboardPath, 'utf8');

if (!dashboard.includes('id="whatsapp-simulator-modal"')) {
  // Add the modal right before the last closing </div> 
  const whatsappModal = `
      {isWhatsappSimOpen && (
        <div id="whatsapp-simulator-modal" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-[2.5rem] w-full max-w-[320px] h-[640px] shadow-2xl flex flex-col overflow-hidden relative border-[10px] border-gray-900">
            {/* Phone Header */}
            <div className="bg-[#075E54] text-white px-4 py-3 flex items-center gap-3 relative z-10 shadow">
              <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center p-1 shrink-0 overflow-hidden">
                <img src="/icons/karigari-logo.png" alt="Karigari" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.src = 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6b/WhatsApp.svg/512px-WhatsApp.svg.png'; }} />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-sm leading-tight">KARIGARI Bot (Govt)</h3>
                <p className="text-[11px] text-white/80 leading-tight flex items-center gap-1">Official MoSJE Partner <CheckCircle2 size={10}/></p>
              </div>
              <button onClick={() => setIsWhatsappSimOpen(false)} className="bg-black/20 p-2 rounded-full hover:bg-black/40"><X size={16} /></button>
            </div>
            
            {/* WhatsApp Chat Background */}
            <div className="flex-1 bg-[#E5DDD5] p-4 flex flex-col gap-3 overflow-y-auto" style={{ backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")' }}>
              <div className="text-center my-2"><span className="bg-[#E1F3FB] text-gray-600 text-[11px] font-bold px-3 py-1.5 rounded-lg shadow-sm">Today</span></div>
              
              <div className="bg-white p-3 rounded-r-xl rounded-bl-xl max-w-[90%] shadow-sm relative">
                <p className="text-sm text-gray-900 leading-snug">🎉 <strong>New Match for your Craft!</strong></p>
                <p className="text-sm text-gray-800 mt-2 leading-snug">A buyer in Mumbai is looking for <strong>Handwoven Odia Saree</strong>. They are offering <strong>₹4,500</strong>.</p>
                <p className="text-sm text-gray-800 mt-2 font-medium">Reply '1' to Accept</p>
                <p className="text-sm text-gray-800 font-medium">Reply '2' to Reject</p>
                <div className="text-[10px] text-gray-400 text-right mt-1">10:42 AM</div>
              </div>

              <div className="bg-[#DCF8C6] p-3 rounded-l-xl rounded-br-xl max-w-[80%] self-end shadow-sm relative mt-2">
                <p className="text-sm text-gray-900">1</p>
                <div className="text-[10px] text-gray-500 text-right mt-1 flex items-center justify-end gap-1">10:45 AM <CheckCircle2 size={12} className="text-[#34B7F1]"/></div>
              </div>

              <div className="bg-white p-3 rounded-r-xl rounded-bl-xl max-w-[90%] shadow-sm relative mt-2">
                <p className="text-sm text-gray-900 leading-snug">✅ <strong>Order Confirmed!</strong></p>
                <p className="text-sm text-gray-800 mt-2 leading-snug">The NGO facilitator has been notified to pick up the item tomorrow at 10 AM. Advance payment of ₹1,500 has been credited to your bank account via UPI.</p>
                <div className="text-[10px] text-gray-400 text-right mt-1">10:45 AM</div>
              </div>
            </div>
            
            {/* Phone Footer */}
            <div className="bg-[#F0F0F0] p-2 flex items-center gap-2">
              <div className="bg-white flex-1 rounded-full px-4 py-2.5 text-sm text-gray-400 border border-gray-200">Type a message</div>
              <div className="w-11 h-11 bg-[#00A884] rounded-full flex items-center justify-center text-white shrink-0 shadow-sm">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
`;

  // We find the last `    </div>\n  );\n}` and replace it
  const endOfFile = '    </div>\n  );\n}';
  if (dashboard.includes(endOfFile)) {
    dashboard = dashboard.replace(endOfFile, whatsappModal);
    fs.writeFileSync(dashboardPath, dashboard);
    console.log("Dashboard modal added.");
  } else {
    // try a more generic replacement at the end of the file
    const lastBraceIndex = dashboard.lastIndexOf('}');
    if (lastBraceIndex !== -1) {
      const beforeLastBrace = dashboard.substring(0, lastBraceIndex);
      const lastDivIndex = beforeLastBrace.lastIndexOf('</div>');
      if (lastDivIndex !== -1) {
        dashboard = beforeLastBrace.substring(0, lastDivIndex) + whatsappModal;
        fs.writeFileSync(dashboardPath, dashboard);
        console.log("Dashboard modal added via generic replacement.");
      }
    }
  }
} else {
  console.log("Modal already exists.");
}
