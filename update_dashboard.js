const fs = require('fs');
let content = fs.readFileSync('C:/Users/DELL/.gemini/antigravity/brain/7e01581f-b738-4d2a-b156-9053ea7320e8/scratch/dashboard.tsx', 'utf8');

content = content.replace(
  'const [isProfileEditorOpen, setIsProfileEditorOpen] = useState(false);',
  'const [isProfileEditorOpen, setIsProfileEditorOpen] = useState(false);\n  const [isWhatsappSimOpen, setIsWhatsappSimOpen] = useState(false);'
);

const banner = `
        {/* WHATSAPP SIMULATOR BANNER */}
        <div className="mb-10 bg-gradient-to-r from-green-500 to-teal-600 rounded-2xl p-6 shadow-md text-white flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="font-bold text-lg mb-1">Demo: Offline SMS / WhatsApp Fallback</h3>
            <p className="text-white/80 text-sm">Show judges how artisans receive demand alerts via WhatsApp when offline.</p>
          </div>
          <button onClick={() => setIsWhatsappSimOpen(true)} className="bg-white text-green-700 font-bold px-6 py-3 rounded-xl shadow hover:bg-green-50 transition-colors whitespace-nowrap">
            Run Simulation
          </button>
        </div>

        {/* QUICK ACTIONS */}`;

content = content.replace('{/* QUICK ACTIONS */}', banner);

const whatsappModal = `
      {isWhatsappSimOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
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
      )}`;

content = content.replace('</main>', whatsappModal + '\n      </main>');

fs.writeFileSync('C:/Users/DELL/.gemini/antigravity/brain/7e01581f-b738-4d2a-b156-9053ea7320e8/scratch/dashboard.tsx', content);
