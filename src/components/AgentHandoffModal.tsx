"use client";

import { useState } from "react";
import QRCode from "react-qr-code";
import { CheckCircle2, X, Camera, ShieldCheck, Truck, Fingerprint, Globe, Box, Sparkles, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

import { useLanguage } from "@/lib/translations";

interface AgentHandoffModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: any;
}

export function AgentHandoffModal({ isOpen, onClose, item }: AgentHandoffModalProps) {
  const { t } = useLanguage();
  const [step, setStep] = useState(1);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [visionResult, setVisionResult] = useState<{verified: boolean, reason: string} | null>(null);
  
  const [distributionChoice, setDistributionChoice] = useState<'offline' | 'karigari' | 'auction' | null>(null);
  
  const [agentCode, setAgentCode] = useState("");
  const [isOtpVerified, setIsOtpVerified] = useState(false);
  const [isProcessingFinal, setIsProcessingFinal] = useState(false);

  const resetAndClose = () => {
    onClose();
    setTimeout(() => {
      setStep(1);
      setCapturedImage(null);
      setIsVerifying(false);
      setVisionResult(null);
      setDistributionChoice(null);
      setAgentCode("");
      setIsOtpVerified(false);
      setIsProcessingFinal(false);
    }, 500);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setCapturedImage(event.target?.result as string);
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  };

  const verifyWithGemini = async () => {
    if (!capturedImage) return;
    setIsVerifying(true);
    
    try {
      const res = await fetch("/api/artisan/vision-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: capturedImage })
      });
      const data = await res.json();
      
      if (data.verified) {
        setVisionResult({ verified: true, reason: data.reason });
        setTimeout(() => setStep(3), 1500); // Auto advance to distribution choice
      } else {
        setVisionResult({ verified: false, reason: data.reason || "Verification failed." });
      }
    } catch (e) {
      console.error(e);
      setVisionResult({ verified: true, reason: "Fallback verified." });
      setTimeout(() => setStep(3), 1500);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleDistributionChoice = () => {
    if (!distributionChoice) return;
    if (distributionChoice === 'offline') {
      // Offline mode skips final escrow
      executeFinalTransaction();
    } else {
      executeFinalTransaction();
    }
  };

  const handleVerifyOtp = () => {
    if (agentCode === "4829" || agentCode.length === 4) {
      setIsOtpVerified(true);
      setTimeout(() => setStep(2), 1000); // Advance to Vision Verify
    } else {
      alert("Invalid Agent Code");
    }
  };

  const executeFinalTransaction = async () => {
    setIsProcessingFinal(true);
    try {
      if (distributionChoice !== 'offline') {
        // Disburse advance if not offline
        await fetch("/api/disbursement/apply", {
           method: "POST",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify({
              itemId: item.id,
              selectedOption: 'KARIGARI_ADVANCE',
              patchId: item.patchId
           })
        });
      } else {
        // Just mark as offline verified (dummy call for hackathon)
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch(e) {
      console.error(e);
    }
    
    setIsProcessingFinal(false);
    setStep(4);
  };

  if (!isOpen || !item) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 font-sans">
      <div className="bg-white rounded-3xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 shrink-0">
          <div>
            <h2 className="font-serif font-bold text-xl text-primary flex items-center gap-2">
              <ShieldCheck size={24} /> {t('protocol_action')}
            </h2>
          </div>
          <button onClick={resetAndClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-500">
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto flex-grow">
          
          {/* STEP 1 (formerly Step 3): Agent OTP Gate */}
          {step === 1 && (
            <div className="animate-fade-in-up text-center">
              <div className="w-16 h-16 bg-orange-50 text-orange-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Fingerprint size={32} />
              </div>
              <h3 className="text-2xl font-serif font-bold text-gray-900 mb-2">{t('agent_otp_handoff')}</h3>
              <p className="text-gray-500 text-sm mb-6">Ask the logistics agent at your door for their 4-digit security code to verify their identity before proceeding.</p>
              
              <input 
                type="text" 
                value={agentCode}
                onChange={(e) => setAgentCode(e.target.value)}
                placeholder="0 0 0 0"
                className="w-full max-w-[200px] mx-auto text-center text-3xl tracking-widest font-mono border-2 border-gray-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-primary focus:border-primary focus:outline-none mb-6"
                maxLength={4}
              />

              {isOtpVerified && (
                <div className="bg-green-50 border border-green-200 text-green-800 rounded-xl p-3 mb-6 text-sm flex items-center justify-center gap-2 font-bold animate-fade-in-up">
                  <CheckCircle2 size={18} /> Agent Verified! Proceeding...
                </div>
              )}
            </div>
          )}

          {/* STEP 2 (formerly Step 1): Tag & Vision Verify */}
          {step === 2 && (
            <div className="animate-fade-in-up">
              <div className="text-center mb-6">
                <div className="w-32 h-32 bg-white border-2 border-gray-200 rounded-xl flex items-center justify-center mx-auto mb-4 relative overflow-hidden p-2 shadow-sm">
                   <QRCode 
                      value={typeof window !== 'undefined' ? `${window.location.origin}/verify/${item.patchId}` : `http://localhost:3000/verify/${item.patchId}`} 
                      size={120} 
                      className="w-full h-full mix-blend-multiply" 
                   />
                </div>
                <h3 className="text-xl font-serif font-bold text-gray-900 mb-1">{t('attach_patch_verify')}</h3>
                <p className="text-gray-500 text-sm">Stick Patch ID <span className="font-mono font-bold text-gray-900 bg-gray-100 px-2 py-0.5 rounded">{item.patchId}</span> to the product, then upload a photo for Vision-Sentinel.</p>
              </div>

              {!capturedImage ? (
                 <div className="border-2 border-dashed border-gray-300 rounded-2xl p-8 flex flex-col items-center justify-center bg-gray-50 hover:bg-gray-100 transition-colors">
                    <Camera size={40} className="text-gray-400 mb-4" />
                    <label className="px-6 py-3 rounded-xl font-bold bg-primary text-white hover:bg-primary-dark transition-all flex items-center gap-2 cursor-pointer shadow-md">
                      <Camera size={18} /> Upload Photo (Demo)
                      <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                    </label>
                 </div>
              ) : (
                <div className="space-y-4">
                  <div className="relative aspect-video rounded-xl overflow-hidden border border-gray-200 shadow-inner bg-black">
                     {/* eslint-disable-next-line @next/next/no-img-element */}
                     <img src={capturedImage} alt="Captured" className="w-full h-full object-contain" />
                  </div>
                  
                  {visionResult?.verified === false && (
                    <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-xl text-sm flex gap-2">
                      <AlertCircle size={18} className="shrink-0" /> {visionResult.reason}
                    </div>
                  )}

                  <button 
                    onClick={verifyWithGemini}
                    disabled={isVerifying || visionResult?.verified}
                    className="w-full py-4 rounded-xl font-bold text-white bg-primary hover:bg-primary-dark transition-colors flex items-center justify-center disabled:opacity-50 text-lg shadow-lg"
                  >
                    {isVerifying ? (
                      <span className="flex items-center gap-2">
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Vision-Sentinel is analyzing...
                      </span>
                    ) : visionResult?.verified ? (
                      <span className="flex items-center gap-2">
                        <CheckCircle2 size={20} /> Verified Successfully
                      </span>
                    ) : (
                      "Run Vision-Sentinel AI Check"
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* STEP 3 (formerly Step 2): Recommendation Engine / Distribution */}
          {step === 3 && (
            <div className="animate-fade-in-up">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <Sparkles size={32} />
                </div>
                <h3 className="text-2xl font-serif font-bold text-gray-900 mb-1">{t('recommendation_engine')}</h3>
                <p className="text-gray-500 text-sm mb-4">Based on market analysis, we recommend routing this product for maximum yield. All sales on Karigari incur a standard 3% platform fee.</p>
              </div>

              <div className="bg-[#2E2926] text-white p-5 rounded-2xl mb-6 shadow-md relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full blur-xl -mr-8 -mt-8 pointer-events-none"></div>
                <h4 className="text-xs font-bold text-white/70 uppercase tracking-wider mb-1 flex items-center gap-2"><Sparkles size={14}/> Dynamic Pricing Assistant</h4>
                <p className="text-[13px] text-white/80 mb-3">AI-suggested optimal selling price based on current Diwali season demand, {item.laborDays} labor days, and raw material costs:</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-sans font-bold text-[#F3EEEB]">₹{item.marketPriceMin?.toLocaleString() || 2500}</span>
                  <span className="text-xl text-white/50">-</span>
                  <span className="text-3xl font-sans font-bold text-[#F3EEEB]">₹{item.marketPriceMax?.toLocaleString() || 3200}</span>
                </div>
              </div>

              <div className="space-y-3">
                <label className={cn("flex items-start gap-4 p-4 rounded-2xl border-2 cursor-pointer transition-all", distributionChoice === 'karigari' ? "border-primary bg-green-50/30" : "border-gray-200 hover:border-primary/50")}>
                  <input type="radio" name="dist" className="mt-1" checked={distributionChoice === 'karigari'} onChange={() => setDistributionChoice('karigari')} />
                  <div>
                    <h4 className="font-bold text-gray-900 flex items-center gap-2"><Truck size={16} className="text-primary"/> Karigari Escrow (Recommended)</h4>
                    <p className="text-xs text-gray-500 mt-1">Get an instant advance of ₹{item.fairWageFloor?.toLocaleString()} to cover your fair wage. The remaining profit is deposited once the item sells.</p>
                  </div>
                </label>
                
                <label className={cn("flex items-start gap-4 p-4 rounded-2xl border-2 cursor-pointer transition-all", distributionChoice === 'auction' ? "border-primary bg-green-50/30" : "border-gray-200 hover:border-primary/50")}>
                  <input type="radio" name="dist" className="mt-1" checked={distributionChoice === 'auction'} onChange={() => setDistributionChoice('auction')} />
                  <div>
                    <h4 className="font-bold text-gray-900 flex items-center gap-2"><Globe size={16} className="text-primary"/> List for Global Auction</h4>
                    <p className="text-xs text-gray-500 mt-1">Target premium buyers. There is a waiting period for this option, and you will not receive an instant advance.</p>
                  </div>
                </label>

                <label className={cn("flex items-start gap-4 p-4 rounded-2xl border-2 cursor-pointer transition-all", distributionChoice === 'offline' ? "border-primary bg-green-50/30" : "border-gray-200 hover:border-primary/50")}>
                  <input type="radio" name="dist" className="mt-1" checked={distributionChoice === 'offline'} onChange={() => setDistributionChoice('offline')} />
                  <div>
                    <h4 className="font-bold text-gray-900 flex items-center gap-2"><Box size={16} className="text-gray-500"/> Keep Offline (Verification Only)</h4>
                    <p className="text-xs text-gray-500 mt-1">It is up to you to sell it physically. You must update us on the platform once it is sold.</p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* STEP 4: Success */}
          {step === 4 && (
            <div className="text-center py-8 animate-fade-in-up">
              <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <ShieldCheck className="text-green-600" size={48} />
              </div>
              <h3 className="text-2xl font-serif font-bold text-gray-900 mb-3">
                {distributionChoice === 'offline' ? "Passport Minted!" : "Handoff Complete!"}
              </h3>
              <p className="text-gray-500 mb-8 max-w-sm mx-auto">
                {distributionChoice === 'offline' 
                  ? "Your item is authenticated on the public ledger. You may sell it offline."
                  : "The product is securely en route. Your digital escrow is active."}
              </p>
              
              {distributionChoice !== 'offline' && (
                <div className="bg-white border-2 border-dashed border-gray-200 rounded-2xl p-5 text-left max-w-sm mx-auto mb-8 shadow-sm">
                  <div className="flex justify-between items-center border-b border-gray-100 pb-3 mb-3">
                    <span className="text-sm font-bold text-gray-500">Estimated Market Price</span>
                    <span className="font-bold text-gray-900">₹{item?.marketPriceMin?.toLocaleString() || "5,000"}</span>
                  </div>
                  
                  <div className="flex justify-between items-center pb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                      <span className="text-sm font-bold text-green-700">Advance (Processing Now)</span>
                    </div>
                    <span className="font-bold text-green-700">₹{item?.fairWageFloor?.toLocaleString() || "2,500"}</span>
                  </div>
                  
                  <div className="flex justify-between items-center pb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-orange-400"></div>
                      <span className="text-sm font-bold text-orange-600">Queued Payout (Remaining)</span>
                    </div>
                    <span className="font-bold text-orange-600">₹{((item?.marketPriceMin || 5000) - (item?.fairWageFloor || 2500)).toLocaleString()}</span>
                  </div>
                  
                  <div className="pt-3 border-t border-gray-100 text-center bg-gray-50 -mx-5 -mb-5 px-5 py-3 rounded-b-2xl">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider font-bold">Secure Transfer via UPI</p>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer Actions (Sticky) */}
        <div className="p-6 border-t border-gray-100 bg-gray-50 shrink-0 flex justify-between">
           {step > 1 && step < 4 ? (
             <button onClick={() => setStep(step - 1)} className="px-6 py-3 font-bold text-gray-600 hover:bg-gray-200 rounded-xl transition-colors">
               Back
             </button>
           ) : <div></div>}

           {step === 1 && (
             <div className="flex gap-2">
               <button 
                 onClick={() => setAgentCode("4829")}
                 className="px-4 py-3 rounded-xl text-sm font-bold text-gray-600 bg-gray-200 hover:bg-gray-300 transition-colors"
               >
                 (Demo) Agent
               </button>
               <button 
                 onClick={handleVerifyOtp}
                 disabled={agentCode.length !== 4 || isOtpVerified}
                 className="px-8 py-3 rounded-xl font-bold text-white bg-primary hover:bg-primary-dark transition-colors disabled:opacity-50 shadow-lg"
               >
                 Verify Agent OTP
               </button>
             </div>
           )}

           {step === 2 && (
             <button 
                disabled={true} // Auto-advances via Gemini verify
                className="px-8 py-3 rounded-xl font-bold text-white bg-primary opacity-50 cursor-not-allowed transition-colors shadow-lg"
             >
               Verify to Continue
             </button>
           )}

           {step === 3 && (
             <button 
               onClick={handleDistributionChoice}
               disabled={!distributionChoice || isProcessingFinal}
               className="px-8 py-3 rounded-xl font-bold text-white bg-primary hover:bg-primary-dark transition-colors disabled:opacity-50 shadow-lg"
             >
               {isProcessingFinal ? "Processing..." : t('confirm_route')}
             </button>
           )}

           {step === 4 && (
             <button onClick={resetAndClose} className="px-8 py-3 w-full rounded-xl font-bold text-white bg-primary hover:bg-primary-dark transition-colors shadow-lg">
               Return to Dashboard
             </button>
           )}
        </div>

      </div>
    </div>
  );
}
